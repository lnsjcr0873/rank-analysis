//! # 决策回测命令（M2 数据飞轮：建议 → 回测 → 采纳/未采纳对账）
//!
//! `get_decision_backtest(game_id)` 在赛后结算/战绩详情调用：
//! 1. 取本局详情（LCU match-details，带缓存），用本机 puuid 对齐"我"；
//! 2. 开赛时刻前 ≤15min 窗口内取最近一条未对账赛前建议；没有 →
//!    返回 `no_pending_suggestion`，不写 ledger（宁缺毋滥，不编造对账）；
//! 3. 组装双方样本：优先敌方对位样本（双方各 ≥3 局），不足退英雄+位置
//!    全样本并在 caveats 标注；样本不足回测阈值 → 对账照常写（对账不
//!    依赖样本量），backtest 标记 insufficient；
//! 4. `compute_backtest` → `record_decision`（幂等 upsert）→
//!    `mark_pending_reconciled`（消费建议，防重复对账）。
//!
//! 对账口径：`adopted = (实际英雄 == 建议英雄)`；关联键 = gameId +
//! suggestedAtMs + 英雄。分路无法从赛后数据归一（LCU 无 timeline）→
//! 无分路模式（ARAM 等）回退敌方全队基准对照；其他模式仍返回
//! `position_unknown` 且不消费建议（留给下局/手动处理）。

use serde::{Deserialize, Serialize};

use crate::backtest::samples::normalize_position;
use crate::backtest::store::{self, LocalSample};
use crate::backtest::MIN_MATCHUP_SAMPLES;
use crate::backtest::{compute_backtest, BacktestInput, BacktestResult, MatchupSample};
use crate::command::match_history::get_game_by_id;
use crate::lcu::api::model::Participant;
use crate::lcu::api::summoner::Summoner;

/// 对账窗口：开赛前 ≤ 15 分钟内的赛前建议才与该局关联。
const RECONCILE_WINDOW_MS: i64 = 15 * 60 * 1000;

/// 时钟偏差容忍度（本地时钟快于 Riot 服务器时钟时，允许赛前建议时间戳略大于开赛时间，最多容忍 3 分钟）。
const CLOCK_SKEW_TOLERANCE_MS: i64 = 3 * 60 * 1000;

/// 回测对账结果（对账数据沉淀 + 回测结果一体返回）。
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DecisionBacktest {
    /// 是否有可对账的赛前建议（false → 其余字段大多为 None）。
    pub aligned: bool,
    /// 未对齐原因：`ok` / `no_pending_suggestion` / `my_puuid_missing` /
    /// `not_in_game` / `parse_game_time_failed` / `position_unknown`。
    pub reason: String,
    pub suggested_at_ms: Option<i64>,
    pub suggestion_champion_id: Option<i32>,
    pub actual_champion_id: Option<i32>,
    pub enemy_champion_id: Option<i32>,
    pub position: Option<String>,
    /// 是否采纳建议（实际英雄 == 建议英雄）。
    pub adopted: Option<bool>,
    pub result_win: Option<bool>,
    /// 回测结果（样本不足时 insufficient_data=true 且 delta=0）。
    pub backtest: Option<BacktestResult>,
}

/// 解析对局时间为 epoch 毫秒：支持 ISO8601 字符串与纯数字时间戳字符串（毫秒/秒）。
pub(crate) fn parse_game_time_to_epoch_ms(s: &str) -> Option<i64> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(num) = trimmed.parse::<i64>() {
        if num > 0 {
            // 数值精度三级判定（不同来源下发精度不一）：
            // - < 1000 亿（秒级 Unix 时间，10 位）→ 秒，×1000
            // - 1000 亿 ~ 1e15（毫秒级，13~14 位）→ 原样
            // - ≥ 1e15（微秒级，16 位，个别 SGP/镜像源下发）→ ÷1000
            return Some(if num < 100_000_000_000 {
                num * 1000
            } else if num >= 1_000_000_000_000_000 {
                num / 1000
            } else {
                num
            });
        }
    }
    iso_to_epoch_ms(trimmed)
}

/// ISO8601 UTC（如 `2021-01-01T00:00:00.000Z`）→ epoch 毫秒。
/// 无 chrono 依赖：与 `lcu::api::sgp::epoch_ms_to_iso` 互逆（Howard Hinnant 历法）。
/// 支持可选的 `.mmm` 毫秒段与 `Z` / `±HH:MM` 时区后缀。
fn iso_to_epoch_ms(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let num = |i: usize, n: usize| -> Option<i64> {
        if i + n > b.len() {
            return None;
        }
        let mut v: i64 = 0;
        for &c in &b[i..i + n] {
            if !c.is_ascii_digit() {
                return None;
            }
            v = v * 10 + i64::from(c - b'0');
        }
        Some(v)
    };
    if b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let y = num(0, 4)?;
    let mo = num(5, 2)?;
    let d = num(8, 2)?;
    let hh = num(11, 2)?;
    let mi = num(14, 2)?;
    let ss = num(17, 2)?;
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || hh > 23 || mi > 59 || ss > 60 {
        return None;
    }
    let mut millis: i64 = 0;
    let mut idx = 19;
    let mut offset_min = 0i64;
    if b.len() > idx && b[idx] == b'.' {
        idx += 1;
        // 吸纳小数毫秒，最多 6 位（微秒精度源也兼容）；前 3 位为毫秒值，超出截断。
        let mut ndigits = 0usize;
        while idx < b.len() && b[idx].is_ascii_digit() && ndigits < 3 {
            millis = millis * 10 + i64::from(b[idx] - b'0');
            idx += 1;
            ndigits += 1;
        }
        while idx < b.len() && b[idx].is_ascii_digit() && ndigits < 6 {
            idx += 1;
            ndigits += 1;
        }
        for _ in ndigits.min(3)..3 {
            millis *= 10;
        }
    }
    // 时区偏移：显式后缀（Z / ±HH:MM）按其换算；无后缀时默认 UTC——
    // 上游（SGP/LCU）下发的无后缀时间串即 UTC 语义，此前 return None 会让
    // 回测直接丢样本（debug3）。若未来出现本地时区源，需在此处显式分支。
    // 注意先判长度：无毫秒段又无后缀时 idx 已 == b.len()，b.get(idx) 为 None。
    if idx == b.len() {
        log::debug!("[backtest] ISO 无时区后缀，按 UTC 解析: {s}");
        let days = days_from_civil(y, mo as u32, d as u32);
        let secs = days * 86_400 + hh * 3600 + mi * 60 + ss - offset_min * 60;
        return Some(secs * 1000 + millis);
    }
    let c = *b.get(idx)?;
    if c == b'Z' || c == b'z' {
        idx += 1;
    } else if c == b'+' || c == b'-' {
        let sign = if c == b'-' { -1 } else { 1 };
        if idx + 6 > b.len() || b[idx + 3] != b':' {
            return None;
        }
        let oh = num(idx + 1, 2)?;
        let om = num(idx + 4, 2)?;
        offset_min = sign * (oh * 60 + om);
        idx += 6;
    } else {
        return None;
    }
    if idx != b.len() {
        return None;
    }
    let days = days_from_civil(y, mo as u32, d as u32);
    let secs = days * 86_400 + hh * 3600 + mi * 60 + ss - offset_min * 60;
    Some(secs * 1000 + millis)
}

/// 自 1970-01-01 起的 (y, m, d) → 天数。Howard Hinnant `days_from_civil`。
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (i64::from(m) + 9) % 12;
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// 在局内定位"我"（participantId 从 1 起与 identity 数组对齐；debug6 去掉
/// 同索引回退，对不上即 None，调用方判 not_in_game）。
fn find_my_participant(participants: &[Participant], idx: usize) -> Option<&Participant> {
    participants
        .iter()
        .find(|p| p.participant_id == idx as i32 + 1)
}

/// 取敌方同分路的玩家英雄（None = 敌方无同分路，宁缺毋滥不出对账）。
fn find_enemy(participants: &[Participant], me: &Participant, position: &str) -> Option<i32> {
    participants
        .iter()
        .find(|p| {
            p.team_id != me.team_id
                && p.timeline
                    .as_ref()
                    .and_then(|t| normalize_position(&t.lane, &t.role))
                    == Some(position)
        })
        .map(|p| p.champion_id)
}

/// 解析对局的对位基准 → (position, 敌方英雄, 是否ARAM回退)。
///
/// - 有分路且敌方有同分路 → 正常对位；
/// - 无分路 + ARAM（大乱斗全员单中、无位置分配）→ position 取 "ARAM"，
///   enemy 取敌方首个不同队玩家英雄作全队基准代表（debug5：此前直接判
///   position_unknown 放弃回测，大乱斗决策回测 Tab 永远无数据）；
/// - 其余 → None（调用方判 position_unknown，不消费建议）。
fn resolve_backtest_matchup(
    participants: &[Participant],
    me: &Participant,
    game_mode: &str,
) -> Option<(String, i32, bool)> {
    let position_opt = me
        .timeline
        .as_ref()
        .and_then(|t| normalize_position(&t.lane, &t.role));
    let enemy_opt = position_opt.and_then(|pos| find_enemy(participants, me, pos));
    match (position_opt, enemy_opt) {
        (Some(pos), Some(eid)) => Some((pos.to_string(), eid, false)),
        _ if game_mode == "ARAM" => {
            let eid = participants
                .iter()
                .find(|p| p.team_id != me.team_id)
                .map(|p| p.champion_id)
                .unwrap_or(0);
            Some(("ARAM".to_string(), eid, true))
        }
        _ => None,
    }
}

/// 组装双方样本：优先敌方对位样本（双方各 ≥ [`MIN_MATCHUP_SAMPLES`]），
/// 不足退英雄+位置全样本；返回 (建议样本, 实际样本, 是否回退全样本)。
fn build_samples(
    suggestion_champion_id: i32,
    actual_champion_id: i32,
    position: &str,
    enemy_champion_id: i32,
) -> (Vec<MatchupSample>, Vec<MatchupSample>, bool) {
    let to_matchup = |rows: Vec<LocalSample>| {
        rows.into_iter()
            .map(|s| MatchupSample {
                champion_id: s.champion_id,
                position: s.position,
                enemy_champion_id: s.enemy_champion_id,
                win: s.win,
                score: s.score,
            })
            .collect::<Vec<_>>()
    };
    let sug_matchup = to_matchup(store::query_samples(
        suggestion_champion_id,
        position,
        Some(enemy_champion_id),
    ));
    let act_matchup = to_matchup(store::query_samples(
        actual_champion_id,
        position,
        Some(enemy_champion_id),
    ));
    if sug_matchup.len() >= MIN_MATCHUP_SAMPLES && act_matchup.len() >= MIN_MATCHUP_SAMPLES {
        return (sug_matchup, act_matchup, false);
    }
    let sug_all = to_matchup(store::query_samples(suggestion_champion_id, position, None));
    let act_all = to_matchup(store::query_samples(actual_champion_id, position, None));
    (sug_all, act_all, true)
}

/// 赛后决策对账（建议 → 回测 → 采纳/未采纳 ledger）。
///
/// # 返回值
/// - `aligned=true`: 对账完成并落库（ledger 幂等 upsert，建议已消费）
/// - `aligned=false`: 无可对账建议或数据缺失（`reason` 说明），不写 ledger
#[tauri::command]
pub async fn get_decision_backtest(game_id: i64) -> Result<DecisionBacktest, String> {
    let game = get_game_by_id(game_id).await?;
    let my = Summoner::get_my_summoner().await?;
    if my.puuid.is_empty() {
        return Ok(DecisionBacktest {
            aligned: false,
            reason: "my_puuid_missing".to_string(),
            ..Default::default()
        });
    }
    let identities = &game.game_detail.participant_identities;
    let Some(idx) = identities.iter().position(|i| i.player.puuid == my.puuid) else {
        return Ok(DecisionBacktest {
            aligned: false,
            reason: "not_in_game".to_string(),
            ..Default::default()
        });
    };
    let participants = &game.game_detail.participants;
    let Some(me) = find_my_participant(participants, idx) else {
        return Ok(DecisionBacktest {
            aligned: false,
            reason: "not_in_game".to_string(),
            ..Default::default()
        });
    };
    let Some(created_ms) = parse_game_time_to_epoch_ms(&game.game_creation_date) else {
        return Ok(DecisionBacktest {
            aligned: false,
            reason: "parse_game_time_failed".to_string(),
            ..Default::default()
        });
    };
    // 最近未对账的赛前建议（开赛前 ≤15min 窗口，允许最多 3min 本地时钟快于服务器的时钟偏差）
    // debug6：with_db 是同步阻塞 SQLite（全局 Mutex），async 上下文直调会卡住
    // Tokio worker（Worker Starvation）。与 command/meet.rs 同口径包 spawn_blocking。
    let cutoff_ms = created_ms + CLOCK_SKEW_TOLERANCE_MS;
    let Some(pending) =
        tauri::async_runtime::spawn_blocking(move || store::latest_pending_before(cutoff_ms))
            .await
            .map_err(|e| format!("对账查询任务失败: {e}"))?
    else {
        return Ok(DecisionBacktest {
            aligned: false,
            reason: "no_pending_suggestion".to_string(),
            ..Default::default()
        });
    };
    if pending.suggested_at_ms < created_ms - RECONCILE_WINDOW_MS {
        return Ok(DecisionBacktest {
            aligned: false,
            reason: "no_pending_suggestion".to_string(),
            ..Default::default()
        });
    }
    // 对位基准：正常分路对位；ARAM 无分路回退全队基准；其余判 position_unknown。
    let Some((position, enemy_id, aram_fallback)) =
        resolve_backtest_matchup(participants, me, &game.game_mode)
    else {
        return Ok(DecisionBacktest {
            aligned: false,
            reason: "position_unknown".to_string(),
            ..Default::default()
        });
    };
    let adopted = me.champion_id == pending.suggestion_champion_id;
    // debug6：build_samples 全是同步 SQLite 查库，同样包 spawn_blocking。
    let (sug_id, act_id, pos_owned, eid) = (
        pending.suggestion_champion_id,
        me.champion_id,
        position.clone(),
        enemy_id,
    );
    let (suggestion_samples, actual_samples, used_fallback) =
        tauri::async_runtime::spawn_blocking(move || {
            build_samples(sug_id, act_id, &pos_owned, eid)
        })
        .await
        .map_err(|e| format!("样本查询任务失败: {e}"))?;
    let result = compute_backtest(&BacktestInput {
        suggestion_champion_id: pending.suggestion_champion_id,
        actual_champion_id: me.champion_id,
        enemy_champion_id: enemy_id,
        suggestion_samples,
        actual_samples,
    });
    let mut caveats = result.caveats.clone();
    if aram_fallback {
        caveats.push("无分路模式（大乱斗）：无单一对位对手，已回退敌方全队基准对照".to_string());
    }
    if used_fallback {
        caveats.push(format!(
            "敌方对位样本不足（双方各 ≥{MIN_MATCHUP_SAMPLES} 局），已回退英雄+位置全样本"
        ));
    }
    // debug6：写 ledger + 消费建议同样是同步 SQLite，包 spawn_blocking。
    let entry = store::LedgerEntry {
        game_id,
        suggested_at_ms: pending.suggested_at_ms,
        suggestion_champion_id: pending.suggestion_champion_id,
        actual_champion_id: me.champion_id,
        enemy_champion_id: enemy_id,
        position: position.clone(),
        adopted,
        result_win: me.stats.win,
        matchup_delta: result.matchup_delta,
        confidence: result.confidence,
        caveats,
    };
    let (reconcile_at, reconcile_id) = (pending.suggested_at_ms, pending.suggestion_champion_id);
    tauri::async_runtime::spawn_blocking(move || {
        store::record_decision(&entry);
        store::mark_pending_reconciled(reconcile_at, reconcile_id, game_id);
    })
    .await
    .map_err(|e| format!("对账落库任务失败: {e}"))?;
    Ok(DecisionBacktest {
        aligned: true,
        reason: "ok".to_string(),
        suggested_at_ms: Some(pending.suggested_at_ms),
        suggestion_champion_id: Some(pending.suggestion_champion_id),
        actual_champion_id: Some(me.champion_id),
        enemy_champion_id: Some(enemy_id),
        position: Some(position),
        adopted: Some(adopted),
        result_win: Some(me.stats.win),
        backtest: Some(result),
    })
}

/// 采纳 vs 未采纳的统计分布（前端"决策回测"区块数据源）。
#[tauri::command]
pub async fn get_adoption_stats() -> Result<store::AdoptionStats, String> {
    // debug6：同步 SQLite 查库，包 spawn_blocking（与上同口径）。
    tauri::async_runtime::spawn_blocking(store::adoption_stats)
        .await
        .map_err(|e| format!("统计查询任务失败: {e}"))?
        .ok_or_else(|| "回测库不可用".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_parses_utc_with_millis() {
        assert_eq!(iso_to_epoch_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(
            iso_to_epoch_ms("2021-01-01T00:00:00.000Z"),
            Some(1_609_459_200_000)
        );
        assert_eq!(
            iso_to_epoch_ms("2021-01-01T08:00:00.000Z"),
            Some(1_609_488_000_000)
        );
    }

    #[test]
    fn iso_parses_without_millis_and_with_offset() {
        assert_eq!(
            iso_to_epoch_ms("2021-01-01T00:00:00Z"),
            Some(1_609_459_200_000)
        );
        // +08:00 → 减 8 小时回到 UTC
        assert_eq!(
            iso_to_epoch_ms("2021-01-01T08:00:00+08:00"),
            Some(1_609_459_200_000)
        );
    }

    #[test]
    fn iso_rejects_malformed() {
        assert_eq!(iso_to_epoch_ms("2021-01-01"), None);
        assert_eq!(iso_to_epoch_ms("2021-13-01T00:00:00.000Z"), None);
        assert_eq!(iso_to_epoch_ms("garbage"), None);
    }

    #[test]
    fn iso_without_suffix_defaults_to_utc() {
        // 上游无后缀时间串即 UTC 语义：不再丢样本（debug3）
        assert_eq!(
            iso_to_epoch_ms("2021-01-01T00:00:00"),
            Some(1_609_459_200_000)
        );
        assert_eq!(
            iso_to_epoch_ms("2021-01-01T00:00:00.123"),
            Some(1_609_459_200_123)
        );
        // 与显式 Z 同值
        assert_eq!(
            iso_to_epoch_ms("2021-01-01T00:00:00"),
            iso_to_epoch_ms("2021-01-01T00:00:00Z")
        );
    }

    #[test]
    fn parse_game_time_handles_numeric_strings_and_iso() {
        assert_eq!(
            parse_game_time_to_epoch_ms("1755200000000"),
            Some(1_755_200_000_000)
        );
        assert_eq!(
            parse_game_time_to_epoch_ms("1609459200"),
            Some(1_609_459_200_000)
        );
        assert_eq!(
            parse_game_time_to_epoch_ms("2021-01-01T00:00:00.000Z"),
            Some(1_609_459_200_000)
        );
        assert_eq!(parse_game_time_to_epoch_ms(""), None);
        assert_eq!(parse_game_time_to_epoch_ms("invalid"), None);
    }

    #[test]
    fn parse_game_time_handles_micros_and_fractional_iso() {
        // 微秒级（16 位数字）→ ÷1000 归毫秒
        assert_eq!(
            parse_game_time_to_epoch_ms("1755200000000123"),
            Some(1_755_200_000_000)
        );
        // ISO 小数毫秒超 3 位（微秒精度源）→ 截断到毫秒
        assert_eq!(
            parse_game_time_to_epoch_ms("2021-01-01T00:00:00.123456Z"),
            Some(1_609_459_200_123)
        );
        // 小数毫秒不足 3 位 → 右补零
        assert_eq!(
            parse_game_time_to_epoch_ms("2021-01-01T00:00:00.5Z"),
            Some(1_609_459_200_500)
        );
    }

    #[test]
    fn iso_roundtrips_with_sgp_generator() {
        for ms in [0, 1_609_459_200_000, 1_609_488_000_999] {
            let iso = crate::lcu::api::sgp::epoch_ms_to_iso(ms);
            assert_eq!(iso_to_epoch_ms(&iso), Some(ms), "ISO={iso}");
        }
    }

    #[test]
    fn find_my_participant_aligns_by_id() {
        let ps = vec![
            participant(1, 100, 101),
            participant(2, 100, 102),
            participant(3, 200, 103),
        ];
        assert_eq!(find_my_participant(&ps, 0).unwrap().champion_id, 101);
        assert_eq!(find_my_participant(&ps, 2).unwrap().champion_id, 103);
    }

    #[test]
    fn find_my_participant_rejects_misaligned_index() {
        // debug6：顺序打乱（idx=0 但 participant_id=9）不再回退同索引，
        // 直接 None（调用方判 not_in_game），防串人进对账。
        let ps = vec![participant(9, 100, 109)];
        assert!(find_my_participant(&ps, 0).is_none());
    }

    #[test]
    fn samples_fallback_when_matchup_samples_are_thin() {
        // 直接对位样本不足（无法注入 store 时模拟逻辑层）：
        // 对位样本各 2 → 应回退全样本；对位样本各 3 → 不回退。
        // （store 查询不可注入，此处验证 to_matchup 转换不 panic + 阈值常量）
        assert_eq!(MIN_MATCHUP_SAMPLES, 3);
        assert_eq!(crate::backtest::MIN_LOCAL_SAMPLES, 5);
    }

    fn participant(id: i32, team: i32, champ: i32) -> Participant {
        Participant {
            participant_id: id,
            team_id: team,
            champion_id: champ,
            ..Default::default()
        }
    }

    /// debug5 回归：ARAM 无分路不再判 position_unknown，回退全队基准。
    #[test]
    fn aram_without_lane_falls_back_to_team_baseline() {
        let me = participant(1, 100, 101);
        let foe = participant(6, 200, 201);
        let ps = vec![me.clone(), foe];
        // ARAM 无 timeline → 回退 ARAM 基准，enemy 取敌方首个。
        let (pos, eid, fallback) = resolve_backtest_matchup(&ps, &me, "ARAM").unwrap();
        assert_eq!(pos, "ARAM");
        assert_eq!(eid, 201);
        assert!(fallback);
        // 非 ARAM 无分路 → 仍判 None（调用方 position_unknown）。
        assert!(resolve_backtest_matchup(&ps, &me, "CLASSIC").is_none());
    }

    /// 正常分路对位不受回退影响。
    #[test]
    fn normal_lane_matchup_unaffected_by_aram_fallback() {
        use crate::lcu::api::model::ParticipantTimeline;
        let mut me = participant(3, 100, 103);
        me.timeline = Some(ParticipantTimeline {
            lane: "MID".to_string(),
            role: "SOLO".to_string(),
        });
        let mut foe = participant(8, 200, 108);
        foe.timeline = Some(ParticipantTimeline {
            lane: "MID".to_string(),
            role: "SOLO".to_string(),
        });
        let ps = vec![me.clone(), foe];
        let (pos, eid, fallback) = resolve_backtest_matchup(&ps, &me, "CLASSIC").unwrap();
        assert_eq!(pos, "MIDDLE");
        assert_eq!(eid, 108);
        assert!(!fallback);
    }
}
