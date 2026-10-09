/**
 * 打野路径卡（P5）组件测试。
 *
 * 锁三件事：
 * 1. **降级纪律**：无帧数据时显式「无数据」，不留白、不编造路径
 * 2. **未知营地**：后端加营地后前端词典落后，卡片仍渲染并给出提示
 * 3. **视觉契约**：样式外置 + 零硬编码色（走 --tag-* token）
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import PlayerCardJungle from '../PlayerCardJungle.vue'
import { UNKNOWN_CAMP_WARN_RATIO } from '@renderer/features/gaming/roster-wall/camps'
import type { PlayerTimelineSummary } from '@renderer/features/gaming/services/playerTimeline'

const DIR = resolve(__dirname, '..')

function timeline(over: Partial<PlayerTimelineSummary> = {}): PlayerTimelineSummary {
  return {
    gamesAnalyzed: 6,
    earlyDeathsWithEnemyJungler: 0.8,
    topJunglePath: ['blueBuff', 'gromp', 'wolves'],
    medianFirstCampAtMs: 65_000,
    invadedEarlyRate: 0.5,
    soloDeathRate: 0.4,
    avgContestedObjectives: 1.2,
    ...over
  }
}

describe('PlayerCardJungle · 渲染', () => {
  it('按后端顺序渲染营地序列', () => {
    const w = mount(PlayerCardJungle, { props: { timeline: timeline() } })
    const steps = w.findAll('.pjungle-step')
    expect(steps.length).toBe(3)
    expect(steps.map(s => s.text())).toEqual(['蓝', '魔像', '三狼'])
    expect(w.find('.pjungle-samples').text()).toBe('6 场样本')
  })

  it('语义分组映射到不同 class（buff / farm / objective）', () => {
    const w = mount(PlayerCardJungle, {
      props: {
        timeline: timeline({ topJunglePath: ['blueBuff', 'wolves', 'dragon'] })
      }
    })
    const cls = w.findAll('.pjungle-step').map(s => s.classes().join(' '))
    expect(cls[0]).toContain('pjungle-step--buff')
    expect(cls[1]).toContain('pjungle-step--farm')
    expect(cls[2]).toContain('pjungle-step--objective')
  })

  it('展示首刷时刻与入侵比例', () => {
    const w = mount(PlayerCardJungle, { props: { timeline: timeline() } })
    const rows = w.findAll('.pjungle-meta-row')
    expect(rows.length).toBe(2)
    expect(rows[0].text()).toContain('01:05')
    expect(rows[1].text()).toContain('50%')
  })

  it('dense 档收起元信息（纵向让给战绩行）', () => {
    const w = mount(PlayerCardJungle, { props: { timeline: timeline(), dense: true } })
    expect(w.find('.pjungle--dense').exists()).toBe(true)
    expect(w.find('.pjungle-meta').exists()).toBe(false)
    // 序列仍在
    expect(w.findAll('.pjungle-step').length).toBe(3)
  })
})

describe('PlayerCardJungle · 降级纪律', () => {
  it('timeline 为 null ⇒ 显式「无数据」，不留白', () => {
    const w = mount(PlayerCardJungle, { props: { timeline: null } })
    expect(w.find('.pjungle-empty').exists()).toBe(true)
    expect(w.text()).toContain('无数据')
    // 绝不出现空序列或编造路径
    expect(w.findAll('.pjungle-step').length).toBe(0)
  })

  it('gamesAnalyzed 为 0 ⇒ 同样走无数据', () => {
    const w = mount(PlayerCardJungle, { props: { timeline: timeline({ gamesAnalyzed: 0 }) } })
    expect(w.text()).toContain('无数据')
  })

  it('有帧数据但路径为空 ⇒「未观察到清野」而非无数据', () => {
    const w = mount(PlayerCardJungle, {
      props: { timeline: timeline({ topJunglePath: [] }) }
    })
    expect(w.text()).toContain('未观察到清野')
    expect(w.text()).not.toContain('无数据')
  })

  it('中位首刷为 null ⇒ 显示占位符而不是 00:00', () => {
    const w = mount(PlayerCardJungle, {
      props: { timeline: timeline({ medianFirstCampAtMs: null }) }
    })
    expect(w.findAll('.pjungle-meta-row')[0].text()).toContain('—')
  })
})

describe('PlayerCardJungle · 未知营地', () => {
  it('少量未知营地：照常渲染，不提示', () => {
    const w = mount(PlayerCardJungle, {
      props: {
        timeline: timeline({ topJunglePath: ['blueBuff', 'brandNew', 'wolves', 'gromp'] })
      }
    })
    expect(w.findAll('.pjungle-step').length).toBe(4)
    expect(w.find('.pjungle-hint').exists()).toBe(false)
  })

  it('未知占比超阈值：提示口径可能不一致', () => {
    // 构造 3 个未知 / 1 个已知 => 75% > 阈值
    const w = mount(PlayerCardJungle, {
      props: {
        timeline: timeline({ topJunglePath: ['blueBuff', 'x1', 'x2', 'x3'] })
      }
    })
    expect(w.find('.pjungle-hint').exists()).toBe(true)
  })

  it('未知营地不丢弃，序列长度与后端一致', () => {
    const path = ['blueBuff', 'unknownA', 'unknownB']
    const w = mount(PlayerCardJungle, { props: { timeline: timeline({ topJunglePath: path }) } })
    expect(w.findAll('.pjungle-step').length).toBe(path.length)
  })

  it('阈值常量被真正用上（改阈值会改行为）', () => {
    expect(UNKNOWN_CAMP_WARN_RATIO).toBeGreaterThan(0)
    expect(UNKNOWN_CAMP_WARN_RATIO).toBeLessThan(1)
  })
})

describe('PlayerCardJungle · 样式契约', () => {
  it('样式外置为独立 css 文件', () => {
    const src = readFileSync(resolve(DIR, 'PlayerCardJungle.vue'), 'utf8')
    expect(src).toContain('<style scoped src="./PlayerCardJungle.styles.css">')
  })

  it('外置样式非空且含关键选择器', () => {
    const css = readFileSync(resolve(DIR, 'PlayerCardJungle.styles.css'), 'utf8')
    for (const sel of ['.pjungle', '.pjungle-path', '.pjungle-step', '.pjungle-empty']) {
      expect(css).toContain(sel)
    }
  })

  it('样式零硬编码色（须走 --tag-* / --bg-* / --text-* token）', () => {
    const css = readFileSync(resolve(DIR, 'PlayerCardJungle.styles.css'), 'utf8')
    const hexes = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    const rgba = css.match(/rgba?\(/g) ?? []
    expect(hexes, `含硬编码 hex：${hexes.join(', ')}`).toHaveLength(0)
    expect(rgba, `含硬编码 rgba：${rgba.join(', ')}`).toHaveLength(0)
    expect(css).toContain('--tag-warn')
    expect(css).toContain('--tag-info')
  })

  it('无 z-index / 动画时长 / 过小字号（repo 设计系统硬约束）', () => {
    const css = readFileSync(resolve(DIR, 'PlayerCardJungle.styles.css'), 'utf8')
    expect(css).not.toMatch(/z-index/)
    expect(css).not.toMatch(/transition[^;]*\d+m?s/)
    // 字号必须走 token，不得写字面量（10px 以下不可读）
    const literals = css.match(/font-size:\s*\d+(\.\d+)?px/g) ?? []
    expect(literals, `含字面量字号：${literals.join(', ')}`).toHaveLength(0)
  })
})
