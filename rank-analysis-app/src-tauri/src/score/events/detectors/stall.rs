use std::collections::{HashMap, HashSet};

use crate::lcu::api::sgp::{SgpFrame, SgpGameDetail};
use crate::score::events::types::{
    fmt_mmss, ms_to_secs, ScoreDimension, ScoreEvent, DELTA_CS_STALL, DELTA_DAMAGE_DIP,
    DELTA_GOLD_STALL, STALL_MIN_FRAMES, STALL_RATIO,
};

/// 帧级增量序列（相邻帧差值；负增量/缺帧视为脏数据跳过）。
pub fn frame_increments(
    detail: &SgpGameDetail,
    pid: i32,
    field: impl Fn(&crate::lcu::api::sgp::SgpFrameParticipantStats) -> i32,
) -> Vec<(i64, i64, i32)> {
    let mut frames: Vec<&SgpFrame> = detail
        .frames
        .iter()
        .filter(|f| f.timestamp.is_some())
        .collect();
    frames.sort_by_key(|f| f.timestamp.unwrap());

    let mut out = Vec::new();
    let mut prev: Option<(i64, i32)> = None;
    for f in frames {
        let Some(stats) = f.participant_frames.get(&pid) else {
            continue;
        };
        let cur = field(stats);
        if let Some((prev_t, prev_v)) = prev {
            let inc = cur - prev_v;
            if inc >= 0 {
                out.push((prev_t, ms_to_secs(f.timestamp.unwrap()), inc));
            }
        }
        prev = Some((ms_to_secs(f.timestamp.unwrap()), cur));
    }
    out
}

/// 帧级"队均增量"：同队成员各自帧增量的均值（按帧对齐）。
pub fn team_avg_increment(
    detail: &SgpGameDetail,
    team_pids: &HashSet<i32>,
    field: impl Fn(&crate::lcu::api::sgp::SgpFrameParticipantStats) -> i32,
) -> HashMap<i64, f64> {
    let mut acc: HashMap<i64, (f64, usize)> = HashMap::new();
    for pid in team_pids {
        for (t, _, inc) in frame_increments(detail, *pid, &field) {
            let e = acc.entry(t).or_insert((0.0, 0));
            e.0 += inc as f64;
            e.1 += 1;
        }
    }
    acc.into_iter()
        .filter(|(_, (_, n))| *n > 0)
        .map(|(t, (sum, n))| (t, sum / n as f64))
        .collect()
}

/// 帧级停滞：本人增量长期低于队均（补刀/经济）。
pub fn detect_frame_stall_events(
    detail: &SgpGameDetail,
    pid: i32,
    team_pids: &HashSet<i32>,
    field: impl Fn(&crate::lcu::api::sgp::SgpFrameParticipantStats) -> i32,
    dimension: ScoreDimension,
    label: &str,
    delta: f64,
) -> Vec<ScoreEvent> {
    let mine = frame_increments(detail, pid, &field);
    let team = team_avg_increment(detail, team_pids, &field);
    if mine.is_empty() || team.is_empty() {
        return Vec::new();
    }

    let mut out = Vec::new();
    let mut run: Option<(i64, i64)> = None;
    for (t, t_end, inc) in mine {
        let avg = team.get(&t).copied().unwrap_or(0.0);
        if avg > 0.0 && (inc as f64) < avg * STALL_RATIO {
            run = Some(match run {
                Some((start, _)) => (start, t_end),
                None => (t, t_end),
            });
        } else if let Some((start, end)) = run.take() {
            if end - start >= (STALL_MIN_FRAMES as i64) * 60 {
                out.push(ScoreEvent {
                    dimension,
                    timestamp_secs: start,
                    description: format!(
                        "{}–{} {label}低于队均 {}%",
                        fmt_mmss(start),
                        fmt_mmss(end),
                        (100.0 - STALL_RATIO * 100.0) as i64
                    ),
                    delta,
                });
            }
        }
    }
    if let Some((start, end)) = run.take() {
        if end - start >= (STALL_MIN_FRAMES as i64) * 60 {
            out.push(ScoreEvent {
                dimension,
                timestamp_secs: start,
                description: format!(
                    "{}–{} {label}低于队均 {}%",
                    fmt_mmss(start),
                    fmt_mmss(end),
                    (100.0 - STALL_RATIO * 100.0) as i64
                ),
                delta,
            });
        }
    }
    out
}

/// 补刀停滞检测。
pub fn detect_cs_stall_events(
    detail: &SgpGameDetail,
    pid: i32,
    team_pids: &HashSet<i32>,
) -> Vec<ScoreEvent> {
    detect_frame_stall_events(
        detail,
        pid,
        team_pids,
        |s| s.minions_killed,
        ScoreDimension::Cs,
        "补刀",
        DELTA_CS_STALL,
    )
}

/// 经济停滞检测。
pub fn detect_gold_stall_events(
    detail: &SgpGameDetail,
    pid: i32,
    team_pids: &HashSet<i32>,
) -> Vec<ScoreEvent> {
    detect_frame_stall_events(
        detail,
        pid,
        team_pids,
        |s| s.total_gold,
        ScoreDimension::Gold,
        "经济增速",
        DELTA_GOLD_STALL,
    )
}

/// 伤害维：输出低谷（帧伤害增量低于队均，持续多帧；需 SGP 独有 damage_stats）。
pub fn detect_damage_dip_events(
    detail: &SgpGameDetail,
    pid: i32,
    team_pids: &HashSet<i32>,
) -> Vec<ScoreEvent> {
    let dmg_of = |s: &crate::lcu::api::sgp::SgpFrameParticipantStats| -> i32 {
        s.damage_stats
            .as_ref()
            .and_then(|d| d.total_damage_done_to_champions)
            .map(|v| v as i32)
            .unwrap_or(0)
    };
    let mine = frame_increments(detail, pid, dmg_of);
    if mine.is_empty() {
        return Vec::new();
    }
    let team = team_avg_increment(detail, team_pids, dmg_of);
    let mut out = Vec::new();
    let mut run: Option<(i64, i64)> = None;
    for (t, t_end, inc) in mine {
        let avg = team.get(&t).copied().unwrap_or(0.0);
        if avg > 0.0 && (inc as f64) < avg * STALL_RATIO {
            run = Some(match run {
                Some((start, _)) => (start, t_end),
                None => (t, t_end),
            });
        } else if let Some((start, end)) = run.take() {
            if end - start >= (STALL_MIN_FRAMES as i64) * 60 {
                out.push(ScoreEvent {
                    dimension: ScoreDimension::Damage,
                    timestamp_secs: start,
                    description: format!(
                        "{}–{} 输出低谷（低于队均 {}%）",
                        fmt_mmss(start),
                        fmt_mmss(end),
                        (100.0 - STALL_RATIO * 100.0) as i64
                    ),
                    delta: DELTA_DAMAGE_DIP,
                });
            }
        }
    }
    out
}
