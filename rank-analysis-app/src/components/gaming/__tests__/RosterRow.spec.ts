/**
 * `RosterRow` 结构金丝雀。
 *
 * `RosterRow.styles.css` 是外置样式文件（CLAUDE.md 约定：`<style>` 超约 200 行必须外置），
 * 提交链路里样式块可能被静默丢失。这里锁住「行必须渲染哪些区域」，
 * 保证样式缺失时至少还有结构与 class 名可依据，同时防止误删关键交互。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import RosterRow from '../RosterRow.vue'
import { buildRoster } from '@renderer/features/gaming/services/roster'
import { defaultUserTag } from '@renderer/types/domain/analysis'
import type { SessionData, SessionSummoner, Subteam } from '@renderer/types/domain/gaming'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }))
vi.mock('@renderer/services/http', () => ({ assetPrefix: 'asset' }))
vi.mock('@renderer/composables/useCopy', () => ({ useCopy: () => ({ copy: vi.fn() }) }))

// jsdom 下没有 n-message-provider；行内 useCopy/UnifiedTagRow 会调 useMessage
const messageMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}))
vi.mock('naive-ui', async importOriginal => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return { ...actual, useMessage: () => messageMock }
})

function player(puuid: string): SessionSummoner {
  return {
    championId: 1,
    championKey: 'Annie',
    summoner: {
      gameName: 'name',
      tagLine: 'tag',
      summonerLevel: 300,
      profileIconId: 1,
      profileIconKey: '',
      puuid,
      platformIdCn: ''
    },
    matchHistory: { platformId: '', begIndex: 0, endIndex: 0, games: { games: [] } },
    userTag: defaultUserTag(),
    rank: { queueMap: { RANKED_SOLO_5x5: {} as never, RANKED_FLEX_SR: {} as never } },
    meetGames: [],
    preGroupMarkers: { name: '', type: '' }
  }
}

function rosterOf(phase: string, assignedPosition = '') {
  const mine: Subteam = {
    subteamId: 1,
    players: [player('me'), player('teammate')]
  }
  mine.players[0].assignedPosition = assignedPosition
  const session = {
    phase,
    type: 'RANKED_SOLO_5x5',
    typeCn: '单双排',
    queueId: 420,
    gameMode: 'CLASSIC',
    isMultiTeam: false,
    mySubteamId: 1,
    subteams: [mine]
  } as unknown as SessionData
  const roster = buildRoster(session, 'me')
  return roster.groups[0].members
}

function mountRow(over: Record<string, unknown> = {}) {
  const members = rosterOf('ChampSelect', 'middle')
  return mount(RosterRow, {
    props: {
      member: members[0],
      index: 0,
      side: 'mine' as const,
      isSelf: true,
      isLoading: false,
      champSelect: true,
      density: 'full' as const,
      ...over
    },
    global: { stubs: { RouterLink: true } }
  })
}

describe('RosterRow 结构', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // useTheme / PlayerNoteBadge / UnifiedTagRow 都要 active pinia
    setActivePinia(createPinia())
  })

  it('渲染名册行的三个区域（主信息/近期表现/最近对局）', () => {
    const w = mountRow()
    expect(w.find('.roster-row').exists()).toBe(true)
    expect(w.find('.roster-row__main').exists()).toBe(true)
    expect(w.find('.roster-row__stats').exists()).toBe(true)
    expect(w.find('.roster-row__history').exists()).toBe(true)
  })

  it('标「我」并渲染召唤师等级', () => {
    const w = mountRow()
    expect(w.text()).toContain('我')
    expect(w.find('.level-badge').text()).toBe('300')
  })

  it('常用位置渲染中文短名（局内同样有效）', () => {
    const w = mountRow()
    expect(w.find('.pos-tag').text()).toBe('中单')
  })

  it('无分配位置时不渲染位置标签（大乱斗等）', () => {
    const members = rosterOf('InProgress', '')
    const w = mount(RosterRow, {
      props: {
        member: members[1],
        index: 1,
        side: 'mine' as const,
        isSelf: false,
        isLoading: false,
        champSelect: false,
        density: 'normal' as const
      }
    })
    expect(w.find('.pos-tag').exists()).toBe(false)
  })

  it('minimal 密度隐藏统计与最近对局区', () => {
    const w = mountRow({ density: 'minimal' })
    expect(w.find('.roster-row__stats').exists()).toBe(false)
    expect(w.find('.roster-row__history').exists()).toBe(false)
  })

  it('normal 密度不渲染最近对局区', () => {
    const w = mountRow({ density: 'normal' })
    expect(w.find('.roster-row__stats').exists()).toBe(true)
    expect(w.find('.roster-row__history').exists()).toBe(false)
  })

  it('侧别与自身状态写进 class，便于外部做阵营配色', () => {
    // 用 find('.roster-row') 而非 wrapper.classes()：根元素外的模板注释会让
    // wrapper 根退化成 Fragment，classes() 取不到根 class。
    const enemy = mountRow({ side: 'enemy' }).find('.roster-row').classes()
    expect(enemy).toContain('roster-row--enemy')

    const mine = mountRow({ side: 'mine' }).find('.roster-row').classes()
    expect(mine).toContain('roster-row--mine')
    expect(mine).toContain('roster-row--self')
  })

  it('组件以 scoped 外置样式引用，且外置文件含行布局规则', () => {
    // 沿用 Home.structure.spec.ts 的约定：样式外置在提交链路里可能被静默丢失，
    // 金丝雀同时锁住 <style src> 引用与文件内容。
    const vue = readFileSync(resolve(__dirname, '../RosterRow.vue'), 'utf8')
    expect(vue).toContain('<style scoped src="./RosterRow.styles.css">')

    const css = readFileSync(resolve(__dirname, '../RosterRow.styles.css'), 'utf8')
    expect(css).toContain('.roster-row')
    expect(css).toContain('.roster-row__main')
    expect(css).toContain('.roster-row__stats')
    expect(css).toContain('.opgg-chip')
  })
})
