//! # 自带模型 RapidOCR 引擎（`ocr-rapid` feature 门控）
//!
//! Win10 LTSC 精简了 WinRT OCR 所需的中文语言包，`Windows.Media.Ocr` 在此类
//! 系统上不可用，故改走自带模型路线：RapidOCR PP-OCRv5 中文 mobile 的识别
//! （Rec）阶段，ONNX Runtime CPU 推理，不依赖任何系统语言包。
//!
//! 只用识别模型的原因：三选一标题带已经由 GDI 按固定几何裁好
//! （见 [`crate::mayhem::capture::slot_band_rects`]），整块小图即一行标题，
//! 不需要检测（Det）模型再找一次文本框。`recognition_only` 管线下整图视为
//! 单个识别 crop，直接出文本。
//!
//! 链路：RGBA bytes → RGB（去 alpha）→ `image::RgbImage` → RapidOcr(rec-only)
//! → 行文本。
//!
//! ## 并发与线程模型
//!
//! `RapidOcr` 的推理方法取 `&mut self`（ONNX session 非并发），因此用全局
//! `Mutex` 串行化；纯 CPU 推理无 COM 套间概念，可全局共享。
//! 推理在 `spawn_blocking` 里跑，不阻塞 Tokio worker。
//!
//! ## 体积拆解（回答“十几 MB 去哪了”）
//!
//! - `onnxruntime.dll` 约 10MB：编译期由 `ort-sys` 预编译库引入，随 exe
//!   打包，不在运行时下载；
//! - 识别模型 rec `.onnx` + 字典 `ppocrv5_dict.txt`：运行时按需下载，
//!   rec-only 下仅此两项，无检测/分类模型。
//!
//! ## 模型落盘与预热
//!
//! 模型不随包发布，由 `rapidocr-core` 的 `ModelCache` 下载到系统临时目录
//! （见 [`crate::paths::cache_dir`]），之后复用并做 sha256 校验。
//!
//! 下载必须发生在三选一弹出之前：[`prewarm`] 在大乱斗页挂载 / 监听启动时由
//! 前端经 `mayhem_ocr_prewarm` 命令后台触发；首轮 `assist_tick` 只做推理
//! 不再下载。`assist_tick` 内只用 `ModelDownloadMode::Never` 打开引擎——
//! 模型没下好时直接返回 `ocr-warming-up`，绝不在选卡瞬间下载阻塞。

use std::sync::Mutex;

use rapidocr_core::config::PipelineConfig;
use rapidocr_core::model::{ModelCache, ModelDownloadMode, PPOCRV5_CH_MOBILE};
use rapidocr_core::RapidOcr;

/// 模型缓存根目录：`<temp>/rank-analysis-ocr-models/ppocrv5-ch-mobile`。
fn model_dir() -> std::path::PathBuf {
    crate::paths::cache_dir("ocr-models").join(PPOCRV5_CH_MOBILE.name)
}

/// rec-only 管线：整图即单个识别 crop，不需要 det/cls 模型。
fn rec_only_pipeline() -> PipelineConfig {
    PipelineConfig::recognition_only()
}

/// 全局唯一的 OCR 管线（惰性初始化，失败可重试）。
///
/// 说明：不用 `OnceLock<Mutex<RapidOcr>>` 的 `get_or_try_init`——那是不稳定
/// API（`once_cell_try`），stable Rust 编不过。这里用 `Mutex<Option<_>>`
/// 手写可重试惰性初始化：建引擎失败（如网络拉不下来模型）后下次调用会
/// 重新尝试，而非永久卡在失败态。外层锁只保护初始化写入（推理持锁期间
/// 状态查询走 [`ENGINE_READY`]，不会被卡住）。
static ENGINE: Mutex<Option<Mutex<RapidOcr>>> = Mutex::new(None);

/// 引擎就绪标志：写入 [`ENGINE`] 成功后置位。查询走无锁原子读，
/// 避免在推理持锁期间被 `ENGINE` 外层锁挡住（`assist_tick` 快路径
/// 每次 tick 都要查就绪态）。
static ENGINE_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 推理串行信号量：`RapidOcr::run_image` 取 `&mut self`，三卡串行推理即可，
///
/// 但 `assist_tick` 的三卡是顺序 await，本来就不会并发——信号量防的是未来
/// 有人把三卡改成 `join!` 并发后在 `Mutex` 上排队进而占满 `spawn_blocking`
/// 线程池。`try_acquire` 拿不到就快速失败，不积压。
static INFER_PERMIT: std::sync::LazyLock<tokio::sync::Semaphore> =
    std::sync::LazyLock::new(|| tokio::sync::Semaphore::new(1));

/// 引擎是否已就绪（模型已下载 + session 已建）。无锁原子读。
pub fn is_ready() -> bool {
    use std::sync::atomic::Ordering;
    ENGINE_READY.load(Ordering::Relaxed)
}

/// 在阻塞线程上建引擎。`allow_download` 为 false 时只开箱不下载，
/// 用于 `assist_tick` 快路径；预热专用 [`prewarm_blocking`] 才允许下载。
///
/// 幂等且失败可重试：已就绪直接返回；model 下载 + session 构建在锁外进行
/// （耗时操作不被外层锁拖住），完成后一次性写入，并发竞态下后来者覆盖。
fn init_blocking(allow_download: bool) -> Result<(), String> {
    {
        let guard = ENGINE.lock().map_err(|e| format!("OCR 引擎锁异常: {e}"))?;
        if guard.is_some() {
            return Ok(());
        }
    }
    let cache = ModelCache::new(model_dir());
    let pipeline = rec_only_pipeline();
    let mode = if allow_download {
        ModelDownloadMode::Missing
    } else {
        ModelDownloadMode::Never
    };
    cache
        .ensure_model_set_for_pipeline(&PPOCRV5_CH_MOBILE, pipeline, mode)
        .map_err(|e| {
            if allow_download {
                format!("OCR 模型准备失败（请检查网络后重试，手动三选一可用）: {e:#}")
            } else {
                // tick 快路径：模型还没下好是正常中间态，前端据此显示“预热中”。
                format!("OCR 模型尚未就绪（预热中）: {e:#}")
            }
        })?;
    let mut cfg = cache.config_for(&PPOCRV5_CH_MOBILE);
    cfg = cfg.with_pipeline(pipeline);
    // rec-only 下 det/cls 配置不再需要，置空避免歧义。
    cfg.det = None;
    cfg.cls = None;
    // 对局机上只给 2 个算子线程，避免团战时抢游戏 CPU。
    cfg.inference.intra_threads = 2;
    cfg.inference.inter_threads = 1;
    let ocr = Mutex::new(RapidOcr::new(cfg).map_err(|e| format!("OCR 引擎初始化失败: {e:#}"))?);
    let mut guard = ENGINE.lock().map_err(|e| format!("OCR 引擎锁异常: {e}"))?;
    if guard.is_none() {
        *guard = Some(ocr);
        ENGINE_READY.store(true, std::sync::atomic::Ordering::Release);
    }
    Ok(())
}

/// 后台预热：在阻塞线程下载模型 + 建 session。幂等，已就绪直接返回。
fn prewarm_blocking() -> Result<(), String> {
    init_blocking(true)
}

/// 后台预热（async 入口）：下载模型 + 建 session，阻塞部分走 `spawn_blocking`。
///
/// 由 `mayhem_ocr_prewarm` 命令调用，前端在大乱斗页挂载 / 监听启动时触发，
/// 绝不在 `assist_tick` 里触发。
pub async fn prewarm() -> Result<(), String> {
    tokio::task::spawn_blocking(prewarm_blocking)
        .await
        .map_err(|e| format!("OCR 预热任务异常: {e}"))?
}

/// 同步 OCR 执行（在阻塞线程上运行；`RapidOcr::run_image` 取 `&mut self`）。
///
/// 注意：此处绝不下载模型。模型未就绪时直接返回中文错误，调用方
/// （`assist_tick`）据此返回 `ocr-warming-up`，不等下载。
fn recognize_rgba_sync(rgba: &[u8], w: i32, h: i32) -> Result<Vec<String>, String> {
    if w <= 0 || h <= 0 {
        return Err("invalid bitmap size".into());
    }
    let expected = (w as usize) * (h as usize) * 4;
    if rgba.len() != expected {
        return Err(format!(
            "pixel buffer size mismatch: {} != {}",
            rgba.len(),
            expected
        ));
    }

    // RGBA → RGB（去 alpha 通道）。
    let mut rgb = Vec::with_capacity((w as usize) * (h as usize) * 3);
    for px in rgba.chunks_exact(4) {
        rgb.extend_from_slice(&px[..3]);
    }
    let img = image::RgbImage::from_raw(w as u32, h as u32, rgb)
        .ok_or_else(|| "failed to build RGB image".to_string())?;

    // 快路径：Never 模式，模型没下好就快速失败，不下载。
    init_blocking(false)?;
    let outer = ENGINE.lock().map_err(|e| format!("OCR 引擎锁异常: {e}"))?;
    let ocr = outer
        .as_ref()
        .ok_or_else(|| "OCR 引擎未初始化".to_string())?;
    let mut ocr_guard = ocr.lock().map_err(|e| format!("OCR 推理锁异常: {e}"))?;
    let out = ocr_guard
        .run_image(&img)
        .map_err(|e| format!("OCR 推理失败: {e:#}"))?;
    Ok(out
        .lines
        .into_iter()
        .map(|l| l.text)
        .filter(|t| !t.trim().is_empty())
        .collect())
}

/// 单卡 OCR 推理超时：rec-only 下小图识别通常 < 1s，超时说明模型卡住或
/// 机器过载——直接按该槽失败处理，不拖住整轮三选一（其余两卡照常打分）。
const RECOGNIZE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

/// 对一块 RGBA 像素缓冲做 OCR，返回识别出的行文本（阅读顺序）。
///
/// 通过 [`tokio::task::spawn_blocking`] 隔离阻塞推理，保证返回的 Future
/// 满足 `Send` 约束，可在 Tauri 命令中安全跨线程调度。推理包一层超时：
/// 超时按单槽失败返回，调用方保留空槽（绝不用他卡结果顶替）。
pub async fn recognize_rgba(rgba: &[u8], w: i32, h: i32) -> Result<Vec<String>, String> {
    // 串行许可：拿不到说明有别的推理在跑，直接按该槽失败返回，
    // 不在 spawn_blocking 队列里积压（burst 期 350ms 一轮，积压会雪崩）。
    let _permit = INFER_PERMIT
        .try_acquire()
        .map_err(|_| "OCR 引擎忙（该卡位按未识别处理）".to_string())?;
    let rgba_owned = rgba.to_vec();
    let task = tokio::task::spawn_blocking(move || recognize_rgba_sync(&rgba_owned, w, h));
    match tokio::time::timeout(RECOGNIZE_TIMEOUT, task).await {
        Ok(join) => join.map_err(|e| format!("OCR 线程执行异常: {e}"))?,
        Err(_) => Err("OCR 推理超时（该卡位按未识别处理）".to_string()),
    }
}

/// 兼容别名：转发至 [`recognize_rgba`]。
pub async fn recognize_bgra(rgba: &[u8], w: i32, h: i32) -> Result<Vec<String>, String> {
    recognize_rgba(rgba, w, h).await
}
