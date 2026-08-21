pub mod kda;
pub mod stall;
pub mod teamfight;
pub mod vision;

use std::collections::HashSet;

use crate::lcu::api::sgp::SgpGameDetail;
use crate::score::events::types::ScoreEvent;

/// 事件检测器上下文
pub struct DetectorContext<'a> {
    pub detail: &'a SgpGameDetail,
    pub participant_id: i32,
    pub team_pids: &'a HashSet<i32>,
}

/// 事件检测器策略特征
pub trait EventDetector {
    fn detect(&self, ctx: &DetectorContext<'_>) -> Vec<ScoreEvent>;
}

/// 默认组合检测器集合
pub struct DefaultEventDetectors;

impl DefaultEventDetectors {
    pub fn all_detectors() -> Vec<Box<dyn EventDetector>> {
        vec![
            Box::new(VisionDetector),
            Box::new(TeamfightDetector),
            Box::new(KdaDetector),
            Box::new(CsStallDetector),
            Box::new(GoldStallDetector),
            Box::new(DamageDipDetector),
        ]
    }
}

pub struct VisionDetector;
impl EventDetector for VisionDetector {
    fn detect(&self, ctx: &DetectorContext<'_>) -> Vec<ScoreEvent> {
        vision::detect_vision_gap_events(&ctx.detail.frames, ctx.participant_id)
    }
}

pub struct TeamfightDetector;
impl EventDetector for TeamfightDetector {
    fn detect(&self, ctx: &DetectorContext<'_>) -> Vec<ScoreEvent> {
        let clusters = teamfight::cluster_teamfights(&ctx.detail.frames);
        teamfight::detect_teamfight_miss_events(&clusters, ctx.participant_id, ctx.team_pids)
    }
}

pub struct KdaDetector;
impl EventDetector for KdaDetector {
    fn detect(&self, ctx: &DetectorContext<'_>) -> Vec<ScoreEvent> {
        kda::detect_death_events(&ctx.detail.frames, ctx.participant_id)
    }
}

pub struct CsStallDetector;
impl EventDetector for CsStallDetector {
    fn detect(&self, ctx: &DetectorContext<'_>) -> Vec<ScoreEvent> {
        stall::detect_cs_stall_events(ctx.detail, ctx.participant_id, ctx.team_pids)
    }
}

pub struct GoldStallDetector;
impl EventDetector for GoldStallDetector {
    fn detect(&self, ctx: &DetectorContext<'_>) -> Vec<ScoreEvent> {
        stall::detect_gold_stall_events(ctx.detail, ctx.participant_id, ctx.team_pids)
    }
}

pub struct DamageDipDetector;
impl EventDetector for DamageDipDetector {
    fn detect(&self, ctx: &DetectorContext<'_>) -> Vec<ScoreEvent> {
        stall::detect_damage_dip_events(ctx.detail, ctx.participant_id, ctx.team_pids)
    }
}
