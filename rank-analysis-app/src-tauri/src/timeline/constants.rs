//! # timeline 帧级分析：常量
//!
//! 这里的每个数字都直接决定对外 Tag 的判定结果，改动等于改产品口径，
//! 故集中一处并在测试中引用常量本身（而非字面量），避免测试与实现漂移。

/// 帧级分析覆盖的前期时长（分钟）。
///
/// 14 分钟 = 前两级 + 第一波小龙可成形的时间窗；再晚的节奏已不适合用
/// 「前期」标签描述（Akari 同口径）。
pub const ANALYSIS_MINUTES: i64 = 14;

/// 「前期」边界（毫秒）：用于区分 early death 与中后期死亡。
pub const EARLY_LIMIT_MS: i64 = 15 * 60 * 1000;

/// 单次击杀在「易抓」评估中的权重。
///
/// 前期死亡数不是等价的：被单杀（无人协防）比被三人越塔强围更暴露走位，
/// 故按参与人数反比加权，单杀权重最高。
pub const KILL_WEIGHT: f64 = 5.0;

/// 单局参与击杀事件数超过此值即认为该帧数据异常（脏数据熔断）。
pub const MAX_PLAUSIBLE_KILL_EVENTS: usize = 60;

/// 地图坐标合法范围（召唤师峡谷约 0..15000）。
///
/// 超出此范围的坐标视为脏数据并让整局降级——宁可不给结论，
/// 也不要把脏坐标算进路径推断里（会污染后续所有营地/分路判定）。
pub const MAP_COORD_MIN: i32 = -1000;
/// 坐标下界
pub const MAP_COORD_MAX: i32 = 16000;

/// 分析失败/降级的原因（对外可读，中文面向用户）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Degraded {
    /// SGP 返回里没有帧（LCU 路径必然如此）
    NoFrames,
    /// 该局地图不是召唤师峡谷（`mapId != 11`），坐标无意义
    NotSummonersRift,
    /// 帧里有坐标缺失，无法做位置推断
    NoPositions,
    /// 击杀事件数超出合理上限，判定为脏数据
    DirtyFrames,
}

impl Degraded {
    /// 对外文案：前端直接展示，避免各端各写一套。
    pub fn message(self) -> &'static str {
        match self {
            Degraded::NoFrames => "无帧数据（需 SGP 路径）",
            Degraded::NotSummonersRift => "非召唤师峡谷地图，不做路径分析",
            Degraded::NoPositions => "帧坐标缺失，无法推断位置",
            Degraded::DirtyFrames => "帧数据异常，已放弃本局分析",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn degrade_messages_are_all_distinct() {
        let all = [
            Degraded::NoFrames,
            Degraded::NotSummonersRift,
            Degraded::NoPositions,
            Degraded::DirtyFrames,
        ];
        let mut msgs: Vec<&str> = all.iter().map(|d| d.message()).collect();
        msgs.sort_unstable();
        let before = msgs.len();
        msgs.dedup();
        assert_eq!(msgs.len(), before, "降级文案重复，调用方无法区分");
    }

    #[test]
    fn early_limit_equals_fifteen_minutes() {
        assert_eq!(EARLY_LIMIT_MS, 15 * 60 * 1000);
    }
}
