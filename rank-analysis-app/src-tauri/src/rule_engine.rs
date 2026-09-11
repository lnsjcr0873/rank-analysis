//! 规则引擎：选人会话的条件求值原语。
//!
//! 提供 `detect_my_position`（从会话中解析当前用户的分路）与
//! `match_condition`（求值单个规则条件）。规则遍历与目标选择
//! 已由 [`crate::bp_decision::evaluate`] 承担，本模块不再负责。

use crate::command::rule_config::{Position, RuleCondition};
use crate::lcu::api::champion_select::{OnePlayer, SelectSession};

/// 从选人会话中找到当前用户，读取其 `assigned_position` 并映射到 `Position`。
///
/// 支持明文 PUUID、混淆 PUUID 还原（排位赛隐私模式）以及本地格子 `cell_id` 兜底。
/// 大乱斗 / 普通匹配等 `assignedPosition == ""` 的场景返回 `None`，
/// 此时 `Position` 条件永远不匹配（按设计）。
pub fn detect_my_position(session: &SelectSession, my_puuid: &str) -> Option<Position> {
    let me = session.my_team.iter().find(|p| {
        if !my_puuid.is_empty() {
            if !p.puuid.is_empty() && p.puuid.eq_ignore_ascii_case(my_puuid) {
                return true;
            }
            if !p.obfuscated_puuid.is_empty() {
                if let Ok(real) = crate::lcu::util::uuid::deobfuscate_puuid(&p.obfuscated_puuid) {
                    if real.eq_ignore_ascii_case(my_puuid) {
                        return true;
                    }
                }
            }
        }
        p.cell_id == session.local_player_cell_id && (p.puuid.is_empty() || my_puuid.is_empty())
    })?;
    parse_position(&me.assigned_position)
}

/// LCU `assigned_position` → `Position`（debug4-5）。
///
/// LCU 选人会话经常下发缩写（最常见 `mid`），此前仅匹配五档全称，
/// 中路规则在实机选人期永远不匹配。别名口径与 `opgg::data::normalize_position`
///（MID/ADC/SUPPORT）及前端 `normalizeLcuPosition` 对齐；大小写不敏感。
pub(crate) fn parse_position(s: &str) -> Option<Position> {
    match s.trim().to_ascii_lowercase().as_str() {
        "top" => Some(Position::Top),
        "jungle" | "jng" | "jung" => Some(Position::Jungle),
        "middle" | "mid" => Some(Position::Middle),
        "bottom" | "bot" | "adc" => Some(Position::Bottom),
        "utility" | "support" | "sup" | "supp" => Some(Position::Utility),
        _ => None,
    }
}

/// 求值单个条件。
pub(crate) fn match_condition(
    cond: &RuleCondition,
    session: &SelectSession,
    my_position: Option<Position>,
) -> bool {
    match cond {
        RuleCondition::Position { value } => my_position == Some(*value),
        RuleCondition::AllyChampionsContains { ids } => team_has_any(&session.my_team, ids),
        // 取反条件不能「空真」：banning 阶段队友还没亮英雄（championId 全 0）时，
        // "队友不包含莫甘娜" 会恒真触发误 Ban。必须至少有一位队友已选定英雄
        // （非 0）才允许对「不包含」做判定——否则条件不匹配。
        //
        // 另：ids 为空（前端未选具体英雄就保存）是无意义的配置错误，一律判 false，
        // 防止"排除空集"恒真霸占后续所有正规规则与兜底池。
        RuleCondition::AllyChampionsNotContains { ids } => {
            !ids.is_empty()
                && team_has_any_selection(&session.my_team)
                && !team_has_any(&session.my_team, ids)
        }
        RuleCondition::EnemyChampionsContains { ids } => team_has_any(&session.their_team, ids),
        RuleCondition::EnemyChampionsNotContains { ids } => {
            !ids.is_empty()
                && team_has_any_selection(&session.their_team)
                && !team_has_any(&session.their_team, ids)
        }
    }
}

/// 队伍中是否**已有人选定英雄**（任意 championId 非 0）。
///
/// 取反条件（NotContains）的前置守卫：全队都没亮英雄时没有可断言的对象，
/// 若直接取反会空真误命中（如 banning 阶段队友未预选 → 误 Ban 队友想玩的英雄）。
fn team_has_any_selection(team: &[OnePlayer]) -> bool {
    team.iter().any(|p| p.champion_id != 0)
}

/// 检查队伍中是否有英雄 ID 命中给定列表。championId == 0 视为"未选"，不计入。
fn team_has_any(team: &[OnePlayer], ids: &[i32]) -> bool {
    team.iter().any(|p| {
        let cid = p.champion_id;
        cid != 0 && ids.contains(&cid)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_session(my_team: Vec<OnePlayer>) -> SelectSession {
        SelectSession {
            my_team,
            their_team: vec![],
            actions: vec![],
            timer: Default::default(),
            local_player_cell_id: 0,
            trades: Vec::new(),
            bench_champions: Vec::new(),
        }
    }

    fn player(puuid: &str, position: &str) -> OnePlayer {
        OnePlayer {
            champion_id: 0,
            puuid: puuid.to_string(),
            obfuscated_puuid: String::new(),
            assigned_position: position.to_string(),
            cell_id: 0,
            champion_pick_intent: 0,
        }
    }

    #[test]
    fn detect_my_position_when_assigned() {
        let s = make_session(vec![player("me", "middle")]);
        assert_eq!(detect_my_position(&s, "me"), Some(Position::Middle));
    }

    #[test]
    fn detect_my_position_returns_none_for_empty_assigned() {
        let s = make_session(vec![player("me", "")]);
        assert_eq!(detect_my_position(&s, "me"), None);
    }

    #[test]
    fn detect_my_position_returns_none_when_puuid_not_found() {
        let s = make_session(vec![player("other", "middle")]);
        assert_eq!(detect_my_position(&s, "me"), None);
    }

    #[test]
    fn detect_my_position_handles_uppercase_lcu_strings() {
        let s = make_session(vec![player("me", "JUNGLE")]);
        assert_eq!(detect_my_position(&s, "me"), Some(Position::Jungle));
    }

    #[test]
    fn position_matches_when_equal() {
        let s = make_session(vec![]);
        let c = RuleCondition::Position {
            value: Position::Middle,
        };
        assert!(match_condition(&c, &s, Some(Position::Middle)));
    }

    #[test]
    fn position_does_not_match_when_different() {
        let s = make_session(vec![]);
        let c = RuleCondition::Position {
            value: Position::Middle,
        };
        assert!(!match_condition(&c, &s, Some(Position::Top)));
    }

    #[test]
    fn position_does_not_match_when_none() {
        let s = make_session(vec![]);
        let c = RuleCondition::Position {
            value: Position::Middle,
        };
        assert!(!match_condition(&c, &s, None));
    }

    fn ally_champ(champion_id: i32) -> OnePlayer {
        OnePlayer {
            champion_id,
            puuid: "x".to_string(),
            obfuscated_puuid: String::new(),
            assigned_position: "".to_string(),
            cell_id: 0,
            champion_pick_intent: 0,
        }
    }

    #[test]
    fn ally_contains_matches_when_at_least_one_ally_has_id() {
        let s = make_session(vec![ally_champ(1), ally_champ(157)]);
        let c = RuleCondition::AllyChampionsContains { ids: vec![157] };
        assert!(match_condition(&c, &s, None));
    }

    #[test]
    fn ally_contains_counts_hovered_champion() {
        // championId != 0 means hovered or locked — both count.
        let s = make_session(vec![ally_champ(238)]);
        let c = RuleCondition::AllyChampionsContains { ids: vec![238] };
        assert!(match_condition(&c, &s, None));
    }

    #[test]
    fn ally_contains_ignores_zero_champion_id() {
        // championId == 0 means "no hover yet" — should NOT match.
        let s = make_session(vec![ally_champ(0)]);
        let c = RuleCondition::AllyChampionsContains { ids: vec![0] };
        assert!(!match_condition(&c, &s, None));
    }

    #[test]
    fn ally_contains_does_not_match_when_no_ally_has_id() {
        let s = make_session(vec![ally_champ(1), ally_champ(2)]);
        let c = RuleCondition::AllyChampionsContains { ids: vec![157] };
        assert!(!match_condition(&c, &s, None));
    }

    #[test]
    fn ally_not_contains_matches_when_team_is_clean() {
        let s = make_session(vec![ally_champ(1), ally_champ(2)]);
        let c = RuleCondition::AllyChampionsNotContains { ids: vec![157] };
        assert!(match_condition(&c, &s, None));
    }

    #[test]
    fn ally_not_contains_does_not_match_when_one_present() {
        let s = make_session(vec![ally_champ(157)]);
        let c = RuleCondition::AllyChampionsNotContains { ids: vec![157] };
        assert!(!match_condition(&c, &s, None));
    }

    fn enemy_champ(champion_id: i32) -> OnePlayer {
        OnePlayer {
            champion_id,
            puuid: "y".to_string(),
            obfuscated_puuid: String::new(),
            assigned_position: "".to_string(),
            cell_id: 0,
            champion_pick_intent: 0,
        }
    }

    fn make_session_with_enemies(
        my_team: Vec<OnePlayer>,
        their_team: Vec<OnePlayer>,
    ) -> SelectSession {
        SelectSession {
            my_team,
            their_team,
            actions: vec![],
            timer: Default::default(),
            local_player_cell_id: 0,
            trades: Vec::new(),
            bench_champions: Vec::new(),
        }
    }

    #[test]
    fn enemy_contains_matches_when_visible() {
        let s = make_session_with_enemies(vec![], vec![enemy_champ(238)]);
        let c = RuleCondition::EnemyChampionsContains { ids: vec![238] };
        assert!(match_condition(&c, &s, None));
    }

    #[test]
    fn enemy_contains_does_not_match_during_ban_phase() {
        // 禁用阶段敌方 championId 均为 0，条件自然不匹配。
        let s = make_session_with_enemies(vec![], vec![enemy_champ(0), enemy_champ(0)]);
        let c = RuleCondition::EnemyChampionsContains { ids: vec![238] };
        assert!(!match_condition(&c, &s, None));
    }

    #[test]
    fn enemy_not_contains_matches_when_clean() {
        let s = make_session_with_enemies(vec![], vec![enemy_champ(1)]);
        let c = RuleCondition::EnemyChampionsNotContains { ids: vec![238] };
        assert!(match_condition(&c, &s, None));
    }

    #[test]
    fn enemy_not_contains_does_not_match_when_one_present() {
        let s = make_session_with_enemies(vec![], vec![enemy_champ(238)]);
        let c = RuleCondition::EnemyChampionsNotContains { ids: vec![238] };
        assert!(!match_condition(&c, &s, None));
    }

    // 边缘情况（T6 审查建议补充）

    #[test]
    fn enemy_contains_does_not_match_when_their_team_empty() {
        let s = make_session_with_enemies(vec![], vec![]);
        let c = RuleCondition::EnemyChampionsContains { ids: vec![157] };
        assert!(!match_condition(&c, &s, None));
    }

    #[test]
    fn enemy_not_contains_does_not_match_when_their_team_empty() {
        // 无敌方英雄时不能「空真」：全队未选英雄 → 取反条件不匹配（防误判）
        let s = make_session_with_enemies(vec![], vec![]);
        let c = RuleCondition::EnemyChampionsNotContains { ids: vec![157] };
        assert!(!match_condition(&c, &s, None));
    }

    #[test]
    fn ally_contains_with_empty_ids_returns_false() {
        // 空列表 "包含以下任意" — 结果为 false。
        let s = make_session(vec![ally_champ(157)]);
        let c = RuleCondition::AllyChampionsContains { ids: vec![] };
        assert!(!match_condition(&c, &s, None));
    }

    #[test]
    fn ally_not_contains_with_empty_ids_never_matches() {
        // 空 ids 是无意义的配置错误（前端未选英雄就保存）："不包含空集"
        // 必须永远判 false，否则有人选英雄时恒真霸占所有后续规则与兜底池。
        let s = make_session(vec![ally_champ(157)]);
        let c = RuleCondition::AllyChampionsNotContains { ids: vec![] };
        assert!(!match_condition(&c, &s, None));
        let none_selected = make_session(vec![ally_champ(0), ally_champ(0)]);
        assert!(!match_condition(&c, &none_selected, None));
    }

    #[test]
    fn enemy_not_contains_with_empty_ids_never_matches() {
        let some = make_session_with_enemies(vec![], vec![enemy_champ(1)]);
        let c = RuleCondition::EnemyChampionsNotContains { ids: vec![] };
        assert!(!match_condition(&c, &some, None));
    }

    #[test]
    fn ally_not_contains_does_not_fire_before_any_ally_picks() {
        // banning 阶段队友都没亮英雄（championId 全 0）：
        // "队友不包含莫甘娜" 若空真会误 Ban 队友想选的英雄，必须不匹配。
        let s = make_session(vec![ally_champ(0), ally_champ(0), ally_champ(0)]);
        let c = RuleCondition::AllyChampionsNotContains { ids: vec![25] };
        assert!(!match_condition(&c, &s, None));
        // 一旦有人预选（非 25）→ 条件恢复成立
        let picked = make_session(vec![ally_champ(64), ally_champ(0), ally_champ(0)]);
        assert!(match_condition(&c, &picked, None));
    }

    #[test]
    fn enemy_not_contains_requires_some_enemy_selection() {
        // 敌方全 0（banning 阶段）不得空真；有人亮英雄后取反正常成立
        let none = make_session_with_enemies(vec![], vec![enemy_champ(0), enemy_champ(0)]);
        let c = RuleCondition::EnemyChampionsNotContains { ids: vec![238] };
        assert!(!match_condition(&c, &none, None));
        let some = make_session_with_enemies(vec![], vec![enemy_champ(1)]);
        assert!(match_condition(&c, &some, None));
    }

    #[test]
    fn ally_contains_walks_full_id_list() {
        // 多 id 列表部分命中：[1, 157, 99] 中的 157 命中队友。
        let s = make_session(vec![ally_champ(157)]);
        let c = RuleCondition::AllyChampionsContains {
            ids: vec![1, 157, 99],
        };
        assert!(match_condition(&c, &s, None));
    }

    #[test]
    fn parse_position_supports_common_aliases() {
        // debug4-5：LCU 常下发缩写（mid 最常见），大小写/空白不敏感
        assert_eq!(parse_position("mid"), Some(Position::Middle));
        assert_eq!(parse_position("MID"), Some(Position::Middle));
        assert_eq!(parse_position(" middle "), Some(Position::Middle));
        assert_eq!(parse_position("adc"), Some(Position::Bottom));
        assert_eq!(parse_position("bot"), Some(Position::Bottom));
        assert_eq!(parse_position("support"), Some(Position::Utility));
        assert_eq!(parse_position("sup"), Some(Position::Utility));
        assert_eq!(parse_position("jng"), Some(Position::Jungle));
        assert_eq!(parse_position("top"), Some(Position::Top));
        assert_eq!(parse_position(""), None);
        assert_eq!(parse_position("captain"), None);
    }

    #[test]
    fn detect_my_position_matches_cell_id_when_ranked_puuid_empty() {
        let mut s = make_session(vec![
            OnePlayer {
                champion_id: 0,
                puuid: "".to_string(),
                obfuscated_puuid: "".to_string(),
                assigned_position: "top".to_string(),
                cell_id: 2,
                champion_pick_intent: 0,
            },
            OnePlayer {
                champion_id: 0,
                puuid: "".to_string(),
                obfuscated_puuid: "".to_string(),
                assigned_position: "bottom".to_string(),
                cell_id: 3,
                champion_pick_intent: 0,
            },
        ]);
        s.local_player_cell_id = 2;
        assert_eq!(detect_my_position(&s, "some-puuid"), Some(Position::Top));
    }
}
