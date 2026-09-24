import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type {
  Game,
  MatchPlayerIdentity,
  Participant,
  ParticipantStats
} from '@renderer/types/domain/match'
import { filterMatches, type MatchFilterState } from '../matchFilters'
import { aggregateChampionPool } from '../championPool'
import RecordCard from '../RecordCard.vue'
import { recordAssetsKey } from '@renderer/composables/recordAssetsKey'

/**
 * 性能基线（可复现测量夹具）：
 * 本 spec 不设断言阈值（CI 抖动），只把数字打到 console，由
 * design/PERF-BASELINE.md 人工落盘成基线快照；后续阶段（Akari 116px 重组、
 * 就地展开、分页双点位）跑同一夹具对比，作为"是否回归"的依据。
 * 本文件保持自包含：自定义 makeGame/genGames 夹具 + 纯函数 + 折叠态单卡
 * 节点锚（61 节点，头部统计并入收起卡后）。宽档 10 人阵容列请见 RecordCard.spec。
 * 运行：npx vitest run src/components/record/__tests__/perfBaseline.spec.ts
 */
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => [])
}))

vi.mock('naive-ui', async () => {
  const actual = await vi.importActual<typeof import('naive-ui')>('naive-ui')
  return {
    ...actual,
    useLoadingBar: () => ({ start: vi.fn(), finish: vi.fn(), error: vi.fn() })
  }
})

function makeGame(
  overrides: Partial<Game> & { championId?: number; stats?: Partial<ParticipantStats> } = {}
): Game {
  const stats: ParticipantStats = {
    win: true,
    item0: 0,
    item1: 0,
    item2: 0,
    item3: 0,
    item4: 0,
    item5: 0,
    item6: 0,
    perk0: 0,
    perkPrimaryStyle: 0,
    perkSubStyle: 0,
    playerAugment1: 0,
    playerAugment2: 0,
    playerAugment3: 0,
    playerAugment4: 0,
    playerAugment5: 0,
    playerAugment6: 0,
    kills: 5,
    deaths: 3,
    assists: 8,
    goldEarned: 12000,
    goldSpent: 11000,
    totalDamageDealtToChampions: 15000,
    totalDamageDealt: 40000,
    totalDamageTaken: 18000,
    totalHeal: 9000,
    totalMinionsKilled: 180,
    neutralMinionsKilled: 20,
    damageDealtToTurrets: 3000,
    groupRate: 0.5,
    goldEarnedRate: 0.6,
    damageDealtToChampionsRate: 0.7,
    damageTakenRate: 0.8,
    healRate: 0.4,
    playerSubteamId: 0,
    subteamPlacement: 0,
    ...(overrides.stats ?? {})
  }
  const participant: Participant = {
    win: stats.win,
    participantId: 1,
    teamId: 0,
    championId: overrides.championId ?? 1,
    spell1Id: 4,
    spell2Id: 6,
    stats
  }
  return {
    ...overrides,
    gameId: overrides.gameId ?? 1,
    queueId: overrides.queueId ?? 420,
    gameMode: overrides.gameMode ?? 'MATCHED_GAME',
    gameType: overrides.gameType ?? 'MATCHED_GAME',
    gameCreationDate: overrides.gameCreationDate ?? new Date().toISOString(),
    gameDuration: overrides.gameDuration ?? 1500,
    mapId: overrides.mapId ?? 11,
    platformId: overrides.platformId ?? 'NA1',
    queueName: overrides.queueName ?? 'Ranked Solo',
    mvp: overrides.mvp ?? '',
    gameDetail: {
      endOfGameResult: '',
      participantIdentities: [],
      participants: [participant]
    },
    participantIdentities: [] as MatchPlayerIdentity[],
    participants: [participant]
  }
}

function genGames(count: number): Game[] {
  const out: Game[] = []
  for (let i = 0; i < count; i++) {
    out.push(
      makeGame({
        gameId: 10000 + i,
        queueId: i % 2 === 0 ? 420 : 440,
        championId: i % 2 === 0 ? 103 : 157,
        stats: { win: i % 3 !== 0 }
      })
    )
  }
  return out
}

/** 与 MatchHistory 的 trendFilteredOf 同构的轻量映射（列表/趋势条同源的锚点） */
function trendFilteredOf(games: Game[]) {
  return games.map(g => {
    const s = g.participants[0]?.stats
    return {
      gameId: g.gameId,
      gameDuration: g.gameDuration,
      gameCreationDate: g.gameCreationDate,
      mvp: g.mvp,
      win: s?.win ?? false,
      championId: g.participants[0]?.championId ?? 0,
      kills: s?.kills ?? 0,
      deaths: s?.deaths ?? 0,
      assists: s?.assists ?? 0
    }
  })
}

function ms(fn: () => unknown, rounds = 5): number {
  fn() // warmup
  const t0 = performance.now()
  for (let i = 0; i < rounds; i++) fn()
  return (performance.now() - t0) / rounds
}

function log(label: string, value: number, unit = 'ms') {
  console.log(`BASELINE ${label} ${value.toFixed(2)} ${unit}`)
}

describe('性能基线快照', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('纯函数耗时（500 / 1000 场）', async () => {
    const g500 = genGames(500)
    const g1000 = genGames(1000)
    const noFilter: MatchFilterState = {
      queueId: 0,
      championId: 0,
      result: 'all',
      timeWindowHours: 0
    }
    const champFilter: MatchFilterState = { ...noFilter, championId: 103 }
    const winFilter: MatchFilterState = { ...noFilter, result: 'win' }
    const queueFilter: MatchFilterState = { ...noFilter, queueId: 420 }
    const windowFilter: MatchFilterState = { ...noFilter, timeWindowHours: 24 }

    const filter0 = ms(() => filterMatches(g500, noFilter))
    log('filterMatches.500.noFilter', filter0, 'ms(1x)')

    const filter1 = ms(() => filterMatches(g500, champFilter))
    log('filterMatches.500.champion', filter1, 'ms(1x)')

    const filter2 = ms(() => filterMatches(g500, winFilter))
    log('filterMatches.500.win', filter2, 'ms(1x)')

    const filter3 = ms(() => filterMatches(g500, queueFilter))
    log('filterMatches.500.queue', filter3, 'ms(1x)')

    const filter4 = ms(() => filterMatches(g500, windowFilter))
    log('filterMatches.500.window24h', filter4, 'ms(1x)')

    const filter5 = ms(() => filterMatches(g1000, winFilter))
    log('filterMatches.1000.win', filter5, 'ms(1x)')

    const pool = ms(() => aggregateChampionPool(g500))
    log('aggregateChampionPool.500', pool, 'ms(1x)')

    const pool1000 = ms(() => aggregateChampionPool(g1000))
    log('aggregateChampionPool.1000', pool1000, 'ms(1x)')

    const trend = ms(() => trendFilteredOf(g500))
    log('trendFilteredOf.500', trend, 'ms(1x)')

    const trend1000 = ms(() => trendFilteredOf(g1000))
    log('trendFilteredOf.1000', trend1000, 'ms(1x)')

    // 断言仅用于让 spec 可跑通；阈值不锁死（对比看 PERF-BASELINE.md）
    expect(filterMatches(g500, winFilter).length).toBeGreaterThan(0)
    expect(aggregateChampionPool(g500).length).toBeGreaterThan(0)
  })

  it('RecordCard 折叠态单卡节点数（61 节点锚）', () => {
    const assetsStub = { srcOf: () => '', detailOf: () => null, preload: () => undefined }
    const game = genGames(1)[0]
    const nodes: number[] = []
    for (let i = 0; i < 3; i++) {
      const wrapper = mount(RecordCard, {
        props: {
          recordType: true,
          games: game,
          championOptions: []
        },
        global: {
          provide: { [recordAssetsKey as unknown as string]: assetsStub }
        }
      })
      nodes.push(wrapper.element.querySelectorAll('*').length)
      wrapper.unmount()
    }
    log(
      'recordcard.collapsed.nodeCount.avg',
      nodes.reduce((a, b) => a + b, 0) / nodes.length,
      'nodes'
    )
    // 61 节点锚（折叠态，116px + 头部统计并入）：不锁死阈值，仅保证可测
    expect(nodes[0]).toBeGreaterThan(0)
  })
})
