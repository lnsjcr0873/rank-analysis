/**
 * `playerTags.spec.ts` 单测。
 *
 * 重点锁三类语义（这些都是"看起来能跑但结论错"的地方）：
 * 1. **B/C 类 Tag 在数据缺失时必须不产出**（而非产出 0 或灰态）——
 *    否则会出现「有 tag 但数据是空的」假象；
 * 2. **阈值边界严格性**（`>=` vs `>`），差一场就贴错标签；
 * 3. **不产出"中性区间"的 Tag**（人头伤害占比 0.65~1.35、区间内的好抓档）。
 *
 * 另锁一条设计系统硬约束：**本文件不得出现 hex**。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  computeKdaOutliers,
  buildPlayerTags,
  PLAYER_TAG_IDS,
  TAG_THRESHOLDS,
  KDA_IQR_THRESHOLD,
  type TagContext
} from './playerTags'
import type { PlayerProfileAnalysis } from '@renderer/features/gaming/analysis/types'

const CTX: TagContext = {
  isSelf: false,
  premadeGroup: null,
  premadeThreshold: 5,
  metTotal: 0,
  earlyDeathsWithEnemyJungler: null
}

/** 造一个可控画像 */
function makeProfile(
  over: {
    count?: number
    score?: number
    winRate?: number
    wins?: number
    winningStreak?: number
    losingStreak?: number
    damageShare?: number
    takenShare?: number
    goldShare?: number
    csPerMinute?: number
    vision?: number
    damageGold?: number
    kde?: number
    soloKills?: number | null
    enemyMissingPings?: number | null
  } = {}
): PlayerProfileAnalysis {
  const winRate = over.winRate ?? 0.55
  const wins = over.wins ?? 10
  const count = over.count ?? 20
  const summary = {
    avgChampionDamagePercentageOfTeam: over.damageShare ?? 0.2,
    avgDamageTakenPercentageOfTeam: over.takenShare ?? 0.2,
    avgGoldPercentageOfTeam: over.goldShare ?? 0.2,
    avgCsPerMinute: over.csPerMinute ?? 6,
    avgVisionScore: over.vision ?? 30,
    avgDamageGoldEfficiency: over.damageGold ?? 1.0,
    avgKillDamageEfficiency: over.kde ?? 1,
    // SGP 独有字段：默认 undefined（模拟 rank 走 LCU 时该字段缺失），
    // 显式传 null / 数值才产出对应 Tag
    avgSoloKills: over.soloKills,
    avgEnemyMissingPings: over.enemyMissingPings
  } as PlayerProfileAnalysis['summary']

  const total = over.score ?? 6

  return {
    count,
    summary,
    winLoss: {
      all: {
        count,
        wins,
        losses: count - wins,
        winRate,
        winningStreak: over.winningStreak ?? 0,
        losingStreak: over.losingStreak ?? 0,
        activeSessionWins: 0,
        activeSessionLosses: 0
      },
      normal: {
        count,
        wins,
        losses: count - wins,
        winRate,
        winningStreak: over.winningStreak ?? 0,
        losingStreak: over.losingStreak ?? 0,
        activeSessionWins: 0,
        activeSessionLosses: 0
      },
      cherry: {
        count: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        winningStreak: 0,
        losingStreak: 0,
        activeSessionWins: 0,
        activeSessionLosses: 0,
        top1s: 0,
        topHalfFinishes: 0,
        top1Rate: 0,
        topHalfRate: 0,
        avgSubteamPlacement: 0
      }
    },
    score: {
      kdaScore: 0,
      winRateScore: 0,
      damageScore: 0,
      damageTakenScore: 0,
      healingScore: 0,
      csScore: 0,
      goldScore: 0,
      participationScore: 0,
      visionScore: 0,
      total,
      maxScore: 17,
      outstanding: total >= 6.5 && count >= 5,
      extraordinary: total >= 8 && count >= 8
    },
    positions: {},
    spells: { flashOnD: 0, flashOnF: 0 },
    teamSide: { blueSideCount: 0, redSideCount: 0 },
    champions: [],
    games: []
  }
}

const idsOf = (tags: ReturnType<typeof buildPlayerTags>) => tags.map(t => t.id)

describe('playerTags · 设计系统硬约束', () => {
  it('文件内不得出现 hex 色（须走 --tag-* token）', () => {
    const src = readFileSync(resolve(__dirname, './playerTags.ts'), 'utf8')
    // 去掉注释后再扫，避免注释里的示例 hex 造成误报
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const hexes = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    expect(hexes, `发现硬编码色：${hexes.join(', ')}`).toHaveLength(0)
  })

  it('每个 Tag 的 tone 都在 8 个语义族内', () => {
    const allowed = new Set(['neutral', 'info', 'win', 'loss', 'brand', 'warn', 'danger', 'muted'])
    const tags = buildPlayerTags(makeProfile({ score: 9, count: 10, winRate: 0.9, wins: 18 }), {
      ...CTX,
      isSelf: true,
      premadeGroup: 'A',
      metTotal: 3
    })
    expect(tags.length).toBeGreaterThan(0)
    for (const t of tags) expect(allowed.has(t.tone)).toBe(true)
  })
})

describe('buildPlayerTags · 身份与趋势', () => {
  it('本人 / 预组 / 遇见过 按需产出', () => {
    const none = buildPlayerTags(makeProfile(), CTX)
    expect(idsOf(none)).not.toContain('self')
    expect(idsOf(none)).not.toContain('premade')
    expect(idsOf(none)).not.toContain('met')

    const all = buildPlayerTags(makeProfile(), {
      ...CTX,
      isSelf: true,
      premadeGroup: 'B',
      metTotal: 12
    })
    expect(idsOf(all)).toContain('self')
    expect(idsOf(all)).toContain('premade')
    expect(idsOf(all)).toContain('met')
    expect(all.find(t => t.id === 'premade')!.label).toContain('B')
  })

  it('高胜率需同时满足样本 ≥16 与胜率 ≥85%（边界严格）', () => {
    // 恰好 16 场 85% → 产出
    const hit = buildPlayerTags(makeProfile({ count: 16, wins: 14, winRate: 0.85 }), CTX)
    expect(idsOf(hit)).toContain('highWinRate')
    // 15 场 100% → 不产出（样本不足）
    const few = buildPlayerTags(makeProfile({ count: 15, wins: 15, winRate: 1 }), CTX)
    expect(idsOf(few)).not.toContain('highWinRate')
    // 20 场 80% → 不产出（胜率不足）
    const low = buildPlayerTags(makeProfile({ count: 20, wins: 16, winRate: 0.8 }), CTX)
    expect(idsOf(low)).not.toContain('highWinRate')
  })

  it('连胜/连跪门槛为 3', () => {
    expect(idsOf(buildPlayerTags(makeProfile({ winningStreak: 3 }), CTX))).toContain(
      'winningStreak'
    )
    expect(idsOf(buildPlayerTags(makeProfile({ winningStreak: 2 }), CTX))).not.toContain(
      'winningStreak'
    )
    expect(idsOf(buildPlayerTags(makeProfile({ losingStreak: 3 }), CTX))).toContain('losingStreak')
  })
})

describe('buildPlayerTags · 实力档位', () => {
  it('performance 一个 Tag 带两档：非凡严格优先于卓越', () => {
    const extra = buildPlayerTags(makeProfile({ score: 9, count: 10 }), CTX)
    const extraTags = extra.filter(t => t.id === 'performance')
    expect(extraTags).toHaveLength(1)
    expect(extraTags[0].label).toContain('非凡')

    const out = buildPlayerTags(makeProfile({ score: 7, count: 10 }), CTX)
    const outTags = out.filter(t => t.id === 'performance')
    expect(outTags).toHaveLength(1)
    expect(outTags[0].label).toContain('卓越')
  })

  it('样本不足时不打档位标签', () => {
    const few = buildPlayerTags(makeProfile({ score: 9, count: 4 }), CTX)
    expect(idsOf(few)).not.toContain('performance')
  })

  it('低于 6.5 不打 performance', () => {
    expect(idsOf(buildPlayerTags(makeProfile({ score: 6.4, count: 10 }), CTX))).not.toContain(
      'performance'
    )
  })

  it('17 分标签始终产出（它是核心指标而非档位）', () => {
    expect(idsOf(buildPlayerTags(makeProfile({ score: 5.5 }), CTX))).toContain('score')
  })
})

describe('buildPlayerTags · 数据指标阈值', () => {
  const cases: Array<[string, Parameters<typeof makeProfile>[0], boolean]> = [
    ['damageShare', { damageShare: 0.28 }, true],
    ['damageShare', { damageShare: 0.27 }, false],
    ['takenShare', { takenShare: 0.3 }, true],
    ['takenShare', { takenShare: 0.29 }, false],
    ['goldShare', { goldShare: 0.275 }, true],
    ['goldShare', { goldShare: 0.274 }, false],
    ['cs', { csPerMinute: 7 }, true],
    ['cs', { csPerMinute: 6.9 }, false],
    ['vision', { vision: 50 }, true],
    ['vision', { vision: 49.9 }, false]
  ]
  it.each(cases)('%s 在阈值边界正确取舍', (id, over, expected) => {
    const tags = buildPlayerTags(makeProfile(over), CTX)
    expect(idsOf(tags).includes(id)).toBe(expected)
  })

  it('伤金转化 > 1 才产出', () => {
    expect(idsOf(buildPlayerTags(makeProfile({ damageGold: 1.01 }), CTX))).toContain(
      'damageGoldEfficiency'
    )
    expect(idsOf(buildPlayerTags(makeProfile({ damageGold: 1.0 }), CTX))).not.toContain(
      'damageGoldEfficiency'
    )
  })

  it('人头伤害占比：中性区间不产出任何标签', () => {
    // 1.35 ~ 0.65 之间（1.0）既不产人头怪也不产伤害型
    const mid = buildPlayerTags(makeProfile({ kde: 1.0 }), CTX)
    expect(idsOf(mid)).not.toContain('kdeHigh')
    expect(idsOf(mid)).not.toContain('kdeLow')
    // > 1.35 人头怪
    expect(idsOf(buildPlayerTags(makeProfile({ kde: 1.36 }), CTX))).toContain('kdeHigh')
    // < 0.65 伤害型
    expect(idsOf(buildPlayerTags(makeProfile({ kde: 0.64 }), CTX))).toContain('kdeLow')
  })
})

describe('buildPlayerTags · B 类（SGP 独有）缺失时不产出', () => {
  it('avgSoloKills 为 null → 不产出单杀标签', () => {
    const tags = buildPlayerTags(makeProfile({ soloKills: null }), CTX)
    expect(idsOf(tags)).not.toContain('soloKills')
    // 有值时产出
    expect(idsOf(buildPlayerTags(makeProfile({ soloKills: 1.4 }), CTX))).toContain('soloKills')
  })

  it('avgEnemyMissingPings 为 null → 不产出', () => {
    expect(idsOf(buildPlayerTags(makeProfile({ enemyMissingPings: null }), CTX))).not.toContain(
      'enemyMissingPings'
    )
    expect(idsOf(buildPlayerTags(makeProfile({ enemyMissingPings: 4.2 }), CTX))).toContain(
      'enemyMissingPings'
    )
  })

  it('敌方消失信号需 ≥3 才产出（低于阈值不刷屏）', () => {
    expect(idsOf(buildPlayerTags(makeProfile({ enemyMissingPings: 2.9 }), CTX))).not.toContain(
      'enemyMissingPings'
    )
  })
})

describe('buildPlayerTags · C 类（需 frames）未接入时静默', () => {
  it('earlyDeaths 为 null → 三个好抓标签都不产出', () => {
    const tags = buildPlayerTags(makeProfile(), CTX)
    expect(idsOf(tags)).not.toContain('veryEasyGank')
    expect(idsOf(tags)).not.toContain('easyGank')
    expect(idsOf(tags)).not.toContain('hardGank')
  })

  it('接入后按阈值产出三档', () => {
    const ctx = { ...CTX, earlyDeathsWithEnemyJungler: 2.5 }
    expect(idsOf(buildPlayerTags(makeProfile(), ctx))).toContain('veryEasyGank')
    expect(
      idsOf(buildPlayerTags(makeProfile(), { ...CTX, earlyDeathsWithEnemyJungler: 1.6 }))
    ).toContain('easyGank')
    expect(
      idsOf(buildPlayerTags(makeProfile(), { ...CTX, earlyDeathsWithEnemyJungler: 0.5 }))
    ).toContain('hardGank')
  })

  it('1.0 ~ 1.5 的中间区间不产出（避免"既不好抓也不难抓"的噪音）', () => {
    const tags = buildPlayerTags(makeProfile(), {
      ...CTX,
      earlyDeathsWithEnemyJungler: 1.2
    })
    expect(idsOf(tags)).not.toContain('veryEasyGank')
    expect(idsOf(tags)).not.toContain('easyGank')
    expect(idsOf(tags)).not.toContain('hardGank')
  })

  it('本人不产出好抓标签（自己不会被"抓"的判断评价）', () => {
    const tags = buildPlayerTags(makeProfile(), {
      ...CTX,
      isSelf: true,
      earlyDeathsWithEnemyJungler: 2.5
    })
    expect(idsOf(tags)).not.toContain('veryEasyGank')
  })
})

describe('buildPlayerTags · 开关与 id 清单', () => {
  it('enabled=false 可屏蔽单个标签', () => {
    const profile = makeProfile({ score: 9, count: 10, winRate: 0.9, wins: 18 })
    const withAll = buildPlayerTags(profile, CTX)
    const withoutScore = buildPlayerTags(profile, CTX, { score: false })
    expect(idsOf(withAll)).toContain('score')
    expect(idsOf(withoutScore)).not.toContain('score')
    // 其他标签不受影响
    expect(idsOf(withoutScore)).toContain('performance')
  })

  it('PLAYER_TAG_IDS 共 21 个（与设计文档 §3 对齐）', () => {
    expect(PLAYER_TAG_IDS).toHaveLength(21)
  })

  it('阈值常量与设计文档一致（防误改）', () => {
    expect(TAG_THRESHOLDS.HIGH_WIN_RATE_MIN_COUNT).toBe(16)
    expect(TAG_THRESHOLDS.HIGH_WIN_RATE_MIN).toBe(0.85)
    expect(TAG_THRESHOLDS.STREAK_MIN).toBe(3)
    expect(TAG_THRESHOLDS.OUTSTANDING_THRESHOLD).toBe(6.5)
    expect(TAG_THRESHOLDS.OUTSTANDING_MIN_COUNT).toBe(5)
    expect(TAG_THRESHOLDS.EXTRAORDINARY_THRESHOLD).toBe(8)
    expect(TAG_THRESHOLDS.EXTRAORDINARY_MIN_COUNT).toBe(8)
    expect(KDA_IQR_THRESHOLD).toBe(0.65)
  })
})

describe('computeKdaOutliers', () => {
  it('少于 5 人不标（样本不足时离群判定无意义）', () => {
    const entries = [1, 2, 3].map(i => ({ puuid: `p${i}`, avgKda: i }))
    const map = computeKdaOutliers(entries)
    expect([...map.values()].every(v => v === null)).toBe(true)
  })

  it('极端高 KDA 被标为 over', () => {
    const entries = [
      { puuid: 'a', avgKda: 3 },
      { puuid: 'b', avgKda: 3.1 },
      { puuid: 'c', avgKda: 2.9 },
      { puuid: 'd', avgKda: 3.05 },
      { puuid: 'e', avgKda: 3.2 },
      { puuid: 'f', avgKda: 20 }
    ]
    const map = computeKdaOutliers(entries)
    expect(map.get('f')).toBe('over')
    expect(map.get('a')).toBeNull()
  })

  it('极端低 KDA 被标为 below', () => {
    const entries = [
      { puuid: 'a', avgKda: 3 },
      { puuid: 'b', avgKda: 3.1 },
      { puuid: 'c', avgKda: 2.9 },
      { puuid: 'd', avgKda: 3.05 },
      { puuid: 'e', avgKda: 3.2 },
      { puuid: 'f', avgKda: 0.1 }
    ]
    expect(computeKdaOutliers(entries).get('f')).toBe('below')
  })

  it('全员相近时无人被标（不制造噪音）', () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ puuid: `p${i}`, avgKda: 3 + i * 0.01 }))
    const map = computeKdaOutliers(entries)
    expect([...map.values()].every(v => v === null)).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * C 类 Tag（P3 帧级数据接入）
 *
 * 这三个 Tag 在 P1/P3 之前是死代码——ctx 里恒为 undefined，永远不渲染。
 * 本组用例锁住「数据到位就亮、数据不可用就完全不出现」，
 * 尤其是**不可用时不能用 0 兜底**：0 会被判成「难抓」，是误导性结论。
 * ------------------------------------------------------------------ */
describe('buildPlayerTags · C 类（帧级）', () => {
  const withGank = (early: number | null | undefined, isSelf = false) => ({
    ...CTX,
    isSelf,
    earlyDeathsWithEnemyJungler: early
  })

  it('数据为 null ⇒ 三个抓人 Tag 都不出现', () => {
    const ids = idsOf(buildPlayerTags(makeProfile(), withGank(null)))
    expect(ids).not.toContain('veryEasyGank')
    expect(ids).not.toContain('easyGank')
    expect(ids).not.toContain('hardGank')
  })

  it('数据为 undefined（未接入）⇒ 同上，不产生误导性结论', () => {
    const ids = idsOf(buildPlayerTags(makeProfile(), withGank(undefined)))
    expect(ids).not.toContain('hardGank')
    expect(ids).not.toContain('easyGank')
  })

  it('高值 ⇒ 极好抓', () => {
    expect(idsOf(buildPlayerTags(makeProfile(), withGank(2.5)))).toContain('veryEasyGank')
  })

  it('中值 ⇒ 好抓', () => {
    expect(idsOf(buildPlayerTags(makeProfile(), withGank(1.6)))).toContain('easyGank')
  })

  it('低值 ⇒ 难抓', () => {
    expect(idsOf(buildPlayerTags(makeProfile(), withGank(0.5)))).toContain('hardGank')
  })

  it('本人不适用（自己不会被敌方打野抓）', () => {
    const ids = idsOf(buildPlayerTags(makeProfile(), withGank(2.5, true)))
    expect(ids).not.toContain('veryEasyGank')
  })
})
