//! # BP 智能推荐命令模块
//!
//! 从近期战绩 + OP.GG 快照算出三类兜底池候选：
//! - frequent：常用英雄 → pick 池
//! - nemesis：败局中敌方高频英雄（常输给谁）→ ban 池
//! - hot_t0：版本 T0/T1，按熟练度分流 pick/ban
//!
//! 纯统计无 AI；聚合全部是纯函数，方便单测。
//! 主玩分路不用国服不可信的 lane 字段，改用常用英雄的 OP.GG 主分路加权众数。

use crate::config::{get_config, Value};
pub use crate::domain::bp_suggestion::*;
use crate::lcu::api::match_history::{Game, MatchHistory};
use crate::lcu::api::summoner::Summoner;
use crate::state::AppState;
use tauri::State;

/// 参与统计的最大场次（LCU 可靠窗口 50 场内取近 30）。
const SAMPLE_GAMES: i32 = 30;
/// 样本下限：不足时返回空结果让前端显示「打几局再来」。
const MIN_SAMPLE_GAMES: usize = 10;
/// 排位队列（单双/灵活）。
const RANKED_QUEUES: [i32; 2] = [420, 440];

/// 读取兜底池配置（照抄 automation.rs::load_champion_pool 的容错读法）。
async fn load_pool(key: &str) -> Vec<i32> {
    let to_ids = |list: &Vec<Value>| -> Vec<i32> {
        list.iter()
            .filter_map(|v| match v {
                Value::Integer(i) => Some(*i as i32),
                _ => None,
            })
            .collect()
    };
    match get_config(key).await {
        Ok(Value::Map(m)) => match m.get("value") {
            Some(Value::List(list)) => to_ids(list),
            _ => vec![],
        },
        Ok(Value::List(list)) => to_ids(&list),
        _ => vec![],
    }
}

/// BP 智能推荐：算出三类兜底池候选。
///
/// # 参数
/// - `position`: 显式指定分路（大写 TOP/...）；None 用常用英雄推断的主分路
///
/// # 行为
/// - 近 30 场里筛排位（420/440）；排位不足 10 场则放宽用全部模式
/// - 全部样本仍不足 10 场时返回空分区（sample_games 告知前端显示空态）
/// - OP.GG 快照拿不到时 opgg_ok=false，hot_t0 为空，其余分区照常
#[tauri::command]
pub async fn get_bp_suggest(
    position: Option<String>,
    state: State<'_, AppState>,
) -> Result<BpSuggestResult, String> {
    let me = Summoner::get_my_summoner().await?;
    let mut history =
        MatchHistory::get_match_history_by_puuid(&me.puuid, 0, SAMPLE_GAMES - 1).await?;
    history.enrich_game_detail().await?;

    let all_games = history.games.games;
    let ranked: Vec<Game> = all_games
        .iter()
        .filter(|g| RANKED_QUEUES.contains(&g.queue_id))
        .cloned()
        .collect();
    let games: &[Game] = if ranked.len() >= MIN_SAMPLE_GAMES {
        &ranked
    } else {
        &all_games
    };

    if games.len() < MIN_SAMPLE_GAMES {
        return Ok(BpSuggestResult {
            main_position: String::new(),
            sample_games: games.len() as i32,
            opgg_ok: false,
            opgg_stale: false,
            frequent: vec![],
            nemesis: vec![],
            hot_t0: vec![],
        });
    }

    // OP.GG 数据缺失不阻塞：hot_t0 降级为空；stale 透传给前端提示，快照缺失时恒 false
    let (snapshot, opgg_stale) =
        match crate::command::opgg::ensure_opgg_snapshot(&state, "ranked").await {
            Ok((snap, stale)) => (Some(snap), stale),
            Err(_) => (None, false),
        };

    let pick_pool = load_pool("settings.auto.pickChampionSlice").await;
    let ban_pool = load_pool("settings.auto.banChampionSlice").await;

    let mut result = build_suggestions(
        games,
        &me.puuid,
        snapshot.as_deref(),
        position.as_deref(),
        &pick_pool,
        &ban_pool,
    );
    result.opgg_stale = opgg_stale;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::game_detail::GameDetail;
    use crate::lcu::api::model::{Participant, ParticipantIdentity, Player, Stats};
    use crate::opgg::data::{ChampionMeta, OpggSnapshot};
    use std::collections::HashMap;

    /// 构造一场对局：我用 my_champ，胜负 win，敌方阵容 enemy_champs。
    fn game(my_champ: i32, win: bool, enemy_champs: &[i32], queue_id: i32) -> Game {
        let me = Participant {
            team_id: 100,
            champion_id: my_champ,
            stats: Stats {
                win,
                ..Default::default()
            },
            ..Default::default()
        };
        // game_detail：我 + 敌方（识别靠 puuid，敌方 team_id=200）
        let mut participants = vec![me.clone()];
        let mut identities = vec![ParticipantIdentity {
            player: Player {
                puuid: "me".into(),
                ..Default::default()
            },
        }];
        for (i, champ) in enemy_champs.iter().enumerate() {
            participants.push(Participant {
                team_id: 200,
                champion_id: *champ,
                stats: Stats {
                    win: !win,
                    ..Default::default()
                },
                ..Default::default()
            });
            identities.push(ParticipantIdentity {
                player: Player {
                    puuid: format!("enemy{}", i),
                    ..Default::default()
                },
            });
        }
        Game {
            queue_id,
            participants: vec![me],
            game_detail: GameDetail {
                participants,
                participant_identities: identities,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn meta(champion_id: i32, position: &str, tier: i32, ban_rate: f64) -> ChampionMeta {
        ChampionMeta {
            champion_id,
            position: position.into(),
            tier,
            rank: 1,
            rank_prev_patch: 0,
            win_rate: 0.52,
            pick_rate: 0.1,
            ban_rate,
            role_rate: 0.8,
            is_main_position: true,
        }
    }

    fn snapshot(metas: Vec<ChampionMeta>) -> OpggSnapshot {
        let mut champions: HashMap<i32, Vec<ChampionMeta>> = HashMap::new();
        for m in metas {
            champions.entry(m.champion_id).or_default().push(m);
        }
        OpggSnapshot {
            mode: "ranked".into(),
            tier: "emerald_plus".into(),
            patch: "16.13".into(),
            fetched_at: 0,
            champions,
            counters: HashMap::new(),
        }
    }

    #[test]
    fn frequent_should_require_min_games_and_sort_by_count() {
        // 英雄 1 打 4 场、英雄 2 打 3 场、英雄 3 打 2 场（低于门槛淘汰）
        let mut games = vec![];
        for _ in 0..4 {
            games.push(game(1, true, &[50], 420));
        }
        for _ in 0..3 {
            games.push(game(2, false, &[50], 420));
        }
        for _ in 0..2 {
            games.push(game(3, true, &[50], 420));
        }
        let result = build_suggestions(&games, "me", None, None, &[], &[]);
        let ids: Vec<i32> = result.frequent.iter().map(|i| i.champion_id).collect();
        assert_eq!(ids, vec![1, 2]);
        assert_eq!(result.frequent[0].suggested_pool, "pick");
        assert_eq!(result.frequent[0].evidence.games, Some(4));
        assert_eq!(result.frequent[0].evidence.win_rate, Some(1.0));
    }

    #[test]
    fn nemesis_should_count_enemies_in_losses_only_and_skip_my_frequents() {
        let mut games = vec![];
        // 3 场败局都有敌方英雄 77；1 场胜局的敌方 88 不该被计入
        for _ in 0..3 {
            games.push(game(1, false, &[77, 78], 420));
        }
        games.push(game(1, true, &[88], 420));
        // 我自己也常玩 78（4 场）→ nemesis 应排除 78
        for _ in 0..4 {
            games.push(game(78, true, &[50], 420));
        }
        let result = build_suggestions(&games, "me", None, None, &[], &[]);
        let ids: Vec<i32> = result.nemesis.iter().map(|i| i.champion_id).collect();
        assert_eq!(
            ids,
            vec![77],
            "只统计败局敌方,排除自己常玩的 78,88 不达门槛"
        );
        assert_eq!(result.nemesis[0].suggested_pool, "ban");
        assert_eq!(result.nemesis[0].evidence.losses_against, Some(3));
        assert_eq!(result.nemesis[0].evidence.loss_games, Some(3));
    }

    #[test]
    fn hot_t0_should_split_by_proficiency_and_filter_pick_by_position() {
        // 英雄 1：T0 上单,我 4 场全胜 → pick；英雄 5：T0 中单,我没玩过 → ban
        // 英雄 6：T0 上单但我没玩过 → ban（ban 不限分路）
        let mut games = vec![];
        for _ in 0..4 {
            games.push(game(1, true, &[50], 420));
        }
        let snap = snapshot(vec![
            meta(1, "TOP", 1, 0.2),
            meta(5, "MIDDLE", 1, 0.3),
            meta(6, "TOP", 1, 0.1),
        ]);
        let result = build_suggestions(&games, "me", Some(&snap), Some("TOP"), &[], &[]);
        assert!(result.opgg_ok);
        let picks: Vec<i32> = result
            .hot_t0
            .iter()
            .filter(|i| i.suggested_pool == "pick")
            .map(|i| i.champion_id)
            .collect();
        let bans: Vec<i32> = result
            .hot_t0
            .iter()
            .filter(|i| i.suggested_pool == "ban")
            .map(|i| i.champion_id)
            .collect();
        assert_eq!(picks, vec![1]);
        // ban 向按 ban_rate 降序：5(0.3) 在 6(0.1) 前
        assert_eq!(bans, vec![5, 6]);
    }

    #[test]
    fn hot_t0_pick_should_not_filter_by_position_when_explicitly_empty() {
        // 主分路投票会是 TOP（英雄 1 打了 4 场 TOP，多于英雄 5 的 3 场 MIDDLE），
        // 但显式传 Some("")（=「全部分路」，不过滤）时，MIDDLE 的会玩英雄（5）
        // 也应出现在 pick 向，不应被按 TOP 过滤掉。
        let mut games = vec![];
        for _ in 0..4 {
            games.push(game(1, true, &[50], 420));
        }
        for _ in 0..3 {
            games.push(game(5, true, &[50], 420));
        }
        let snap = snapshot(vec![meta(1, "TOP", 1, 0.2), meta(5, "MIDDLE", 1, 0.3)]);
        let result = build_suggestions(&games, "me", Some(&snap), Some(""), &[], &[]);
        let picks: Vec<i32> = result
            .hot_t0
            .iter()
            .filter(|i| i.suggested_pool == "pick")
            .map(|i| i.champion_id)
            .collect();
        assert!(picks.contains(&1), "TOP 会玩英雄应出现在 pick 向");
        assert!(
            picks.contains(&5),
            "显式空字符串=不过滤分路，MIDDLE 会玩英雄也应出现在 pick 向"
        );
    }

    #[test]
    fn hot_t0_ban_should_exclude_my_frequent_champions() {
        // 英雄 9：T0 主分路 TOP,我打过 3 场但全败(胜率 0% → 不「会玩」)
        // 它已在 frequent(3 场达标)——不该再被建议 ban,矛盾推荐
        let mut games = vec![];
        for _ in 0..3 {
            games.push(game(9, false, &[50], 420));
        }
        let snap = snapshot(vec![meta(9, "TOP", 1, 0.2)]);
        let result = build_suggestions(&games, "me", Some(&snap), Some("TOP"), &[], &[]);
        assert!(
            result.frequent.iter().any(|i| i.champion_id == 9),
            "9 是常用英雄"
        );
        assert!(
            !result.hot_t0.iter().any(|i| i.champion_id == 9),
            "常用英雄不该出现在 hot_t0 ban 向"
        );
    }

    #[test]
    fn main_position_should_be_weighted_mode_of_opgg_main_positions() {
        // 英雄 1(TOP) 4 场 + 英雄 2(TOP) 2 场 vs 英雄 3(MIDDLE) 3 场 → TOP
        let mut games = vec![];
        for _ in 0..4 {
            games.push(game(1, true, &[50], 420));
        }
        for _ in 0..2 {
            games.push(game(2, true, &[50], 420));
        }
        for _ in 0..3 {
            games.push(game(3, true, &[50], 420));
        }
        let snap = snapshot(vec![
            meta(1, "TOP", 2, 0.1),
            meta(2, "TOP", 3, 0.1),
            meta(3, "MIDDLE", 2, 0.1),
        ]);
        let result = build_suggestions(&games, "me", Some(&snap), None, &[], &[]);
        assert_eq!(result.main_position, "TOP");
        // 未显式传分路时,hot_t0 pick 向应按推断出的 TOP 过滤
    }

    #[test]
    fn main_position_tie_should_be_deterministic_by_position_lexical_order() {
        // 英雄 A(JUNGLE) 与英雄 B(TOP) 各打 3 场 → 得票数相等（平票）。
        // HashMap 遍历序不确定，必须靠次级 tie-break（字典序最小）保证结果稳定：
        // JUNGLE < TOP，故恒返回 JUNGLE。
        let mut games = vec![];
        for _ in 0..3 {
            games.push(game(10, true, &[50], 420)); // 英雄 10 → JUNGLE
        }
        for _ in 0..3 {
            games.push(game(20, true, &[50], 420)); // 英雄 20 → TOP
        }
        let snap = snapshot(vec![meta(10, "JUNGLE", 2, 0.1), meta(20, "TOP", 2, 0.1)]);
        let my_champs = aggregate_my_champions(&games);
        for _ in 0..20 {
            // 反复跑几次，覆盖 HashMap 遍历序的随机性
            assert_eq!(derive_main_position(&my_champs, Some(&snap)), "JUNGLE");
        }
    }

    #[test]
    fn already_in_pool_should_be_flagged_per_target_pool() {
        let mut games = vec![];
        for _ in 0..3 {
            games.push(game(1, false, &[77], 420));
        }
        let result = build_suggestions(&games, "me", None, None, &[1], &[77]);
        assert!(result.frequent[0].already_in_pool, "1 已在 pick 池");
        assert!(result.nemesis[0].already_in_pool, "77 已在 ban 池");
    }
}
