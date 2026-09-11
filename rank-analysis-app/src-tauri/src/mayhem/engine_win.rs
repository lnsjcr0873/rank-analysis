//! # Windows.Media.Ocr 引擎实现（A3.2，`ocr-win` feature 门控）
//!
//! 仅在 `--features ocr-win` 且 Windows 目标下编译。链路：
//! RGBA bytes → DataWriter/DetachBuffer → IBuffer → SoftwareBitmap(Bgra8)
//! → OcrEngine::TryCreateFromUserProfileLanguages → RecognizeAsync → 行文本。
//!
//! ## 前提与限制
//!
//! - 系统需安装中文语言包（OCR 依赖 `TryCreateFromUserProfileLanguages`），
//!   失败时错误信息会明确提示
//! - `CreateCopyFromBuffer` 假定**预乘 alpha**：GDI 抓屏的 alpha 恒为 255
//!   （等效不透明），预乘语义下无影响，无需转换
//! - WinRT 工厂调用要求 MTA 套间：每次 OCR 执行用 [`ComGuard`] 做线程级 RAII
//!   初始化（debug5-2）。COM 套间是**线程级**状态，`std::sync::Once` 只保证
//!   首个线程初始化一次——`spawn_blocking` 随机调度到其他 worker 线程时
//!   就会抛 CO_E_NOTINITIALIZED（0x800401F0）。

use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

/// 线程级 COM MTA 守卫（debug5-2）。
///
/// 构造时 `CoInitializeEx(MTA)`，Drop 时配对 `CoUninitialize`。每次
/// `recognize_rgba_sync` 在当前 `spawn_blocking` 线程上持有一个，与线程池
/// 调度无关。HRESULT 显式吞掉：S_FALSE（已初始化）/ RPC_E_CHANGED_MODE
/// 均不致命，按现有套间继续（must_use 需绑定以消除告警）。
struct ComGuard;

impl ComGuard {
    fn enter() -> Self {
        unsafe {
            let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
            let _ = hr;
        }
        ComGuard
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

/// 同步 OCR 执行（在专有阻塞线程上运行，确保 !Send 的 WinRT COM 指针不跨越 .await 边界）。
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

    // 线程级 COM 初始化：当前 spawn_blocking 线程持有守卫，执行完配对清理。
    let _com = ComGuard::enter();

    let writer = DataWriter::new().map_err(|e| format!("DataWriter::new: {e}"))?;
    writer
        .WriteBytes(rgba)
        .map_err(|e| format!("WriteBytes: {e}"))?;
    let buffer = writer
        .DetachBuffer()
        .map_err(|e| format!("DetachBuffer: {e}"))?;
    drop(writer); // 显式关闭写入器；buffer 已独立持有数据

    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Rgba8, w, h)
        .map_err(|e| format!("CreateCopyFromBuffer: {e}"))?;

    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| format!("OCR 引擎不可用（请在系统设置安装中文语言包后重试）: {e}"))?;

    let operation = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| format!("RecognizeAsync: {e}"))?;
    let result = operation
        .join()
        .map_err(|e| format!("recognize join: {e}"))?;

    let mut lines = Vec::new();
    for line in result
        .Lines()
        .map_err(|e| format!("Lines: {e}"))?
        .into_iter()
    {
        let text = line
            .Text()
            .map_err(|e| format!("Line::Text: {e}"))?
            .to_string();
        if !text.trim().is_empty() {
            lines.push(text);
        }
    }
    Ok(lines)
}

/// 对一块 RGBA 像素缓冲做 OCR，返回识别出的行文本（自上而下）。
///
/// 通过 [`tokio::task::spawn_blocking`] 隔离 WinRT COM 对象的生命周期，
/// 保证返回的 Future 满足 `Send` 约束，可在 Tauri 命令中安全跨线程调度。
pub async fn recognize_rgba(rgba: &[u8], w: i32, h: i32) -> Result<Vec<String>, String> {
    let rgba_owned = rgba.to_vec();
    tokio::task::spawn_blocking(move || recognize_rgba_sync(&rgba_owned, w, h))
        .await
        .map_err(|e| format!("OCR 线程执行异常: {e}"))?
}

/// 兼容别名：转发至 [`recognize_rgba`]。
pub async fn recognize_bgra(rgba: &[u8], w: i32, h: i32) -> Result<Vec<String>, String> {
    recognize_rgba(rgba, w, h).await
}
