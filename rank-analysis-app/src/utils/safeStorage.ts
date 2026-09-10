/**
 * localStorage 安全写入，把配额/序列化异常归一为可判定的结果码。
 *
 * 裸 `localStorage.setItem` 在 Webview 存储写满（QuotaExceededError）或隐私
 * 模式下会抛异常——若调用方把异常吞掉，用户会以为已保存、实则未落盘。本模块
 * 提供 `safeSetItem` / `safeSetJson`：失败时返回结果码而非静默，调用方据此
 * 提示用户，且保留内存值（当前会话不丢数据）。
 */

export type SetStorageResult = 'written' | 'quota' | 'error'

/**
 * QuotaExceededError 判定。旧版 Webview 可能不抛标准 DOMException 或只带
 * `code === 22`，同时对 `name` / `code` 做防御性检查。
 */
export function isQuotaExceeded(err: unknown): boolean {
  const e = err as { name?: unknown; code?: unknown } | null
  return e?.name === 'QuotaExceededError' || e?.code === 22
}

/** 写入原始字符串；失败返回 'quota' | 'error'，调用方负责提示用户 */
export function safeSetItem(key: string, value: string): SetStorageResult {
  try {
    localStorage.setItem(key, value)
    return 'written'
  } catch (err) {
    return isQuotaExceeded(err) ? 'quota' : 'error'
  }
}

/** JSON 序列化后写入：stringify 异常（循环引用等）也归一为 'error' */
export function safeSetJson(key: string, value: unknown): SetStorageResult {
  let text: string
  try {
    text = JSON.stringify(value)
  } catch {
    return 'error'
  }
  return safeSetItem(key, text)
}

/** 删除键（读/删失败无可归因，静默即可） */
export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* 隐私模式等场景下删除失败无副作用 */
  }
}
