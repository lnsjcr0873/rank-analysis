//! # timeline 帧级分析（P1）
//!
//! 从 SGP `DETAILS` 的逐分钟帧里，还原**前期**的三个事实：
//! 打野节奏（开局清野顺序）、死亡结构（前期被单杀几次）、资源参与（龙/峡谷先锋）。
//! 这三件事是 21 个 Tag 里 C 类 4 个（极好抓/好抓/难抓/可疑闪现）的唯一数据源，
//! 也是 P5 打野路径卡的底座。
//!
//! ## 设计约束
//!
//! 1. **纯函数**：本模块不做任何 IO。入参是已取到的 [`SgpGameDetailResponse`]，
//!    出参是结论 + 降级原因。这样 CI 里不需要网络与 SGP token。
//! 2. **降级而非中断**：拿不到帧 / 非召唤师峡谷 / 坐标缺失，一律返回
//!    `None` 并附 `degraded` 文案，绝不返回半截结论。
//! 3. **数据可信度前置校验**：击杀事件数明显超出常理即判脏数据整局放弃
//!    （见 [`MAX_PLAUSIBLE_KILL_EVENTS`])，避免脏数据算出「场均 5 次单杀」。
//!
//! [MAX_PLAUSIBLE_KILL_EVENTS]: crate::timeline::constants::MAX_PLAUSIBLE_KILL_EVENTS

pub mod constants;
pub mod geometry;

#[cfg(test)]
mod tests;

use std::collections::HashMap;

use serde::Serialize;

use crate::lcu::api::sgp::{SgpFrame, SgpFrameEvent, SgpGameDetailResponse};
use constants::{
    Degraded, ANALYSIS_MINUTES, EARLY_LIMIT_MS, KILL_WEIGHT, MAX_PLAUSIBLE_KILL_EVENTS,
};
use geometry::{camp_of_monster, is_plausible_coord, Camp};

/// 召唤师峡谷的 `mapId`。
const MAP_ID_SUMMONERS_RIFT: i64 = 11;

/// 清理野怪的帧事件类型（**已归一化**：小写且无分隔符）。
const CAMP_KILL_EVENT_TYPES: &[&str] = &["monsterkill", "campkill"];

/// 击杀事件的帧事件类型（已归一化）。
const CHAMPION_KILL_EVENT_TYPES: &[&str] = &["championkill"];

/// 帧事件类型归一化：小写 + 只保留字母数字。
///
/// **常量表里的每个键都必须写成归一化后的形式**（`championkill` 而非
/// `champion_kill`）。否则收到的 `CHAMPION_KILL` 归一化成 `championkill` 后
/// 与未归一化的键做子串匹配会**静默失败**——表现为「所有击杀都识别不出」，
/// 没有任何报错。这是本模块踩过的坑，故在此显式写明。
fn normalize_event_type(raw: Option<&str>) -> String {
    raw.unwrap_or_default()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

fn is_champion_kill(e: &SgpFrameEvent) -> bool {
    let t = normalize_event_type(e.r#type.as_deref());
    CHAMPION_KILL_EVENT_TYPES
        .iter()
        .any(|k| t == *k || t.contains(k))
}

fn is_camp_kill(e: &SgpFrameEvent) -> bool {
    let t = normalize_event_type(e.r#type.as_deref());
    CAMP_KILL_EVENT_TYPES
        .iter()
        .any(|k| t == *k || t.contains(k))
}

/// 一名玩家在一局里的前期表现。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerTimeline {
    /// 本人 participantId（由调用方按 puuid 匹配后回填）
    pub participant_id: i32,
    /// 分析覆盖的帧数
    pub frames_analyzed: u32,
    /// 开局清野顺序（按首次清理时间排序）
    pub jungle_path: Vec<Camp>,
    /// 首个 camp 的清理时刻（毫秒，相对对局开始）
    pub first_camp_at_ms: Option<i64>,
    /// 开局 3 分钟内是否碰过野怪（区分「入侵野区」与「刷自己野区」）
    pub invaded_before_3min: bool,
    /// 前期死亡次数
    pub early_deaths: u32,
    /// 前期死亡加权分（单杀权重高）
    pub early_death_score: f64,
    /// 前期各次死亡是否都无人协防（true = 好抓）
    pub all_early_deaths_solo: bool,
    /// 是否参与过资源团
    pub contested_objectives: u32,
}

/// 一局的分析产出：逐玩家结论 + 本局是否降级。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameTimeline {
    pub game_id: i64,
    pub players: Vec<PlayerTimeline>,
    /// 非空表示本局降级，`players` 不可信
    pub degraded: Option<String>,
}

/// 判定本局是否应当整体降级。
///
/// 顺序：先看地图（换了图坐标没意义）→ 再看有没有帧 → 最后看坐标可信度。
fn detect_degraded(map_id: Option<i64>, frames: &[SgpFrame]) -> Option<Degraded> {
    if let Some(id) = map_id {
        if id != MAP_ID_SUMMONERS_RIFT {
            return Some(Degraded::NotSummonersRift);
        }
    }
    if frames.is_empty() {
        return Some(Degraded::NoFrames);
    }
    // 帧里至少要有一个可信坐标，否则位置推断全无依据。
    // 坐标有两个来源，**都要看**：事件坐标（事件发生处）与参与者逐分钟坐标（人在哪）。
    // 只看事件坐标会把「有 participant_frames 但事件不带坐标」的合法帧误判为无坐标——
    // 而「事件有坐标、participant_frames 为空」同样是合法形态（有些局只给其一）。
    let has_position = frames.iter().any(|f| {
        let in_events = f.events.iter().any(|e| {
            e.position
                .as_ref()
                .is_some_and(|p| is_plausible_coord(p.x, p.y))
        });
        let in_participants = f.participant_frames.values().any(|s| {
            s.position
                .as_ref()
                .is_some_and(|p| is_plausible_coord(p.x, p.y))
        });
        in_events || in_participants
    });
    if !has_position {
        return Some(Degraded::NoPositions);
    }
    None
}

/// 本局全部击杀事件数（用于脏数据熔断）。
fn count_champion_kills(frames: &[SgpFrame]) -> usize {
    frames
        .iter()
        .flat_map(|f| f.events.iter())
        .filter(|e| is_champion_kill(e))
        .count()
}

/// 抽出一局的有效帧（限制在前期窗口内）。
fn early_frames(frames: &[SgpFrame]) -> Vec<&SgpFrame> {
    // 帧 timestamp 单位为毫秒；无 timestamp 的帧保留，交由后续按事件时间兜底
    frames
        .iter()
        .filter(|f| match f.timestamp {
            Some(ts) => ts <= ANALYSIS_MINUTES * 60 * 1000,
            None => true,
        })
        .collect()
}

/// 某次击杀是否为「单杀」（无人协防）。
fn is_solo_kill(e: &SgpFrameEvent) -> bool {
    e.assisting_participant_ids
        .as_ref()
        .is_none_or(|ids| ids.is_empty())
}

/// 一次早期死亡的权重：单杀权重最高，多人参与逐级递减。
fn death_weight(e: &SgpFrameEvent) -> f64 {
    let helpers = e
        .assisting_participant_ids
        .as_ref()
        .map(|v| v.len())
        .unwrap_or(0);
    // 1 + 1/(1+helpers)：单杀 = 1.0，双人 = 0.5，三人 = 0.33…，收敛到 0
    1.0 / (1.0 + helpers as f64)
}

/// 清野序列：按时间记录首次清理的营地，重复营地只记第一次。
fn collect_jungle_path(frames: &[&SgpFrame]) -> Vec<(Camp, i64)> {
    let mut path: Vec<(Camp, i64)> = Vec::new();
    for f in frames {
        let ts = f.timestamp.unwrap_or_default();
        for e in &f.events {
            if !is_camp_kill(e) {
                continue;
            }
            let Some(camp) =
                camp_of_monster(e.monster_type.as_deref(), e.monster_sub_type.as_deref())
            else {
                continue;
            };
            if path.iter().any(|(c, _)| *c == camp) {
                continue;
            }
            path.push((camp, ts));
        }
    }
    path
}

/// 统计某参与者的前期死亡情况。
fn collect_early_deaths(frames: &[&SgpFrame], participant_id: i32) -> (u32, f64, bool) {
    let mut count = 0u32;
    let mut score = 0.0f64;
    let mut all_solo = true;
    for f in frames {
        let ts = f.timestamp.unwrap_or_default();
        if ts > EARLY_LIMIT_MS {
            continue;
        }
        for e in &f.events {
            if !is_champion_kill(e) || e.victim_id != Some(participant_id) {
                continue;
            }
            count += 1;
            score += death_weight(e) * KILL_WEIGHT;
            if !is_solo_kill(e) {
                all_solo = false;
            }
        }
    }
    (count, score, all_solo)
}

/// 统计某参与者参与过的资源节奏次数。
///
/// 定义（刻意保守，宁可少算不可多算）：同一帧内出现以下任一即算一次——
/// - 该参与者**亲自拿下**资源（龙/先锋/男爵的 monster 击杀，killer 或 participant 命中）；
/// - 该帧同时发生了资源击杀与英雄击杀，且该参与者是击杀方或受害方（即参与了资源团）。
///
/// **已知局限**：SGP 帧是逐分钟聚合，一分钟内两次事件会被合并计数，
/// 因此这是「节奏次数」的上界近似，不是精确的团战次数。
fn collect_objectives(frames: &[&SgpFrame], participant_id: i32) -> u32 {
    let is_objective_event = |e: &SgpFrameEvent| -> bool {
        camp_of_monster(e.monster_type.as_deref(), e.monster_sub_type.as_deref())
            .is_some_and(geometry::is_objective_camp)
    };

    let mut n = 0u32;
    for f in frames {
        // 该帧是否发生了资源事件，以及本人是否亲自参与击杀/拿下
        let objective_happened = f.events.iter().any(is_objective_event);
        let self_took_objective = f.events.iter().any(|e| {
            is_objective_event(e)
                && (e.participant_id == Some(participant_id) || e.killer_id == Some(participant_id))
        });
        // 本人是否参与了该帧的英雄击杀（作为击杀方或受害方）
        let self_in_kill = f.events.iter().any(|e| {
            is_champion_kill(e)
                && (e.killer_id == Some(participant_id) || e.victim_id == Some(participant_id))
        });

        if self_took_objective || (objective_happened && self_in_kill) {
            n += 1;
        }
    }
    n
}

/// 分析一局，返回逐玩家结论。
///
/// @param game_id 本局 gameId（回填用）
/// @param map_id 本局地图 id；`None` 视为未知（不因此降级）
/// @param player_ids 需要产出结论的 participantId 列表
/// @param detail 已取到的 SGP 详情
pub fn analyze_game_timeline(
    game_id: i64,
    map_id: Option<i64>,
    player_ids: &[i32],
    detail: &SgpGameDetailResponse,
) -> GameTimeline {
    // json 缺失与 frames 缺失同义（响应结构不完整）——都按「无帧」降级，
    // 不因为「少一层可选字段」就 panic。
    let Some(json) = detail.json.as_ref() else {
        return GameTimeline {
            game_id,
            players: Vec::new(),
            degraded: Some(Degraded::NoFrames.message().to_string()),
        };
    };
    let frames = &json.frames;

    if let Some(reason) = detect_degraded(map_id, frames) {
        return GameTimeline {
            game_id,
            players: Vec::new(),
            degraded: Some(reason.message().to_string()),
        };
    }

    if count_champion_kills(frames) > MAX_PLAUSIBLE_KILL_EVENTS {
        return GameTimeline {
            game_id,
            players: Vec::new(),
            degraded: Some(Degraded::DirtyFrames.message().to_string()),
        };
    }

    let early = early_frames(frames);
    let path = collect_jungle_path(&early);

    let players = player_ids
        .iter()
        .map(|pid| {
            let (early_deaths, score, all_solo) = collect_early_deaths(&early, *pid);
            PlayerTimeline {
                participant_id: *pid,
                frames_analyzed: early.len() as u32,
                jungle_path: path.iter().map(|(c, _)| *c).collect(),
                first_camp_at_ms: path.first().map(|(_, ts)| *ts),
                invaded_before_3min: path.first().is_some_and(|(_, ts)| *ts <= 3 * 60 * 1000),
                early_deaths,
                early_death_score: score,
                all_early_deaths_solo: early_deaths == 0 || all_solo,
                contested_objectives: collect_objectives(&early, *pid),
            }
        })
        .collect();

    GameTimeline {
        game_id,
        players,
        degraded: None,
    }
}

/// puuid → participantId 映射（DETAILS 只给 `{participantId, puuid}`，且两者均可缺）。
///
/// 同一局内 puuid 唯一，故重复出现时取首个（`or_insert`）——若数据异常导致
/// 同 puuid 对应两个 id，宁可少算一人，也不要让后一个覆盖掉已建立的映射。
pub fn participant_ids_by_puuid(detail: &SgpGameDetailResponse) -> HashMap<String, i32> {
    let mut out: HashMap<String, i32> = HashMap::new();
    let Some(json) = detail.json.as_ref() else {
        return out;
    };
    for p in &json.participants {
        if let (Some(puuid), Some(pid)) = (
            p.puuid.as_deref().filter(|s| !s.is_empty()),
            p.participant_id,
        ) {
            out.entry(puuid.to_string()).or_insert(pid);
        }
    }
    out
}
