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
        position: Some(SgpFramePosition { x: 5000, y: 5000 }),
        ..Default::default()
    }
}

fn camp_kill(monster: &str, killer: i32) -> SgpFrameEvent {
    SgpFrameEvent {
        r#type: Some("MONSTER_KILL".into()),
        monster_type: Some(monster.to_string()),
        participant_id: Some(killer),
        position: Some(SgpFramePosition { x: 4000, y: 6000 }),
        ..Default::default()
    }
}

/// 造一帧：事件 + 一条参与者坐标。
///
/// 事件本身也各带坐标（champ_kill / camp_kill 内部已填），所以
/// 「有可信坐标」的前置校验对绝大多数用例天然成立；只有专门测降级的
/// 用例才会用 `frame_without_any_position` 把两侧都清空。
fn frame(ts_ms: i64, events: Vec<SgpFrameEvent>) -> SgpFrame {
    SgpFrame {
        timestamp: Some(ts_ms),
        events,
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
    analyze_game_timeline(1000, map_id, &[input(1, 100)], &detail(frames))
}

/// 一个玩家输入（SGP pid + 队伍）。
fn input(participant_id: i32, team_id: i32) -> PlayerInput {
    PlayerInput {
        participant_id,
        team_id,
    }
}

/// 造一帧，含指定各参与者的位置（其余为默认）。
fn frame_with_positions(
    ts_ms: i64,
    events: Vec<SgpFrameEvent>,
    positions: &[(i32, i32, i32, i32)],
) -> SgpFrame {
    let mut f = frame(ts_ms, events);
    for (pid, x, y, _) in positions {
        f.participant_frames.insert(
            *pid,
            SgpFrameParticipantStats {
                position: Some(SgpFramePosition { x: *x, y: *y }),
                ..Default::default()
            },
        );
    }
    f
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
    let t = analyze_game_timeline(1000, Some(11), &[input(1, 100)], &empty);
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
    for e in f.events.iter_mut() {
        e.position = None;
    }
    let t = analyze(vec![f], Some(11));
    assert_eq!(t.degraded, None, "仅参与者坐标也应通过前置校验");
    assert_eq!(t.players.len(), 1);
}

#[test]
fn positions_from_events_alone_are_enough() {
    // 事件有坐标而 participant_frames 为空 => 也应正常分析
    let mut f = frame(60_000, vec![champ_kill(1, vec![2])]);
    f.participant_frames.clear();
    let t = analyze(vec![f], Some(11));
    assert_eq!(t.degraded, None, "仅事件坐标也应通过前置校验");
}

/// 全帧无任何可信坐标（事件与参与者两侧都清空）。
/// 全帧无任何可信坐标（事件与参与者两侧都清空）。
///
/// 单独抽出是因为这类夹具很容易漏掉一侧——漏了就会让「测降级」的用例
/// 意外通过前置校验，退化成测别的分支。
fn frame_without_any_position(ts_ms: i64, events: Vec<SgpFrameEvent>) -> SgpFrame {
    let mut f = frame(ts_ms, events);
    for stats in f.participant_frames.values_mut() {
        stats.position = None;
    }
    for e in f.events.iter_mut() {
        e.position = None;
    }
    f
}

#[test]
fn absurd_kill_count_trips_dirty_frames() {
    // 注意：击杀事件**分散到多帧**，不能全塞进一帧。
    // 前置校验的坐标检查只看是否有可信坐标，与击杀数无关；
    // 真正触发熔断的是 count_champion_kills 的总量，与帧数无关。
    let events_per_frame = MAX_PLAUSIBLE_KILL_EVENTS + 5;
    let frames: Vec<SgpFrame> = (0..2)
        .map(|i| {
            frame(
                60_000 * (i as i64 + 1),
                (0..events_per_frame)
                    .map(|j| champ_kill(1, vec![2 + (j % 5) as i32]))
                    .collect(),
            )
        })
        .collect();
    let t = analyze(frames, Some(11));
    assert_eq!(t.degraded.as_deref(), Some(Degraded::DirtyFrames.message()));
    assert!(t.players.is_empty());
}

#[test]
fn kill_count_just_under_threshold_is_accepted() {
    // 边界：恰好等于阈值不算脏数据
    let frames: Vec<SgpFrame> = (0..2)
        .map(|i| {
            frame(
                60_000 * (i as i64 + 1),
                (0..MAX_PLAUSIBLE_KILL_EVENTS / 2)
                    .map(|j| champ_kill(1, vec![2 + (j % 5) as i32]))
                    .collect(),
            )
        })
        .collect();
    let t = analyze(frames, Some(11));
    assert_eq!(t.degraded, None, "阈值内不应熔断");
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
    // 不同版本/端点的 SGP 事件类型写法不一致（下划线大写、驼峰、无分隔符…）
    for kind in [
        "CHAMPION_KILL",
        "championKill",
        "champion_kill",
        "ChampionKill",
        "CHAMPIONKILL",
    ] {
        let t = analyze(
            vec![frame(
                300_000,
                vec![SgpFrameEvent {
                    r#type: Some(kind.into()),
                    victim_id: Some(1),
                    position: Some(SgpFramePosition { x: 5000, y: 5000 }),
                    ..Default::default()
                }],
            )],
            Some(11),
        );
        assert_eq!(t.players[0].early_deaths, 1, "kind={kind} 未被识别");
    }
}

#[test]
fn event_type_matching_is_case_insensitive() {
    // 逐字符混合大小写：单独覆盖，因为上面的循环只列了「统一大写/统一小写/驼峰」
    // 三种规律性写法，混写（如 PaRtIcIpAnT_KiLl）容易被漏掉。
    let t = analyze(
        vec![frame(
            300_000,
            vec![SgpFrameEvent {
                r#type: Some("ChAmPiOn_KiLl".into()),
                victim_id: Some(1),
                position: Some(SgpFramePosition { x: 5000, y: 5000 }),
                ..Default::default()
            }],
        )],
        Some(11),
    );
    assert_eq!(t.players[0].early_deaths, 1, "逐字符混合大小写未被识别");
}

/// 反向确认：`participant_kill` 不是 SGP 的事件类型，不应被当成击杀。
///
/// 这条与上面那条成对——上一条曾因把 `CHAMPION_KILL` 误写成
/// `PARTICIPANT_KILL`（手滑打错一个字母）而误判为实现有 bug。
/// 显式断言「未知类型不误判」，比只断言「已知类型能识别」更能防这类事故。
#[test]
fn unknown_event_type_is_not_mistaken_for_a_known_one() {
    let t = analyze(
        vec![frame(
            300_000,
            vec![SgpFrameEvent {
                r#type: Some("PARTICIPANT_KILL".into()),
                victim_id: Some(1),
                position: Some(SgpFramePosition { x: 5000, y: 5000 }),
                ..Default::default()
            }],
        )],
        Some(11),
    );
    assert_eq!(t.players[0].early_deaths, 0, "未知事件类型不应被识别为击杀");
}

#[test]
fn camp_kill_type_variants_are_recognized() {
    for kind in ["MONSTER_KILL", "monsterKill", "CAMP_KILL", "campKill"] {
        let t = analyze(
            vec![frame(
                300_000,
                vec![SgpFrameEvent {
                    r#type: Some(kind.into()),
                    monster_type: Some("BlueSentinel".into()),
                    participant_id: Some(1),
                    position: Some(SgpFramePosition { x: 4000, y: 6000 }),
                    ..Default::default()
                }],
            )],
            Some(11),
        );
        assert_eq!(
            t.players[0].jungle_path,
            vec![Camp::BlueBuff],
            "kind={kind} 未被识别"
        );
    }
}

/// 常量表里的事件类型键必须已是归一化形式（无分隔符）。
///
/// 这条断言把本模块踩过的坑钉死：键若写成 `champion_kill`，而收到的
/// `CHAMPION_KILL` 归一化成 `championkill`，子串匹配会**静默失败**——
/// 所有击杀都识别不出，且不报任何错。
#[test]
fn event_type_constant_keys_are_already_normalized() {
    for key in CHAMPION_KILL_EVENT_TYPES
        .iter()
        .chain(CAMP_KILL_EVENT_TYPES)
    {
        let normalized = normalize_event_type(Some(key));
        assert_eq!(
            key, &normalized,
            "常量表键 {key:?} 未归一化，会与归一化后的实际值匹配失败（静默漏识别）"
        );
    }
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

/* ---------------- 敌方打野识别与「敌方打野在场」死亡 ---------------- */

/// 造一局：1 号是队伍 100 的打野（清野最多），2 号是队伍 200 的打野，
/// 3 号是队伍 100 的受害玩家。返回 (frames, inputs)。
fn jungle_vs_jungle_setup(
    victim_at: (i32, i32),
    enemy_jungler_at: (i32, i32),
    victim_team: i32,
) -> (Vec<SgpFrame>, Vec<PlayerInput>) {
    let frames = vec![
        // 各自清野，让 1/2 被推断为打野
        frame_with_positions(
            60_000,
            vec![camp_kill("BlueSentinel", 1), camp_kill("RIFT_HERALD", 2)],
            &[
                (1, 3000, 5000, 0),
                (2, 12000, 10500, 0),
                (3, victim_at.0, victim_at.1, 0),
            ],
        ),
        // 一次前期死亡，发生在指定坐标
        frame_with_positions(
            300_000,
            vec![champ_kill(3, vec![2])],
            &[
                (1, 3000, 5000, 0),
                (2, enemy_jungler_at.0, enemy_jungler_at.1, 0),
                (3, victim_at.0, victim_at.1, 0),
            ],
        ),
    ];
    let inputs = vec![input(1, 100), input(2, 200), input(3, victim_team)];
    (frames, inputs)
}

#[test]
fn death_near_enemy_jungler_is_counted() {
    // 敌方打野就在附近 => 该次死亡计入
    let (frames, inputs) = jungle_vs_jungle_setup((3000, 5000), (3500, 5200), 100);
    let t = analyze_game_timeline(1000, Some(11), &inputs, &detail(frames));
    assert_eq!(t.degraded, None);
    let victim = t.players.iter().find(|p| p.participant_id == 3).unwrap();
    assert_eq!(victim.early_deaths, 1);
    assert_eq!(
        victim.early_deaths_with_enemy_jungler, 1,
        "敌方打野在附近时应计为「因敌方打野在场」"
    );
}

#[test]
fn death_far_from_enemy_jungler_is_not_counted() {
    // 敌方打野远在另一头 => 只是一次普通死亡
    let (frames, inputs) = jungle_vs_jungle_setup((3000, 5000), (12000, 10500), 100);
    let t = analyze_game_timeline(1000, Some(11), &inputs, &detail(frames));
    let victim = t.players.iter().find(|p| p.participant_id == 3).unwrap();
    assert_eq!(victim.early_deaths, 1);
    assert_eq!(
        victim.early_deaths_with_enemy_jungler, 0,
        "敌方打野不在附近时不应计入"
    );
}

#[test]
fn own_jungler_presence_does_not_count_as_enemy() {
    // 附近的是**我方**打野（同队）=> 不应计入「敌方打野在场」
    let (frames, inputs) = jungle_vs_jungle_setup((3000, 5000), (3100, 5100), 200);
    // 让 victim 与 1 号同队（100），而附近的 2 号也在 100 队
    let (frames, _) = jungle_vs_jungle_setup((3000, 5000), (3100, 5100), 100);
    let t = analyze_game_timeline(
        1000,
        Some(11),
        &[input(1, 100), input(2, 100), input(3, 100)],
        &detail(frames),
    );
    let victim = t.players.iter().find(|p| p.participant_id == 3).unwrap();
    // 2 号虽在附近但同队 => 只按敌方打野算
    assert_eq!(victim.early_deaths, 1);
    assert_eq!(victim.early_deaths_with_enemy_jungler, 0);
}

#[test]
fn jungler_role_is_inferred_from_camp_kills() {
    let (frames, inputs) = jungle_vs_jungle_setup((3000, 5000), (12000, 10500), 100);
    let t = analyze_game_timeline(1000, Some(11), &inputs, &detail(frames));
    let by_pid = |pid: i32| t.players.iter().find(|p| p.participant_id == pid).unwrap();
    assert!(
        by_pid(1).inferred_jungle_role,
        "清野最多的 1 号应被判为打野"
    );
    assert!(
        by_pid(2).inferred_jungle_role,
        "清野最多的 2 号应被判为打野"
    );
    assert!(
        !by_pid(3).inferred_jungle_role,
        "没清野的 3 号不应被判为打野"
    );
}

#[test]
fn team_without_any_camp_kills_yields_no_jungler() {
    // 只有一队清野 => 该队判出打野；另一队判不出
    let frames = vec![frame_with_positions(
        60_000,
        vec![camp_kill("BlueSentinel", 1)],
        &[(1, 3000, 5000, 0), (2, 12000, 10500, 0), (3, 3000, 5000, 0)],
    )];
    let inputs = vec![input(1, 100), input(2, 200), input(3, 200)];
    let t = analyze_game_timeline(1000, Some(11), &inputs, &detail(frames));
    let by_pid = |pid: i32| t.players.iter().find(|p| p.participant_id == pid).unwrap();
    assert!(by_pid(1).inferred_jungle_role);
    assert!(
        !by_pid(2).inferred_jungle_role && !by_pid(3).inferred_jungle_role,
        "未清野的队伍不应被随便挑一个人当打野"
    );
}

#[test]
fn jungler_paths_are_per_player_not_shared_within_team() {
    // 同队两人都有清野记录时，路径必须各自独立（早期版本会给全队同一条路径）
    let frames = vec![
        frame_with_positions(
            60_000,
            vec![camp_kill("BlueSentinel", 1)],
            &[(1, 3000, 5000, 0), (4, 3000, 5000, 0)],
        ),
        frame_with_positions(
            180_000,
            vec![camp_kill("WOLF", 4)],
            &[(1, 3000, 5000, 0), (4, 3000, 5000, 0)],
        ),
    ];
    let inputs = vec![input(1, 100), input(4, 100)];
    let t = analyze_game_timeline(1000, Some(11), &inputs, &detail(frames));
    let by_pid = |pid: i32| t.players.iter().find(|p| p.participant_id == pid).unwrap();
    assert_eq!(by_pid(1).jungle_path, vec![Camp::BlueBuff]);
    assert_eq!(
        by_pid(4).jungle_path,
        vec![Camp::Wolves],
        "4 号的路径不应包含 1 号打的蓝buff"
    );
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
