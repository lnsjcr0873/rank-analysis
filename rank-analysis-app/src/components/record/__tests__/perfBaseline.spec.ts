import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Game, MatchPlayerIdentity, Participant, ParticipantStats } from '@renderer/types/domain/match'
import { filterMatches, type MatchFilterState } from '../matchFilters'
import { aggregateChampionPool } from '../championPool'
import RecordCard from '../RecordCard.vue'
import { recordAssetsKey } from '@renderer/composables/recordAssetsKey'

/**
 * P0 鎬ц兘鍩虹嚎锛堝彲澶嶇幇娴嬮噺澶瑰叿锛夛細
 * 璇?spec 涓嶈鏂█闃堝€硷紙CI 鎶栧姩锛夛紝鍙妸鏁板瓧鎵撳埌 console锛岀敱
 * design/PERF-BASELINE.md 浜哄伐钀界洏鎴愬熀绾垮揩鐓э紱鍚庣画闃舵锛圥1 鍗＄墖瀵嗗害銆? * P3 鍒嗛〉銆丳4 宸︽爮鎸夊綋鍓嶉〉閲嶇畻锛夎窇鍚屼竴澶瑰叿瀵规瘮锛屼綔涓?鏄惁鍥炲綊"鐨勪緷鎹€? *
 * 鏈枃浠朵繚鎸佽嚜鍖呭惈锛氳嚜瀹氫箟 makeGame/genGames 澶瑰叿 + 绾嚱鏁?+ 鎶樺彔鎬佸崟鍗? * 鑺傜偣閿氾紙40 鑺傜偣锛夈€傚妗ｅ弻鏂?10 浜洪樀瀹瑰垪璇疯 RecordCard.spec锛坵ide 妗ｏ級銆? *
 * 杩愯锛歯px vitest run src/components/record/__tests__/perfBaseline.spec.ts
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

/** 涓?MatchHistory 鍐?trendFilteredOf 鍚屾瀯鐨勮交閲忔槧灏勶紙鍒楄〃/瓒嬪娍鏉″悓婧愮殑閿氱偣锛?*/
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
  // warmup
  fn()
  const t0 = performance.now()
  for (let i = 0; i < rounds; i++) fn()
  return (performance.now() - t0) / rounds
}

function log(label: string, value: number, unit = 'ms') {
  console.log(`BASELINE ${label} ${value.toFixed(2)} ${unit}`)
}

describe('P0 鎬ц兘鍩虹嚎蹇収', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('绾嚱鏁拌€楁椂锛?00 / 1000 鍦猴級', async () => {
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

    // 鏂█浠呯敤浜庤 spec 鍙?缁?锛涢槇鍊间笉閿佹锛堝姣旂湅 PERF-BASELINE.md锛?    expect(filterMatches(g500, winFilter).length).toBeGreaterThan(0)
    expect(aggregateChampionPool(g500).length).toBeGreaterThan(0)
  })

  it('RecordCard 鎶樺彔鎬佸崟鍗¤妭鐐规暟锛?0 鑺傜偣閿氾級', () => {
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
    // 40 鑺傜偣閿氾紙鎶樺彔鎬侊級锛氫笉閿佹闃堝€硷紝浠呬繚璇佸彲娴?    expect(nodes[0]).toBeGreaterThan(0)
  })
})
