//! # 自校准基线差分三选一面板检测器
//!
//! ## 为什么废弃「固定亮度阈值」
//!
//! 旧口径是「标题带亮度标准差 ≥ 18 且至少 2 带成立」即判定三选一出现。实测
//! （1920×1080，客户端已启动、**未进对局、屏幕上没有任何三选一面板**）三带
//! stddev 分别为 88.2 / 57.3 / 42.3，全屏 stddev 98.4：普通游戏画面本身就
//! 远超阈值，检测恒为真。该启发式无法区分「三选一面板」与「随便什么画面」，
//! 于是调度器在 3 级就把第 1 轮判掉、反复对战场画面做 OCR、拿不到文本后
//! 静默失败——表现为功能「完全用不了」。
//!
//! 该常数在代码里本就自述为「目测初值…需实测校准」，从未被真实对局校准过。
//!
//! ## 现在的判据：相对自身历史的稳健离群
//!
//! 每个卡位维护自己近期观测量（stddev / mean / 近白占比）的**滚动中位数**与
//! **MAD 稳健标准差**，把当前帧换算成稳健 z 分数：
//!
//! ```text
//! score = max_f (cur_f - median_f) / sigma_f      （仅取上偏，且需越过绝对下限）
//! ```
//!
//! 取三个特征里最大的上偏分数。判据是「相对这条基线的跃升」而非绝对亮度，
//! 因此不含任何与分辨率、亮度设置、游戏画面相关的魔数——基线由真机自己测出，
//! 首局即可自校准。`SCORE_MIN = 3.0` 取的是标准统计意义上的离群阈值。
//!
//! ## 抗污染
//!
//! - 只有**判定为未激活**的卡位才把当帧写入基线，避免三选一面板帧进入基线。
//! - 面板确认存在后（[`PanelDetector::observe`] 返回 `present`）整体停止入队，
//!   由调用方在轮次推进/换局时 [`PanelDetector::reset`]。
//! - 基线未积累到 [`BASELINE_MIN_SAMPLES`] 个样本前一律不下判定（`ready=false`），
//!   宁可漏报也不误报。
//!
//! ## 标定可观测
//!
//! 每帧判定都会经 [`record`] 追加一行 JSONL 到
//! `rank-analysis-mayhem/band-detect.jsonl`，含全部原始观测量、基线、sigma 与
//! 分数。真实对局跑一局即可拿到正负两类样本，用于复核 `SCORE_MIN`——
//! 详见 docs/debug.md 的标定流程。

use std::collections::VecDeque;
use std::io::Write;
use std::sync::{LazyLock, Mutex, MutexGuard};

use serde::Serialize;

use super::capture::BandFeatures;

/// 判定为离群的稳健 z 分数门槛（标准统计意义上的 3σ）。
pub const SCORE_MIN: f64 = 3.0;

/// 连续成立帧数：三带同时成立才确认面板出现，用于压制单帧抖动。
pub const CONFIRM_FRAMES: u8 = 2;

/// 滚动基线窗口长度（帧）。
pub const BASELINE_WINDOW: usize = 24;

/// 基线成熟所需最少样本数；不足时不下判定。
pub const BASELINE_MIN_SAMPLES: usize = 8;

/// 各特征的绝对最小跃升量（stddev / mean / 近白占比）。
///
/// 防止基线极平稳时 z 分数被除法放大：位移太小一律记 0 分。
pub const FEATURE_MIN_DELTA: [f64; 3] = [6.0, 10.0, 0.008];

/// 各特征的 sigma 下限，避免除零/除极小数。
const FEATURE_MIN_SIGMA: [f64; 3] = [1.5, 3.0, 0.003];

/// 特征索引。
const F_STDDEV: usize = 0;
const F_MEAN: usize = 1;
const F_WHITE: usize = 2;

/// 判定「三选一面板已出现」所需同时成立的卡位数（三选一恒为 3 张卡）。
pub const REQUIRED_SLOTS: usize = 3;

/// 单个卡位的判定结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BandVerdict {
    pub slot: u8,
    /// 原始观测量
    pub features: BandFeatures,
    /// 各特征的滚动中位数基线（未成熟时全为 0）
    pub baseline: [f64; 3],
    /// 各特征的 MAD 稳健标准差
    pub sigma: [f64; 3],
    /// 最大上偏稳健 z 分数
    pub score: f64,
    /// 是否判为卡片在画面上
    pub active: bool,
    /// 当前连续成立的帧数
    pub streak: u8,
}

/// 一帧的整体判定。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub bands: Vec<BandVerdict>,
    /// 三带同时连续成立 → 确认三选一面板出现
    pub present: bool,
    /// 基线是否成熟到可以下判定
    pub ready: bool,
}

impl Detection {
    /// 确认出现的卡位数。
    pub fn active_slots(&self) -> usize {
        self.bands.iter().filter(|b| b.active).count()
    }
}

/// 自校准基线差分检测器。
pub struct PanelDetector {
    /// 每卡位每特征的滚动样本（仅存判定为未激活的帧）
    history: [[VecDeque<f64>; 3]; 3],
    /// 每卡位连续成立帧数
    streak: [u8; 3],
    /// 面板确认存在后停止入队，等待调用方 reset
    suppress: bool,
}

impl Default for PanelDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl PanelDetector {
    pub fn new() -> Self {
        Self {
            history: Default::default(),
            streak: [0; 3],
            suppress: false,
        }
    }

    /// 清空基线与去抖状态。**换局、每轮强化推进后必须调用**，
    /// 否则上一轮三选一面板附近的画面会残留进基线。
    pub fn reset(&mut self) {
        self.history = Default::default();
        self.streak = [0; 3];
        self.suppress = false;
    }

    fn samples(&self, slot: usize) -> usize {
        self.history[slot][F_STDDEV].len()
    }

    /// 摄入一帧三带观测量并给出判定。
    pub fn observe(&mut self, feats: [BandFeatures; 3]) -> Detection {
        let ready = (0..3).all(|s| self.samples(s) >= BASELINE_MIN_SAMPLES);

        let mut bands = Vec::with_capacity(3);
        for (slot, feat) in feats.iter().enumerate() {
            let cur = [feat.stddev, feat.mean, feat.white];
            let mut baseline = [0.0f64; 3];
            let mut sigma = [0.0f64; 3];
            let mut score = 0.0f64;

            if ready {
                for f in 0..3 {
                    let mut sorted: Vec<f64> = self.history[slot][f].iter().copied().collect();
                    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    let med = median(&sorted);
                    let mut dev: Vec<f64> = sorted.iter().map(|v| (v - med).abs()).collect();
                    dev.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    // 1.4826 把 MAD 换算成正态分布下的标准差估计
                    let mad = median(&dev) * 1.4826;
                    baseline[f] = med;
                    sigma[f] = mad.max(FEATURE_MIN_SIGMA[f]);

                    let delta = cur[f] - med;
                    if delta.is_finite() && delta >= FEATURE_MIN_DELTA[f] {
                        let z = delta / sigma[f];
                        if z.is_finite() {
                            score = score.max(z);
                        }
                    }
                }
            }

            let active = ready && score >= SCORE_MIN;
            if active {
                self.streak[slot] = self.streak[slot].saturating_add(1);
            } else {
                self.streak[slot] = 0;
            }

            bands.push(BandVerdict {
                slot: slot as u8,
                features: *feat,
                baseline,
                sigma,
                score,
                active,
                streak: self.streak[slot],
            });
        }

        let present = ready
            && bands.iter().filter(|b| b.active).count() >= REQUIRED_SLOTS
            && bands.iter().all(|b| b.streak >= CONFIRM_FRAMES);

        // 面板在场期间冻结基线，避免把卡片画面学成「正常画面」
        if present {
            self.suppress = true;
        }
        if !self.suppress {
            for (slot, feat) in feats.iter().enumerate() {
                // 判为激活的帧不入基线，否则面板画面会被学成「正常画面」
                if bands[slot].active {
                    continue;
                }
                for (f, v) in [
                    (F_STDDEV, feat.stddev),
                    (F_MEAN, feat.mean),
                    (F_WHITE, feat.white),
                ] {
                    let q = &mut self.history[slot][f];
                    if q.len() >= BASELINE_WINDOW {
                        q.pop_front();
                    }
                    q.push_back(v);
                }
            }
        }

        Detection {
            bands,
            present,
            ready,
        }
    }
}

fn median(sorted: &[f64]) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let n = sorted.len();
    if n % 2 == 1 {
        sorted[n / 2]
    } else {
        (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
    }
}

// ---------------------------------------------------------------------------
// 进程内共享单例
// ---------------------------------------------------------------------------

static DETECTOR: LazyLock<Mutex<PanelDetector>> =
    LazyLock::new(|| Mutex::new(PanelDetector::new()));

fn lock() -> MutexGuard<'static, PanelDetector> {
    DETECTOR.lock().unwrap_or_else(|e| e.into_inner())
}

/// 对共享检测器喂一帧并取判定。
pub fn observe_shared(feats: [BandFeatures; 3]) -> Detection {
    let det = lock().observe(feats);
    record(&det);
    det
}

/// 重置共享检测器（换局 / 每轮强化推进）。
pub fn reset_shared() {
    lock().reset();
}

// ---------------------------------------------------------------------------
// 标定记录：每帧一行 JSONL
// ---------------------------------------------------------------------------

/// 诊断文件相对路径（位于 [`crate::paths::cache_dir`] 下）。
pub const RECORD_FILE: &str = "band-detect.jsonl";

/// 诊断文件大小上限，超过后停止追加（避免长局把磁盘写满）。
const RECORD_MAX_BYTES: u64 = 6 * 1024 * 1024;

/// 把一帧判定追加进标定文件。写失败只告警，绝不影响检测主流程。
pub fn record(det: &Detection) {
    let dir = crate::paths::cache_dir("rank-analysis-mayhem");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(RECORD_FILE);
    // 达到上限就不再写
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() >= RECORD_MAX_BYTES {
            return;
        }
    }
    let Ok(line) = serde_json::to_string(det) else {
        return;
    };
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        if writeln!(f, "{line}").is_err() {
            log::warn!("[mayhem] 标定记录写入失败");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feat(stddev: f64, mean: f64, white: f64) -> BandFeatures {
        BandFeatures {
            stddev,
            mean,
            white,
        }
    }

    /// 平稳的游戏场景帧（负类）：围绕中心小幅抖动。
    fn scene(i: u32) -> [BandFeatures; 3] {
        let j = ((i * 37) % 11) as f64 - 5.0;
        [
            feat(80.0 + j, 190.0 + j, 0.010 + j / 1000.0),
            feat(60.0 + j, 200.0 + j, 0.012 + j / 1000.0),
            feat(50.0 + j, 210.0 + j, 0.008 + j / 1000.0),
        ]
    }

    /// 三选一面板帧（正类）：三带同时跃升，近白占比大幅上升。
    fn panel() -> [BandFeatures; 3] {
        [
            feat(96.0, 232.0, 0.145),
            feat(94.0, 235.0, 0.151),
            feat(93.0, 233.0, 0.139),
        ]
    }

    #[test]
    fn baseline_is_not_ready_before_min_samples() {
        let mut d = PanelDetector::new();
        // 用 u32 显式收窄：BASELINE_MIN_SAMPLES 是 usize 常量，会把 i 推成 usize
        for i in 0..(BASELINE_MIN_SAMPLES as u32 - 1) {
            let det = d.observe(scene(i));
            assert!(!det.ready, "第 {i} 帧基线不该成熟");
            assert!(!det.present);
            assert!(det.bands.iter().all(|b| !b.active));
        }
        let det = d.observe(scene(99));
        assert!(det.ready);
        assert!(!det.present);
    }

    #[test]
    fn steady_gameplay_scene_is_never_reported_as_panel() {
        // 这是旧固定阈值口径的致命误报场景：stddev 高达 80，却不该判为卡片
        let mut d = PanelDetector::new();
        for i in 0..40 {
            let det = d.observe(scene(i));
            assert!(!det.present, "第 {i} 帧误报：{det:?}");
        }
    }

    #[test]
    fn panel_is_confirmed_after_consecutive_frames() {
        let mut d = PanelDetector::new();
        for i in 0..20 {
            d.observe(scene(i));
        }
        let first = d.observe(panel());
        assert!(!first.present, "单帧不应确认，应等去抖");
        let second = d.observe(panel());
        assert!(second.present, "连续两帧应确认：{second:?}");
        assert_eq!(second.active_slots(), REQUIRED_SLOTS);
    }

    #[test]
    fn single_slot_jump_is_not_enough() {
        let mut d = PanelDetector::new();
        for i in 0..20 {
            d.observe(scene(i));
        }
        // 只有中间一张卡跃升（路过的特效）
        let f = [scene(30)[0], panel()[1], scene(30)[2]];
        for _ in 0..4 {
            let det = d.observe(f);
            assert!(!det.present, "单卡跃升不应确认面板：{det:?}");
        }
    }

    #[test]
    fn panel_frames_do_not_pollute_baseline() {
        let mut d = PanelDetector::new();
        for i in 0..20 {
            d.observe(scene(i));
        }
        let base_before = d.observe(scene(21)).bands[0].baseline[F_STDDEV];
        d.observe(panel());
        d.observe(panel());
        // 面板在场后回到场景，基线应仍接近原场景水平
        let after = d.observe(scene(22));
        let base_after = after.bands[0].baseline[F_STDDEV];
        assert!(
            (base_after - base_before).abs() < 6.0,
            "基线被面板污染：{base_before} → {base_after}"
        );
    }

    #[test]
    fn reset_clears_baseline_and_streak() {
        let mut d = PanelDetector::new();
        for i in 0..20 {
            d.observe(scene(i));
        }
        d.observe(panel());
        d.reset();
        let det = d.observe(panel());
        assert!(!det.ready, "reset 后基线应重新积累");
        assert!(!det.present);
    }

    #[test]
    fn flat_scene_does_not_explode_into_false_positive() {
        // sigma 趋 0 的病态场景：绝对跃升下限必须兜住
        let mut d = PanelDetector::new();
        for _ in 0..20 {
            d.observe([feat(50.0, 180.0, 0.01); 3]);
        }
        let det = d.observe([feat(52.0, 183.0, 0.012); 3]);
        assert!(!det.present, "{det:?}");
    }

    #[test]
    fn median_handles_even_and_odd_lengths() {
        assert_eq!(median(&[1.0, 3.0]), 2.0);
        assert_eq!(median(&[1.0, 2.0, 9.0]), 2.0);
        assert_eq!(median(&[]), 0.0);
    }
}
