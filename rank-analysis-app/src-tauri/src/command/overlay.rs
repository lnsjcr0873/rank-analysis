//! # Overlay 窗口命令（4b overlay POC）
//!
//! 暴露给前端的 overlay 控制命令。

use crate::live::NextAction;
use tauri::Emitter;

/// 显示 overlay 窗口（对局中由前端 Gaming.vue 调用）。
///
/// 创建/显示透明置顶 overlay 窗口，设置鼠标穿透。
/// 场景：phase 转 InProgress 时调用。
/// 必须使用异步命令：Windows 上在同步 IPC 命令内创建 WebView 会与主线程
/// 互相等待，导致页面资源加载、后续 IPC 和窗口关闭一起失去响应。
#[tauri::command]
pub async fn show_overlay_window(app: tauri::AppHandle) -> Result<(), String> {
    crate::overlay::show(&app);
    Ok(())
}

/// 隐藏 overlay 窗口（对局结束由前端调用）。
///
/// 场景：phase 离开 InProgress 时调用。
#[tauri::command]
pub fn hide_overlay_window() -> Result<(), String> {
    crate::overlay::hide();
    Ok(())
}

/// 强制彻底关闭与销毁所有残留 overlay 浮窗并释放焦点。
#[tauri::command]
pub fn force_close_overlay() -> Result<(), String> {
    crate::overlay::force_hide();
    Ok(())
}

/// 获取当前激活的 Overlay 状态快照（供前端窗口挂载时即时同步）
#[tauri::command]
pub fn get_overlay_state() -> serde_json::Value {
    crate::overlay::get_overlay_state()
}

/// 向 overlay 窗口推送 NextAction 建议数据。
///
/// 主窗口（Gaming.vue）轮询 `get_next_actions`（前端 30s 节流），结果通过此命令
/// 经 `overlay:update` 事件送达 overlay 窗口。定向 [`Emitter::emit_to`] 只发给
/// overlay：全局广播会把同一份数据冗余投递给主窗与全部 record-* 子窗口。
#[tauri::command]
pub fn push_overlay_data(app: tauri::AppHandle, actions: Vec<NextAction>) -> Result<(), String> {
    crate::overlay::set_current_actions(actions.clone());
    if let Err(e) = app.emit_to("overlay", "overlay:update", &actions) {
        log::warn!("overlay 数据推送通知: {e}");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// B1 多面板框架
// ---------------------------------------------------------------------------

/// 向指定 overlay 面板推送任意负载（B1 面板信封）。
///
/// 与 [`push_overlay_data`] 的区别：事件为 `overlay:panel`，payload 为
/// `{ panel, payload }` 信封——overlay 端按 `panel` 分发到注册的渲染组件，
/// 主窗侧无需关心 overlay 内部结构。
#[tauri::command]
pub fn push_overlay_panel(
    app: tauri::AppHandle,
    panel: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    let envelope = serde_json::json!({ "panel": panel, "payload": payload });
    // 广播带时间戳的最终信封：与缓存落盘同一对象，Overlay 端本地 TTL
    // 与后端快照 TTL 按同一时钟过期（此前广播的是无时间戳版本）。
    let envelope = crate::overlay::set_current_panel(envelope);
    if let Err(e) = app.emit_to("overlay", "overlay:panel", &envelope) {
        log::warn!("overlay 面板推送通知: {e}");
    }
    Ok(())
}

/// 清空当前面板信封并通知 overlay 端移除残留面板。
///
/// 三选一选卡完成后前端调度器调用：旧推荐不再有效，立即清掉而不是等
/// 30s TTL。overlay 窗口挂载时的快照同步也会拿到 null，不显示僵尸推荐。
#[tauri::command]
pub fn clear_overlay_panel(app: tauri::AppHandle) -> Result<(), String> {
    crate::overlay::clear_current_panel();
    if let Err(e) = app.emit_to("overlay", "overlay:panel", &serde_json::json!(null)) {
        log::warn!("overlay 面板清空通知: {e}");
    }
    Ok(())
}

/// 调整 overlay 尺寸与锚点（`top-left` / `top-center` / `top-right`）。
#[tauri::command]
pub fn set_overlay_layout(
    app: tauri::AppHandle,
    width: f64,
    height: f64,
    anchor: String,
) -> Result<(), String> {
    crate::overlay::layout(&app, width, height, &anchor);
    Ok(())
}

/// 切换鼠标穿透（true=穿透；手动校正面板交互时传 false）。
#[tauri::command]
pub fn set_overlay_click_through(enabled: bool) -> Result<(), String> {
    crate::overlay::set_click_through(enabled)
}

/// 显示/隐藏浮窗（全局热键 Alt+A 后端入口）。返回切换后的可见状态。
/// 窗口不存在时会创建 WebView，与 show_overlay_window 一样必须离开同步 IPC 线程。
#[tauri::command]
pub async fn overlay_toggle(app: tauri::AppHandle) -> Result<bool, String> {
    crate::overlay::toggle(&app)
}
