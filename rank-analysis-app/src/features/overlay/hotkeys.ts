/**
 * 全局热键（B1）：Alt+A 开关对局浮窗。
 *
 * 通过 tauri-plugin-global-shortcut 注册系统级快捷键——游戏窗口持有焦点时
 * 依然可触发。注册失败（权限/冲突）不静默吞掉：由调用方决定是否提示。
 */
import { isRegistered, register, unregister } from '@tauri-apps/plugin-global-shortcut'
import { invoke } from '@tauri-apps/api/core'
import { isWindows } from '@renderer/services/platform'

export const DEFAULT_OVERLAY_HOTKEY = 'Alt+A'
export const OVERLAY_HOTKEY = DEFAULT_OVERLAY_HOTKEY

let currentRegisteredHotkey: string | null = null

/** 幂等应用热键配置；重复调用先解绑再按需绑定。 */
export async function applyOverlayHotkey(enabled: boolean, customHotkey?: string): Promise<void> {
  // overlay 主战场是 Windows 国服（透明置顶/屏幕穿透均为 Windows 专属行为）。
  // macOS/Linux 下不注册系统级热键，优雅降级为无操作，避免 unregistered/低层
  // 窗口 API 静默异常。
  if (!isWindows()) return

  const target = (customHotkey && customHotkey.trim()) || OVERLAY_HOTKEY

  if (currentRegisteredHotkey) {
    await unregister(currentRegisteredHotkey).catch(() => {})
  }
  const active = await isRegistered(target).catch(() => false)
  if (active) {
    await unregister(target).catch(() => {})
  }
  if (!enabled) {
    currentRegisteredHotkey = null
    return
  }
  // toggle 的可见性判定在 Rust 侧（窗口 is_visible），前端无需跟踪状态
  await register(target, () => {
    void invoke('overlay_toggle').catch(err => console.warn('overlay_toggle failed:', err))
  })
  currentRegisteredHotkey = target
}

/**
 * 显式注销当前管理的热键（幂等）。
 *
 * 注意：仅在"用户彻底不想被劫持按键"的极端场景调用。overlay 的 hide/show
 * 常态切换不走这里——热键正是用来唤回隐藏浮窗的，跟随隐藏注销会导致
 * 下一局热键永久失效（show 侧不会重注册）。进程退出由 Rust 侧
 * `overlay::unregister_hotkeys` 兜底。
 */
export async function unregisterOverlayHotkey(): Promise<void> {
  const keys = [currentRegisteredHotkey, OVERLAY_HOTKEY].filter(
    (k): k is string => typeof k === 'string' && k.length > 0
  )
  for (const key of new Set(keys)) {
    const active = await isRegistered(key).catch(() => false)
    if (active) {
      await unregister(key).catch(() => {})
    }
  }
  currentRegisteredHotkey = null
}
