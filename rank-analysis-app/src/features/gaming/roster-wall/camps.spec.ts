/**
 * 营地词典与格式化工具测试。
 *
 * 重点锁两件事：
 * 1. **未知营地不抛不猜** —— 后端新增营地时前端词典落后，卡片仍要能渲染并提示
 * 2. **格式化对 null 的处理** —— 「没数据」与「值为 0」必须区分
 */

import { describe, it, expect } from 'vitest'
import { campMeta, CAMP_META, formatClock, formatRate, UNKNOWN_CAMP_WARN_RATIO } from './camps'

describe('campMeta', () => {
  it('覆盖 Rust Camp 枚举的全部 camelCase 取值', () => {
    // 与 src-tauri/src/timeline/geometry.rs 的 Camp 变体一一对应
    const rustCamps = [
      'blueBuff',
      'redBuff',
      'gromp',
      'wolves',
      'krugs',
      'riftScuttler',
      'riftHerald',
      'dragon',
      'baron'
    ]
    for (const c of rustCamps) {
      expect(CAMP_META[c], `缺少营地 ${c}`).toBeDefined()
    }
    expect(Object.keys(CAMP_META).sort()).toEqual([...rustCamps].sort())
  })

  it('语义分组正确：buff / objective 各自归位', () => {
    expect(campMeta('blueBuff').group).toBe('buff')
    expect(campMeta('redBuff').group).toBe('buff')
    expect(campMeta('dragon').group).toBe('objective')
    expect(campMeta('baron').group).toBe('objective')
    expect(campMeta('riftHerald').group).toBe('objective')
    expect(campMeta('wolves').group).toBe('farm')
    expect(campMeta('riftScuttler').group).toBe('farm')
  })

  it('未知营地兜底而不抛错（后端加营地时前端词典落后）', () => {
    const m = campMeta('brandNewCamp')
    expect(m.title).toBe('brandNewCamp')
    // 未知按 farm 处理：不参与特殊配色，也就不会伪装成 buff/objective
    expect(m.group).toBe('farm')
    expect(m.label.length).toBeGreaterThan(0)
  })

  it('兜底 label 不会因为超长标识而撑爆卡片', () => {
    expect(campMeta('aVeryLongUnknownCampIdentifier').label.length).toBeLessThanOrEqual(2)
  })

  it('阈值常量在合理区间（不是 0 也不是 1）', () => {
    expect(UNKNOWN_CAMP_WARN_RATIO).toBeGreaterThan(0)
    expect(UNKNOWN_CAMP_WARN_RATIO).toBeLessThan(1)
  })
})

describe('formatClock', () => {
  it('毫秒 → mm:ss', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(60_000)).toBe('01:00')
    expect(formatClock(95_000)).toBe('01:35')
    expect(formatClock(3 * 60 * 1000)).toBe('03:00')
  })

  it('非法输入显示占位符而非 NaN/负数', () => {
    expect(formatClock(-1)).toBe('--:--')
    expect(formatClock(Number.NaN)).toBe('--:--')
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('--:--')
  })
})

describe('formatRate', () => {
  it('null → 占位符（区分「没数据」与「0%」）', () => {
    expect(formatRate(null)).toBe('—')
  })

  it('0 → 0%（有效结论）', () => {
    expect(formatRate(0)).toBe('0%')
  })

  it('常规比例四舍五入', () => {
    expect(formatRate(0.5)).toBe('50%')
    expect(formatRate(0.667)).toBe('67%')
    expect(formatRate(1)).toBe('100%')
  })
})
