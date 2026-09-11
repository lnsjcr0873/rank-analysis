//! # 对局内 Overlay 窗口管理（4b overlay POC）
//!
//! 管理透明置顶 overlay 窗口的完整生命周期——创建、显示、隐藏、销毁。
//! 窗口属性：`transparent` / `decorations=false` / `always_on_top` / `focusable=false` /
//! `skip_taskbar` / 鼠标穿透 / 右上角定位。
//!
//! ## 窗口位置
//!
//! 固定在主显示器右上角（评估文档 §3.1：320×200，边距 16px）。
//! 后续可配置化为左上/右下/左下（评估文档 §5.2）。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex, OnceLock};

use tauri::Manager;
use tauri::Position;
use tauri::WebviewUrl;
use tauri::WebviewWindowBuilder;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// 标记 overlay 窗口是否已创建。
static OVERLAY_CREATED: LazyLock<AtomicBool> = LazyLock::new(|| AtomicBool::new(false));

/// 全局 AppHandle（创建窗口时写入一次，供后续通过标签查找窗口句柄）。
///
/// 使用 `OnceLock` 保证写入安全：`create()` 是唯一写入点，写入后永不变更；
/// 读取方无需持锁，消除了 `std::sync::Mutex` 在异步上下文中被跨 await 持有
/// 导致死锁的隐患。
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// 当前生效的浮窗锚点（默认右上，支持 top-left / top-center / top-right）。
///
/// **注意**：以下 `Mutex` 均为 `std::sync::Mutex`（非 tokio），在异步命令中被
/// 同步调用时**必须保证锁持有期间不含任何 `.await`**——否则会阻塞 tokio worker
/// 线程导致事件循环死锁。当前所有锁均在单次同步操作内完成读写后立即释放，
/// 如未来需要跨 await 请迁移为 `tokio::sync::Mutex`。
static CURRENT_ANCHOR: LazyLock<Mutex<String>> =
    LazyLock::new(|| Mutex::new("top-right".to_string()));

/// 缓存当前激活的面板信封（供 Overlay 窗口加载完毕时即时拉取）
static CURRENT_PANEL_ENVELOPE: LazyLock<Mutex<Option<serde_json::Value>>> =
    LazyLock::new(|| Mutex::new(None));

/// 缓存当前的 NextAction 列表
static CURRENT_ACTIONS: LazyLock<Mutex<Vec<crate::live::NextAction>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

/// 记录当前窗口尺寸
static CURRENT_WIDTH: LazyLock<Mutex<f64>> = LazyLock::new(|| Mutex::new(OVERLAY_WIDTH));
static CURRENT_HEIGHT: LazyLock<Mutex<f64>> = LazyLock::new(|| Mutex::new(OVERLAY_HEIGHT));

/// Overlay 窗口固定尺寸（评估文档 §3.1）。
const OVERLAY_WIDTH: f64 = 320.0;
const OVERLAY_HEIGHT: f64 = 200.0;
/// 窗口与屏幕边缘的间距。
const OVERLAY_MARGIN: f64 = 16.0;

/// 设置当前激活的面板信封
pub fn set_current_panel(envelope: serde_json::Value) {
    *CURRENT_PANEL_ENVELOPE
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(envelope);
}

/// 设置当前的 NextAction 建议数据
pub fn set_current_actions(actions: Vec<crate::live::NextAction>) {
    *CURRENT_ACTIONS.lock().unwrap_or_else(|e| e.into_inner()) = actions;
}

/// 获取当前所有激活的 Overlay 状态快照
pub fn get_overlay_state() -> serde_json::Value {
    let panel = CURRENT_PANEL_ENVELOPE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let actions = CURRENT_ACTIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    serde_json::json!({
        "panel": panel,
        "actions": actions
    })
}

/// 创建 overlay 窗口（只建一次，幂等）。
///
/// 窗口初始不可见（`visible(false)`），由 [`show`] 在对局中激活。
/// 创建失败不 panic——降级为主窗口内 Tab 展示（当前 M5a/M5b 行为）。
fn create(app: &tauri::AppHandle) -> Result<(), String> {
    let width = *CURRENT_WIDTH.lock().unwrap_or_else(|e| e.into_inner());
    let height = *CURRENT_HEIGHT.lock().unwrap_or_else(|e| e.into_inner());
    let builder = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay.html".into()))
        .title("")
        .inner_size(width, height)
        .decorations(false)
        .always_on_top(true)
        .focusable(false)
        .resizable(false)
        .shadow(false)
        .skip_taskbar(true)
        .visible(false);
    // tauri 的 WebviewWindowBuilder#transparent 在 macOS 上不存在（webview 透明
    // 走 window effects 通道）；overlay 主战场是 Windows 国服，macOS 分支不设透明，
    // 由 CSS 透明背景兜底。
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);
    let w = builder
        .build()
        .map_err(|e| format!("overlay 窗口创建失败: {e}"))?;

    let _ = w.set_ignore_cursor_events(true);
    log::info!("[overlay] 窗口创建完成（置顶/无边框/透明/鼠标穿透）");

    let _ = APP_HANDLE.set(app.clone());
    OVERLAY_CREATED.store(true, Ordering::Relaxed);
    Ok(())
}

/// 通过标签查找已创建的 overlay 窗口句柄。
fn get_window() -> Option<tauri::WebviewWindow> {
    APP_HANDLE.get()?.get_webview_window("overlay")
}

/// 显示 overlay 窗口（对局中调用）。
///
/// 以 [`get_window`] 的**真实存活**为准决定是否创建：`OVERLAY_CREATED` 只是
/// 缓存标志，窗口被外部销毁后它仍为 true，若只信标志将永远不再重建。
/// 并发首次 show 时后到者会因 label 冲突创建失败并告警返回——先到者已完成
/// 显示与定位，无实际影响。
pub fn show(app: &tauri::AppHandle) {
    let width = *CURRENT_WIDTH.lock().unwrap_or_else(|e| e.into_inner());
    let height = *CURRENT_HEIGHT.lock().unwrap_or_else(|e| e.into_inner());
    if get_window().is_none() {
        if OVERLAY_CREATED.load(Ordering::Relaxed) {
            log::info!("[overlay] 标志为已创建但窗口不存在，重建...");
        }
        if let Err(e) = create(app) {
            log::warn!("[overlay] 创建失败: {e}");
            return;
        }
    }
    if let Some(w) = get_window() {
        let _ = w.set_size(tauri::LogicalSize::new(width, height));
        let _ = w.set_ignore_cursor_events(true);
        let _ = w.show();
        // 鼠标穿透：对局内悬浮建议不应拦截玩家对游戏窗口的操作
        let _ = w.set_ignore_cursor_events(true);
    }
    let anchor = CURRENT_ANCHOR
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    position_by_anchor(app, width, &anchor);
}

/// 隐藏 overlay 窗口（对局结束调用）。
pub fn hide() {
    if let Some(w) = get_window() {
        let _ = w.set_ignore_cursor_events(true);
        let _ = w.hide();
    }
}

/// 强制销毁/隐藏 overlay 浮窗并确保完全释放鼠标捕获。
pub fn force_hide() {
    hide();
}

/// 调整 overlay 窗口尺寸并定位到指定锚点。
///
/// B1 多面板：三选一卡组等面板比原 NextAction 卡大，且需要贴屏幕顶部的
/// 左中右位置。尺寸钳制在合理范围防止把游戏窗口整个盖住。
///
/// # 参数
/// - `anchor`: `"top-left"` | `"top-center"` | `"top-right"`（未知值回退右上）
pub fn layout(app: &tauri::AppHandle, width: f64, height: f64, anchor: &str) {
    *CURRENT_ANCHOR.lock().unwrap_or_else(|e| e.into_inner()) = anchor.to_string();
    let width = width.clamp(200.0, 900.0);
    let height = height.clamp(80.0, 500.0);
    *CURRENT_WIDTH.lock().unwrap_or_else(|e| e.into_inner()) = width;
    *CURRENT_HEIGHT.lock().unwrap_or_else(|e| e.into_inner()) = height;
    if let Some(w) = get_window() {
        let _ = w.set_size(tauri::LogicalSize::new(width, height));
    }
    position_by_anchor(app, width, anchor);
}

/// 按锚点将窗口贴**浮窗所在显示器**顶部（带边距）。
///
/// 双屏场景游戏常跑在副屏：固定取主显示器会把浮窗画到玩家看不到的屏上。
/// 优先 `current_monitor`（浮窗当前所在屏，Tauri 已按逻辑坐标换算，
/// 无混合 DPI 二次缩放的歧义），拿不到时回退主显示器。
fn position_by_anchor(app: &tauri::AppHandle, width: f64, anchor: &str) {
    let Some(w) = get_window() else {
        return;
    };
    let monitor = w
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        log::warn!("[overlay] 无法获取显示器，窗口保持默认位置");
        return;
    };
    let scale_factor = monitor.scale_factor();
    let logical_screen_w = monitor.size().width as f64 / scale_factor;
    let x = match anchor {
        "top-left" => OVERLAY_MARGIN,
        "top-center" => (logical_screen_w - width) / 2.0,
        // 默认右上（历史行为）
        _ => logical_screen_w - width - OVERLAY_MARGIN,
    };
    let y = match anchor {
        "top-right" => 64.0, // 避开顶栏窗控按钮区域（最小化/最大化/关闭）
        _ => OVERLAY_MARGIN,
    };
    let _ = w.set_position(Position::Logical(tauri::LogicalPosition::new(x, y)));
}

/// 切换鼠标穿透。
///
/// 三选一识别失败时的手动校正面板需要接收点击，其余时间保持穿透，
/// 避免悬浮窗挡住游戏操作。
pub fn set_click_through(enabled: bool) -> Result<(), String> {
    let Some(w) = get_window() else {
        return Err("overlay 窗口不存在".to_string());
    };
    w.set_ignore_cursor_events(enabled)
        .map_err(|e| e.to_string())
}

/// 切换 overlay 显示/隐藏（全局热键 Alt+A 的后端实现）。
///
/// 返回切换后的可见状态。窗口不存在时先创建再显示（与 [`show`] 同语义）。
pub fn toggle(app: &tauri::AppHandle) -> Result<bool, String> {
    match get_window() {
        Some(w) => {
            let visible = w.is_visible().unwrap_or(false);
            if visible {
                hide();
                Ok(false)
            } else {
                show(app);
                Ok(true)
            }
        }
        None => {
            show(app);
            Ok(true)
        }
    }
}

/// 销毁 overlay 窗口（进程退出时清理）。
pub fn destroy() {
    if let Some(w) = get_window() {
        let _ = w.close();
        log::info!("[overlay] 窗口已销毁");
    }
    OVERLAY_CREATED.store(false, Ordering::Relaxed);
    // APP_HANDLE 是 OnceLock（写入一次即生效）：进程退出时无需清空句柄，
    // 复用也无副作用；此处不再调用不存在的 `take()`。
}

/// 注销全部系统级全局热键（进程退出/主窗关闭时调用）。
///
/// OS 进程退出时一般会自动回收热键，但退出钩子若被长驻任务卡住，
/// 热键会在“退出中”窗口期继续劫持 Alt+A；显式注销消掉该窗口期。
/// hide/show 常态切换不走这里——热键正是用来唤回隐藏浮窗的，
/// 跟随窗口隐藏注销会导致下一局热键永久失效。
pub fn unregister_hotkeys(app: &tauri::AppHandle) {
    match app.global_shortcut().unregister_all() {
        Ok(()) => log::info!("[overlay] 全局热键已全部注销"),
        Err(e) => log::warn!("[overlay] 注销全局热键失败（可忽略）: {e}"),
    }
}
