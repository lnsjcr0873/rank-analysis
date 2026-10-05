/**
 * 跨局汇总聚合（`computeAggregatedSummary`）。
 *
 * 移植自 Akari `analysis/player/aggregate/summary.ts`（80 行），字段一一对应。
 *
 * 两个口径决策：
 * - `avgKda` 用**跨局合并**口径 `(Σkills + Σassists) / Σdeaths`，
 *   而非「场均 KDA 的均值」。后者在死亡数分布不均时会被小样本局拉偏
 *   （一场 0 死 30 杀会把场均抬飞）。Akari 同此口径。
 * - SGP 独有的 `avgSoloKills` / `avgEnemyMissingPings` / `avgPings` 走
 *   `avgIfAllNonNull`：任一局缺失即整体 null ⇒ 对应 tag 自动隐藏，
 *   绝不出现「用半数样本算出的均值」。
 */

import { ACTIVE_SESSION_GAP_MS, ACTIVE_SESSION_LATEST_WINDOW_MS } from './constants'
import type {
  AggregatedSpellsAnalysis,
  AggregatedSummaryAnalysis,
  AggregatedTeamSideAnalysis,
  AggregatedWinLossAnalysis,
  PreparedGame
} from './types'
import {
  avgIfAllNonNull,
  avgOrOne,
  avgOrZero,
  calculateCoefficientOfVariation,
  noZero
} from './utils'

/** 闪现的召唤师技能 ID（与 `gameAdapter.SUMMONER_SPELL_FLASH_ID` 同值；独立声明避免环依赖） */
const FLASH_ID = 4

/**
 * 队内比较：`teamSide`。
 *
 * LCU 约定 100 = 蓝方、200 = 红方（斗魂为 `CHERRY-*`，此处不计入任一侧）。
 */
export function computeTeamSide(games: PreparedGame[]): AggregatedTeamSideAnalysis {
  let blueSideCount = 0
  let redSideCount = 0
  for (const g of games) {
    if (g.self.teamId === 100) blueSideCount++
    else if (g.self.teamId === 200) redSideCount++
  }
  return { blueSideCount, redSideCount }
}

/**
 * 召唤师技能聚合（当前只需闪现，供「可疑闪现」tag 使用）。
 *
 * `flashOnD` = 带闪现且闪现仍在 charges 中；`flashOnF` = 带闪现且已用完。
 * 两者同时 > 0 才有分析价值（说明确实在用闪现）。
 */
export function computeSpells(games: PreparedGame[]): AggregatedSpellsAnalysis {
  let flashOnD = 0
  let flashOnF = 0
  for (const g of games) {
    const { spell1Id, spell2Id } = g.self
    if (spell1Id !== FLASH_ID && spell2Id !== FLASH_ID) continue
    // 与 Akari 一致：以 spell1 位为代表位判 charges（LCU 顺序不稳定时取其一）
    if (spell1Id === FLASH_ID) flashOnD++
    else flashOnF++
  }
  return { flashOnD, flashOnF }
}

/**
 * 计算跨局汇总指标。
 *
 * @param games 已按时间**倒序**（最近一局在前）的 `PreparedGame` 列表
 */
export function computeAggregatedSummary(games: PreparedGame[]): AggregatedSummaryAnalysis {
  const summaries = games.map(g => g.single)
  const participants = games.map(g => g.self)

  const kills = participants.reduce((s, p) => s + p.kills, 0)
  const deaths = participants.reduce((s, p) => s + p.deaths, 0)
  const assists = participants.reduce((s, p) => s + p.assists, 0)
  const visionScores = participants.map(p => p.visionScore ?? 0)

  return {
    /* 输出伤害 */
    avgChampionDamageRatioToTeamMax: avgOrZero(summaries.map(s => s.championDamageRatioToTeamMax)),
    avgChampionDamageRatioToMax: avgOrZero(summaries.map(s => s.championDamageRatioToMax)),
    avgChampionDamagePercentageOfTeam: avgOrZero(
      summaries.map(s => s.championDamagePercentageOfTeam)
    ),
    avgChampionDamagePerMinute: avgOrZero(summaries.map(s => s.championDamagePerMinute)),

    /* 承伤 */
    avgDamageTakenRatioToTeamMax: avgOrZero(summaries.map(s => s.damageTakenRatioToTeamMax)),
    avgDamageTakenRatioToMax: avgOrZero(summaries.map(s => s.damageTakenRatioToMax)),
    avgDamageTakenPercentageOfTeam: avgOrZero(summaries.map(s => s.damageTakenPercentageOfTeam)),

    /* 经济 */
    avgGoldRatioToTeamMax: avgOrZero(summaries.map(s => s.goldRatioToTeamMax)),
    avgGoldRatioToMax: avgOrZero(summaries.map(s => s.goldRatioToMax)),
    avgGoldPercentageOfTeam: avgOrZero(summaries.map(s => s.goldPercentageOfTeam)),

    /* 补刀 */
    avgCsRatioToTeamMax: avgOrZero(summaries.map(s => s.csRatioToTeamMax)),
    avgCsRatioToMax: avgOrZero(summaries.map(s => s.csRatioToMax)),
    avgCsPercentageOfTeam: avgOrZero(summaries.map(s => s.csPercentageOfTeam)),
    avgCsPerMinute: avgOrZero(summaries.map(s => s.csPerMinute)),

    /* 推塔伤害 */
    avgTowerDamageRatioToTeamMax: avgOrZero(summaries.map(s => s.towerDamageRatioToTeamMax)),
    avgTowerDamageRatioToMax: avgOrZero(summaries.map(s => s.towerDamageRatioToMax)),
    avgTowerDamagePercentageOfTeam: avgOrZero(summaries.map(s => s.towerDamagePercentageOfTeam)),

    /* 视野 */
    avgVisionScore: avgOrZero(visionScores),
    avgVisionScorePercentageOfTeam: avgOrZero(summaries.map(s => s.visionScorePercentageOfTeam)),

    /* 综合效率 */
    avgDamageGoldEfficiency: avgOrZero(summaries.map(s => s.damageGoldEfficiency)),
    avgKillParticipation: avgOrZero(summaries.map(s => s.killParticipation)),
    /** 用 avgOrOne：空样本时取 1（"无效率差异"），不取 0 */
    avgKillDamageEfficiency: avgOrOne(summaries.map(s => s.killDamageEfficiency)),

    /* 累计与胜率 */
    kills,
    deaths,
    assists,
    avgKda: (kills + assists) / noZero(deaths),
    kdaCv: calculateCoefficientOfVariation(participants.map(p => p.kda)),
    winRate: participants.filter(p => p.win).length / noZero(participants.length),

    /* SGP 独有：任一局缺失即整体 null */
    avgSoloKills: avgIfAllNonNull(participants.map(p => p.soloKills)),
    avgEnemyMissingPings: avgIfAllNonNull(participants.map(p => p.enemyMissingPings))
  }
}

/**
 * 胜负聚合（含连胜/连跪与活跃 session）。
 *
 * `games` 必须按时间**倒序**（最近一局在前）——连胜/连跪从最近一局往前数。
 *
 * ⚠️ **时钟必须注入**：Akari 原实现直接调 `Date.now()`，导致测试不可确定
 * （同一份 fixtures 在不同时间跑出不同结果）。本实现改为由调用方传入 `nowMs`。
 *
 * @param games 时间倒序的对局列表
 * @param nowMs 当前时间戳（毫秒）；由调用方注入以便测试
 */
export function computeWinLoss(games: PreparedGame[], nowMs: number): AggregatedWinLossAnalysis {
  const count = games.length
  if (count === 0) {
    return {
      count: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      winningStreak: 0,
      losingStreak: 0,
      activeSessionWins: 0,
      activeSessionLosses: 0
    }
  }

  let wins = 0
  let losses = 0
  for (const g of games) {
    if (g.self.win) wins++
    else losses++
  }

  // 连胜/连跪：从最近一局（index 0）往前数，遇到结果翻转即停
  let winningStreak = 0
  let losingStreak = 0
  for (const g of games) {
    if (g.self.win) {
      if (losingStreak > 0) break
      winningStreak += 1
      continue
    }
    if (winningStreak > 0) break
    losingStreak += 1
  }

  /*
   * 活跃 session：从最近一局往前累加，直到「最近一局已太久」或「相邻间隔过大」。
   * 目的是把「今天连赢 5 把」与「上周连赢 5 把」区分开——后者不该算"当前连胜"。
   */
  let activeSessionWins = 0
  let activeSessionLosses = 0
  const latest = games[0]
  let lastGameEndedAt = latest.basic.gameCreation + latest.basic.gameDuration * 1000

  if (nowMs - lastGameEndedAt < ACTIVE_SESSION_LATEST_WINDOW_MS) {
    if (latest.self.win) activeSessionWins += 1
    else activeSessionLosses += 1

    for (let i = 1; i < games.length; i++) {
      const cur = games[i]
      if (lastGameEndedAt - cur.basic.gameCreation > ACTIVE_SESSION_GAP_MS) break
      if (cur.self.win) activeSessionWins += 1
      else activeSessionLosses += 1
      lastGameEndedAt = cur.basic.gameCreation + cur.basic.gameDuration * 1000
    }
  }

  return {
    count,
    wins,
    losses,
    winRate: wins / noZero(count),
    winningStreak,
    losingStreak,
    activeSessionWins,
    activeSessionLosses
  }
}
