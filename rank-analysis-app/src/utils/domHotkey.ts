/**
 * 全局快捷键的可编辑目标让路判定（debug5-8）。
 *
 * @module utils/domHotkey
 */

/**
 * 事件目标是否为可编辑元素，全局快捷键应让路（不拦截、不 preventDefault）。
 *
 * 口径比文档的 input/textarea 更宽：
 * - select：n-select 等下拉的展开项同样吃方向键
 * - contenteditable 富文本
 * - isComposing：中文输入法组词中（与 CommandPalette 同口径，debug3-C1）
 *
 * @param e - 键盘事件
 * @returns 可编辑目标（应让路）返回 true
 */
export function shouldYieldToEditableTarget(e: KeyboardEvent): boolean {
  if (e.isComposing || e.key === 'Process') return true
  const t = e.target as HTMLElement | null
  if (!t) return false
  if (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement
  )
    return true
  if (t.isContentEditable) return true
  // jsdom 对未挂载节点的 isContentEditable 恒 false，且焦点可能落在可编辑区
  // 的内层子元素上：用 closest 兜底（`contenteditable="false"` 飞地不算可编辑）
  const root = typeof t.closest === 'function' ? t.closest('[contenteditable]') : null
  if (root instanceof HTMLElement && root.getAttribute('contenteditable') !== 'false') return true
  return false
}
