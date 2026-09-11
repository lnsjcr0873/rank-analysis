//! BP 决策求值：纯函数，OP.GG snapshot 作为参数注入。

use crate::bp_decision::types::{BpActionType, MyPendingAction, Unavailable};
use crate::lcu::api::champion_select::{SelectSession, Timer};
use std::collections::HashMap;

use crate::bp_decision::types::{BpDecision, BpEvidence, BpMode, BpOrigin, BpRejected, BpTarget};
use crate::command::rule_config::{BanRule, PickRule, Position};
use crate::opgg::data::OpggSnapshot;
use crate::rule_engine::{detect_my_position, match_condition};

/// LCU 的 `adjustedTimeLeftInPhase` 以**毫秒**返回，转成秒。
///
/// 真机核对方法：观察 `automation.rs` 里 `BP execute:` 日志打出的 time_left——
/// 应落在 0~35s 区间且随时间递减；若实测打出的是 0.0xx 量级（例如
/// "0.027s left"），说明 LCU 返回的其实已经是秒，去掉本函数里的 `/ 1000.0`
/// 这一处换算即可。
pub fn phase_secs_left(timer: &Timer) -> f64 {
    timer.adjusted_time_left_in_phase / 1000.0
}

/// 找到当前用户尚未完成的那个 BP 动作。
///
/// 优先返回 `is_in_progress` 的（轮到我了），否则返回第一个未完成的
/// （预选期：pick action 已存在但还没轮到我，此时仍应 hover）。
pub fn find_my_pending_action(session: &SelectSession) -> Option<MyPendingAction> {
    let my_cell = session.local_player_cell_id;
    let mut fallback: Option<MyPendingAction> = None;

    for group in &session.actions {
        for a in group {
            if a.actor_cell_id != my_cell || a.completed {
                continue;
            }
            let action_type = match a.action_type.as_str() {
                "ban" => BpActionType::Ban,
                "pick" => BpActionType::Pick,
                _ => continue,
            };
            let pending = MyPendingAction {
                action_id: a.id,
                action_type,
                is_in_progress: a.is_in_progress,
                champion_id: a.champion_id,
            };
            if a.is_in_progress {
                return Some(pending);
            }
            if fallback.is_none() {
                fallback = Some(pending);
            }
        }
    }
    fallback
}

/// 收集当前会话中不可选 / 不可 ban 的英雄，并保留原因。
///
/// **不合并原因**——决策带要区分「已被 ban」和「已被他人选走」，
/// 且后者要分清我方还是对面。
/// 当前用户自己的 hover/pick 不计入（允许重新选择同一英雄）。
pub fn unavailable_map(session: &SelectSession) -> HashMap<i32, Unavailable> {
    let my_cell = session.local_player_cell_id;
    let mut map = HashMap::new();

    for group in &session.actions {
        for a in group {
            if a.action_type == "ban" && a.completed {
                map.insert(a.champion_id, Unavailable::Banned);
            }
            if a.action_type == "pick" && a.actor_cell_id != my_cell && a.champion_id != 0 {
                map.entry(a.champion_id).or_insert(Unavailable::Taken {
                    by_ally: a.is_ally_action,
                });
            }
        }
    }
    map
}

/// 用户接管检测。
///
/// 记住我们最后一次 hover 的英雄 ID：
/// - 若此前已主动 hover（`last_hovered` 为 `Some(ours)`）：当前 hover 只要不再等于
///   我们记录的值（包括**清空成 0**——用户手动点取消/清空）即判定用户接管。
///   否则上一轮「点取消立即被脚本弹回原英雄」的按键争夺会复现：用户清空后
///   工具在下一 tick 又把目标 hover 写回去。
/// - 若此前尚未主动 hover（`None`）：此时 `current_hover` 可能是用户自主预选，
///   也可能是**我们自己的 hover 正在落库**（PATCH 已生效、但 set_last_hovered
///   因时序尚未写入）。因此只有「当前非 0 且 ≠ 我们正要执行的 target」才判定
///   接管——等于工具自身目标时显然是自己的动作，不算用户覆盖。
pub fn detect_override(
    current_hover: i32,
    last_hovered: Option<i32>,
    our_target: Option<i32>,
) -> bool {
    match last_hovered {
        Some(ours) => current_hover != ours,
        None => current_hover != 0 && our_target != Some(current_hover),
    }
}

/// 求值所需的全部输入。OP.GG snapshot 由调用方注入，本模块不取数据。
pub struct BpContext<'a> {
    pub session: &'a SelectSession,
    pub my_puuid: &'a str,
    pub pick_rules: &'a [PickRule],
    pub ban_rules: &'a [BanRule],
    /// pickChampionSlice 兜底池
    pub pick_pool: &'a [i32],
    /// banChampionSlice 兜底池
    pub ban_pool: &'a [i32],
    /// None = 数据缺失，此时择选退化为「第一个可用」
    pub snapshot: Option<&'a OpggSnapshot>,
    pub mode: BpMode,
    pub execute_at_secs_left: f64,
    /// 我们最后一次主动 hover 的英雄 ID，用于接管检测
    pub last_hovered: Option<i32>,
}

/// `Position` → LCU 分路命名，与 `opgg::data::normalize_position` 的输出对齐。
fn position_to_lcu(p: Position) -> &'static str {
    match p {
        Position::Top => "TOP",
        Position::Jungle => "JUNGLE",
        Position::Middle => "MIDDLE",
        Position::Bottom => "BOTTOM",
        Position::Utility => "UTILITY",
    }
}

/// 敌方已亮出的英雄 ID（0 = 未选，剔除）。
fn enemy_champion_ids(session: &SelectSession) -> Vec<i32> {
    session
        .their_team
        .iter()
        .map(|p| p.champion_id)
        .filter(|&id| id != 0)
        .collect()
}

/// 敌方已亮出英雄 → 其实际分路（`assigned_position` 大写 LCU 命名；空串 = 未知）。
///
/// 同一英雄被敌方多人以不同位置选出时取首个非空分路（选人期极少换位摇摆，
/// 首个即主分路的概率最高；未知时调用方回退旧行为，不过滤）。
fn enemy_positions(session: &SelectSession) -> HashMap<i32, String> {
    let mut map: HashMap<i32, String> = HashMap::new();
    for p in &session.their_team {
        if p.champion_id == 0 {
            continue;
        }
        let pos = p.assigned_position.trim().to_ascii_uppercase();
        let dominated = map.get(&p.champion_id).is_some_and(|e| !e.is_empty());
        if !dominated {
            map.insert(p.champion_id, pos);
        }
    }
    map
}

/// 目标英雄面对当前敌方阵容时**最差的一条已知对位**。
///
/// OP.GG 只给每分路最难打的 top3 对手，因此本函数天然只可能返回劣势对位；
/// 敌方阵容与该英雄的苦手名单无交集时返回 None（这是常态，不是错误）。
///
/// 分路过滤沿用 `command/opgg.rs::select_meta` 的「精确命中 → 回退」策略：
/// 有分路信息时优先取同分路记录，取不到再放宽到任意分路；
/// `my_position` 为 None（ARAM 等）时完全不按分路过滤。
///
/// 双向分路核验（debug3-B3）：`LaneCounter.position` 是"该英雄打这个位置时
/// 被克制"——只验我方分路不够。敌方豹女走辅助时，她的 JUNGLE 克制记录不
/// 得用于排挤我方打野盲僧。`enemy_positions` 为空（无任何分路信息）时保守
/// 保留旧行为；某英雄分路未知时该条保留（宁可误报不漏报）；其余已知错位
/// 的记录剔除，全部剔除后直接返回 None（没有真实对位）。
pub fn worst_matchup(
    champion_id: i32,
    enemy_ids: &[i32],
    enemy_positions: &HashMap<i32, String>,
    snapshot: Option<&OpggSnapshot>,
    my_position: Option<Position>,
) -> Option<BpEvidence> {
    let counters = snapshot?.counters.get(&champion_id)?;
    let mut present: Vec<_> = counters
        .iter()
        .filter(|c| enemy_ids.contains(&c.opponent_id))
        .collect();
    if present.is_empty() {
        return None;
    }
    if !enemy_positions.is_empty() {
        let filtered: Vec<_> = present
            .iter()
            .filter(|c| match enemy_positions.get(&c.opponent_id) {
                Some(enemy_pos) if !enemy_pos.is_empty() => *enemy_pos == c.position,
                _ => true,
            })
            .copied()
            .collect();
        if filtered.is_empty() {
            return None;
        }
        present = filtered;
    }

    let picked = my_position
        .and_then(|p| {
            let lcu = position_to_lcu(p);
            present
                .iter()
                .filter(|c| c.position == lcu)
                .min_by(|a, b| a.subject_win_rate.total_cmp(&b.subject_win_rate))
                .copied()
        })
        .or_else(|| {
            present
                .iter()
                .min_by(|a, b| a.subject_win_rate.total_cmp(&b.subject_win_rate))
                .copied()
        })?;

    Some(BpEvidence {
        win_rate: picked.subject_win_rate,
        against_champion_id: picked.opponent_id,
        matchup_delta: None,
    })
}

/// 从兜底池择选：**避雷 + 列表序**。
///
/// OP.GG 只有「最难打的 top3 对手」这份稀疏负向样本，无法 maximize，
/// 因此语义是排除而非择优：
/// 1. 跳过不可用（已 ban / 已被选）的候选，记入 `rejected`
/// 2. 跳过被在场敌方克制的候选，记入 `rejected::CounteredBy`
/// 3. 返回列表序第一个「干净」的候选
/// 4. 全被克制时硬选列表序第一个，并把它的劣势对位作为 evidence 返回
///    （此时它不再出现在 `rejected` 里——它是目标，不是落选）
///
/// 无 snapshot / ARAM（`counters` 为空）时第 2 步恒不触发，
/// 行为与今天的「第一个可用」完全一致。
pub fn pick_best_from(
    pool: &[i32],
    enemy_ids: &[i32],
    enemy_positions: &HashMap<i32, String>,
    unavailable: &HashMap<i32, Unavailable>,
    snapshot: Option<&OpggSnapshot>,
    my_position: Option<Position>,
) -> (Option<i32>, Vec<BpRejected>, Option<BpEvidence>) {
    let mut rejected = Vec::new();
    let mut countered: Vec<(i32, BpEvidence)> = Vec::new();

    for &id in pool {
        if let Some(u) = unavailable.get(&id) {
            rejected.push(rejection_for(id, *u));
            continue;
        }
        match worst_matchup(id, enemy_ids, enemy_positions, snapshot, my_position) {
            Some(ev) => {
                rejected.push(BpRejected::CounteredBy {
                    champion_id: id,
                    opponent_id: ev.against_champion_id,
                    subject_win_rate: ev.win_rate,
                });
                countered.push((id, ev));
            }
            None => return (Some(id), rejected, None),
        }
    }

    match countered.first().copied() {
        Some((id, ev)) => {
            rejected.retain(
                |r| !matches!(r, BpRejected::CounteredBy { champion_id, .. } if *champion_id == id),
            );
            (Some(id), rejected, Some(ev))
        }
        None => (None, rejected, None),
    }
}

/// 把不可用原因翻译成落选条目。
fn rejection_for(champion_id: i32, u: Unavailable) -> BpRejected {
    match u {
        Unavailable::Banned => BpRejected::Banned { champion_id },
        Unavailable::Taken { by_ally } => BpRejected::Taken {
            champion_id,
            by_ally,
        },
    }
}

/// 大乱斗 / Mayhem 等随机英雄模式的 bench 换人求值（debug4-12）。
///
/// 这些模式 LCU 根本不下发 BP actions（`session.actions` 为空），
/// [`evaluate_bp_decision`] 首行即返回 None——而 bench 换人恰恰最需要在
/// 这些模式工作。独立求值不依赖 pending action：已锁定英雄 + 决策改推的
/// 目标在 bench 池中即换。调用方（执行侧）负责冷却与模式门禁。
pub fn evaluate_bench_swap_target(
    session: &SelectSession,
    my_puuid: &str,
    pick_rules: &[PickRule],
    pick_pool: &[i32],
    snapshot: Option<&OpggSnapshot>,
) -> Option<i32> {
    use crate::rule_engine::match_condition;
    if session.bench_champions.is_empty() {
        return None;
    }
    // 我方已锁定英雄（征召 pick 完成 / 大乱斗直接分配）
    let locked = session
        .actions
        .iter()
        .flatten()
        .find_map(|a| {
            (a.actor_cell_id == session.local_player_cell_id
                && a.action_type == "pick"
                && a.completed
                && a.champion_id > 0)
                .then_some(a.champion_id)
        })
        .or_else(|| {
            session.my_team.iter().find_map(|p| {
                (p.cell_id == session.local_player_cell_id && p.champion_id > 0)
                    .then_some(p.champion_id)
            })
        })?;
    let unavailable = unavailable_map(session);
    let my_position = crate::rule_engine::detect_my_position(session, my_puuid);
    let enemy_ids = enemy_champion_ids(session);
    let enemy_pos = enemy_positions(session);
    // 规则优先，兜底次之——与 evaluate_bp_decision 同序
    for rule in pick_rules.iter().filter(|r| r.enabled) {
        if !rule
            .conditions
            .iter()
            .all(|c| match_condition(c, session, my_position))
        {
            continue;
        }
        let champ = rule.action.champion_id;
        if champ != locked
            && !unavailable.contains_key(&champ)
            && session.bench_champions.contains(&champ)
        {
            return Some(champ);
        }
    }
    let (chosen, _, _) = pick_best_from(
        pick_pool,
        &enemy_ids,
        &enemy_pos,
        &unavailable,
        snapshot,
        my_position,
    );
    chosen.filter(|c| *c != locked && session.bench_champions.contains(c))
}

/// 求值一次完整的 BP 决策。
///
/// 返回 None 表示当前没有属于我的待办 BP 动作（非选人期、或我的回合已完成）。
///
/// # 顺序
/// 1. 按用户拖拽顺序遍历规则，第一条「条件全满足且目标可执行」的即为目标
/// 2. 无规则命中 → 走兜底池的避雷择选（见 [`pick_best_from`]）
/// 3. 无论走哪条路，都尝试为目标附上 evidence（面对当前阵容的最差对位）
pub fn evaluate_bp_decision(ctx: &BpContext) -> Option<BpDecision> {
    let pending = find_my_pending_action(ctx.session)?;
    let unavailable = unavailable_map(ctx.session);
    let my_position = detect_my_position(ctx.session, ctx.my_puuid);
    let enemy_ids = enemy_champion_ids(ctx.session);
    let enemy_pos = enemy_positions(ctx.session);

    let mut rejected = Vec::new();
    let mut target: Option<BpTarget> = None;

    // ---- 1. 规则遍历 ----
    // pick 与 ban 的规则类型不同但遍历逻辑一致，各自展开一遍比引入泛型更好读。
    match pending.action_type {
        BpActionType::Pick => {
            for rule in ctx.pick_rules.iter().filter(|r| r.enabled) {
                if !rule
                    .conditions
                    .iter()
                    .all(|c| match_condition(c, ctx.session, my_position))
                {
                    rejected.push(BpRejected::RuleNotMatched {
                        rule_id: rule.id.clone(),
                        rule_name: rule.name.clone(),
                    });
                    continue;
                }
                let champ = rule.action.champion_id;
                if let Some(u) = unavailable.get(&champ) {
                    rejected.push(rejection_for(champ, *u));
                    continue;
                }
                target = Some(BpTarget {
                    champion_id: champ,
                    lock: rule.action.lock,
                    origin: BpOrigin::Rule {
                        rule_id: rule.id.clone(),
                        rule_name: rule.name.clone(),
                    },
                    evidence: worst_matchup(
                        champ,
                        &enemy_ids,
                        &enemy_pos,
                        ctx.snapshot,
                        my_position,
                    ),
                });
                break;
            }
        }
        BpActionType::Ban => {
            for rule in ctx.ban_rules.iter().filter(|r| r.enabled) {
                if !rule
                    .conditions
                    .iter()
                    .all(|c| match_condition(c, ctx.session, my_position))
                {
                    rejected.push(BpRejected::RuleNotMatched {
                        rule_id: rule.id.clone(),
                        rule_name: rule.name.clone(),
                    });
                    continue;
                }
                let champ = rule.action.champion_id;
                if let Some(u) = unavailable.get(&champ) {
                    rejected.push(rejection_for(champ, *u));
                    continue;
                }
                target = Some(BpTarget {
                    champion_id: champ,
                    lock: true,
                    origin: BpOrigin::Rule {
                        rule_id: rule.id.clone(),
                        rule_name: rule.name.clone(),
                    },
                    evidence: worst_matchup(
                        champ,
                        &enemy_ids,
                        &enemy_pos,
                        ctx.snapshot,
                        my_position,
                    ),
                });
                break;
            }
        }
    }

    // ---- 2. 兜底 ----
    if target.is_none() {
        let pool = match pending.action_type {
            BpActionType::Pick => ctx.pick_pool,
            BpActionType::Ban => ctx.ban_pool,
        };
        let (chosen, pool_rejected, evidence) = pick_best_from(
            pool,
            &enemy_ids,
            &enemy_pos,
            &unavailable,
            ctx.snapshot,
            my_position,
        );
        rejected.extend(pool_rejected);
        target = chosen.map(|champion_id| BpTarget {
            champion_id,
            lock: true,
            origin: BpOrigin::Fallback {
                pool_size: pool.len(),
            },
            evidence,
        });
    }

    Some(BpDecision {
        action_type: pending.action_type,
        target: target.clone(),
        rejected,
        mode: ctx.mode,
        time_left_secs: phase_secs_left(&ctx.session.timer),
        execute_at_secs_left: ctx.execute_at_secs_left,
        user_overridden: detect_override(
            pending.champion_id,
            ctx.last_hovered,
            target.as_ref().map(|t| t.champion_id),
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bp_decision::types::{BpActionType, Unavailable};
    use crate::lcu::api::champion_select::{Action, OnePlayer, SelectSession, Timer};

    fn action(
        actor: i32,
        id: i32,
        champ: i32,
        completed: bool,
        in_progress: bool,
        ty: &str,
        ally: bool,
    ) -> Action {
        Action {
            actor_cell_id: actor,
            id,
            champion_id: champ,
            completed,
            is_ally_action: ally,
            is_in_progress: in_progress,
            action_type: ty.to_string(),
        }
    }

    fn session(actions: Vec<Vec<Action>>) -> SelectSession {
        SelectSession {
            my_team: vec![],
            their_team: vec![],
            actions,
            timer: Timer::default(),
            local_player_cell_id: 0,
            trades: Vec::new(),
            bench_champions: Vec::new(),
        }
    }

    use crate::bp_decision::types::{BpEvidence, BpOrigin, BpRejected};
    use crate::command::rule_config::{
        BanAction, BanRule, PickAction, PickRule, Position, RuleCondition,
    };
    use crate::opgg::data::{LaneCounter, OpggSnapshot};

    fn player(champ: i32, position: &str, puuid: &str) -> OnePlayer {
        OnePlayer {
            champion_id: champ,
            puuid: puuid.to_string(),
            // 选人期混淆 puuid（#131 新增字段）；此处构造的是已知 puuid 的测试玩家，留空即可
            obfuscated_puuid: String::new(),
            assigned_position: position.to_string(),
            cell_id: 0,
            champion_pick_intent: 0,
        }
    }

    /// 盲僧(64) 打野被 豹女(60) 克制到 44.7%；亚索(157) 中路被 劫(238) 克制到 46%
    fn snap() -> OpggSnapshot {
        let mut counters = HashMap::new();
        counters.insert(
            64,
            vec![LaneCounter {
                opponent_id: 60,
                position: "JUNGLE".into(),
                subject_win_rate: 0.447,
                play: 4710,
            }],
        );
        counters.insert(
            157,
            vec![LaneCounter {
                opponent_id: 238,
                position: "MIDDLE".into(),
                subject_win_rate: 0.46,
                play: 3000,
            }],
        );
        OpggSnapshot {
            mode: "ranked".into(),
            tier: "emerald_plus".into(),
            patch: "16.13".into(),
            fetched_at: 0,
            champions: HashMap::new(),
            counters,
        }
    }

    // ---- worst_matchup ----

    /// 敌方分路表构造：[(英雄 id, 分路)] → HashMap
    fn enemy_pos(pairs: &[(i32, &str)]) -> HashMap<i32, String> {
        pairs
            .iter()
            .map(|(id, pos)| (*id, (*pos).to_string()))
            .collect()
    }

    #[test]
    fn worst_matchup_finds_present_enemy_counter() {
        let ev = worst_matchup(
            64,
            &[60, 99],
            &enemy_pos(&[(60, "JUNGLE")]),
            Some(&snap()),
            Some(Position::Jungle),
        )
        .unwrap();
        assert_eq!(ev.against_champion_id, 60);
        assert!((ev.win_rate - 0.447).abs() < 1e-9);
    }

    #[test]
    fn worst_matchup_none_when_counter_enemy_absent() {
        // 豹女不在场上 → 无已知劣势
        assert!(worst_matchup(
            64,
            &[99, 89],
            &enemy_pos(&[(99, "MIDDLE"), (89, "BOTTOM")]),
            Some(&snap()),
            Some(Position::Jungle)
        )
        .is_none());
    }

    #[test]
    fn worst_matchup_none_without_snapshot() {
        assert!(worst_matchup(
            64,
            &[60],
            &enemy_pos(&[(60, "JUNGLE")]),
            None,
            Some(Position::Jungle)
        )
        .is_none());
    }

    #[test]
    fn worst_matchup_skips_position_filter_when_position_unknown() {
        // ARAM：无分路，不按 position 过滤
        let ev = worst_matchup(
            64,
            &[60],
            &enemy_pos(&[(60, "JUNGLE")]),
            Some(&snap()),
            None,
        )
        .unwrap();
        assert_eq!(ev.against_champion_id, 60);
    }

    #[test]
    fn worst_matchup_ignores_off_role_enemy_counter() {
        // B3 核心：豹女在敌方走 UTILITY（辅助）→ 盲僧打野的 JUNGLE 克制记录
        // 不得用于排挤盲僧；无真实对位 → None
        assert!(worst_matchup(
            64,
            &[60],
            &enemy_pos(&[(60, "UTILITY")]),
            Some(&snap()),
            Some(Position::Jungle)
        )
        .is_none());
    }

    #[test]
    fn worst_matchup_keeps_counter_when_enemy_position_unknown() {
        // 敌方分路未知（空表/空串）→ 保守保留旧行为，宁可误报不漏报
        let ev = worst_matchup(
            64,
            &[60],
            &HashMap::new(),
            Some(&snap()),
            Some(Position::Jungle),
        )
        .unwrap();
        assert_eq!(ev.against_champion_id, 60);
        let ev2 = worst_matchup(
            64,
            &[60],
            &enemy_pos(&[(60, "")]),
            Some(&snap()),
            Some(Position::Jungle),
        )
        .unwrap();
        assert_eq!(ev2.against_champion_id, 60);
    }

    // ---- pick_best_from（避雷 + 列表序）----

    #[test]
    fn pick_best_from_skips_countered_and_takes_first_clean() {
        // 池 [盲僧64, 拉克丝99]，敌方打野豹女60 → 盲僧被克制，取拉克丝
        let (chosen, rejected, ev) = pick_best_from(
            &[64, 99],
            &[60],
            &enemy_pos(&[(60, "JUNGLE")]),
            &HashMap::new(),
            Some(&snap()),
            Some(Position::Jungle),
        );
        assert_eq!(chosen, Some(99));
        assert!(ev.is_none(), "幸存者没有已知劣势");
        assert_eq!(
            rejected,
            vec![BpRejected::CounteredBy {
                champion_id: 64,
                opponent_id: 60,
                subject_win_rate: 0.447,
            }]
        );
    }

    #[test]
    fn pick_best_from_ignores_off_role_enemy() {
        // B3：敌方豹女走辅助 → 盲僧不被排挤，直接取盲僧且无 evidence
        let (chosen, rejected, ev) = pick_best_from(
            &[64, 99],
            &[60],
            &enemy_pos(&[(60, "UTILITY")]),
            &HashMap::new(),
            Some(&snap()),
            Some(Position::Jungle),
        );
        assert_eq!(chosen, Some(64));
        assert!(ev.is_none());
        assert!(rejected.is_empty());
    }

    #[test]
    fn pick_best_from_hard_picks_first_when_all_countered() {
        // 池只有盲僧，且被克制 → 硬选它，evidence 说明风险，且它不出现在 rejected 里
        let (chosen, rejected, ev) = pick_best_from(
            &[64],
            &[60],
            &enemy_pos(&[(60, "JUNGLE")]),
            &HashMap::new(),
            Some(&snap()),
            Some(Position::Jungle),
        );
        assert_eq!(chosen, Some(64));
        assert_eq!(
            ev,
            Some(BpEvidence {
                win_rate: 0.447,
                against_champion_id: 60,
                matchup_delta: None,
            })
        );
        assert!(rejected.is_empty(), "被硬选中的不应同时出现在落选里");
    }

    #[test]
    fn pick_best_from_returns_none_when_pool_all_unavailable() {
        let mut un = HashMap::new();
        un.insert(64, Unavailable::Banned);
        un.insert(99, Unavailable::Taken { by_ally: true });
        let (chosen, rejected, ev) =
            pick_best_from(&[64, 99], &[], &HashMap::new(), &un, Some(&snap()), None);
        assert_eq!(chosen, None);
        assert!(ev.is_none());
        assert_eq!(
            rejected,
            vec![
                BpRejected::Banned { champion_id: 64 },
                BpRejected::Taken {
                    champion_id: 99,
                    by_ally: true
                },
            ]
        );
    }

    #[test]
    fn pick_best_from_degrades_to_first_available_without_snapshot() {
        // 无 OP.GG 数据（含 ARAM）→ 与今天的「第一个可用」完全一致
        let (chosen, _, ev) = pick_best_from(
            &[64, 99],
            &[60],
            &HashMap::new(),
            &HashMap::new(),
            None,
            None,
        );
        assert_eq!(chosen, Some(64));
        assert!(ev.is_none());
    }

    // ---- evaluate_bp_decision：origin × evidence 四种组合 ----

    fn pick_rule(
        id: &str,
        name: &str,
        champ: i32,
        lock: bool,
        conds: Vec<RuleCondition>,
    ) -> PickRule {
        PickRule {
            id: id.into(),
            name: name.into(),
            enabled: true,
            conditions: conds,
            action: PickAction {
                champion_id: champ,
                lock,
            },
        }
    }

    /// 我在打野位、轮到我 pick；敌方阵容由参数给出
    fn pick_session(their: Vec<OnePlayer>) -> SelectSession {
        SelectSession {
            my_team: vec![player(0, "jungle", "me")],
            their_team: their,
            actions: vec![vec![action(0, 10, 0, false, true, "pick", true)]],
            timer: Timer {
                adjusted_time_left_in_phase: 27_000.0,
                ..Default::default()
            },
            local_player_cell_id: 0,
            trades: Vec::new(),
            bench_champions: Vec::new(),
        }
    }

    fn ctx<'a>(
        session: &'a SelectSession,
        pick_rules: &'a [PickRule],
        pool: &'a [i32],
        snapshot: Option<&'a OpggSnapshot>,
    ) -> BpContext<'a> {
        BpContext {
            session,
            my_puuid: "me",
            pick_rules,
            ban_rules: &[],
            pick_pool: pool,
            ban_pool: &[],
            snapshot,
            mode: BpMode::Auto,
            execute_at_secs_left: 5.0,
            last_hovered: None,
        }
    }

    #[test]
    fn rule_hit_without_evidence() {
        // 组合 1：规则命中固定英雄，敌方无克制关系 → Rule + None
        let s = pick_session(vec![player(99, "middle", "e1")]);
        let rules = vec![pick_rule("r1", "打野保底", 64, true, vec![])];
        let d = evaluate_bp_decision(&ctx(&s, &rules, &[], Some(&snap()))).unwrap();
        let t = d.target.unwrap();
        assert_eq!(t.champion_id, 64);
        assert!(t.lock);
        assert_eq!(
            t.origin,
            BpOrigin::Rule {
                rule_id: "r1".into(),
                rule_name: "打野保底".into()
            }
        );
        assert!(t.evidence.is_none());
        assert_eq!(d.action_type, BpActionType::Pick);
        assert!((d.time_left_secs - 27.0).abs() < 1e-9);
    }

    #[test]
    fn rule_hit_with_evidence_when_target_is_countered() {
        // 组合 2：规则命中，但目标被在场敌方克制 → Rule + Some（规则是用户意图，照执行，只标风险）
        let s = pick_session(vec![player(60, "jungle", "e1")]);
        let rules = vec![pick_rule("r1", "打野保底", 64, true, vec![])];
        let d = evaluate_bp_decision(&ctx(&s, &rules, &[], Some(&snap()))).unwrap();
        let t = d.target.unwrap();
        assert_eq!(t.champion_id, 64);
        assert_eq!(
            t.evidence,
            Some(BpEvidence {
                win_rate: 0.447,
                against_champion_id: 60,
                matchup_delta: None,
            })
        );
    }

    #[test]
    fn fallback_without_evidence() {
        // 组合 3：无规则命中，兜底避雷后有幸存者 → Fallback + None
        let s = pick_session(vec![player(60, "jungle", "e1")]);
        let d = evaluate_bp_decision(&ctx(&s, &[], &[64, 99], Some(&snap()))).unwrap();
        let t = d.target.unwrap();
        assert_eq!(t.champion_id, 99);
        assert_eq!(t.origin, BpOrigin::Fallback { pool_size: 2 });
        assert!(t.evidence.is_none());
        assert!(t.lock, "兜底 pick 恒锁定");
    }

    #[test]
    fn fallback_with_evidence_when_all_countered() {
        // 组合 4：兜底池全被克制 → Fallback + Some
        let s = pick_session(vec![player(60, "jungle", "e1")]);
        let d = evaluate_bp_decision(&ctx(&s, &[], &[64], Some(&snap()))).unwrap();
        let t = d.target.unwrap();
        assert_eq!(t.champion_id, 64);
        assert_eq!(t.origin, BpOrigin::Fallback { pool_size: 1 });
        assert_eq!(
            t.evidence,
            Some(BpEvidence {
                win_rate: 0.447,
                against_champion_id: 60,
                matchup_delta: None,
            })
        );
    }

    #[test]
    fn collects_rule_not_matched_and_unavailable_rejections() {
        // 规则1 条件不满足；规则2 目标已被 ban；最终走兜底
        let mut s = pick_session(vec![player(99, "middle", "e1")]);
        s.actions
            .push(vec![action(5, 20, 157, true, false, "ban", false)]);
        let rules = vec![
            pick_rule(
                "r1",
                "中路专用",
                1,
                true,
                vec![RuleCondition::Position {
                    value: Position::Middle,
                }],
            ),
            pick_rule("r2", "抢亚索", 157, true, vec![]),
        ];
        let d = evaluate_bp_decision(&ctx(&s, &rules, &[89], Some(&snap()))).unwrap();
        assert_eq!(d.target.unwrap().champion_id, 89);
        assert_eq!(
            d.rejected,
            vec![
                BpRejected::RuleNotMatched {
                    rule_id: "r1".into(),
                    rule_name: "中路专用".into()
                },
                BpRejected::Banned { champion_id: 157 },
            ]
        );
    }

    #[test]
    fn rule_requires_all_conditions_to_match() {
        // 规则要求：分路是打野 AND 敌方阵容包含 99 号英雄；只满足其一时整条规则不算命中
        let rule = pick_rule(
            "r1",
            "双条件",
            64,
            true,
            vec![
                RuleCondition::Position {
                    value: Position::Jungle,
                },
                RuleCondition::EnemyChampionsContains { ids: vec![99] },
            ],
        );

        // 只满足 Position（敌方没有 99）→ RuleNotMatched，走兜底
        let s_partial = pick_session(vec![player(1, "middle", "e1")]);
        let d = evaluate_bp_decision(&ctx(&s_partial, std::slice::from_ref(&rule), &[77], None))
            .unwrap();
        assert_eq!(d.target.unwrap().champion_id, 77, "规则未命中应走兜底");
        assert_eq!(
            d.rejected,
            vec![BpRejected::RuleNotMatched {
                rule_id: "r1".into(),
                rule_name: "双条件".into(),
            }]
        );

        // 两个条件都满足 → 命中该规则
        let s_full = pick_session(vec![player(99, "middle", "e1")]);
        let d2 = evaluate_bp_decision(&ctx(&s_full, &[rule], &[77], None)).unwrap();
        let t2 = d2.target.unwrap();
        assert_eq!(t2.champion_id, 64);
        assert_eq!(
            t2.origin,
            BpOrigin::Rule {
                rule_id: "r1".into(),
                rule_name: "双条件".into(),
            }
        );
    }

    #[test]
    fn later_rule_wins_when_earlier_not_matched() {
        let rules = vec![
            pick_rule(
                "r1",
                "中路专用",
                1,
                true,
                vec![RuleCondition::Position {
                    value: Position::Middle,
                }],
            ),
            pick_rule("r2", "打野保底", 64, true, vec![]),
        ];
        let s = pick_session(vec![player(99, "middle", "e1")]);
        let d = evaluate_bp_decision(&ctx(&s, &rules, &[], None)).unwrap();
        let t = d.target.unwrap();
        assert_eq!(t.champion_id, 64);
        assert_eq!(
            t.origin,
            BpOrigin::Rule {
                rule_id: "r2".into(),
                rule_name: "打野保底".into(),
            }
        );
        assert_eq!(
            d.rejected,
            vec![BpRejected::RuleNotMatched {
                rule_id: "r1".into(),
                rule_name: "中路专用".into(),
            }]
        );
    }

    #[test]
    fn returns_none_when_no_pending_action() {
        let s = SelectSession {
            my_team: vec![player(0, "jungle", "me")],
            their_team: vec![],
            actions: vec![vec![action(0, 10, 64, true, false, "pick", true)]],
            timer: Timer::default(),
            local_player_cell_id: 0,
            trades: Vec::new(),
            bench_champions: Vec::new(),
        };
        assert!(evaluate_bp_decision(&ctx(&s, &[], &[64], None)).is_none());
    }

    #[test]
    fn target_none_when_no_rule_and_empty_pool() {
        let s = pick_session(vec![]);
        let d = evaluate_bp_decision(&ctx(&s, &[], &[], None)).unwrap();
        assert!(d.target.is_none());
    }

    #[test]
    fn ban_branch_uses_ban_rules_and_ban_pool() {
        let mut s = pick_session(vec![]);
        s.actions = vec![vec![action(0, 11, 0, false, true, "ban", true)]];
        let ban_rules = vec![BanRule {
            id: "b1".into(),
            name: "禁亚索".into(),
            enabled: true,
            conditions: vec![],
            action: BanAction { champion_id: 157 },
        }];
        let mut c = ctx(&s, &[], &[], None);
        c.ban_rules = &ban_rules;
        let d = evaluate_bp_decision(&c).unwrap();
        assert_eq!(d.action_type, BpActionType::Ban);
        let t = d.target.unwrap();
        assert_eq!(t.champion_id, 157);
        assert!(t.lock, "ban 恒为 lock=true");
    }

    #[test]
    fn ban_disabled_rule_skipped_entirely() {
        let mut s = pick_session(vec![]);
        s.actions = vec![vec![action(0, 11, 0, false, true, "ban", true)]];
        let ban_rules = vec![BanRule {
            id: "b1".into(),
            name: "已停用禁用".into(),
            enabled: false,
            conditions: vec![],
            action: BanAction { champion_id: 157 },
        }];
        let ban_pool = vec![89];
        let mut c = ctx(&s, &[], &[], None);
        c.ban_rules = &ban_rules;
        c.ban_pool = &ban_pool;
        let d = evaluate_bp_decision(&c).unwrap();
        assert_eq!(d.action_type, BpActionType::Ban);
        assert_eq!(d.target.unwrap().champion_id, 89);
        assert!(d.rejected.is_empty(), "停用的规则不该出现在落选理由里");
    }

    #[test]
    fn ban_rule_target_unavailable_falls_through() {
        let mut s = pick_session(vec![]);
        s.actions = vec![vec![action(0, 11, 0, false, true, "ban", true)]];
        s.actions
            .push(vec![action(5, 20, 157, true, false, "ban", false)]); // 对面已经 ban 了亚索
        let ban_rules = vec![BanRule {
            id: "b1".into(),
            name: "禁亚索".into(),
            enabled: true,
            conditions: vec![],
            action: BanAction { champion_id: 157 },
        }];
        let ban_pool = vec![89];
        let mut c = ctx(&s, &[], &[], None);
        c.ban_rules = &ban_rules;
        c.ban_pool = &ban_pool;
        let d = evaluate_bp_decision(&c).unwrap();
        assert_eq!(
            d.target.unwrap().champion_id,
            89,
            "规则目标已被 ban，应落到兜底池"
        );
        assert_eq!(d.rejected, vec![BpRejected::Banned { champion_id: 157 }]);
    }

    #[test]
    fn ban_none_when_no_rules_and_empty_pool() {
        let mut s = pick_session(vec![]);
        s.actions = vec![vec![action(0, 11, 0, false, true, "ban", true)]];
        let d = evaluate_bp_decision(&ctx(&s, &[], &[], None)).unwrap();
        assert_eq!(d.action_type, BpActionType::Ban);
        assert!(d.target.is_none());
    }

    #[test]
    fn disabled_rules_are_skipped_entirely() {
        let s = pick_session(vec![]);
        let mut r = pick_rule("r1", "已停用", 64, true, vec![]);
        r.enabled = false;
        let d = evaluate_bp_decision(&ctx(&s, &[r], &[99], None)).unwrap();
        assert_eq!(d.target.unwrap().champion_id, 99);
        assert!(d.rejected.is_empty(), "停用的规则不该出现在落选理由里");
    }

    #[test]
    fn user_overridden_is_reported_from_last_hovered() {
        let mut s = pick_session(vec![]);
        s.actions = vec![vec![action(0, 10, 157, false, true, "pick", true)]];
        let rules = vec![pick_rule("r1", "打野保底", 64, true, vec![])];
        let mut c = ctx(&s, &rules, &[], None);
        c.last_hovered = Some(64);
        let d = evaluate_bp_decision(&c).unwrap();
        assert!(d.user_overridden, "我们 hover 了盲僧，现在是亚索 → 接管");
    }

    // ---- evaluate_bench_swap_target（debug4-12：无 pending action 也能换）----

    /// 大乱斗式会话：actions 为空、英雄直接分配到 my_team、bench 有候选
    fn aram_session(locked: i32, bench: Vec<i32>) -> SelectSession {
        let mut me = player(locked, "", "me");
        me.cell_id = 0;
        SelectSession {
            my_team: vec![me],
            their_team: vec![],
            actions: vec![],
            timer: Timer::default(),
            local_player_cell_id: 0,
            trades: Vec::new(),
            bench_champions: bench,
        }
    }

    #[test]
    fn bench_swap_without_pending_action_returns_rule_target() {
        // actions 为空（大乱斗）→ evaluate_bp_decision 恒 None，但 bench 求值
        // 仍能从规则拿到目标
        let s = aram_session(1, vec![64, 99]);
        assert!(evaluate_bp_decision(&ctx(&s, &[], &[], None)).is_none());
        let rules = vec![pick_rule("r1", "打野保底", 64, true, vec![])];
        assert_eq!(
            evaluate_bench_swap_target(&s, "me", &rules, &[], None),
            Some(64)
        );
    }

    #[test]
    fn bench_swap_without_pending_action_falls_back_to_pool() {
        let s = aram_session(1, vec![99]);
        assert_eq!(
            evaluate_bench_swap_target(&s, "me", &[], &[99], None),
            Some(99)
        );
    }

    #[test]
    fn bench_swap_returns_none_when_target_not_on_bench() {
        // 规则目标不在 bench 池 → 不换（LCU 只允许换入 bench 内的英雄）
        let s = aram_session(1, vec![99]);
        let rules = vec![pick_rule("r1", "打野保底", 64, true, vec![])];
        assert_eq!(
            evaluate_bench_swap_target(&s, "me", &rules, &[64], None),
            None
        );
    }

    #[test]
    fn bench_swap_returns_none_when_already_on_target() {
        // 已锁定就是目标 → 不换
        let s = aram_session(64, vec![64, 99]);
        let rules = vec![pick_rule("r1", "打野保底", 64, true, vec![])];
        assert_eq!(
            evaluate_bench_swap_target(&s, "me", &rules, &[], None),
            None
        );
    }

    #[test]
    fn find_pending_should_prefer_in_progress_action() {
        // 我有一个未完成的 pick（预选期）和一个进行中的 ban
        let s = session(vec![
            vec![action(0, 10, 0, false, false, "pick", true)],
            vec![action(0, 11, 0, false, true, "ban", true)],
        ]);
        let p = find_my_pending_action(&s).unwrap();
        assert_eq!(p.action_id, 11);
        assert_eq!(p.action_type, BpActionType::Ban);
        assert!(p.is_in_progress);
    }

    #[test]
    fn find_pending_should_fall_back_to_not_yet_started_action() {
        // 预选期：pick action 存在但还没轮到我
        let s = session(vec![vec![action(0, 10, 0, false, false, "pick", true)]]);
        let p = find_my_pending_action(&s).unwrap();
        assert_eq!(p.action_id, 10);
        assert_eq!(p.action_type, BpActionType::Pick);
        assert!(!p.is_in_progress);
        assert_eq!(p.champion_id, 0);
    }

    #[test]
    fn find_pending_should_ignore_completed_and_others() {
        let s = session(vec![vec![
            action(0, 10, 64, true, false, "pick", true), // 我的，已完成
            action(3, 11, 0, false, true, "pick", true),  // 别人的
        ]]);
        assert!(find_my_pending_action(&s).is_none());
    }

    #[test]
    fn unavailable_map_should_separate_banned_from_taken() {
        let s = session(vec![vec![
            action(5, 20, 157, true, false, "ban", false), // 对面 ban 了亚索
            action(1, 21, 64, false, false, "pick", true), // 队友 hover 了盲僧
            action(7, 22, 99, false, false, "pick", false), // 对面 hover 了拉克丝
            action(0, 23, 89, false, false, "pick", true), // 我自己的 hover，不算不可用
        ]]);
        let m = unavailable_map(&s);
        assert_eq!(m.get(&157), Some(&Unavailable::Banned));
        assert_eq!(m.get(&64), Some(&Unavailable::Taken { by_ally: true }));
        assert_eq!(m.get(&99), Some(&Unavailable::Taken { by_ally: false }));
        assert!(!m.contains_key(&89), "自己的 hover 不应阻挡自己");
    }

    #[test]
    fn detect_override_respects_user_choice() {
        assert!(
            detect_override(157, Some(64), None),
            "我们 hover 盲僧、变成亚索 → 接管"
        );
        assert!(!detect_override(64, Some(64), None), "没变 → 不接管");
        // 用户点取消/清空悬停（当前 0）→ 视为接管，勿被脚本弹回原英雄
        assert!(detect_override(0, Some(64), None), "撤回成 0 → 用户接管");
        assert!(
            detect_override(157, None, None),
            "进入前已有预选 → 尊重用户接管"
        );
        assert!(!detect_override(0, None, None), "尚未有预选 → 未接管");
    }

    #[test]
    fn detect_override_ignores_our_own_inflight_hover() {
        // 自动 hover 的 PATCH 已生效但 last_hovered 尚未落库（时序窗口）：
        // current == our_target → 是工具自身的动作，不是用户接管
        assert!(
            !detect_override(64, None, Some(64)),
            "自己的 hover 正在落库不判接管"
        );
        // 用户选了别的英雄（≠ target）→ 判接管
        assert!(detect_override(157, None, Some(64)), "用户选了别的 → 接管");
    }

    #[test]
    fn phase_secs_left_converts_lcu_milliseconds() {
        let t = Timer {
            adjusted_time_left_in_phase: 27_500.0,
            ..Default::default()
        };
        assert!((phase_secs_left(&t) - 27.5).abs() < 1e-9);
    }
}
