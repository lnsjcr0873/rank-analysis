/**
 * `playerTimeline` 测试（P3 TS 侧）。
 *
 * 覆盖三件最容易出错、且出错后都是**静默**的事：
 * 1. 降级局绝不能混进均值（否则 C 类 Tag 显示一个编出来的数）
 * 2. 拿不到数据时必须返回 `null` 而不是 0——0 会被判成「难抓」
 * 3. 缓存不得跨不同 gameId 集串味
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  fetchPlayerTimelines,
  fetchPlayerTimeline,
  clearTimelineCache,
  timelineCacheSize,
  setTimelineInvoke,
  type PlayerTimelineEntry,
  type TimelineEntry
} from '../playerTimeline'

function entry(over: Partial<PlayerTimelineEntry> = {}): PlayerTimelineEntry {
  return {
    framesAnalyzed: 14,
    junglePath: ['blueBuff', 'gromp', 'wolves'],
    firstCampAtMs: 60_000,
    invadedBefore3min: true,
    earlyDeaths: 1,
    earlyDeathScore: 5,
    allEarlyDeathsSolo: true,
    contestedObjectives: 1,
    earlyDeathsWithEnemyJungler: 1,
    inferredJungleRole: true,
    ...over
  }
}

function ok(players: Record<string, PlayerTimelineEntry>): TimelineEntry {
  return { degraded: null, players }
}

beforeEach(() => {
  clearTimelineCache()
  setTimelineInvoke(null)
})

describe('playerTimeline · 汇总', () => {
  it('空输入不请求，返回不可用形态', async () => {
    const invoke = vi.fn()
    setTimelineInvoke(invoke)
    const out = await fetchPlayerTimelines('', [], [])
    expect(invoke).not.toHaveBeenCalled()
    expect(out.p1).toBeUndefined()
  })

  it('region 为空时全部不可用且不发请求', async () => {
    const invoke = vi.fn()
    setTimelineInvoke(invoke)
    const out = await fetchPlayerTimelines('', [1], [{ puuid: 'p1', teamId: 100 }])
    expect(invoke).not.toHaveBeenCalled()
    expect(out.p1.earlyDeathsWithEnemyJungler).toBeNull()
    expect(out.p1.gamesAnalyzed).toBe(0)
  })

  it('正常汇总：跨局均值与帧数', async () => {
    setTimelineInvoke(async () => ({
      1: ok({ p1: entry({ earlyDeathsWithEnemyJungler: 2 }) }),
      2: ok({ p1: entry({ earlyDeathsWithEnemyJungler: 4 }) })
    }))
    const out = await fetchPlayerTimelines('TN100', [1, 2], [{ puuid: 'p1', teamId: 100 }])
    expect(out.p1.gamesAnalyzed).toBe(2)
    expect(out.p1.earlyDeathsWithEnemyJungler).toBe(3)
  })

  it('降级局被剔除，不进均值', async () => {
    setTimelineInvoke(async () => ({
      1: ok({ p1: entry({ earlyDeathsWithEnemyJungler: 2 }) }),
      // 降级局里那个 100 绝不能把均值拉高
      2: {
        degraded: '无帧数据（需 SGP 路径）',
        players: { p1: entry({ earlyDeathsWithEnemyJungler: 100 }) }
      }
    }))
    const out = await fetchPlayerTimelines('TJ100', [1, 2], [{ puuid: 'p1', teamId: 100 }])
    expect(out.p1.gamesAnalyzed).toBe(1)
    expect(out.p1.earlyDeathsWithEnemyJungler).toBe(2)
  })

  it('null 局的玩家结果按不可用处理（不是 0）', async () => {
    setTimelineInvoke(async () => ({ 1: null }))
    const out = await fetchPlayerTimelines('TJ100', [1], [{ puuid: 'p1', teamId: 100 }])
    expect(out.p1.earlyDeathsWithEnemyJungler).toBeNull()
    expect(out.p1.gamesAnalyzed).toBe(0)
  })

  it('玩家未出现在结果里 ⇒ 不可用（不是 0）', async () => {
    setTimelineInvoke(async () => ({ 1: ok({ other: entry() }) }))
    const out = await fetchPlayerTimelines('TJ100', [1], [{ puuid: 'p1', teamId: 100 }])
    expect(out.p1.earlyDeathsWithEnemyJungler).toBeNull()
  })

  it('IPC 抛异常时降级为不可用且不向上抛', async () => {
    setTimelineInvoke(async () => {
      throw new Error('sgp down')
    })
    const out = await fetchPlayerTimelines('TJ100', [1], [{ puuid: 'p1', teamId: 100 }])
    expect(out.p1.earlyDeathsWithEnemyJungler).toBeNull()
  })

  it('无人死亡时 soloDeathRate 为 0 而非 null（是有效结论）', async () => {
    setTimelineInvoke(async () => ({
      1: ok({ p1: entry({ earlyDeaths: 0, allEarlyDeathsSolo: true }) })
    }))
    const out = await fetchPlayerTimeline('TJ100', [1], { puuid: 'p1', teamId: 100 })
    expect(out.soloDeathRate).toBe(0)
  })

  it('打野路径取频次最高者，并列时按字典序保证确定', async () => {
    setTimelineInvoke(async () => ({
      1: ok({ p1: entry({ junglePath: ['redBuff', 'krugs'] }) }),
      2: ok({ p1: entry({ junglePath: ['blueBuff', 'gromp'] }) }),
      3: ok({ p1: entry({ junglePath: ['blueBuff', 'gromp'] }) })
    }))
    const out = await fetchPlayerTimeline('TJ100', [1, 2, 3], { puuid: 'p1', teamId: 100 })
    expect(out.topJunglePath).toEqual(['blueBuff', 'gromp'])
  })
})

describe('playerTimeline · 缓存', () => {
  it('二次调用命中缓存、不再请求', async () => {
    const invoke = vi.fn(async () => ({ 1: ok({ p1: entry() }) }))
    setTimelineInvoke(invoke)
    await fetchPlayerTimelines('TJ100', [1], [{ puuid: 'p1', teamId: 100 }])
    expect(invoke).toHaveBeenCalledTimes(1)
    await fetchPlayerTimelines('TJ100', [1], [{ puuid: 'p1', teamId: 100 }])
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('gameId 集不同则不复用缓存', async () => {
    const invoke = vi.fn(async () => ({ 1: ok({ p1: entry() }) }))
    setTimelineInvoke(invoke)
    await fetchPlayerTimelines('TJ100', [1], [{ puuid: 'p1', teamId: 100 }])
    await fetchPlayerTimelines('TJ100', [9, 8], [{ puuid: 'p1', teamId: 100 }])
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('批量里部分玩家命中缓存时，只为缺失者请求', async () => {
    const invoke = vi.fn(async (_cmd: string, _args?: Record<string, unknown>) => ({
      1: ok({ p1: entry(), p2: entry() })
    }))
    setTimelineInvoke(invoke)
    await fetchPlayerTimelines('TJ100', [1], [{ puuid: 'p1', teamId: 100 }])
    await fetchPlayerTimelines(
      'TJ100',
      [1],
      [
        { puuid: 'p1', teamId: 100 },
        { puuid: 'p2', teamId: 100 }
      ]
    )
    // 第二次只把 p2 发上去
    const calls = invoke.mock.calls as unknown as [string, Record<string, unknown>][]
    const lastArgs = calls[calls.length - 1][1]
    const sent = lastArgs.players as { puuid: string }[]
    expect(sent.map(p => p.puuid)).toEqual(['p2'])
  })

  it('缓存条目可清空（测试隔离）', async () => {
    setTimelineInvoke(async () => ({ 1: ok({ p1: entry() }) }))
    await fetchPlayerTimelines('TJ100', [1], [{ puuid: 'p1', teamId: 100 }])
    expect(timelineCacheSize()).toBe(1)
    clearTimelineCache()
    expect(timelineCacheSize()).toBe(0)
  })
})
