//! # L3 事件级归因引擎（score/events）
//!
//! 把 9 维 L2 维度分回溯到**具体事件**（时间轴级证据），供 UI 三级下钻
//! 与 AI 复盘 prompt 引用。数据源是 SGP DETAILS timeline（`SgpGameDetail`）。

pub mod detectors;
pub mod types;

pub use detectors::{
    CsStallDetector, DamageDipDetector, DefaultEventDetectors, DetectorContext, EventDetector,
    GoldStallDetector, KdaDetector, TeamfightDetector, VisionDetector,
};
pub use types::{ScoreBreakdownDrilldown, ScoreDimension, ScoreEvent, MAX_EVENTS};

use std::collections::HashSet;

use crate::lcu::api::sgp::SgpGameDetail;

/// 对单名玩家的帧事件流做全维归因（时间升序，截断 [`MAX_EVENTS`]）。
///
/// `team_pids`：本队 5 人 participantId 集合（用于队均基准与"本队参与团战"判定；
/// 帧数据本身不带 team 信息，必须由调用方从 LCU 详情提供）。
pub fn compute_score_events(
    detail: &SgpGameDetail,
    participant_id: i32,
    team_pids: &HashSet<i32>,
) -> Vec<ScoreEvent> {
    if detail.frames.is_empty() || team_pids.is_empty() {
        return Vec::new();
    }

    let ctx = DetectorContext {
        detail,
        participant_id,
        team_pids,
    };

    let detectors = DefaultEventDetectors::all_detectors();
    let mut events = Vec::new();
    for detector in detectors {
        events.extend(detector.detect(&ctx));
    }

    events.sort_by_key(|e| e.timestamp_secs);
    events.truncate(MAX_EVENTS);
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::sgp::{
        SgpFrame, SgpFrameDamageStats, SgpFrameEvent, SgpFrameParticipantStats,
    };
    use crate::score::events::types::{
        fmt_mmss, DELTA_CS_STALL, DELTA_PARTICIPATION_MISS, DELTA_VISION_GAP,
    };
    use std::collections::HashMap;

    fn ev(
        r#type: &str,
        ms: i64,
        pid: Option<i32>,
        killer: Option<i32>,
        victim: Option<i32>,
    ) -> SgpFrameEvent {
        SgpFrameEvent {
            r#type: Some(r#type.to_string()),
            timestamp: Some(ms),
            participant_id: pid,
            killer_id: killer,
            victim_id: victim,
            ..Default::default()
        }
    }

    fn frame(
        ms: i64,
        stats: HashMap<i32, SgpFrameParticipantStats>,
        events: Vec<SgpFrameEvent>,
    ) -> SgpFrame {
        SgpFrame {
            timestamp: Some(ms),
            participant_frames: stats,
            events,
        }
    }

    fn stats(cs: i32, gold: i32, dmg: Option<f64>) -> SgpFrameParticipantStats {
        SgpFrameParticipantStats {
            minions_killed: cs,
            total_gold: gold,
            damage_stats: dmg.map(|v| SgpFrameDamageStats {
                total_damage_done_to_champions: Some(v),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    fn detail(frames: Vec<SgpFrame>) -> SgpGameDetail {
        SgpGameDetail {
            frames,
            ..Default::default()
        }
    }

    const ME: i32 = 1;
    const MATE_A: i32 = 2;
    const MATE_B: i32 = 3;

    fn my_team() -> HashSet<i32> {
        HashSet::from([ME, MATE_A, MATE_B])
    }

    #[test]
    fn empty_frames_yield_no_events() {
        let d = detail(vec![]);
        assert!(compute_score_events(&d, ME, &my_team()).is_empty());
    }

    #[test]
    fn death_events_are_recorded_with_order() {
        let d = detail(vec![
            frame(0, HashMap::new(), vec![]),
            frame(
                1_200_000,
                HashMap::new(),
                vec![ev("CHAMPION_KILL", 1_200_000, Some(9), Some(9), Some(ME))],
            ),
            frame(
                2_400_000,
                HashMap::new(),
                vec![ev("CHAMPION_KILL", 2_400_000, Some(9), Some(9), Some(ME))],
            ),
        ]);
        let events = compute_score_events(&d, ME, &my_team());
        let deaths: Vec<_> = events
            .iter()
            .filter(|e| e.dimension == ScoreDimension::Kda)
            .collect();
        assert_eq!(deaths.len(), 2);
        assert_eq!(deaths[0].timestamp_secs, 1200);
        assert!(deaths[0].description.contains("第 1 次"));
        assert_eq!(deaths[1].timestamp_secs, 2400);
    }

    #[test]
    fn teamfight_without_me_is_participation_miss() {
        let events = vec![
            ev(
                "CHAMPION_KILL",
                600_000,
                Some(MATE_A),
                Some(MATE_A),
                Some(50),
            ),
            ev(
                "CHAMPION_KILL",
                615_000,
                Some(MATE_B),
                Some(MATE_B),
                Some(51),
            ),
            ev("CHAMPION_KILL", 630_000, Some(52), Some(52), Some(MATE_B)),
            ev("CHAMPION_KILL", 645_000, Some(53), Some(53), Some(MATE_A)),
        ];
        let d = detail(vec![frame(700_000, HashMap::new(), events)]);
        let evs = compute_score_events(&d, ME, &my_team());
        let miss: Vec<_> = evs
            .iter()
            .filter(|e| e.dimension == ScoreDimension::Participation)
            .collect();
        assert_eq!(miss.len(), 1, "本队参战而我缺席 → 1 条未参团证据");
        assert_eq!(miss[0].delta, DELTA_PARTICIPATION_MISS);
    }

    #[test]
    fn teamfight_where_i_die_counts_as_participation() {
        let events = vec![
            ev("CHAMPION_KILL", 600_000, Some(50), Some(50), Some(ME)),
            ev(
                "CHAMPION_KILL",
                615_000,
                Some(MATE_A),
                Some(MATE_A),
                Some(51),
            ),
            ev("CHAMPION_KILL", 630_000, Some(52), Some(52), Some(MATE_B)),
        ];
        let d = detail(vec![frame(700_000, HashMap::new(), events)]);
        let evs = compute_score_events(&d, ME, &my_team());
        assert!(
            !evs.iter()
                .any(|e| e.dimension == ScoreDimension::Participation),
            "我阵亡也算参团，不应产出未参团证据"
        );
    }

    #[test]
    fn cs_stall_detected_over_two_frames() {
        let mk = |t: i64, mine_cs: i32, mate_cs: i32| {
            frame(
                t,
                HashMap::from([
                    (ME, stats(mine_cs, 1000, None)),
                    (MATE_A, stats(mate_cs, 1000, None)),
                    (MATE_B, stats(mate_cs, 1000, None)),
                ]),
                vec![],
            )
        };
        let d = detail(vec![
            mk(60_000, 0, 0),
            mk(120_000, 10, 100),
            mk(180_000, 20, 200),
        ]);
        let evs = compute_score_events(&d, ME, &my_team());
        let stalls: Vec<_> = evs
            .iter()
            .filter(|e| e.dimension == ScoreDimension::Cs)
            .collect();
        assert_eq!(stalls.len(), 1);
        assert!(stalls[0].description.contains("补刀"));
    }

    #[test]
    fn stall_requires_two_consecutive_frames() {
        let mk = |t: i64, mine_cs: i32, mate_cs: i32| {
            frame(
                t,
                HashMap::from([
                    (ME, stats(mine_cs, 1000, None)),
                    (MATE_A, stats(mate_cs, 1000, None)),
                    (MATE_B, stats(mate_cs, 1000, None)),
                ]),
                vec![],
            )
        };
        let d = detail(vec![
            mk(60_000, 0, 0),
            mk(120_000, 10, 50),
            mk(180_000, 60, 100),
        ]);
        let evs = compute_score_events(&d, ME, &my_team());
        assert!(!evs.iter().any(|e| e.dimension == ScoreDimension::Cs));
    }

    #[test]
    fn vision_gap_over_five_minutes() {
        let events = vec![
            ev("WARD_PLACED", 300_000, Some(ME), None, None),
            ev("WARD_PLACED", 700_000, Some(ME), None, None),
        ];
        let d = detail(vec![frame(800_000, HashMap::new(), events)]);
        let evs = compute_score_events(&d, ME, &my_team());
        let gaps: Vec<_> = evs
            .iter()
            .filter(|e| e.dimension == ScoreDimension::Vision)
            .collect();
        assert_eq!(gaps.len(), 1);
        assert!(gaps[0].description.contains("6 分钟"));
    }

    #[test]
    fn missing_participant_frames_are_skipped_not_fabricated() {
        let mk = |t: i64, mate_cs: i32| {
            frame(
                t,
                HashMap::from([
                    (MATE_A, stats(mate_cs, 1000, None)),
                    (MATE_B, stats(mate_cs, 1000, None)),
                ]),
                vec![],
            )
        };
        let d = detail(vec![mk(60_000, 0), mk(120_000, 50)]);
        let evs = compute_score_events(&d, ME, &my_team());
        assert!(!evs.iter().any(|e| e.dimension == ScoreDimension::Cs));
    }

    #[test]
    fn damage_dip_requires_sgp_damage_stats() {
        let mk = |t: i64, mine: i32| {
            frame(
                t,
                HashMap::from([
                    (ME, stats(mine, 1000, None)),
                    (MATE_A, stats(mine + 100, 1000, Some(0.0))),
                    (MATE_B, stats(mine + 100, 1000, Some(0.0))),
                ]),
                vec![],
            )
        };
        let d = detail(vec![mk(60_000, 0), mk(120_000, 5), mk(180_000, 10)]);
        let evs = compute_score_events(&d, ME, &my_team());
        assert!(!evs.iter().any(|e| e.dimension == ScoreDimension::Damage));
    }

    #[test]
    fn events_are_sorted_ascending_and_capped() {
        let d = detail(vec![frame(
            0,
            HashMap::new(),
            vec![
                ev("CHAMPION_KILL", 900_000, Some(9), Some(9), Some(ME)),
                ev("CHAMPION_KILL", 300_000, Some(9), Some(9), Some(ME)),
                ev("CHAMPION_KILL", 600_000, Some(9), Some(9), Some(ME)),
            ],
        )]);
        let evs = compute_score_events(&d, ME, &my_team());
        assert!(evs
            .windows(2)
            .all(|w| w[0].timestamp_secs <= w[1].timestamp_secs));
        assert!(evs.len() <= MAX_EVENTS);
    }

    #[test]
    fn fmt_mmss_pads_zeroes() {
        assert_eq!(fmt_mmss(5), "00:05");
        assert_eq!(fmt_mmss(600), "10:00");
        assert_eq!(fmt_mmss(3600), "60:00");
    }
}
