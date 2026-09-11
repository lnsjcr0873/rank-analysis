/**
 * shouldYieldToEditableTarget 单元测试（debug5-8）
 *
 * - input/textarea/select/contenteditable 一律让路（方向键留给光标/选项）
 * - 输入法组词中（isComposing / key === 'Process'）让路
 * - 普通 div/button 不让路（全局快捷键照常生效）
 */
import { describe, it, expect } from 'vitest'
import { shouldYieldToEditableTarget } from '../domHotkey'

function keyOn(target: HTMLElement | null, extra: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, ...extra })
  // jsdom 的 KeyboardEvent 构造器不接受 target：挂到只读属性上
  Object.defineProperty(e, 'target', { value: target })
  return e
}

describe('shouldYieldToEditableTarget', () => {
  it('input/textarea/select 让路', () => {
    expect(shouldYieldToEditableTarget(keyOn(document.createElement('input')))).toBe(true)
    expect(shouldYieldToEditableTarget(keyOn(document.createElement('textarea')))).toBe(true)
    expect(shouldYieldToEditableTarget(keyOn(document.createElement('select')))).toBe(true)
  })

  it('contenteditable 让路（含内层子元素）', () => {
    // 注：jsdom 的 contentEditable 属性赋值不同步 attribute，这里用 setAttribute
    //（真实浏览器两者等价；实现侧同时查 isContentEditable + closest 双保险）
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    expect(shouldYieldToEditableTarget(keyOn(div))).toBe(true)
    const inner = document.createElement('span')
    div.appendChild(inner)
    expect(shouldYieldToEditableTarget(keyOn(inner))).toBe(true)
  })

  it('contenteditable="false" 飞地不让路', () => {
    const outer = document.createElement('div')
    outer.setAttribute('contenteditable', 'true')
    const inner = document.createElement('div')
    inner.setAttribute('contenteditable', 'false')
    outer.appendChild(inner)
    expect(shouldYieldToEditableTarget(keyOn(inner))).toBe(false)
  })

  it('输入法组词中让路（isComposing / Process）', () => {
    const div = document.createElement('div')
    expect(shouldYieldToEditableTarget(keyOn(div, { isComposing: true }))).toBe(true)
    expect(shouldYieldToEditableTarget(keyOn(div, { key: 'Process' }))).toBe(true)
  })

  it('普通 div/button 不让路', () => {
    expect(shouldYieldToEditableTarget(keyOn(document.createElement('div')))).toBe(false)
    expect(shouldYieldToEditableTarget(keyOn(document.createElement('button')))).toBe(false)
    expect(shouldYieldToEditableTarget(keyOn(document.body))).toBe(false)
  })
})
