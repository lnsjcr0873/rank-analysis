use crate::lcu::api::sgp::SgpFrame;
use crate::score::events::types::{
    fmt_mmss, is_champion_kill, ms_to_secs, ScoreDimension, ScoreEvent, DELTA_DEATH,
};

/// KDA 维：本人全部阵亡事件。
pub fn detect_death_events(frames: &[SgpFrame], pid: i32) -> Vec<ScoreEvent> {
    let mut deaths: Vec<i64> = frames
        .iter()
        .flat_map(|f| f.events.iter())
        .filter(|e| is_champion_kill(e) && e.victim_id == Some(pid))
        .filter_map(|e| e.timestamp.map(ms_to_secs))
        .collect();
    deaths.sort_unstable();

    deaths
        .iter()
        .enumerate()
        .map(|(i, t)| ScoreEvent {
            dimension: ScoreDimension::Kda,
            timestamp_secs: *t,
            description: format!("{} 阵亡（本局第 {} 次）", fmt_mmss(*t), i + 1),
            delta: DELTA_DEATH,
        })
        .collect()
}
