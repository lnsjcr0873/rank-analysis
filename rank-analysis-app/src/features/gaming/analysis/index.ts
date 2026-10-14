/**
 * 画像分析编排层（`analyzePlayerProfile`）。
 *
 * 把 `gameAdapter → singleSummary → aggregate* → positions` 串成一次调用，
 * 对外只暴露一个入口。**纯函数、零 IO**：入参是已归一化的对局数组，
 * 网络取数由 `services/playerAnalysis.ts` 负责。
 *
 * 数据流：
 *   rank Game[] → normalizeGame → computeSingleSummary → PreparedGame[]
 *   PreparedGame[] → computeAggregatedSummary / computeWinLossMap
 *                  → computeAggregateScore / computeChampions / computePositions
 *                  → PlayerProfileAnalysis
 */

import type { Game } from '@renderer/types/domain/match'

import { computeAggregatedSummary, computeSpells, computeTeamSide } from './aggregateSummary'
import { computeAggregateScore } from './aggregateScore'
import { PVE_QUEUE_IDS } from './constants'
import { normalizeGame, type NormalizedGame } from './gameAdapter'
import { computeChampions, computePositions, computeWinLossMap } from './positions'
import { computeSingleSummary } from './singleSummary'
import type { PlayerProfileAnalysis, PreparedGame } from './types'

/** 默认取最近多少局（对齐 Akari `matchHistoryLoadCount` 默认 50） */
export const DEFAULT_GAME_LIMIT = 50

/** 一局对局的原始输入（rank `Game` + 本人 puuid） */
export interface AnalyzeGameInput {
  game: Game
  puuid: string
}

/**
 * 筛选口径过滤：一局是否计入画像。
 *
 * 排除两类（与 Akari `isPveOrNonMatchedGame` / `isAbortedOrRemadeGame` 对齐）：
 * - PvE 队列（大乱斗 / 无限火力 / 机器人 / 无限乱斗 / 激斗）——胜率、参团、
 *   队内占比与竞技不可比，混进 50 场窗口会污染整张画像
 * - 中止 / 重做局——没有有效胜负，计入会同时稀释胜率与场均数据
 */
export function shouldIncludeGame(game: Game): boolean {
  if (PVE_QUEUE_IDS.has(game.queueId)) return false
  // gameType 非 MATCHED_GAME 的局（自定义房、训练模式）同样排除
  if (game.gameType && game.gameType !== 'MATCHED_GAME') return false
  return true
}

/**
 * 计算一名玩家的完整画像。
 *
 * @param games 原始对局（顺序不限，内部会按创建时间倒序）
 * @param puuid 本人 puuid
 * @param nowMs 当前时间（注入以便测试；活跃 session / 连胜判定依赖它）
 * @param options.limit 最多取最近多少局（对应 Akari `matchHistoryLoadCount`，默认 50）
 * @returns 画像；可用对局为 0 时返回 null（调用方据此渲染空态，**不返回全零对象**）
 */
export function analyzePlayerProfile(
  games: Game[],
  puuid: string,
  nowMs: number,
  options: { limit?: number } = {}
): PlayerProfileAnalysis | null {
  const limit = options.limit ?? DEFAULT_GAME_LIMIT

  // 1) 过滤 + 归一化。normalizeGame 返回 null 表示该局找不到本人（跨区归属变化等）
  const normalized = games
    .filter(shouldIncludeGame)
    .map(g => normalizeGame(g, puuid))
    .filter((n): n is NormalizedGame => n !== null)

  if (normalized.length === 0) return null

  // 2) 时间倒序（最近在前）——连胜/连跪/活跃 session 都从最近一局往前数
  normalized.sort((a, b) => b.basic.gameCreation - a.basic.gameCreation)

  // 3) 截断到最近 N 局（先倒序再截断，保证留下的是最近的）
  const limited = normalized.slice(0, limit)

  // 4) 逐局计算占比/比率
  const prepared: PreparedGame[] = limited.map(n => ({
    gameId: n.basic.gameId,
    basic: n.basic,
    self: n.self,
    teamMates: n.teamMates,
    everyone: n.everyone,
    single: computeSingleSummary(n.self, n.teamMates, n.everyone, n.basic.gameDuration)
  }))

  // 5) 跨局聚合
  const summary = computeAggregatedSummary(prepared)
  const winLoss = computeWinLossMap(prepared, nowMs)

  return {
    count: prepared.length,
    summary,
    winLoss,
    score: computeAggregateScore(prepared, summary.avgKda, summary.winRate),
    positions: computePositions(prepared),
    spells: computeSpells(prepared),
    teamSide: computeTeamSide(prepared),
    champions: computeChampions(prepared, nowMs),
    games: prepared
  }
}
