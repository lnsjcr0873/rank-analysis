use crate::lcu::api::sgp::SgpFrame;
use crate::score::events::types::{
    fmt_mmss, ms_to_secs, ScoreDimension, ScoreEvent, DELTA_VISION_GAP, VISION_GAP_SECS,
};

/// 视野维归因检测器：连续未插眼（本人 WARD_PLACED 间隔超阈值）。
pub fn detect_vision_gap_events(frames: &[SgpFrame], pid: i32) -> Vec<ScoreEvent> {
    let mut placed: Vec<i64> = frames
        .iter()
        .flat_map(|f| f.events.iter())
        .filter(|e| e.r#type.as_deref() == Some("WARD_PLACED") && e.participant_id == Some(pid))
        .filter_map(|e| e.timestamp.map(ms_to_secs))
        .collect();
    placed.sort_unstable();

    let mut out = Vec::new();
    for w in placed.windows(2) {
        let gap = w[1] - w[0];
        if gap > VISION_GAP_SECS {
            out.push(ScoreEvent {
                dimension: ScoreDimension::Vision,
                timestamp_secs: w[0],
                description: format!(
                    "{}–{} 连续 {} 分钟未插眼",
                    fmt_mmss(w[0]),
                    fmt_mmss(w[1]),
                    gap / 60
                ),
                delta: DELTA_VISION_GAP,
            });
        }
    }
    out
}
