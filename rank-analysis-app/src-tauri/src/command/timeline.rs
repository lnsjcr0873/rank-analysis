//! # 帧级分析对外命令
//!
//! 批量拉取 SGP `DETAILS`（逐分钟帧）并对指定玩家做前期帧级分析。
//!
//! ## 为什么必须批量 + 限流
//!
//! 名册墙要给**同屏 10 人**各出画像，而 SGP 只提供**按 gameId** 的帧端点，
//! 没有「一次查多人」的接口。朴素实现是 10 人 × N 局 = 10N 次请求，
//! 既慢又极易触发 SGP 限流。因此这里：
//!
//! - **按 gameId 去重**：同一局对 10 人只拉一次，之后本地按 puuid 分发；
//! - **并发上限**：局内 `buffer_unordered(3)`，全局 `Semaphore(4)`——SGP 是公网
//!   网关，比本机 LCU 脆弱，故比 `LCU_SEMAPHORE`(20) 保守得多；
//! - **连续失败熔断**：连续 N 局失败即认为 SGP 不可达，剩余局直接返回 `None`，
//!   不再空转请求。
//!
//! ## 降级纪律
//!
//! 单局失败 → 该局 `None`，**整个批次不失败**（照抄 `get_sgp_ranks_by_puuids`
//! 的不变式）。前端据此把 C 类 Tag 隐藏，而不是把整页打成错误态。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{SystemTime, UNIX_EPOCH};

use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;

use crate::lcu::api::sgp;
use crate::timeline;
use crate::timeline::geometry::Camp;

/// 局内并发度。
const PER_GAME_CONCURRENCY: usize = 3;

/// 全局并发闸（SGP 公网网关，保守取 4）。
static SGP_TIMELINE_SEMAPHORE: LazyLock<Arc<Semaphore>> =
    LazyLock::new(|| Arc::new(Semaphore::new(4)));

/// 连续失败达到此数即熔断，剩余局不再发请求。
const CIRCUIT_BREAKER_THRESHOLD: usize = 5;

/// 熔断冷却：让前端下一次重试时 SGP 可能已恢复。
const CIRCUIT_BREAKER_COOLDOWN_MS: u64 = 30_000;

/// 当前熔断截止时刻（epoch 毫秒）；0 表示未熔断。
static BREAK_UNTIL_MS: AtomicU64 = AtomicU64::new(0);

/// epoch 毫秒。仅用于熔断计时，不参与任何对局逻辑。
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

/// 熔断是否生效（测试会直接改 `BREAK_UNTIL_MS`）。
fn circuit_open() -> bool {
    let until = BREAK_UNTIL_MS.load(Ordering::Relaxed);
    until != 0 && now_ms() < until
}

fn trip_circuit(consecutive_failures: usize) {
    if consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD {
        BREAK_UNTIL_MS.store(now_ms() + CIRCUIT_BREAKER_COOLDOWN_MS, Ordering::Relaxed);
    }
}

/// 调用方传入的玩家身份（puuid + 队伍）。
///
/// **队伍必须由调用方给**：SGP 的 `DETAILS` 只给 `{participantId, puuid}`，
/// 帧里也没有队伍字段，而「敌方打野在场」这个指标必须区分敌我。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelinePlayerInput {
    pub puuid: String,
    pub team_id: i32,
}

/// 单个玩家在一局的结论。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerTimelineEntry {
    pub frames_analyzed: u32,
    /// 清野顺序（camelCase 枚举名，如 `blueBuff`）
    pub jungle_path: Vec<Camp>,
    pub first_camp_at_ms: Option<i64>,
    pub invaded_before_3min: bool,
    pub early_deaths: u32,
    pub early_death_score: f64,
    pub all_early_deaths_solo: bool,
    pub contested_objectives: u32,
    /// 因敌方打野在场的前期死亡次数（C 类 Tag 数据源）
    pub early_deaths_with_enemy_jungler: u32,
    /// 本局是否被推断为打野
    pub inferred_jungle_role: bool,
}

/// 单局结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEntry {
    /// 本局降级原因；`Some` 时 `players` 不可信
    pub degraded: Option<String>,
    /// puuid → 结论
    pub players: HashMap<String, PlayerTimelineEntry>,
}

/// 批量拉取 SGP 帧并做逐玩家分析。
///
/// - 单局失败 => 该局结果为 `None`，整个批次不失败
/// - 缓存命中由 `sgp::fetch_match_detail` 内部处理，零额外请求
/// - 连续失败达阈值即熔断，剩余局跳过请求
#[tauri::command]
pub async fn get_player_timelines(
    region: String,
    game_ids: Vec<i64>,
    players: Vec<TimelinePlayerInput>,
) -> HashMap<i64, Option<TimelineEntry>> {
    let mut out: HashMap<i64, Option<TimelineEntry>> = HashMap::new();
    let Some(first) = players.first() else {
        return out;
    };
    if game_ids.is_empty() || first.puuid.is_empty() {
        return out;
    }
    let puuids: Vec<String> = players.iter().map(|p| p.puuid.clone()).collect();

    // 按 gameId 去重：同局对 10 人只拉一次
    let mut unique = game_ids;
    unique.sort_unstable();
    unique.dedup();

    // 熔断生效时不发任何请求
    if circuit_open() {
        for gid in unique {
            out.insert(gid, None);
        }
        return out;
    }

    let semaphore = Arc::clone(&SGP_TIMELINE_SEMAPHORE);
    let consecutive = Arc::new(AtomicUsize::new(0));

    let results = stream::iter(unique.into_iter().map(|gid| {
        let region = region.clone();
        let semaphore = Arc::clone(&semaphore);
        let consecutive = Arc::clone(&consecutive);
        let puuids = puuids.clone();
        let players = players.clone();
        async move {
            let _permit = semaphore.acquire_owned().await;
            match fetch_and_analyze(&region, gid, &puuids, &players).await {
                Ok(entry) => {
                    consecutive.store(0, Ordering::Relaxed);
                    (gid, Some(entry))
                }
                Err(_) => {
                    let n = consecutive.fetch_add(1, Ordering::Relaxed) + 1;
                    trip_circuit(n);
                    (gid, None)
                }
            }
        }
    }))
    .buffer_unordered(PER_GAME_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;

    for (gid, entry) in results {
        out.insert(gid, entry);
    }
    out
}

/// 单局：拉详情 → 建立 puuid↔participantId → 跑纯函数分析。
async fn fetch_and_analyze(
    region: &str,
    game_id: i64,
    puuids: &[String],
    players: &[TimelinePlayerInput],
) -> Result<TimelineEntry, String> {
    let detail = sgp::fetch_match_detail(region, game_id).await?;
    let id_map = timeline::participant_ids_by_puuid(&detail);

    // 身份对齐：SGP participantId 与 LCU 不可比，一律经 puuid 中转（照 score/mod.rs）
    let inputs: Vec<timeline::PlayerInput> = players
        .iter()
        .filter_map(|p| {
            id_map.get(&p.puuid).map(|pid| timeline::PlayerInput {
                participant_id: *pid,
                team_id: p.team_id,
            })
        })
        .collect();
    if inputs.is_empty() {
        return Ok(TimelineEntry {
            degraded: Some("未在帧数据中匹配到目标玩家".to_string()),
            players: HashMap::new(),
        });
    }

    let analysis = timeline::analyze_game_timeline(game_id, None, &inputs, &detail);
    let mut result = HashMap::new();
    for pt in &analysis.players {
        let Some(puuid) = puuids
            .iter()
            .find(|p| id_map.get(*p) == Some(&pt.participant_id))
        else {
            continue;
        };
        result.insert(
            puuid.clone(),
            PlayerTimelineEntry {
                frames_analyzed: pt.frames_analyzed,
                jungle_path: pt.jungle_path.clone(),
                first_camp_at_ms: pt.first_camp_at_ms,
                invaded_before_3min: pt.invaded_before_3min,
                early_deaths: pt.early_deaths,
                early_death_score: pt.early_death_score,
                all_early_deaths_solo: pt.all_early_deaths_solo,
                contested_objectives: pt.contested_objectives,
                early_deaths_with_enemy_jungler: pt.early_deaths_with_enemy_jungler,
                inferred_jungle_role: pt.inferred_jungle_role,
            },
        );
    }

    Ok(TimelineEntry {
        degraded: analysis.degraded,
        players: result,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player(puuid: &str, team_id: i32) -> TimelinePlayerInput {
        TimelinePlayerInput {
            puuid: puuid.to_string(),
            team_id,
        }
    }

    /// 熔断状态需要在用例间复位，否则会互相污染。
    fn reset_circuit() {
        BREAK_UNTIL_MS.store(0, Ordering::Relaxed);
    }

    #[tokio::test]
    async fn empty_game_ids_returns_empty_map() {
        reset_circuit();
        let out = get_player_timelines("HN10".into(), vec![], vec![player("p1", 100)]).await;
        assert!(out.is_empty());
    }

    #[tokio::test]
    async fn empty_puuids_returns_empty_map() {
        reset_circuit();
        let out = get_player_timelines("HN10".into(), vec![1, 2, 3], vec![]).await;
        assert!(out.is_empty());
    }

    #[tokio::test]
    async fn circuit_open_short_circuits_all_games_without_requests() {
        reset_circuit();
        // 人工把熔断截止时间设到未来
        BREAK_UNTIL_MS.store(now_ms() + 60_000, Ordering::Relaxed);
        assert!(circuit_open());

        let out =
            get_player_timelines("HN10".into(), vec![11, 12, 13, 14], vec![player("p1", 100)])
                .await;

        // 全部返回 None（而不是报错），且 key 齐全
        assert_eq!(out.len(), 4);
        assert!(out.values().all(|v| v.is_none()));
        reset_circuit();
    }

    #[test]
    fn circuit_closes_after_cooldown() {
        reset_circuit();
        assert!(!circuit_open());
        // 已过期的时间戳 => 不熔断
        BREAK_UNTIL_MS.store(1, Ordering::Relaxed);
        assert!(!circuit_open());
        reset_circuit();
    }

    #[test]
    fn trip_only_opens_at_threshold() {
        reset_circuit();
        trip_circuit(CIRCUIT_BREAKER_THRESHOLD - 1);
        assert!(!circuit_open(), "未达阈值不应熔断");
        trip_circuit(CIRCUIT_BREAKER_THRESHOLD);
        assert!(circuit_open(), "达到阈值应熔断");
        reset_circuit();
    }
}
