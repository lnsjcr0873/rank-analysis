/**
 * BestPicksPanel 推荐条组件测试：
 * 常驻条渲染（敌方头像 + Top3）/ 展开 Top5 卡 / 理由行 / unknown 一次带过 /
 * 全 ≤0 提示 / 敌方锁定不足空态 / 失败降级。
 * 数据层（useBestPicks）已由 composable 单测覆盖，这里 mock 后验证 UI。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { computed, nextTick } from 'vue'
import { NCheckbox, NSelect } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'
import { clearOwnedChampionsCache } from '@renderer/features/gaming/services/ownedChampions'
import type { DualPick } from '@renderer/features/gaming/services/counterIntel'
import type { Game, MatchHistory } from '@renderer/types/domain/match'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const composableMock = vi.hoisted(() => {
  const { ref } = require('vue') as typeof import('vue')
  return {
    picks: ref<DualPick[]>([]),
    isLoading: ref(false),
    error: ref(false)
  }
})

vi.mock('@renderer/composables/useCounterIntel', async importOriginal => {
  const actual = await importOriginal<typeof import('@renderer/composables/useCounterIntel')>()
  return {
    ...actual,
    useBestPicks: vi.fn(() => ({
      picks: composableMock.picks,
      isLoading: composableMock.isLoading,
      error: composableMock.error
    }))
  }
})

vi.mock('@renderer/services/ai/champion-names', () => ({
  getChampionName: (id: number) => `英雄${id}`,
  loadChampionNames: vi.fn(async () => {})
}))

import BestPicksPanel from '../BestPicksPanel.vue'
import { useBestPicks } from '@renderer/composables/useCounterIntel'

const mockedUseBestPicks = vi.mocked(useBestPicks)

function makePicks(count = 3): DualPick[] {
  const base: DualPick[] = [
    {
      championId: 51,
      score: 0.62,
      counterScore: 0.52,
      synergyScore: 0.1,
      evidences: [
        { againstChampionId: 104, relation: 'favored', winRate: 0.58, play: 210 },
        { againstChampionId: 103, relation: 'countered', winRate: 0.41, play: 90 }
      ],
      synergyEvidences: [
        { teammateChampionId: 300, synergyPosition: 'ADC', winRate: 0.6, play: 120 }
      ]
    },
    {
      championId: 11,
      score: 0.1,
      counterScore: 0.1,
      synergyScore: 0,
      evidences: [{ againstChampionId: 104, relation: 'favored', winRate: 0.52, play: 300 }],
      synergyEvidences: []
    },
    {
      championId: 67,
      score: -0.2,
      counterScore: -0.2,
      synergyScore: 0,
      evidences: [],
      synergyEvidences: []
    }
  ]
  if (count <= base.length) return base.slice(0, count)
  // 超出 3 条时用无证据占位卡补齐（分路/数量截断测试只需要「存在多张卡」）
  return base.concat(
    Array.from({ length: count - base.length }, (_, i) => ({
      championId: 1000 + i,
      score: 0.05,
      counterScore: 0.05,
      synergyScore: 0,
      evidences: [],
      synergyEvidences: []
    }))
  )
}

/** 面板内第 index 个 n-select（模板顺序：0 位置 / 1 段位 / 2 数量） */
function wrapperSelect(index: number, wrapper: ReturnType<typeof mount>): ReturnType<typeof mount> {
  return wrapper.findAllComponents(NSelect)[index]
}

async function mountPanel(props: Record<string, unknown> = {}): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(BestPicksPanel, {
    props: {
      enemyIds: [104, 103, 102],
      candidateIds: [51, 11, 67, 1, 2],
      tier: 'emerald_plus',
      ...props
    },
    global: {
      plugins: [createPinia()],
      stubs: {
        Popover: {
          template: '<div class="popover-stub"><slot name="trigger" /><slot /></div>'
        }
      }
    }
  })
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  composableMock.picks.value = []
  composableMock.isLoading.value = false
  composableMock.error.value = false
  clearOwnedChampionsCache()
})

const mockedInvoke = vi.mocked(invoke)

/** 构造一场「某英雄赢/输」的最小战绩（满足 aggregateChampionPool 的聚合需求） */
function makePoolGame(championId: number, win: boolean): Game {
  return {
    mvp: '',
    gameDetail: { endOfGameResult: '', participantIdentities: [], participants: [] },
    gameId: championId,
    gameCreationDate: '',
    gameDuration: 1800,
    gameMode: '',
    gameType: '',
    mapId: 11,
    queueId: 420,
    queueName: '',
    platformId: '',
    participantIdentities: [],
    participants: [
      {
        win,
        participantId: 1,
        teamId: 100,
        championId,
        spell1Id: 0,
        spell2Id: 0,
        // aggregateChampionPool 读 stats.win 判胜负：必须放这里，顶层 win 不认
        stats: { win }
      }
    ]
  } as unknown as Game
}

function historyOf(championId: number): MatchHistory {
  // 5 场全胜：满足默认门槛（胜率≥50%·场次≥5），否则阈值筛选会把单场样本滤掉
  return {
    platformId: '',
    begIndex: 0,
    endIndex: 49,
    games: { games: Array.from({ length: 5 }, () => makePoolGame(championId, true)) }
  }
}

function historyNames(): string[] {
  return mockedInvoke.mock.calls
    .filter(([cmd]) => cmd === 'get_match_history_by_name')
    .map(([, args]) => (args as { name: string }).name)
}

/** 勾选面板内「仅英雄池」（模板顺序第 2 个 n-checkbox） */
async function enablePoolOnly(wrapper: ReturnType<typeof mount>): Promise<void> {
  const poolCheck = wrapper.findAllComponents(NCheckbox)[1]
  poolCheck.vm.$emit('update:checked', true)
  await tick()
}

/** 等一个 macrotask：panel 挂载用 setTimeout(0) 桥接，checkbox/props 更新同理 */
async function tick(): Promise<void> {
  await nextTick()
  await new Promise(r => setTimeout(r, 0))
  await flushPromises()
}

/** useBestPicks 收到的候选池 Ref（第 2 个入参，响应式跟随 filteredCandidates） */
function candidateArg(): { value: number[] } {
  const args = mockedUseBestPicks.mock.calls[0] as unknown as Array<{ value: number[] }>
  return args[1]
}

describe('BestPicksPanel', () => {
  it('把 enemyIds/candidateIds/tier 传给 useBestPicks（响应式透传）', async () => {
    await mountPanel()
    expect(mockedUseBestPicks).toHaveBeenCalledTimes(1)
    const args = mockedUseBestPicks.mock.calls[0]
    const ids = computed(() => [104, 103, 102])
    const candidates = computed(() => [51, 11, 67, 1, 2])
    const tier = computed(() => 'emerald_plus')
    expect(args[0].value).toEqual(ids.value)
    expect(args[1].value).toEqual(candidates.value)
    expect(args[2].value).toEqual(tier.value)
  })

  it('把 teammateIds/myPosition（规范化成 OP.GG 命名）传给 useBestPicks（协同维度透传）', async () => {
    await mountPanel({ teammateIds: [300, 301], myPosition: 'BOTTOM' })
    const args = mockedUseBestPicks.mock.calls[0]
    const teammates = computed(() => [300, 301])
    const pos = computed(() => 'ADC')
    expect(args[4]?.value).toEqual(teammates.value)
    expect(args[5]?.value).toEqual(pos.value)
  })

  it('位置筛选切到具体分路后 myPosition 入参跟随（默认跟随我的分路）', async () => {
    const wrapper = await mountPanel({ myPosition: 'top' })
    const args = mockedUseBestPicks.mock.calls[0]
    expect(args[5]?.value).toBe('TOP')
    const posSelect = wrapperSelect(0, wrapper)
    posSelect.vm.$emit('update:value', 'JUNGLE')
    await nextTick()
    expect(args[5]?.value).toBe('JUNGLE')
    posSelect.vm.$emit('update:value', 'all')
    await nextTick()
    expect(args[5]?.value).toBe('')
  })

  it('段位下拉切换向外 emit switch-tier（由父组件统一处理）', async () => {
    const wrapper = await mountPanel()
    wrapperSelect(1, wrapper).vm.$emit('update:value', 'diamond_plus')
    expect(wrapper.emitted('switch-tier')).toEqual([['diamond_plus']])
  })

  it('显示数量默认 5：候选超过 5 个时只渲染前 5 张卡', async () => {
    const picks = makePicks(6)
    const wrapper = await mountPanel()
    composableMock.picks.value = picks
    await nextTick()
    const cards = wrapper.findAll('.bp-pick-card')
    expect(cards).toHaveLength(5)
    expect(cards[0].text()).toContain('英雄51')
  })

  it('显示数量切到「全部」后渲染全部候选', async () => {
    composableMock.picks.value = makePicks(6)
    const wrapper = await mountPanel()
    wrapperSelect(2, wrapper).vm.$emit('update:value', 'all')
    await nextTick()
    expect(wrapper.findAll('.bp-pick-card')).toHaveLength(6)
  })

  it('敌方锁定 ≥2 时显示推荐条，含敌方头像与 Top3 应对', async () => {
    composableMock.picks.value = makePicks()
    const wrapper = await mountPanel()
    expect(wrapper.find('.bp-bar').exists()).toBe(true)
    const enemyAvatars = wrapper.findAll('.bp-enemy-avatar')
    expect(enemyAvatars).toHaveLength(3)
    // 无队友已亮时不允许出现队友头像（避免误示敌方头像为队友）
    expect(wrapper.findAll('.bp-teammate-avatar')).toHaveLength(0)
    const pickAvatars = wrapper.findAll('.bp-pick-avatar')
    expect(pickAvatars).toHaveLength(3)
  })

  it('敌方只锁定 1 人且无队友亮时隐藏（保持原有隐藏规则）', async () => {
    const wrapper = await mountPanel({ enemyIds: [104] })
    expect(wrapper.find('.bp-bar').exists()).toBe(false)
  })

  it('纯协同场景：敌方 0 锁 + 队友已亮 ≥1 时显示条（常驻条文案为「与队友」）', async () => {
    const wrapper = await mountPanel({ enemyIds: [], teammateIds: [300] })
    expect(wrapper.find('.bp-bar').exists()).toBe(true)
    expect(wrapper.find('.bp-label').text()).toBe('与队友')
    expect(wrapper.find('.bp-arrow-label').text()).toBe('最优协同')
    expect(wrapper.find('.bp-panel-title').text()).toContain('与已亮队友协同的最佳选择')
    // 协同锚点是队友头像：只显示队友头像，不得显示敌方头像
    const teammateAvatars = wrapper.findAll('.bp-teammate-avatar')
    expect(teammateAvatars).toHaveLength(1)
    expect(teammateAvatars[0].attributes('src')).toContain('champion/300')
    expect(wrapper.findAll('.bp-enemy-avatar')).toHaveLength(0)
  })

  it('敌方 1 锁 + 队友 1 亮也显示（协同维度放宽显示门槛，队友/敌方头像分别呈现）', async () => {
    const wrapper = await mountPanel({ enemyIds: [104], teammateIds: [300] })
    expect(wrapper.find('.bp-bar').exists()).toBe(true)
    expect(wrapper.find('.bp-arrow-label').text()).toBe('双维最优')
    const teammateAvatars = wrapper.findAll('.bp-teammate-avatar')
    expect(teammateAvatars).toHaveLength(1)
    expect(teammateAvatars[0].attributes('src')).toContain('champion/300')
    const enemyAvatars = wrapper.findAll('.bp-enemy-avatar')
    expect(enemyAvatars).toHaveLength(1)
    expect(enemyAvatars[0].attributes('src')).toContain('champion/104')
  })

  it('loading 时显示分析中提示', async () => {
    composableMock.isLoading.value = true
    const wrapper = await mountPanel()
    expect(wrapper.find('.bp-bar').text()).toContain('分析中')
  })

  it('失败时降级文案不崩溃', async () => {
    composableMock.error.value = true
    const wrapper = await mountPanel()
    expect(wrapper.find('.bp-bar').text()).toContain('OP.GG 数据未就绪')
  })

  it('展开层渲染 Top5 卡：头像/名字/总分/协同与对位子分/证据行', async () => {
    composableMock.picks.value = makePicks()
    const wrapper = await mountPanel({ teammateIds: [300] })
    const cards = wrapper.findAll('.bp-pick-card')
    expect(cards).toHaveLength(3)
    const first = cards[0]
    expect(first.text()).toContain('英雄51')
    expect(first.text()).toContain('分数 +0.62')
    expect(first.text()).toContain('协同 +0.10')
    expect(first.text()).toContain('对位 +0.52')
    expect(first.text()).toContain('协同 英雄300（60.0% · 120 局）')
    expect(first.text()).toContain('克制 英雄104（58.0% · 210 局）')
    expect(first.text()).toContain('被克 英雄103（41.0% · 90 局）')
  })

  it('无队友时隐藏协同子分（纯对位模式）', async () => {
    composableMock.picks.value = makePicks()
    const wrapper = await mountPanel()
    expect(wrapper.find('.bp-pick-card').text()).not.toContain('协同 +')
  })

  it('unknown 候选一次带过「无 OP.GG 数据」', async () => {
    composableMock.picks.value = makePicks()
    const wrapper = await mountPanel()
    const cards = wrapper.findAll('.bp-pick-card')
    expect(cards[2].text()).toContain('其余对位/协同无 OP.GG 数据')
  })

  it('全部候选 ≤0 时显示「无正面对位优势」提示', async () => {
    composableMock.picks.value = [
      {
        championId: 67,
        score: 0,
        counterScore: 0,
        synergyScore: 0,
        evidences: [],
        synergyEvidences: []
      },
      {
        championId: 1,
        score: -0.1,
        counterScore: -0.1,
        synergyScore: 0,
        evidences: [],
        synergyEvidences: []
      }
    ]
    const wrapper = await mountPanel()
    expect(wrapper.text()).toContain('无正面对位优势英雄')
  })

  it('无推荐结果时显示空态（敌方锁定但无收益）', async () => {
    composableMock.picks.value = []
    const wrapper = await mountPanel()
    expect(wrapper.text()).toContain('敌方尚未锁定英雄')
  })

  it('切号重置（debug5-6）：旧号池清空并按新号重拉，不残留旧池', async () => {
    mockedInvoke.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === 'get_match_history_by_name') {
        const name = (args as { name: string }).name
        return Promise.resolve(historyOf(name === 'A#1' ? 51 : 11))
      }
      return Promise.resolve(null)
    })
    const wrapper = await mountPanel({ mySummonerName: 'A#1' })
    await enablePoolOnly(wrapper)
    expect(historyNames()).toEqual(['A#1'])
    expect(candidateArg().value).toEqual([51])

    await wrapper.setProps({ mySummonerName: 'B#2' })
    await tick()
    expect(historyNames()).toEqual(['A#1', 'B#2'])
    // 新号池（11）不含 51：不残留旧号；含 11：确是新号数据
    expect(candidateArg().value).not.toContain(51)
    expect(candidateArg().value).toContain(11)
  })

  it('切号竞态（debug5-6 衍生）：A 在途迟到不覆盖已切到的 B', async () => {
    let resolveA: ((v: MatchHistory) => void) | null = null
    mockedInvoke.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === 'get_match_history_by_name') {
        const name = (args as { name: string }).name
        if (name === 'A#1') {
          return new Promise<MatchHistory>(res => {
            resolveA = res
          })
        }
        return Promise.resolve(historyOf(11))
      }
      return Promise.resolve(null)
    })
    const wrapper = await mountPanel({ mySummonerName: 'A#1' })
    await enablePoolOnly(wrapper)
    // A 请求在途时切到 B：B 命中缓存前先走网络，同样返回 11
    const switchPromise = wrapper.setProps({ mySummonerName: 'B#2' })
    await switchPromise
    await tick()
    expect(historyNames()).toContain('B#2')
    // A 迟到回包（51）：世代守卫应丢弃，候选中不得出现旧号英雄
    resolveA!(historyOf(51))
    await tick()
    expect(candidateArg().value).not.toContain(51)
    expect(candidateArg().value).toContain(11)
  })

  it('切回旧号秒回（debug5-6）：模块级 myPoolCache 按名分键，不再请求网络', async () => {
    mockedInvoke.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === 'get_match_history_by_name') {
        const name = (args as { name: string }).name
        return Promise.resolve(historyOf(name === 'A#1' ? 51 : 11))
      }
      return Promise.resolve(null)
    })
    const wrapper = await mountPanel({ mySummonerName: 'A#1' })
    await enablePoolOnly(wrapper)
    await wrapper.setProps({ mySummonerName: 'B#2' })
    await tick()
    const callsAfterB = historyNames().length
    await wrapper.setProps({ mySummonerName: 'A#1' })
    await tick()
    // 切回 A 命中模块缓存：网络请求数不再涨，且候选回到 51
    expect(historyNames()).toHaveLength(callsAfterB)
    expect(candidateArg().value).toEqual([51])
  })
})
