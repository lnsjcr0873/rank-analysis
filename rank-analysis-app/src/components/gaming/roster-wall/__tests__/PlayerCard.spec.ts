/**
 * 名册墙组件单测 + **结构金丝雀**。
 *
 * 金丝雀部分锁住外置样式引用与关键选择器：CLAUDE.md 要求大段样式外置，
 * 但外置文件在提交链路里可能被静默丢失（`RosterRow.spec.ts` /
 * `Home.structure.spec.ts` 已有同类先例），故必须由测试守住。
 */

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { NPopover } from 'naive-ui'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import PlayerTagChip from '../PlayerTagChip.vue'
import type { PlayerTag } from '@renderer/features/gaming/roster-wall/playerTags'

const RW = resolve(__dirname, '..')

const TAG: PlayerTag = {
  id: 'winningStreak',
  label: '连胜 5',
  tone: 'win',
  detail: '从最近一局往前'
}

describe('PlayerTagChip', () => {
  it('渲染标签文字与 tone class', () => {
    const w = mount(PlayerTagChip, { props: { tag: TAG } })
    const chip = w.find('.tag-chip')
    expect(chip.text()).toBe('连胜 5')
    expect(chip.classes()).toContain('tag-chip--win')
  })

  it.each([
    ['neutral'],
    ['info'],
    ['win'],
    ['loss'],
    ['brand'],
    ['warn'],
    ['danger'],
    ['muted']
  ] as const)('tone=%s 有对应 class（8 个语义族齐全）', tone => {
    const w = mount(PlayerTagChip, { props: { tag: { ...TAG, tone } } })
    expect(w.find('.tag-chip').classes()).toContain(`tag-chip--${tone}`)
  })

  it('有 detail 时挂 popover，无 detail 时不挂', () => {
    // 注意：naive-ui 的 NPopover 内容是**懒渲染**（hover 才挂载），
    // 因此未触发时不能断言 .tag-detail 存在，只能断言 popover 组件本身。
    expect(
      mount(PlayerTagChip, { props: { tag: TAG } })
        .findComponent(NPopover)
        .exists()
    ).toBe(true)

    const plain = mount(PlayerTagChip, {
      props: { tag: { id: 'score', label: '17分 12.3', tone: 'muted' } }
    })
    expect(plain.findComponent(NPopover).exists()).toBe(false)
    // 无 detail 时标签仍直接渲染，不被 popover 包住
    expect(plain.find('.tag-chip').exists()).toBe(true)
  })

  it('样式内不出现硬编码色（须走 --tag-* token）', () => {
    const src = readFileSync(resolve(RW, 'PlayerTagChip.vue'), 'utf8')
    const styleBlock = src.slice(src.indexOf('<style'))
    const hexes = styleBlock.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    expect(hexes, `PlayerTagChip 样式含硬编码色：${hexes.join(', ')}`).toHaveLength(0)
  })
})

describe('结构金丝雀 · 外置样式引用', () => {
  const externalized: Array<[vue: string, css: string, selectors: string[]]> = [
    ['PlayerCard.vue', 'PlayerCard.styles.css', ['.pcard', '.pcard-tags', '.pcard-deco']],
    ['TeamBlock.vue', 'TeamBlock.styles.css', ['.rw-team', '.rw-team-grid', '.rw-card-empty']],
    ['RosterWall.vue', 'RosterWall.styles.css', ['.roster-wall', '.roster-wall-head']]
  ]

  it.each(externalized)('%s 以 scoped src 引用 %s', (vue, css) => {
    const src = readFileSync(resolve(RW, vue), 'utf8')
    expect(src).toContain(`<style scoped src="./${css}">`)
    expect(readFileSync(resolve(RW, css), 'utf8')).not.toBe('')
  })

  it.each(externalized)('%s 的外置样式含关键选择器', (_vue, css, selectors) => {
    const content = readFileSync(resolve(RW, css), 'utf8')
    for (const sel of selectors) {
      expect(content, `${css} 应含 ${sel}`).toContain(sel)
    }
  })

  it('PlayerCard 固定宽度 240px（Akari 契约）', () => {
    const css = readFileSync(resolve(RW, 'PlayerCard.styles.css'), 'utf8')
    expect(css).toMatch(/\.pcard\s*\{[^}]*width:\s*240px/)
  })
})

describe('结构金丝雀 · 设计系统硬约束', () => {
  const vueFiles = [
    'PlayerTagChip.vue',
    'PlayerCard.vue',
    'PlayerCardHeader.vue',
    'PlayerCardStats.vue',
    'PlayerCardChampions.vue',
    'PlayerCardHistory.vue',
    'TeamBlock.vue',
    'RosterWall.vue'
  ]

  it.each(vueFiles)('%s 不含 z-index 硬编码（只允许 5 个语义档）', file => {
    const src = readFileSync(resolve(RW, file), 'utf8')
    const styleBlock = src.slice(src.indexOf('<style'))
    const raw = styleBlock.match(/z-index:\s*(\d+)/g) ?? []
    // var(--z-*) 不匹配此正则；匹配到的数字只能是 0
    const offenders = raw.filter(v => !/z-index:\s*0\s*;/.test(v))
    expect(offenders, `${file} 含非 0 的 z-index 数字：${offenders.join(', ')}`).toHaveLength(0)
  })

  it.each(vueFiles)('%s 不含硬编码动画时长/缓动（须用 --dur-* / --ease-expo）', file => {
    const src = readFileSync(resolve(RW, file), 'utf8')
    const styleBlock = src.slice(src.indexOf('<style'))
    const offenders = styleBlock.match(/(transition|animation)[^;]*\b\d+ms\b/g) ?? []
    expect(offenders, `${file} 含硬编码 ms：${offenders.join(', ')}`).toHaveLength(0)
  })

  it.each(vueFiles)('%s 不出现小于 10px 的字号', file => {
    const src = readFileSync(resolve(RW, file), 'utf8')
    const styleBlock = src.slice(src.indexOf('<style'))
    // 匹配 font-size: 9px / 8px 之类（var(--font-size-*) 不匹配）
    const offenders = styleBlock.match(/font-size:\s*(\d+)px/g) ?? []
    for (const o of offenders) {
      const px = Number(o.match(/(\d+)px/)![1])
      expect(px, `${file} 含 ${px}px 字号（下限 10px）`).toBeGreaterThanOrEqual(10)
    }
  })
})
