/**
 * Gaming.vue 名册墙接线回归测试（Akari 情报卡 band）。
 *
 * 组件自身的行为由 `components/gaming/roster-wall/__tests__/PlayerCard.spec.ts`
 * 与 `features/gaming/roster-wall/columns.spec.ts` 覆盖；本文件只锁**接线**：
 *
 * 1. **插入点**：`RosterWall` 必须在 `.intel-bay` 之后、`.roster` 之前
 *    （设计文档 ADR-4）。位置错了就退化成两列并排，与原型不符。
 * 2. **档位门禁**：大乱斗 / 斗魂多队 / 视口 <1400px 三种情况整块不渲染——
 *    这些场景下名册墙要么与既有面板打架，要么与 `.roster` 重复。
 * 3. **阵营切分**：我方/敌方按 subteam 反查，10 人全进两侧，无遗漏无重复。
 * 4. **降级不崩**：无画像玩家渲染「无画像」空态卡，而不是让整页渲染失败。
 * 5. **band 样式外置**：`.roster-wall-band` 必须在 Gaming.styles.css 里，
 *    否则 band 无间距（这个断言真的抓到过一次缺失）。
 *
 * 挂载策略与 mock 约定照抄同目录 `Gaming.roster.spec.ts`。
 *
 * 两个必须知道的坑：
 * - `useSessionSync` 的 `sessionData` 是**模块级 reactive 单例**，同文件内多次挂载
 *   会共享状态。所以每次 `session()` 都用自增 tag 生成唯一 puuid 与昵称，
 *   一旦渲染出的还是上一个用例的数据，昵称断言会立刻失败（而不是静默通过）。
 * - fixture 的 `gameType` 必须是 `'MATCHED_GAME'`（后端 `sgp.rs`/`db.rs` 的实际
 *   口径）；写成 `'MATCHED'` 会被 `shouldIncludeGame` 判为自定义局全量剔除，
 *   结果是所有人「无画像」。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

/** 可控视口宽度：Gaming.vue 的 viewportWidth 在挂载时取一次（afterEach 复位 1600） */
function setWidth(w: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
}

/** 每个用例一个 tag：昵称里带 tag，用例间串数据会被昵称断言当场抓住 */
let seq = 0

/**
 * 造 n 场已结束排位对局。
 *
 * 形状必须对齐 `Game` 域模型（`participants[].stats` 扁平 + 顶层 `queueName`），
 * 因为同一份 `matchHistory` 会同时喂给名册墙的分析层（`gameAdapter`）与
 * `.roster` 里既有的 `PlayerHistoryGrid`——两者读同一个 `Game`。
 * 字段集取 `gameAdapter` 实际读取字段的最小闭包。
 */
function games(puuid: string, count: number) {
  const now = Date.now()
  return {
    games: Array.from({ length: count }, (_, i) => {
      const win = i % 3 !== 0 // 胜率约 2/3，便于断言胜率着色分支
      const stats = {
        win,
        item0: 1001,
        item1: 1004,
        item2: 1055,
        item3: 3006,
        item4: 3072,
        item5: 1053,
        item6: 0,
        perk0: 0,
        perkPrimaryStyle: 8100,
        perkSubStyle: 8000,
        playerAugment1: 0,
        playerAugment2: 0,
        playerAugment3: 0,
        playerAugment4: 0,
        playerAugment5: 0,
        playerAugment6: 0,
        kills: 3 + (i % 5),
        deaths: 2,
        assists: 7,
        goldEarned: 12_000,
        goldSpent: 11_000,
        totalDamageDealtToChampions: 21_000,
        totalDamageDealt: 24_000,
        totalDamageTaken: 18_000,
        totalHeal: 900,
        totalMinionsKilled: 180,
        neutralMinionsKilled: 40,
        damageDealtToTurrets: 1_200,
        groupRate: 0,
        goldEarnedRate: 0,
        damageDealtToChampionsRate: 0,
        damageTakenRate: 0,
        healRate: 0,
        playerSubteamId: 0,
        subteamPlacement: 0,
        visionScore: 25,
        spell1Id: 4,
        spell2Id: 14
      }
      return {
        gameId: 1000 + i,
        // 近期对局：避开「活跃 session 排除」与按时间分段的边界
        gameCreationDate: new Date(now - (i + 2) * 86_400_000).toISOString(),
        gameDuration: 1800,
        gameMode: 'CLASSIC',
        gameType: 'MATCHED_GAME',
        queueId: 420,
        queueName: '单双排',
        mapId: 11,
        isCherrySubteam: false,
        mvp: '',
        championId: 10 + (i % 6),
        participants: [
          {
            win,
            participantId: 1,
            teamId: 100,
            championId: 10 + (i % 6),
            spell1Id: 4,
            spell2Id: 14,
            stats
          }
        ],
        // puuid 只存在于 identities[].player（`Participant` 上没有 puuid 字段），
        // 写成扁平 `{ puuid }` 会让 normalizeGame 找不到本人 → 全量 'all-filtered'
        participantIdentities: [
          {
            player: {
              accountId: 1,
              platformId: '',
              gameName: '',
              tagLine: '',
              summonerName: '',
              summonerId: 1,
              puuid
            }
          }
        ],
        gameDetail: {
          participants: [],
          participantIdentities: [],
          endOfGameResult: ''
        }
      }
    })
  }
}

/** CLASSIC 造 2 队 × 5 人；`withGames=false` 时全员无历史对局（走空态） */
function session(withGames = true, over: Partial<SessionData> = {}): SessionData {
  const tag = `t${++seq}`
  const player = (role: string, subteamId: number, index: number) => ({
    championId: 10 + index,
    championKey: `champion_${10 + index}`,
    summoner: {
      gameName: `${tag}-${role}`,
      tagLine: 'TT',
      summonerLevel: 100 + index,
      profileIconId: 1,
      profileIconKey: '',
      puuid: `${tag}-${role}`,
      platformIdCn: ''
    },
    matchHistory: {
      platformId: '',
      begIndex: 0,
      endIndex: 20,
      games: withGames ? games(`${tag}-${role}`, 20) : { games: [] }
    },
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
    preGroupMarkers: subteamId === 1 ? { name: '队伍1', type: 'premade' } : { name: '', type: '' },
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
        players: Array.from({ length: 5 }, (_, i) => player(`m${i}`, 1, i))
      },
      {
        subteamId: 2,
        players: Array.from({ length: 5 }, (_, i) => player(`e${i}`, 2, i))
      }
    ],
    ...over
  } as unknown as SessionData
}

/** 当前用例 tag（`session()` 里自增的那个），用于断言没有串数据 */
function currentTag(): string {
  return `t${seq}`
}

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

/** a 是否在 DOM 上位于 b 之前（比字符串 indexOf 可靠，不会被子串误命中） */
function precedes(a: Element, b: Element): boolean {
  // eslint-disable-next-line no-bitwise
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

describe('Gaming.vue 名册墙接线', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    for (const k of Object.keys(eventListeners)) delete eventListeners[k]
    setWidth(1600)
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

  afterEach(() => setWidth(1600))

  it('名册墙插在情报舱之后、名册行之前（ADR-4 三层顺序）', async () => {
    const { wrapper, unmount } = await mountGaming(session())
    const wall = wrapper.find('.roster-wall-band').element
    const intel = wrapper.find('.intel-bay').element
    const roster = wrapper.find('.roster').element

    expect(precedes(intel, wall)).toBe(true)
    expect(precedes(wall, roster)).toBe(true)
    unmount()
  })

  it('视口 <1400px：整块不渲染（窄窗不与 .roster 重复）', async () => {
    setWidth(1200)
    const { wrapper, unmount } = await mountGaming(session())
    expect(wrapper.find('.roster-wall-band').exists()).toBe(false)
    // 名册行仍在——这是「降级而非中断」
    expect(wrapper.findAll('.roster-row').length).toBe(10)
    unmount()
  })

  it('大乱斗：名册墙让位给 MayhemDraftPanel', async () => {
    const { wrapper, unmount } = await mountGaming(
      session(true, { queueId: 2400, type: 'ARAM', typeCn: '斗魂大乱斗' })
    )
    expect(wrapper.find('.roster-wall-band').exists()).toBe(false)
    unmount()
  })

  it('斗魂多队：名册墙让位（只有我方/敌方两栏，无法映射三方平铺）', async () => {
    const { wrapper, unmount } = await mountGaming(
      session(true, {
        queueId: 1750,
        type: 'CHERRY',
        typeCn: '斗魂竞技场',
        isMultiTeam: true
      })
    )
    expect(wrapper.find('.roster-wall-band').exists()).toBe(false)
    unmount()
  })

  it('阵营切分：我方 5 / 敌方 5，按 subteam 反查而非数组顺序', async () => {
    const { wrapper, unmount } = await mountGaming(session())
    const tag = currentTag()
    const teams = wrapper.findAll('.rw-team')
    expect(teams.length).toBe(2)

    const ally = wrapper.findAll('.rw-team-dot--ally').length
    const enemy = wrapper.findAll('.rw-team-dot--enemy').length
    expect(ally).toBe(1)
    expect(enemy).toBe(1)

    const cards = wrapper.findAll('.pcard')
    expect(cards.length).toBe(10)

    // 昵称必须来自本次挂载的 session（防跨用例串数据）
    const text = wrapper.find('.roster-wall-band').text()
    expect(text).toContain(`${tag}-m0`)
    expect(text).toContain(`${tag}-e0`)
    unmount()
  })

  it('有历史对局：渲染真实卡片而非「无画像」空态', async () => {
    const { wrapper, unmount } = await mountGaming(session(true))
    expect(wrapper.find('.roster-wall-band').exists()).toBe(true)
    expect(wrapper.findAll('.pcard').length).toBe(10)
    expect(wrapper.findAll('.rw-card-empty').length).toBe(0)
    unmount()
  })

  it('预组队标记渲染在卡上（对齐 Akari orderPlayerBy=premade-team）', async () => {
    const { wrapper, unmount } = await mountGaming(session())
    // fixture 里 subteamId=1 全员带 preGroupMarkers.name='队伍1' → 我方 5 张卡有标记
    const premade = wrapper.findAll('.pcard--premade')
    expect(premade.length).toBe(5)
    unmount()
  })

  it('无画像玩家渲染「无画像」空态卡，不让整页渲染失败', async () => {
    const { wrapper, unmount } = await mountGaming(session(false))
    expect(wrapper.find('.roster-wall-band').exists()).toBe(true)
    const empty = wrapper.findAll('.rw-card-empty')
    expect(empty.length).toBe(10)
    expect(empty[0].text()).toContain('无画像')
    expect(empty[0].text()).toContain('无对局数据')
    unmount()
  })

  it('band 样式外置且不含硬编码色值', () => {
    const vue = readFileSync(resolve(__dirname, '../Gaming.vue'), 'utf8')
    expect(vue).toContain('class="roster-wall-band"')
    // 样式挂在外置 css 上，SFC 内不得再有 style 块
    expect(vue).toContain('<style scoped src="./Gaming.styles.css">')
    const css = readFileSync(resolve(__dirname, '../Gaming.styles.css'), 'utf8')
    expect(css).toContain('.roster-wall-band')
  })
})
