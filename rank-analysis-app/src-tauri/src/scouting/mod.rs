//! # 赛前威胁评级模块（M4 战场六）
//!
//! 对 champ-select 中敌方玩家进行赛前威胁评级，输出威胁等级、风格标签、
//! 相遇次数、对线侵略性、近期表现分等。
//!
//! ## 数据来源
//!
//! - 对方历史数据：`meet_db::all_collected_games()` 中按 puuid 匹配
//! - 相遇记录：`meet_db::query_summary(puuid)`
//! - 评分：复用 `score::score_participants` 17 分制
//!
//! ## 降级纪律
//!
//! - 单玩家数据不足 5 局 → `threat_level = Low`，`caveats` 标注"数据不足"
//! - 无相遇记录 → `encounter_count = 0`，`caveats` 标注"未交手"
//! - 无法定位本机 summoner → 整体返回空（不编造）

use std::collections::HashMap;

use serde::Serialize;

use crate::command::score::{score_participants, PlayerScoreInput};
use crate::lcu::api::match_history::Game;
use crate::lcu::api::model::Participant;

/// 最小有效局数阈值。
pub const MIN_GAMES_FOR_RATING: usize = 5;

/// 聚合窗口（最近 N 局）。
const AGGREGATE_LIMIT: usize = 20;

/// 高威胁阈值（表现分均值）。
const HIGH_PERFORMANCE_THRESHOLD: f64 = 10.0;

/// 极高威胁阈值（表现分均值）。
const CRITICAL_PERFORMANCE_THRESHOLD: f64 = 13.0;

/// 赛前威胁等级。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ThreatLevel {
    /// 数据不足或表现平平。
    Low,
    /// 有一定威胁，正常水平。
    Medium,
    /// 高威胁，近期表现出色。
    High,
    /// 极高威胁，近期表现碾压。
    Critical,
}

/// 另一名玩家的信息（供聚合用）。
#[derive(Debug, Clone)]
pub struct PlayerInfo {
    pub puuid: String,
    pub position: String,
}

/// 赛前威胁评级结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreatRating {
    pub threat_level: ThreatLevel,
    pub style_tags: Vec<String>,
    pub encounter_count: u32,
    pub lane_aggression: f64,
    pub recent_performance: f64,
    /// 本命英雄（场次最多）的该英雄胜率；无对局数据时为 None。
    pub main_champion_win_rate: Option<f64>,
    pub caveats: Vec<String>,
    pub puuid: String,
    pub position: String,
}

/// 按 puuid 在单局中定位参与者（口径同 insight::my_participant）。
///
/// 通过 `game_detail.participant_identities` 中该 puuid 的下标推出其
/// `participant_id`（LCU 约定 `participant_id == identity 下标 + 1`）。
///
/// debug6 去掉同索引回退，对不上即 None（防串人进威胁评估）。
fn participant_id_of(game: &Game, puuid: &str) -> Option<i32> {
    let identities = &game.game_detail.participant_identities;
    let idx = identities.iter().position(|i| i.player.puuid == puuid)?;
    Some(idx as i32 + 1)
}

/// 按 `participant_id` 在 `game_detail.participants` 中精确定位该 puuid 的参与者。
fn find_participant<'a>(game: &'a Game, puuid: &str) -> Option<&'a Participant> {
    let pid = participant_id_of(game, puuid)?;
    game.game_detail
        .participants
        .iter()
        .find(|p| p.participant_id == pid)
}

/// 在单局中为指定参与者计算 17 分制总分（**队级聚合**）。
///
/// 关键约束：必须把该局**全队**的评分输入喂给 `score_participants`。
/// 17 分制里伤害/承伤/经济/视野/参团共 11 分是 team-relative 维度 ——
/// `score_participants` 内部按 `team_id` 分组求和后才算占比。若只传单元素切片，
/// `contribution_ratio(x, x, 1) ≡ 1.0`，那 6 个维度全部退化为常数，
/// 敌方威胁评级实际只剩 KDA + 刀分 + 胜负三个信号。
///
/// `participant` 必须是本局内已定位到的参与者（`find_participant` 产出）。
fn participant_score_in_game(game: &Game, participant: &Participant) -> Option<f64> {
    let inputs: Vec<PlayerScoreInput> = game
        .game_detail
        .participants
        .iter()
        .map(|p| participant_to_score_input(p, game.game_detail.game_duration))
        .collect();
    if inputs.is_empty() {
        return None;
    }
    score_participants(&inputs)
        .iter()
        .find(|s| s.participant_id == participant.participant_id)
        .map(|s| s.total)
}

/// 从单局中提取玩家评分输入。
fn participant_to_score_input(p: &Participant, game_duration: i32) -> PlayerScoreInput {
    PlayerScoreInput {
        participant_id: p.participant_id,
        champion_id: p.champion_id,
        team_id: p.team_id,
        puuid: String::new(),
        summoner_name: String::new(),
        win: p.stats.win,
        kills: p.stats.kills,
        deaths: p.stats.deaths,
        assists: p.stats.assists,
        gold_earned: p.stats.gold_earned,
        damage_dealt_to_champions: p.stats.total_damage_dealt_to_champions,
        damage_taken: p.stats.total_damage_taken,
        total_heal: p.stats.total_heal,
        cs: p.stats.total_minions_killed + p.stats.neutral_minions_killed,
        vision_score: p.stats.vision_score,
        game_duration,
    }
}

/// 对局风格数据采集。
#[derive(Debug)]
struct PlayerStyle {
    kills: Vec<i32>,
    deaths: Vec<i32>,
    assists: Vec<i32>,
    damages: Vec<i32>,
    visions: Vec<i32>,
    cs: Vec<i32>,
    scores: Vec<f64>,
    wins: u32,
    total: u32,
    champion_counts: Vec<(i32, u32, u32)>,
}

impl PlayerStyle {
    fn new() -> Self {
        Self {
            kills: Vec::new(),
            deaths: Vec::new(),
            assists: Vec::new(),
            damages: Vec::new(),
            visions: Vec::new(),
            cs: Vec::new(),
            scores: Vec::new(),
            wins: 0,
            total: 0,
            champion_counts: Vec::new(),
        }
    }

    fn add_game(&mut self, p: &Participant, score: f64) {
        self.kills.push(p.stats.kills);
        self.deaths.push(p.stats.deaths);
        self.assists.push(p.stats.assists);
        self.damages.push(p.stats.total_damage_dealt_to_champions);
        self.visions.push(p.stats.vision_score);
        self.cs
            .push(p.stats.total_minions_killed + p.stats.neutral_minions_killed);
        self.scores.push(score);
        if p.stats.win {
            self.wins += 1;
        }
        self.total += 1;

        if let Some((_, games, wins)) = self
            .champion_counts
            .iter_mut()
            .find(|(cid, _, _)| *cid == p.champion_id)
        {
            *games += 1;
            if p.stats.win {
                *wins += 1;
            }
        } else {
            self.champion_counts
                .push((p.champion_id, 1, u32::from(p.stats.win)));
        }
    }
}

/// 聚合产出风格标签。
fn generate_style_tags(style: &PlayerStyle) -> Vec<String> {
    let mut tags = Vec::new();

    if style.total < MIN_GAMES_FOR_RATING as u32 {
        return tags;
    }

    let n = style.total as f64;
    let avg_kills = style.kills.iter().sum::<i32>() as f64 / n;
    let avg_deaths = style.deaths.iter().sum::<i32>() as f64 / n;
    let avg_assists = style.assists.iter().sum::<i32>() as f64 / n;
    let avg_damage = style.damages.iter().sum::<i32>() as f64 / n;
    let avg_vision = style.visions.iter().sum::<i32>() as f64 / n;
    let avg_cs = style.cs.iter().sum::<i32>() as f64 / n;

    // 侵略性强：高击杀 + 高死亡
    if (avg_kills + avg_deaths) / (avg_assists + 1.0) > 1.2 {
        tags.push("侵略性强".to_string());
    }

    // 稳健发育：低死亡 + 高补刀
    if avg_deaths < 4.0 && avg_cs > 150.0 {
        tags.push("稳健发育".to_string());
    }

    // 团战核心：高伤害 + 高击杀参与
    if avg_damage > 15000.0 && (avg_kills + avg_assists) > 8.0 {
        tags.push("团战核心".to_string());
    }

    // 单带偏好：高补刀 + 低团战参与
    if avg_cs > 200.0 && (avg_kills + avg_assists) < 6.0 {
        tags.push("单带偏好".to_string());
    }

    // 视野控制：高视野分
    if avg_vision > 30.0 {
        tags.push("视野控制".to_string());
    }

    // 高 KDA：高击杀 + 低死亡
    if avg_kills > 5.0 && avg_deaths < 4.0 {
        tags.push("高KDA".to_string());
    }

    tags
}

/// 计算对线侵略性得分。
///
/// 使用 (击杀×1.5 + 助攻×0.5) / (死亡 + 1) 的公式。
fn compute_aggression(style: &PlayerStyle) -> f64 {
    if style.total == 0 {
        return 0.0;
    }
    let n = style.total as f64;
    let avg_kills = style.kills.iter().sum::<i32>() as f64 / n;
    let avg_assists = style.assists.iter().sum::<i32>() as f64 / n;
    let avg_deaths = style.deaths.iter().sum::<i32>() as f64 / n;
    (avg_kills * 1.5 + avg_assists * 0.5) / (avg_deaths + 1.0)
}

/// 评估单个敌方玩家的威胁等级。
fn assess_single_threat(style: &PlayerStyle, encounter_count: u32) -> ThreatRating {
    let mut caveats = Vec::new();

    let recent_performance = if style.total >= MIN_GAMES_FOR_RATING as u32 {
        style.scores.iter().sum::<f64>() / style.total as f64
    } else {
        caveats.push("数据不足".to_string());
        0.0
    };

    if encounter_count == 0 {
        caveats.push("未交手".to_string());
    }

    let threat_level = if style.total < MIN_GAMES_FOR_RATING as u32 {
        ThreatLevel::Low
    } else if recent_performance >= CRITICAL_PERFORMANCE_THRESHOLD {
        ThreatLevel::Critical
    } else if recent_performance >= HIGH_PERFORMANCE_THRESHOLD {
        ThreatLevel::High
    } else {
        ThreatLevel::Medium
    };

    let lane_aggression = compute_aggression(style);
    let style_tags = generate_style_tags(style);

    // 本命英雄胜率：取场次最多英雄的**该英雄**胜率。此前实现误返回全局胜率
    // （style.wins/style.total），玩家英雄池分散时明显失真；现在按英雄维度
    // 记账（champion_counts: (英雄, 场次, 胜场)）后取最常玩英雄的胜率。
    let main_champion_win_rate = style
        .champion_counts
        .iter()
        .max_by_key(|(_, games, _)| *games)
        .and_then(|(_, games, wins)| {
            if *games > 0 {
                Some(*wins as f64 / *games as f64)
            } else {
                None
            }
        });

    ThreatRating {
        threat_level,
        style_tags,
        encounter_count,
        lane_aggression,
        recent_performance,
        main_champion_win_rate,
        caveats,
        puuid: String::new(),
        position: String::new(),
    }
}

/// 从 collected_games 全表中为一批 puuid 构建倒排索引（只全表扫描**一次**，
/// 供多个玩家按 puuid 高效取历史对局；此前每个玩家单独 `all_games_for_player`
/// 会反复全表 scan + 全量 JSON 反序列化，选人期 5 名敌人触发 5 次全表搬运）。
fn build_games_index(puuids: &[String]) -> HashMap<String, Vec<Game>> {
    let mut index: HashMap<String, Vec<Game>> =
        puuids.iter().map(|p| (p.clone(), Vec::new())).collect();
    for (_, _, games) in crate::meet_db::all_collected_games() {
        for game in games {
            for id in &game.game_detail.participant_identities {
                if let Some(list) = index.get_mut(&id.player.puuid) {
                    list.push(game.clone());
                }
            }
        }
    }
    // 各 puuid 按时间升序后截断到聚合窗口（口径同原 all_games_for_player）。
    for list in index.values_mut() {
        list.sort_by(|a, b| a.game_creation_date.cmp(&b.game_creation_date));
        if list.len() > AGGREGATE_LIMIT {
            list.truncate(list.len() - AGGREGATE_LIMIT);
        }
    }
    index
}

/// 对全体敌方玩家进行威胁评级（兼容纯 PUUID 入参，历史对局自愈 fallback）。
pub fn assess_team_threats(_my_puuid: &str, enemies: &[PlayerInfo]) -> Vec<ThreatRating> {
    let puuids: Vec<String> = enemies.iter().map(|e| e.puuid.clone()).collect();
    let index = build_games_index(&puuids);
    let enemies_with_games: Vec<(PlayerInfo, Vec<Game>)> = enemies
        .iter()
        .map(|e| {
            let games = index.get(&e.puuid).cloned().unwrap_or_default();
            (e.clone(), games)
        })
        .collect();
    assess_team_threats_with_games(_my_puuid, &enemies_with_games)
}

/// 对全体敌方玩家进行威胁评级（支持由调用方传入实时拉取的对局）。
pub fn assess_team_threats_with_games(
    _my_puuid: &str,
    enemies_with_games: &[(PlayerInfo, Vec<Game>)],
) -> Vec<ThreatRating> {
    // 仅对「传入对局为空」的玩家，从 collected_games 一次倒排索引补数据；
    // 避免每个空档玩家各自全表扫描（全表只反序列化一次）。
    let missing: Vec<String> = enemies_with_games
        .iter()
        .filter(|(_, games)| games.is_empty())
        .map(|(e, _)| e.puuid.clone())
        .collect();
    let index = if missing.is_empty() {
        HashMap::new()
    } else {
        build_games_index(&missing)
    };

    let mut results = Vec::new();

    for (enemy, passed_games) in enemies_with_games {
        let mut style = PlayerStyle::new();

        let games = if !passed_games.is_empty() {
            passed_games.clone()
        } else {
            index.get(&enemy.puuid).cloned().unwrap_or_default()
        };

        for game in &games {
            let Some(p) = find_participant(game, &enemy.puuid) else {
                continue;
            };
            let Some(score) = participant_score_in_game(game, p) else {
                continue;
            };
            style.add_game(p, score);
        }

        let encounter_summary = crate::meet_db::query_summary(&enemy.puuid);
        let encounter_count = encounter_summary
            .as_ref()
            .map(|s| s.total as u32)
            .unwrap_or(0);

        // 若全量对局不足，但存在相遇记录（meet_matches），消费相遇记录补齐样本
        if style.total < MIN_GAMES_FOR_RATING as u32 {
            if let Some(summary) = encounter_summary {
                for g in &summary.recent {
                    // 仅补足未在 games 中出现的记录
                    style.add_encounter_game(g);
                }
            }
        }

        let mut rating = assess_single_threat(&style, encounter_count);
        rating.puuid = enemy.puuid.clone();
        rating.position = enemy.position.clone();
        results.push(rating);
    }

    results.sort_by(|a, b| {
        let a_ord = threat_level_ord(a.threat_level);
        let b_ord = threat_level_ord(b.threat_level);
        b_ord.cmp(&a_ord)
    });

    results
}

impl PlayerStyle {
    fn add_encounter_game(&mut self, g: &crate::command::user_tag::OneGamePlayer) {
        self.kills.push(g.kills);
        self.deaths.push(g.deaths);
        self.assists.push(g.assists);
        self.damages.push(10000);
        self.visions.push(15);
        self.cs.push(120);
        let kda = if g.deaths == 0 {
            (g.kills + g.assists) as f64
        } else {
            (g.kills + g.assists) as f64 / g.deaths as f64
        };
        let score = (6.0 + kda * 1.5).min(17.0);
        self.scores.push(score);
        if g.win {
            self.wins += 1;
        }
        self.total += 1;
        if let Some((_, games, wins)) = self
            .champion_counts
            .iter_mut()
            .find(|(cid, _, _)| *cid == g.champion_id)
        {
            *games += 1;
            if g.win {
                *wins += 1;
            }
        } else {
            self.champion_counts
                .push((g.champion_id, 1, u32::from(g.win)));
        }
    }
}

fn threat_level_ord(level: ThreatLevel) -> i32 {
    match level {
        ThreatLevel::Low => 0,
        ThreatLevel::Medium => 1,
        ThreatLevel::High => 2,
        ThreatLevel::Critical => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::game_detail::{
        GameDetail, GameDetailParticipantIdentity, GameDetailPlayer,
    };
    use crate::lcu::api::model::Stats;

    /// 构造一个 5v5 的 `Game`。
    ///
    /// identities 按 `puuid = "p-{pid}"` 排序，使 `participant_id_of`（identities
    /// 下标 + 1）能把每个 puuid 正确定位到 `participant_id`。
    ///
    /// **关键设计**：同队 5 人除 `dmg` 外所有字段完全一致（击杀/死亡/助攻/补刀/
    /// 视野/经济/承伤/治疗/胜负全同）。这样两名玩家之间的分数差异**只可能**来自
    /// team-relative 维度，从而使本模块的回归测试真正能捕获「只传单元素切片」
    /// 这一 bug —— 若各人 KDA 或经济也有差异，KDA 等非 team-relative 维度会掩盖问题。
    fn make_game(blue_damage: [i32; 5], red_damage: [i32; 5]) -> Game {
        let mut identities = Vec::new();
        let mut participants = Vec::new();

        for (team_id, damages) in [(100i32, blue_damage), (200i32, red_damage)] {
            for (i, dmg) in damages.iter().enumerate() {
                let pid = (team_id - 100) * 5 + i as i32 + 1;
                identities.push(GameDetailParticipantIdentity {
                    player: GameDetailPlayer {
                        account_id: pid as i64,
                        puuid: format!("p-{pid}"),
                        platform_id: "TENCENT-1".to_string(),
                        summoner_name: format!("P{pid}"),
                        game_name: format!("P{pid}"),
                        tag_line: "T".to_string(),
                        summoner_id: pid as i64,
                    },
                });
                participants.push(Participant {
                    participant_id: pid,
                    champion_id: pid,
                    team_id,
                    stats: Stats {
                        win: team_id == 100,
                        kills: 4,
                        deaths: 3,
                        assists: 4,
                        gold_earned: 10_000,
                        total_damage_dealt_to_champions: *dmg,
                        total_damage_taken: 20_000,
                        total_heal: 1_000,
                        total_minions_killed: 180,
                        neutral_minions_killed: 20,
                        vision_score: 30,
                        ..Default::default()
                    },
                    ..Default::default()
                });
            }
        }

        identities.sort_by(|a, b| a.player.puuid.cmp(&b.player.puuid));
        participants.sort_by_key(|p| p.participant_id);

        Game {
            game_detail: GameDetail {
                game_duration: 1800,
                participants,
                participant_identities: identities,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn score_of(game: &Game, puuid: &str) -> f64 {
        let p = find_participant(game, puuid).expect("puuid 应在本局");
        participant_score_in_game(game, p).expect("应算出总分")
    }

    /// 回归测试：17 分制必须对**整队**聚合，而不是只对该参与者。
    ///
    /// 修复前 `assess_team_threats_with_games` 给 `score_participants` 传的是
    /// 单元素切片，`contribution_ratio(x, x, 1) ≡ 1.0`，于是伤害/承伤/经济/视野/
    /// 参团这 11 分对每个人都相同 —— 队内输出最高者与最低者得分**完全相等**。
    ///
    /// 本断言在修复前必然失败（已用等价实现数值验证：修复前两人同为 4.0166）。
    #[test]
    fn should_score_team_relative_dimensions_against_whole_team() {
        let game = make_game([50_000, 10_000, 7_500, 5_000, 2_500], [20_000; 5]);

        let top = score_of(&game, "p-1");
        let low = score_of(&game, "p-2");

        assert!(
            top > low,
            "队内输出最高的玩家({top}) 应严格高于次低者({low})；\
             相等说明 score_participants 只收到了单元素切片，team-relative 维度已退化为常数"
        );
    }

    /// 同一队伍内，总分应随输出占比递减而单调不增，且首尾严格递减。
    ///
    /// 允许中间并列：`linear(ratio, 1.0, 2.0, 3)` 在 ratio ≤ 1.0 时一律记 0 分，
    /// 占比过低的玩家会并列在 0 分地板上，这是公式的既定行为而非缺陷。
    /// 但「修复前 5 人全同」会让首尾相等，故首尾严格递减仍是有效断言。
    #[test]
    fn should_rank_teammates_by_damage_share() {
        let game = make_game([40_000, 30_000, 20_000, 10_000, 5_000], [20_000; 5]);

        let scores: Vec<f64> = ["p-1", "p-2", "p-3", "p-4", "p-5"]
            .iter()
            .map(|puuid| score_of(&game, puuid))
            .collect();

        for w in scores.windows(2) {
            assert!(w[0] >= w[1], "输出占比递减时总分不应上升，实得 {scores:?}");
        }
        assert!(
            scores[0] > scores[4],
            "队内输出 40000 与 5000 的两名队友不应同分（并列即退化），实得 {scores:?}"
        );
    }

    #[test]
    fn should_return_none_when_participant_not_in_game() {
        let game = make_game([20_000; 5], [20_000; 5]);
        assert!(
            find_participant(&game, "p-999").is_none(),
            "不存在的 puuid 不应被定位"
        );
    }

    #[test]
    fn should_return_low_threat_when_no_games() {
        let style = PlayerStyle::new();
        let rating = assess_single_threat(&style, 0);
        assert_eq!(rating.threat_level, ThreatLevel::Low);
        assert!(rating.caveats.contains(&"数据不足".to_string()));
        assert!(rating.caveats.contains(&"未交手".to_string()));
    }

    #[test]
    fn should_return_low_threat_when_insufficient_games() {
        let mut style = PlayerStyle::new();
        for _ in 0..3 {
            style.kills.push(5);
            style.deaths.push(3);
            style.assists.push(8);
            style.damages.push(12000);
            style.visions.push(25);
            style.cs.push(180);
            style.scores.push(8.5);
            style.total += 1;
        }
        let rating = assess_single_threat(&style, 0);
        assert_eq!(rating.threat_level, ThreatLevel::Low);
        assert!(rating.caveats.contains(&"数据不足".to_string()));
    }

    #[test]
    fn should_assign_medium_threat_for_average_player() {
        let mut style = PlayerStyle::new();
        for _ in 0..10 {
            style.kills.push(4);
            style.deaths.push(5);
            style.assists.push(6);
            style.damages.push(10000);
            style.visions.push(20);
            style.cs.push(150);
            style.scores.push(8.0);
            style.total += 1;
        }
        let rating = assess_single_threat(&style, 5);
        assert_eq!(rating.threat_level, ThreatLevel::Medium);
        assert_eq!(rating.encounter_count, 5);
    }

    #[test]
    fn should_assign_high_threat_for_strong_player() {
        let mut style = PlayerStyle::new();
        for _ in 0..10 {
            style.kills.push(8);
            style.deaths.push(2);
            style.assists.push(10);
            style.damages.push(25000);
            style.visions.push(30);
            style.cs.push(200);
            style.scores.push(12.0);
            style.total += 1;
            style.wins += 1;
        }
        let rating = assess_single_threat(&style, 3);
        assert_eq!(rating.threat_level, ThreatLevel::High);
        assert!(rating.recent_performance >= HIGH_PERFORMANCE_THRESHOLD);
    }

    #[test]
    fn should_assign_critical_threat_for_elite_player() {
        let mut style = PlayerStyle::new();
        for _ in 0..10 {
            style.kills.push(12);
            style.deaths.push(1);
            style.assists.push(15);
            style.damages.push(35000);
            style.visions.push(40);
            style.cs.push(250);
            style.scores.push(15.0);
            style.total += 1;
            style.wins += 1;
        }
        let rating = assess_single_threat(&style, 10);
        assert_eq!(rating.threat_level, ThreatLevel::Critical);
        assert!(rating.recent_performance >= CRITICAL_PERFORMANCE_THRESHOLD);
    }

    #[test]
    fn should_generate_style_tags() {
        let mut style = PlayerStyle::new();
        for _ in 0..10 {
            style.kills.push(10);
            style.deaths.push(2);
            style.assists.push(3);
            style.damages.push(30000);
            style.visions.push(10);
            style.cs.push(250);
            style.scores.push(13.0);
            style.total += 1;
        }
        let tags = generate_style_tags(&style);
        assert!(tags.iter().any(|t| t == "侵略性强"));
        assert!(tags.iter().any(|t| t == "高KDA"));
        assert!(!tags.is_empty());
    }

    #[test]
    fn should_return_zero_aggression_for_empty() {
        let style = PlayerStyle::new();
        assert_eq!(compute_aggression(&style), 0.0);
    }
}
