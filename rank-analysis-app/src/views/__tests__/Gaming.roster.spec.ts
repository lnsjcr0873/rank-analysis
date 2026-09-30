/**
 * Gaming.vue 名册优先布局回归测试（Akari 式对局页改造）。
 *
 * 背景：改造前对局页是「结论优先 + 卡片列」——情报舱在上，`gaming-grid`
 * 里每队一个队伍容器，每个成员一张独立卡片；大乱斗则直接用
 * `MayhemDraftPanel` 把整个情报舱替换掉，形成两套页面结构。
 *
 * 本文件锁住改造后的三个不可回退点：
 * 1. **全模式共用名册**：旧卡片列容器不再出现在模板里，
 *    成员一律由 `RosterRow` 在 `.roster` 中渲染（大乱斗也渲染）。
 * 2. **大乱斗不再吞掉情报舱**：`v-if="isMayhem"` 的 MayhemDraftPanel 与
 *    `v-if="!isMayhem"` 的 intel-bay 是并列两块，名册在两者之下始终渲染。
 * 3. **外置样式不被静默丢失**：`<style scoped src>` 引用 + 关键选择器。
 *
 * 挂载策略与 mock 约定照抄同目录 `Gaming.tierSelect.spec.ts`：
 * 真实 naive-ui 全量注册 + stub 内部组件、mock tauri invoke/listen/getCurrentWindow、
 * ipc、`@renderer/services/ai`，session 数据由 `session-basic-info` 事件驱动。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import naive from 'naive-ui'
import { createRouter, createMemoryHistory } from 'vue-router'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {}
}))

const eventListeners: Record<string, Array<(event: { payload: unknown }) => void>> = {}
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: (event: { payload: unknown }) => void) => {
    ;(eventListeners[name] ??= []).push(cb)
    return () => {
      eventListeners[name] = (eventListeners[name] ?? []).filter(f => f !== cb)
    }
  })
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' })
}))

vi.mock('@renderer/services/ai', () => ({
  analyzeChampSelectWithAIStream: vi.fn(),
  analyzeGameWithAIStream: vi.fn()
}))

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

import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { invoke } from '@tauri-apps/api/core'
import Gaming from '../Gaming.vue'
import type { SessionData } from '@renderer/types/domain/gaming'

const mockGetConfig = vi.mocked(getConfigByIpc)
const mockPut = vi.mocked(putConfigByIpc)
const mockInvoke = vi.mocked(invoke)

const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: { template: '<div />' } }]
})

/** CLASSIC 造 2 队 × 5 人；CHERRY 造 3 队 × 2 人（与 command/session.rs 同口径） */
function session(over: Partial<SessionData> = {}): SessionData {
  const player = (puuid: string, subteamId: number, index: number) => ({
    championId: 10 + index,
    championKey: `champion_${10 + index}`,
    summoner: {
      gameName: puuid === 'me' ? '我' : `p${puuid}`,
      tagLine: 'TT',
      summonerLevel: 100 + index,
      profileIconId: 1,
      profileIconKey: '',
      puuid,
      platformIdCn: ''
    },
    matchHistory: { platformId: '', begIndex: 0, endIndex: 0, games: { games: [] } },
    userTag: {
      tag: [],
      preGroup: [],
      socialNetwork: [],
      recentData: {
        winRate: 0.5,
        kda: 2,
        games: 10,
        avgGold: 7000,
        avgDamage: 21000,
        modeId: 420,
        championId: 10 + index,
        gamesData: []
      }
    },
    rank: { queueMap: { RANKED_SOLO_5x5: {}, RANKED_FLEX_SR: {} } },
    meetGames: [],
    preGroupMarkers: { name: '', type: '' },
    subteamId,
    assignedPosition: ['top', 'jungle', 'middle', 'bottom', 'utility'][index] ?? ''
  })
  return {
    phase: 'InProgress',
    type: 'RANKED_SOLO_5x5',
    typeCn: '单双排',
    queueId: 420,
    gameMode: 'CLASSIC',
    isMultiTeam: false,
    mySubteamId: 1,
    subteams: [
      {
        subteamId: 1,
        players: Array.from({ length: 5 }, (_, i) => player(i === 0 ? 'me' : `m${i}`, 1, i))
      },
      {
        subteamId: 2,
        players: Array.from({ length: 5 }, (_, i) => player(`e${i}`, 2, i))
      }
    ],
    ...over
  } as unknown as SessionData
}

/** 与 Gaming.tierSelect.spec.ts 同款：让 mock 的 listen/emit 微任务跑完 */
async function flush(w: { vm: { $nextTick: () => Promise<void> } }): Promise<void> {
  await new Promise(r => setTimeout(r, 0))
  await w.vm.$nextTick()
}

async function mountGaming(data: SessionData) {
  const wrapper = mount(Gaming, {
    global: {
      plugins: [testRouter, naive],
      stubs: {
        'a-modal': true,
        Select: {
          props: ['value', 'options'],
          emits: ['update:value'],
          template:
            '<select :value="value" @change="$emit(\'update:value\', $event.target.value)">' +
            '<option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>' +
            '</select>'
        },
        RouterLink: true
      }
    }
  })
  await flush(wrapper)
  for (const cb of eventListeners['session-basic-info'] ?? []) cb({ payload: data })
  await flush(wrapper)
  await flush(wrapper)
  return { wrapper, unmount: () => wrapper.unmount() }
}

describe('Gaming.vue 名册优先布局', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    for (const k of Object.keys(eventListeners)) delete eventListeners[k]
    mockGetConfig.mockResolvedValue(undefined)
    mockPut.mockResolvedValue(undefined)
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_opgg_status') {
        return {
          mode: 'ranked',
          patch: '16.12',
          fetchedAt: Date.now(),
          stale: false,
          championCount: 5
        }
      }
      return null
    })
  })

  it('成员由名册行渲染，不再出现旧的卡片列容器', async () => {
    const { wrapper, unmount } = await mountGaming(session())
    expect(wrapper.find('.roster').exists()).toBe(true)
    expect(wrapper.find('.gaming-grid').exists()).toBe(false)
    expect(wrapper.find('.subteam-col').exists()).toBe(false)
    // CLASSIC：两组共 10 行
    expect(wrapper.findAll('.roster-row').length).toBe(10)
    unmount()
  })

  it('分组标签走「我方/敌方」且我方排第一', async () => {
    const { wrapper, unmount } = await mountGaming(session())
    const labels = wrapper.findAll('.roster-group__label').map(n => n.text())
    expect(labels).toEqual(['我方', '敌方'])
    unmount()
  })

  it('CHERRY 多队：按小队平铺，我方第一、其余按 subteamId 升序', async () => {
    const data = session({ isMultiTeam: true, type: 'CHERRY', typeCn: '斗魂竞技场' })
    // 重排 subteam 顺序为 3/1/2，确认排序由名册层而非后端顺序决定
    data.subteams = [
      { subteamId: 3, players: [data.subteams[1].players[0], data.subteams[1].players[1]] },
      { subteamId: 1, players: data.subteams[0].players.slice(0, 2) },
      { subteamId: 2, players: [data.subteams[1].players[2], data.subteams[1].players[3]] }
    ]
    data.mySubteamId = 1
    const { wrapper, unmount } = await mountGaming(data)
    const labels = wrapper.findAll('.roster-group__label').map(n => n.text())
    expect(labels).toEqual(['我方', '第 2 小队', '第 3 小队'])
    expect(wrapper.find('.roster').classes()).toContain('roster-multi')
    unmount()
  })

  it('大乱斗：MayhemDraftPanel 出现、情报舱让位，但名册仍渲染', async () => {
    const data = session({ queueId: 2400, type: 'ARAM', typeCn: '斗魂大乱斗' })
    const { wrapper, unmount } = await mountGaming(data)
    expect(wrapper.find('.intel-bay').exists()).toBe(false)
    expect(wrapper.find('.roster').exists()).toBe(true)
    expect(wrapper.findAll('.roster-row').length).toBe(10)
    expect(wrapper.find('.roster').classes()).toContain('roster-mayhem')
    unmount()
  })

  it('普通对局：情报舱与名册同时存在（不再是二选一）', async () => {
    const { wrapper, unmount } = await mountGaming(session())
    expect(wrapper.find('.intel-bay').exists()).toBe(true)
    expect(wrapper.find('.roster').exists()).toBe(true)
    unmount()
  })

  it('匿名选人期敌方仍渲染名册行（有占位名，不空白）', async () => {
    const data = session({ phase: 'ChampSelect' })
    data.subteams[1].players.forEach(p => {
      p.summoner.puuid = ''
      p.summoner.gameName = ''
      p.summoner.tagLine = ''
      p.pickState = 'locked'
    })
    const { wrapper, unmount } = await mountGaming(data)
    expect(wrapper.findAll('.roster-row').length).toBe(10)
    expect(wrapper.text()).toContain('匿名 1')
    unmount()
  })

  it('样式外置且包含名册布局规则', () => {
    const vue = readFileSync(resolve(__dirname, '../Gaming.vue'), 'utf8')
    expect(vue).toContain('<style scoped src="./Gaming.styles.css">')
    const css = readFileSync(resolve(__dirname, '../Gaming.styles.css'), 'utf8')
    expect(css).toContain('.roster')
    expect(css).toContain('.roster-group__label')
    expect(css).toContain('.roster-placeholder')
    // 旧卡片列样式应随改造一并删除，避免残留死规则
    expect(css).not.toContain('.subteam-col')
    expect(css).not.toContain('.gaming-grid')
  })
})
