use std::collections::HashSet;

use crate::lcu::api::sgp::{SgpFrame, SgpFrameEvent};
use crate::score::events::types::{
    event_involves, event_involves_any, fmt_mmss, is_champion_kill, ms_to_secs, ScoreDimension,
    ScoreEvent, DELTA_PARTICIPATION_MISS, TEAMFIGHT_MIN_DEATHS, TEAMFIGHT_WINDOW_SECS,
};

/// 单次团战聚类（45s 窗口、≥3 死亡即一团，与前端 `teamfightClusters` 同语义）。
pub struct TeamfightCluster<'a> {
    /// 窗口内最后一死的秒（用于时间轴定位）。
    pub start_secs: i64,
    pub end_secs: i64,
    /// 窗口内全部死亡事件（含双方）。
    pub deaths: Vec<&'a SgpFrameEvent>,
}

/// 把帧事件流聚合成团战（45s 窗口贪婪聚类，≥3 死才算团）。
pub fn cluster_teamfights(frames: &[SgpFrame]) -> Vec<TeamfightCluster<'_>> {
    let mut deaths: Vec<(i64, &SgpFrameEvent)> = frames
        .iter()
        .flat_map(|f| f.events.iter())
        .filter(|e| is_champion_kill(e))
        .filter_map(|e| e.timestamp.map(|ms| (ms_to_secs(ms), e)))
        .collect();
    deaths.sort_by_key(|(t, _)| *t);

    let mut clusters: Vec<TeamfightCluster<'_>> = Vec::new();
    for (t, e) in deaths {
        let need_new = clusters
            .last()
            .is_none_or(|c: &TeamfightCluster<'_>| t - c.end_secs > TEAMFIGHT_WINDOW_SECS);
        if need_new {
            clusters.push(TeamfightCluster {
                start_secs: t,
                end_secs: t,
                deaths: Vec::new(),
            });
        }
        if let Some(last) = clusters.last_mut() {
            last.end_secs = t;
            last.deaths.push(e);
        }
    }
    clusters.retain(|c| c.deaths.len() >= TEAMFIGHT_MIN_DEATHS);
    clusters
}

/// 参团维：本队有参与的团战（窗口内我方有人击杀/被击杀/助攻）而本人完全未参与。
pub fn detect_teamfight_miss_events(
    clusters: &[TeamfightCluster<'_>],
    pid: i32,
    team_pids: &HashSet<i32>,
) -> Vec<ScoreEvent> {
    let mut out = Vec::new();
    for c in clusters {
        let my_team_involved = c.deaths.iter().any(|e| event_involves_any(e, team_pids));
        if !my_team_involved {
            continue;
        }
        let participated = c.deaths.iter().any(|e| event_involves(e, pid));
        if !participated {
            out.push(ScoreEvent {
                dimension: ScoreDimension::Participation,
                timestamp_secs: c.start_secs,
                description: format!(
                    "{} 团战（{}s 内 {} 人死亡）本队有参战，但未参与",
                    fmt_mmss(c.start_secs),
                    c.end_secs - c.start_secs,
                    c.deaths.len()
                ),
                delta: DELTA_PARTICIPATION_MISS,
            });
        }
    }
    out
}
