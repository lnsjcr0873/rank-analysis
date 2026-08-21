//! # BP 智能推荐领域模块
//!
//! 从近期战绩 + OP.GG 快照算出三类兜底池候选：
//! - frequent：常用英雄 → pick 池
//! - nemesis：败局中敌方高频英雄（常输给谁）→ ban 池
//! - hot_t0：版本 T0/T1，按熟练度分流 pick/ban

use crate::lcu::api::match_history::Game;
use crate::opgg::data::OpggSnapshot;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// 常用英雄入选门槛（场次）。
pub const FREQUENT_MIN_GAMES: i32 = 3;
/// 常输英雄入选门槛（败局出现次数）。
pub const NEMESIS_MIN_ENCOUNTERS: i32 = 2;
/// 各分区候选上限。
pub const SECTION_CAP: usize = 8;
/// 「会玩」判据：≥3 场且胜率 ≥50%。
pub const PROFICIENT_MIN_GAMES: i32 = 3;
pub const PROFICIENT_MIN_WIN_RATE: f64 = 0.5;
/// 主玩分路投票的最低场次（≥2 场才算「玩过」）。
pub const POSITION_VOTE_MIN_GAMES: i32 = 2;

/// `get_bp_suggest` 的聚合结果：主玩分路 + 三类候选分区。
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BpSuggestResult {
    /// 推断（或显式指定）的主玩分路："TOP"|"JUNGLE"|"MIDDLE"|"BOTTOM"|"UTILITY"|""（""=无法判定）
    pub main_position: String,
    /// 参与统计的样本场次。
    pub sample_games: i32,
    /// OP.GG 快照是否可用；false 时 `hot_t0` 恒空。
    pub opgg_ok: bool,
    /// OP.GG 快照是否为过期缓存（刷新失败降级使用旧数据）；快照缺失时恒为 false。
    pub opgg_stale: bool,
    /// 常用英雄 → pick 池候选。
    pub frequent: Vec<BpSuggestItem>,
    /// 常输给的敌方英雄 → ban 池候选。
    pub nemesis: Vec<BpSuggestItem>,
    /// 版本 T0/T1 英雄，按熟练度分流 pick/ban。
    pub hot_t0: Vec<BpSuggestItem>,
}

/// 单个候选英雄条目。
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BpSuggestItem {
    /// 英雄 ID。
    pub champion_id: i32,
    /// 建议去向池："pick" | "ban"。
    pub suggested_pool: String,
    /// 是否已在对应的兜底池中。
    pub already_in_pool: bool,
    /// 支撑本条建议的统计证据。
    pub evidence: BpSuggestEvidence,
}

/// 候选条目的统计证据；全 Option，缺失字段序列化时省略。
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct BpSuggestEvidence {
    /// 我玩该英雄的场次。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub games: Option<i32>,
    /// 我玩该英雄的胜率（0~1）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub win_rate: Option<f64>,
    /// 败局中出现次数（nemesis 专用）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub losses_against: Option<i32>,
    /// 败局总数（nemesis 专用，作为 `losses_against` 的分母参考）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loss_games: Option<i32>,
    /// OP.GG T 级（hot_t0 专用）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opgg_tier: Option<i32>,
    /// OP.GG 胜率（hot_t0 专用，0~1）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opgg_win_rate: Option<f64>,
    /// OP.GG 分路（hot_t0 专用）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
}

/// 我的按英雄聚合：champion_id → (场次, 胜场)。
pub fn aggregate_my_champions(games: &[Game]) -> HashMap<i32, (i32, i32)> {
    let mut map: HashMap<i32, (i32, i32)> = HashMap::new();
    for g in games {
        let Some(me) = g.participants.first() else {
            continue;
        };
        let e = map.entry(me.champion_id).or_insert((0, 0));
        e.0 += 1;
        if me.stats.win {
            e.1 += 1;
        }
    }
    map
}

/// 败局敌方英雄出现次数：champion_id → 次数；同时返回败局总数。
pub fn aggregate_nemesis(games: &[Game]) -> (HashMap<i32, i32>, i32) {
    let mut map: HashMap<i32, i32> = HashMap::new();
    let mut loss_games = 0;
    for g in games {
        let Some(me) = g.participants.first() else {
            continue;
        };
        if me.stats.win {
            continue;
        }
        loss_games += 1;
        for p in &g.game_detail.participants {
            if p.team_id != me.team_id && p.champion_id > 0 {
                *map.entry(p.champion_id).or_insert(0) += 1;
            }
        }
    }
    (map, loss_games)
}

/// 主玩分路：常用英雄（≥POSITION_VOTE_MIN_GAMES 场）的 OP.GG 主分路按场次加权投票。
pub fn derive_main_position(
    my_champs: &HashMap<i32, (i32, i32)>,
    snapshot: Option<&OpggSnapshot>,
) -> String {
    let Some(snap) = snapshot else {
        return String::new();
    };
    let mut votes: HashMap<&str, i32> = HashMap::new();
    for (champ_id, (games, _wins)) in my_champs {
        if *games < POSITION_VOTE_MIN_GAMES {
            continue;
        }
        let Some(metas) = snap.champions.get(champ_id) else {
            continue;
        };
        if let Some(main) = metas.iter().find(|m| m.is_main_position) {
            if !main.position.is_empty() {
                *votes.entry(main.position.as_str()).or_insert(0) += games;
            }
        }
    }
    votes
        .into_iter()
        .max_by_key(|(p, v)| (*v, std::cmp::Reverse(*p)))
        .map(|(p, _)| p.to_string())
        .unwrap_or_default()
}

/// 「会玩」判据：打过 ≥3 场且胜率 ≥50%。
pub fn is_proficient(agg: Option<&(i32, i32)>) -> bool {
    match agg {
        Some((games, wins)) => {
            *games >= PROFICIENT_MIN_GAMES
                && (*wins as f64 / *games as f64) >= PROFICIENT_MIN_WIN_RATE
        }
        None => false,
    }
}

/// 三类候选总装（纯函数，网络/配置读取都在命令层）。
pub fn build_suggestions(
    games: &[Game],
    _my_puuid: &str,
    snapshot: Option<&OpggSnapshot>,
    position: Option<&str>,
    pick_pool: &[i32],
    ban_pool: &[i32],
) -> BpSuggestResult {
    let my_champs = aggregate_my_champions(games);
    let main_position = derive_main_position(&my_champs, snapshot);
    let effective_pos = position.unwrap_or(&main_position);

    let my_frequent_ids: HashSet<i32> = my_champs
        .iter()
        .filter(|(_, (games, _))| *games >= FREQUENT_MIN_GAMES)
        .map(|(id, _)| *id)
        .collect();

    // frequent：常用英雄，按 (games, wins) 降序 → pick 池候选
    let mut frequent_ids: Vec<i32> = my_frequent_ids.iter().copied().collect();
    frequent_ids.sort_by(|a, b| {
        let (ga, wa) = my_champs[a];
        let (gb, wb) = my_champs[b];
        (gb, wb).cmp(&(ga, wa))
    });
    frequent_ids.truncate(SECTION_CAP);
    let frequent: Vec<BpSuggestItem> = frequent_ids
        .iter()
        .map(|id| {
            let (games, wins) = my_champs[id];
            BpSuggestItem {
                champion_id: *id,
                suggested_pool: "pick".to_string(),
                already_in_pool: pick_pool.contains(id),
                evidence: BpSuggestEvidence {
                    games: Some(games),
                    win_rate: Some(wins as f64 / games as f64),
                    ..Default::default()
                },
            }
        })
        .collect();

    // nemesis：败局中敌方高频英雄，排除我自己的常用英雄 → ban 池候选
    let (nemesis_map, loss_games) = aggregate_nemesis(games);
    let mut nemesis_ids: Vec<i32> = nemesis_map
        .iter()
        .filter(|(id, count)| **count >= NEMESIS_MIN_ENCOUNTERS && !my_frequent_ids.contains(id))
        .map(|(id, _)| *id)
        .collect();
    nemesis_ids.sort_by(|a, b| nemesis_map[b].cmp(&nemesis_map[a]));
    nemesis_ids.truncate(SECTION_CAP);
    let nemesis: Vec<BpSuggestItem> = nemesis_ids
        .iter()
        .map(|id| {
            let count = nemesis_map[id];
            BpSuggestItem {
                champion_id: *id,
                suggested_pool: "ban".to_string(),
                already_in_pool: ban_pool.contains(id),
                evidence: BpSuggestEvidence {
                    losses_against: Some(count),
                    loss_games: Some(loss_games),
                    ..Default::default()
                },
            }
        })
        .collect();

    // hot_t0：版本 T0/T1（OP.GG tier==1），按我的熟练度分流 pick/ban
    let opgg_ok = snapshot.is_some();
    let mut hot_t0: Vec<BpSuggestItem> = vec![];
    if let Some(snap) = snapshot {
        let nemesis_set: HashSet<i32> = nemesis_ids.iter().copied().collect();
        let mut pick_candidates: Vec<(i32, &crate::opgg::data::ChampionMeta)> = vec![];
        let mut ban_candidates: Vec<(i32, &crate::opgg::data::ChampionMeta)> = vec![];

        for (champ_id, metas) in &snap.champions {
            let Some(main) = metas.iter().find(|m| m.is_main_position && m.tier == 1) else {
                continue;
            };
            let agg = my_champs.get(champ_id);
            if (effective_pos.is_empty() || main.position == effective_pos) && is_proficient(agg) {
                pick_candidates.push((*champ_id, main));
            } else if !is_proficient(agg)
                && !nemesis_set.contains(champ_id)
                && !my_frequent_ids.contains(champ_id)
            {
                ban_candidates.push((*champ_id, main));
            }
        }

        // pick 向：按场次/胜率降序
        pick_candidates.sort_by(|(a_id, _), (b_id, _)| {
            let (ga, wa) = my_champs.get(a_id).copied().unwrap_or((0, 0));
            let (gb, wb) = my_champs.get(b_id).copied().unwrap_or((0, 0));
            (gb, wb).cmp(&(ga, wa))
        });
        // ban 向：按 OP.GG ban_rate 降序
        ban_candidates.sort_by(|(_, a_meta), (_, b_meta)| {
            b_meta
                .ban_rate
                .partial_cmp(&a_meta.ban_rate)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        pick_candidates.truncate(SECTION_CAP);
        ban_candidates.truncate(SECTION_CAP);

        for (id, meta) in pick_candidates {
            let (games, wins) = my_champs.get(&id).copied().unwrap_or((0, 0));
            hot_t0.push(BpSuggestItem {
                champion_id: id,
                suggested_pool: "pick".to_string(),
                already_in_pool: pick_pool.contains(&id),
                evidence: BpSuggestEvidence {
                    games: if games > 0 { Some(games) } else { None },
                    win_rate: if games > 0 {
                        Some(wins as f64 / games as f64)
                    } else {
                        None
                    },
                    opgg_tier: Some(meta.tier),
                    opgg_win_rate: Some(meta.win_rate),
                    position: Some(meta.position.clone()),
                    ..Default::default()
                },
            });
        }
        for (id, meta) in ban_candidates {
            let (games, wins) = my_champs.get(&id).copied().unwrap_or((0, 0));
            hot_t0.push(BpSuggestItem {
                champion_id: id,
                suggested_pool: "ban".to_string(),
                already_in_pool: ban_pool.contains(&id),
                evidence: BpSuggestEvidence {
                    games: if games > 0 { Some(games) } else { None },
                    win_rate: if games > 0 {
                        Some(wins as f64 / games as f64)
                    } else {
                        None
                    },
                    opgg_tier: Some(meta.tier),
                    opgg_win_rate: Some(meta.win_rate),
                    position: Some(meta.position.clone()),
                    ..Default::default()
                },
            });
        }
    }

    BpSuggestResult {
        main_position,
        sample_games: games.len() as i32,
        opgg_ok,
        opgg_stale: false,
        frequent,
        nemesis,
        hot_t0,
    }
}
