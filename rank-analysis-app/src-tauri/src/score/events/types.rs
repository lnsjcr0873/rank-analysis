use crate::lcu::api::sgp::SgpFrameEvent;
use std::collections::HashSet;

/// 维度枚举：与 `command::score::PlayerScoreBreakdown` 字段一一对应。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScoreDimension {
    Kda,
    Win,
    Damage,
    DamageTaken,
    Heal,
    Cs,
    Gold,
    Participation,
    Vision,
}

/// 一条事件级归因证据。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreEvent {
    pub dimension: ScoreDimension,
    /// 对局内秒（0 起）；帧级证据取该时段的起始秒。
    pub timestamp_secs: i64,
    /// 人类可读的中文描述（UI 时间轴与 AI prompt 共用）。
    pub description: String,
    /// 该证据对维分的扣分估计（启发式固定权重，非精确分数）。
    pub delta: f64,
}

/// 单场对局单名玩家的三级下钻结果（L1 总分 + L2 维度分 + L3 事件证据）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreBreakdownDrilldown {
    pub participant_id: i32,
    pub champion_id: i32,
    pub total: f64,
    pub breakdown: crate::command::score::PlayerScoreBreakdown,
    pub events: Vec<ScoreEvent>,
    /// false = timeline 不可用，事件列表为空且不应展示为"低分原因"。
    pub timeline_available: bool,
}

/// 单局事件证据上限（防长局刷屏）。
pub const MAX_EVENTS: usize = 12;

/// 团战判定窗口（秒）。
pub const TEAMFIGHT_WINDOW_SECS: i64 = 45;
/// 团战最少死亡数（窗口内 ChampionKill 计数）。
pub const TEAMFIGHT_MIN_DEATHS: usize = 3;

/// 视野：相邻插眼间隔超过该秒数 → "连续未插眼"证据。
pub const VISION_GAP_SECS: i64 = 300;

/// 帧级停滞判定：本人增量 < 队均增量 × 该系数，且持续 ≥ 该帧数。
pub const STALL_RATIO: f64 = 0.5;
pub const STALL_MIN_FRAMES: usize = 2;

// 各事件类型的启发式扣分权重（delta 语义：扣分估计，非精确）。
pub const DELTA_PARTICIPATION_MISS: f64 = 0.5;
pub const DELTA_DEATH: f64 = 0.1;
pub const DELTA_CS_STALL: f64 = 0.1;
pub const DELTA_VISION_GAP: f64 = 0.15;
pub const DELTA_GOLD_STALL: f64 = 0.1;
pub const DELTA_DAMAGE_DIP: f64 = 0.1;

/// 毫秒 → 对局内秒。
pub fn ms_to_secs(ms: i64) -> i64 {
    ms / 1000
}

/// 秒 → `mm:ss`。
pub fn fmt_mmss(secs: i64) -> String {
    format!("{:02}:{:02}", secs / 60, secs % 60)
}

/// 帧事件是否为击杀（死亡）事件。
pub fn is_champion_kill(e: &SgpFrameEvent) -> bool {
    e.r#type.as_deref() == Some("CHAMPION_KILL")
}

/// 事件参与者是否包含某玩家（击杀者/受害者/助攻任一）。
pub fn event_involves(e: &SgpFrameEvent, pid: i32) -> bool {
    e.participant_id == Some(pid)
        || e.killer_id == Some(pid)
        || e.victim_id == Some(pid)
        || e.assisting_participant_ids
            .as_ref()
            .is_some_and(|ids| ids.contains(&pid))
}

/// 事件是否涉及集合中任一玩家（击杀者/受害者/助攻/事件主体任一命中）。
pub fn event_involves_any(e: &SgpFrameEvent, pids: &HashSet<i32>) -> bool {
    e.killer_id.is_some_and(|k| pids.contains(&k))
        || e.victim_id.is_some_and(|v| pids.contains(&v))
        || e.participant_id.is_some_and(|p| pids.contains(&p))
        || e.assisting_participant_ids
            .as_ref()
            .is_some_and(|ids| ids.iter().any(|a| pids.contains(a)))
}
