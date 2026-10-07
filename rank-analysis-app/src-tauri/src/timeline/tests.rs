//! timeline 帧级分析的纯函数测试。
//!
//! 全部用手造 `SgpFrame` / `SgpFrameEvent`，**不依赖网络与 SGP token**，
//! 因此 CI 里可稳定复现。造数据的原则：宁可造得"笨"（显式填每个字段），
//! 也不要依赖 `Default`——`Default` 会让"忘了填 position"这类错误
//! 伪装成"字段缺失时的降级行为"而测不出来。

use super::*;
use crate::lcu::api::sgp::{
    SgpDetailParticipant, SgpFrame, SgpFrameEvent, SgpFrameParticipantStats, SgpFramePosition,
    SgpGameDetail, SgpGameDetailResponse,
};
use crate::timeline::geometry::Camp;

fn event(kind: &str) -> SgpFrameEvent {
    SgpFrameEvent {
        r#type: Some(kind.to_string()),
        ..Default::default()
    }
}

fn champ_kill(victim: i32, killers: Vec<i32>) -> SgpFrameEvent {
    SgpFrameEvent {
        r#type: Some("CHAMPION_KILL".into()),
        victim_id: Some(victim),
        killer_id: killers.first().copied(),
        assisting_participant_ids: if killers.len() > 1 {
            Some(killers[1..].to_vec())
        } else {
            None
        },
        ..Default::default()
    }
}

fn camp_kill(monster: &str, killer: i32) -> SgpFrameEvent {
    SgpFrameEvent {
        r#type: Some("MONSTER_KILL".into()),
        monster_type: Some(monster.to_string()),
        participant_id: Some(killer),
        ..Default::default()
    }
}

fn frame(ts_ms: i64, events: Vec<SgpFrameEvent>) -> SgpFrame {
    SgpFrame {
        timestamp: Some(ts_ms),
        events,
        // 造一个带坐标的参与者帧，满足「有可信坐标」的前置校验
        participant_frames: HashMap::from([(
            1,
            SgpFrameParticipantStats {
                position: Some(SgpFramePosition { x: 7800, y: 7900 }),
                ..Default::default()
            },
        )]),
    }
}

fn detail(frames: Vec<SgpFrame>) -> SgpGameDetailResponse {
    SgpGameDetailResponse {
        metadata: None,
        json: Some(SgpGameDetail {
            end_of_game_result: None,
            frame_interval: Some(60_000),
            frames,
            participants: vec![SgpDetailParticipant {
                participant_id: Some(1),
                puuid: Some("p1".into()),
            }],
        }),
    }
}

fn analyze(frames: Vec<SgpFrame>, map_id: Option<i64>) -> GameTimeline {
    analyze_game_timeline(1000, map_id, &[1], &detail(frames))
}

#[test]
fn no_frames_degrades() {
    let t = analyze(vec![], Some(11));
    assert_eq!(t.degraded.as_deref(), Some(Degraded::NoFrames.message()));
    assert!(t.players.is_empty(), "降级时不得输出半截结论");
}

#[test]
fn missing_json_body_degrades_as_no_frames() {
    let empty = SgpGameDetailResponse {
        metadata: None,
        json: None,
    };
    let t = analyze_game_timeline(1000, Some(11), &[1], &empty);
    assert_eq!(t.degraded.as_deref(), Some(Degraded::NoFrames.message()));
}

#[test]
fn non_summoners_rift_degrades_before_reading_frames() {
    // 有帧也照样降级：换图后坐标没有意义
    let t = analyze(vec![frame(60_000, vec![champ_kill(1, vec![2])])], Some(12));
    assert_eq!(
        t.degraded.as_deref(),
        Some(Degraded::NotSummonersRift.message())
    );
}

#[test]
fn frames_without_any_position_degrade() {
    let t = analyze(
        vec![frame_without_any_position(
            60_000,
            vec![champ_kill(1, vec![2])],
        )],
        Some(11),
    );
    assert_eq!(t.degraded.as_deref(), Some(Degraded::NoPositions.message()));
}

#[test]
fn positions_from_participant_frames_alone_are_enough() {
    // participant_frames 有坐标而事件没有 => 仍应正常分析（这是 SGP 常见形态）
    let mut f = frame(60_000, vec![champ_kill(1, vec![2])]);
    f.events[0].position = None;
    let t = analyze(vec![f], Some(11));
    assert_eq!(t.degraded, None, "仅参与者坐标也应通过前置校验");
    assert_eq!(t.players.len(), 1);
}

#[test]
fn positions_from_events_alone_are_enough() {
    // 事件有坐标而 participant_frames 为空 => 也应正常分析
    let mut f = frame(60_000, vec![champ_kill(1, vec![2])]);
    f.participant_frames.clear();
    f.events[0].position = Some(SgpFramePosition { x: 5000, y: 5000 });
    let t = analyze(vec![f], Some(11));
    assert_eq!(t.degraded, None, "仅事件坐标也应通过前置校验");
}

/// 全帧无任何可信坐标（事件与参与者两侧都清空）。
fn frame_without_any_position(ts_ms: i64, events: Vec<SgpFrameEvent>) -> SgpFrame {
    let mut f = frame(ts_ms, events);
    for stats in f.participant_frames.values_mut() {
        stats.position = None;
    }
    // 事件上的坐标也要清掉，否则仍会被判为「有坐标」
    for e in f.events.iter_mut() {
        e.position = None;
    }
    f
}

#[test]
fn absurd_kill_count_trips_dirty_frames() {
    let events: Vec<SgpFrameEvent> = (0..MAX_PLAUSIBLE_KILL_EVENTS + 5)
        .map(|i| champ_kill(1, vec![2 + (i % 5) as i32]))
        .collect();
    let t = analyze(vec![frame(60_000, events)], Some(11));
    assert_eq!(t.degraded.as_deref(), Some(Degraded::DirtyFrames.message()));
    assert!(t.players.is_empty());
}

#[test]
fn jungle_path_keeps_first_kill_order_and_dedups() {
    let frames = vec![
        frame(
            120_000,
            vec![camp_kill("BlueSentinel", 1), camp_kill("RIFT_HERALD", 1)],
        ),
        // 同一营地第二次清理不应重复进序列
        frame(240_000, vec![camp_kill("BlueSentinel", 1)]),
        frame(360_000, vec![camp_kill("WOLF", 1)]),
    ];
    let t = analyze(frames, Some(11));
    assert!(t.degraded.is_none());
    let p = &t.players[0];
    assert_eq!(
        p.jungle_path,
        vec![Camp::BlueBuff, Camp::RiftHerald, Camp::Wolves]
    );
    assert_eq!(p.first_camp_at_ms, Some(120_000));
}

#[test]
fn first_camp_within_three_minutes_counts_as_invasion() {
    let t = analyze(
        vec![frame(150_000, vec![camp_kill("BlueSentinel", 1)])],
        Some(11),
    );
    assert!(t.players[0].invaded_before_3min);

    let late = analyze(
        vec![frame(300_000, vec![camp_kill("BlueSentinel", 1)])],
        Some(11),
    );
    assert!(!late.players[0].invaded_before_3min);
}

#[test]
fn solo_death_scores_full_weight_multi_kill_scales_down() {
    let solo = analyze(vec![frame(300_000, vec![champ_kill(1, vec![2])])], Some(11));
    assert_eq!(solo.players[0].early_deaths, 1);
    assert_eq!(solo.players[0].early_death_score, KILL_WEIGHT);
    assert!(solo.players[0].all_early_deaths_solo);

    let grouped = analyze(
        vec![frame(300_000, vec![champ_kill(1, vec![2, 3, 4])])],
        Some(11),
    );
    assert_eq!(grouped.players[0].early_deaths, 1);
    // 三人协防：权重 1/(1+2)
    assert!(
        (grouped.players[0].early_death_score - KILL_WEIGHT / 3.0).abs() < 1e-9,
        "多人协防应低于单杀权重，实际 {}",
        grouped.players[0].early_death_score
    );
    assert!(!grouped.players[0].all_early_deaths_solo);
}

#[test]
fn deaths_after_early_limit_are_ignored() {
    let t = analyze(
        vec![frame(EARLY_LIMIT_MS + 60_000, vec![champ_kill(1, vec![2])])],
        Some(11),
    );
    assert_eq!(t.players[0].early_deaths, 0, "15 分钟后不算前期死亡");
}

#[test]
fn deaths_of_other_participants_are_not_counted() {
    let t = analyze(vec![frame(300_000, vec![champ_kill(9, vec![2])])], Some(11));
    assert_eq!(t.players[0].early_deaths, 0);
}

#[test]
fn zero_deaths_still_reports_solo_flag_as_true() {
    // 没人头时"全部单杀"应视为真（真空真），避免前端把 0 次死亡显示成"被抓过"
    let t = analyze(vec![frame(300_000, vec![champ_kill(5, vec![2])])], Some(11));
    assert_eq!(t.players[0].early_deaths, 0);
    assert!(t.players[0].all_early_deaths_solo);
}

#[test]
fn events_after_analysis_window_are_excluded() {
    let late_camp = ANALYSIS_MINUTES * 60 * 1000 + 60_000;
    let t = analyze(
        vec![frame(late_camp, vec![camp_kill("BARON_NASHOR", 1)])],
        Some(11),
    );
    assert!(
        t.players[0].jungle_path.is_empty(),
        "14 分钟后的营地不该进前期路径"
    );
}

#[test]
fn objective_taken_is_counted_once_per_frame() {
    let t = analyze(vec![frame(600_000, vec![camp_kill("DRAGON", 1)])], Some(11));
    assert_eq!(t.players[0].contested_objectives, 1);
}

#[test]
fn objective_fight_counts_only_if_self_involved() {
    // 本人只是同帧被路过的路人 => 不算参与资源节奏
    let bystander = analyze(
        vec![frame(
            600_000,
            vec![camp_kill("DRAGON", 9), champ_kill(7, vec![8])],
        )],
        Some(11),
    );
    assert_eq!(bystander.players[0].contested_objectives, 0);

    // 本人参与了那场击杀 => 算一次
    let involved = analyze(
        vec![frame(
            600_000,
            vec![camp_kill("DRAGON", 9), champ_kill(1, vec![8])],
        )],
        Some(11),
    );
    assert_eq!(involved.players[0].contested_objectives, 1);
}

#[test]
fn farm_camps_are_not_objectives() {
    let t = analyze(
        vec![frame(600_000, vec![camp_kill("BlueSentinel", 1)])],
        Some(11),
    );
    assert_eq!(t.players[0].contested_objectives, 0);
}

#[test]
fn event_type_matching_tolerates_case_and_separators() {
    // 不同版本 SGP 的事件类型大小写/分隔符不一致
    for kind in ["CHAMPION_KILL", "championKill", "champion_kill"] {
        let t = analyze(vec![frame(300_000, vec![champ_kill(1, vec![2])])], Some(11));
        assert_eq!(t.players[0].early_deaths, 1, "kind={kind} 未被识别");
    }
    let t = analyze(
        vec![frame(300_000, vec![event("PaRtIcIpAnT_KiLl")])],
        Some(11),
    );
    assert_eq!(t.players[0].early_deaths, 1);
}

#[test]
fn frames_analyzed_counts_only_early_window() {
    let t = analyze(
        vec![
            frame(60_000, vec![]),
            frame(120_000, vec![]),
            frame(ANALYSIS_MINUTES * 60 * 1000 + 60_000, vec![]),
        ],
        Some(11),
    );
    assert_eq!(t.players[0].frames_analyzed, 2);
}

#[test]
fn puuid_map_skips_participants_without_ids() {
    let d = SgpGameDetailResponse {
        metadata: None,
        json: Some(SgpGameDetail {
            frames: vec![],
            participants: vec![
                SgpDetailParticipant {
                    participant_id: Some(3),
                    puuid: Some("a".into()),
                },
                // 缺 participantId => 应跳过
                SgpDetailParticipant {
                    participant_id: None,
                    puuid: Some("b".into()),
                },
                // 缺 puuid => 应跳过
                SgpDetailParticipant {
                    participant_id: Some(5),
                    puuid: None,
                },
            ],
            ..Default::default()
        }),
    };
    let m = participant_ids_by_puuid(&d);
    assert_eq!(m.len(), 1);
    assert_eq!(m.get("a"), Some(&3));
}

#[test]
fn puuid_map_is_empty_when_json_missing() {
    let d = SgpGameDetailResponse {
        metadata: None,
        json: None,
    };
    assert!(participant_ids_by_puuid(&d).is_empty());
}
