//! # A3 触发→识别→打分→推送 管线编排
//!
//! 职责：把 capture（带活跃度）→ OCR 文本 → 词表匹配 → 打分 四段串成一次
//! `assist_tick`。OCR 引擎尚未接入时，tick 返回 `pushed:false` 与明确原因——
//! 前端调度器据此只报告不推送；引擎落地后仅需替换 [`recognize_bands`] 的实现。
//!
//! 「三选一是否出现」的判定已迁至 [`super::detector`]（自校准基线差分）：
//! 本模块不再持有任何绝对亮度阈值——旧的 `BAND_ACTIVE_THRESHOLD = 18` 在真实
//! 游戏画面上恒成立，等于没有判定。前端 trigger.ts 同理，只消费后端给出的
//! `active` / `present`，不再自行比较数值。

use serde::Serialize;
use serde_json::Value;

/// 判定「三选一出现」所需的活跃卡位数（三选一恒为 3 张卡）。
///
/// 权威定义在 [`super::detector::REQUIRED_SLOTS`]，此处仅为调用方引用方便。
pub use super::detector::REQUIRED_SLOTS as ACTIVE_SLOTS_REQUIRED;

/// 一次 assist tick 的结果（前端据此决定是否推送面板）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TickOutcome {
    pub phase: String,
    pub pushed: bool,
    /// 未推送时的机器可读原因
    pub reason: Option<&'static str>,
    /// 活跃标题带数
    pub active_slots: usize,
    /// 推送成功时的三选一面板负载（契约见 features/overlay/panels.ts）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

/// 对三个卡位的文本跑「词表匹配 → 打分」并组装面板负载。
///
/// OCR 引擎产出文本候选后调这里；手动调试可直接喂样例文本。
///
/// R09：`champion_id` 为 None 时走纯全局口径（不混入任何英雄分片），并在
/// payload 顶层标注 `championScope: "global"`；有值时标注 `"champion"`。
/// 调用方不得用样例英雄 id（如 67）填充未知英雄——那会把错误英雄的分片
/// 胜率混入打分。
pub fn run_augment_round(
    texts: [Option<String>; 3],
    champion_id: Option<i64>,
    rerolls_left: Option<u8>,
) -> Result<Value, String> {
    let augments = super::store::read_local_json("augments.json")?;
    let lexicon = super::ocr::build_lexicon(&augments);
    let metas = super::score::CandidateMeta::map_from_augments(&augments);
    let tables = super::score::load_tables_opt(champion_id)?;

    let hits = super::ocr::match_slots(&texts, &lexicon, 2);
    let mut payload = super::score::score_round(
        [hits[0].as_ref(), hits[1].as_ref(), hits[2].as_ref()],
        &metas,
        &tables,
        rerolls_left,
    );
    if let Some(obj) = payload.as_object_mut() {
        obj.insert(
            "championScope".to_string(),
            Value::String(
                if champion_id.is_some() {
                    "champion"
                } else {
                    "global"
                }
                .to_string(),
            ),
        );
        if let Some(id) = champion_id {
            obj.insert("championId".to_string(), Value::from(id));
        }
    }
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mayhem::capture::{BandStat, Rect};

    fn band(slot: u8, active: bool) -> BandStat {
        BandStat {
            slot,
            rect: Rect {
                x: 0,
                y: 0,
                w: 10,
                h: 10,
            },
            stddev: 88.0,
            mean: 200.0,
            white: 0.01,
            active,
            score: if active { 4.0 } else { 0.2 },
            baseline: Some(80.0),
            ready: true,
        }
    }

    /// 判定只看后端给出的 `active`，且三选一恒为 3 张卡 → 必须 3/3 成立。
    #[test]
    fn detection_requires_all_three_slots() {
        let count = |v: [bool; 3]| v.iter().filter(|a| **a).count();
        assert!(count([true, true, true]) >= ACTIVE_SLOTS_REQUIRED);
        // 旧口径（≥2 带）在这里会误判：普通游戏画面三带 stddev 高达 88
        assert!(count([true, true, false]) < ACTIVE_SLOTS_REQUIRED);
        assert!(count([true, false, false]) < ACTIVE_SLOTS_REQUIRED);
        assert_eq!(ACTIVE_SLOTS_REQUIRED, 3);
    }

    #[test]
    fn band_stat_carries_detector_verdict_not_threshold_math() {
        // 高 stddev 本身不再意味着 active：判定权归 detector
        let s = band(0, false);
        assert!(s.stddev > 18.0);
        assert!(!s.active);
    }
}
