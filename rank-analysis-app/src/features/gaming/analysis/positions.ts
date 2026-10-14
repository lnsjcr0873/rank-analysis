/**
 * 分路 / 英雄分桶 / 斗魂胜负三分桶。
 *
 * 移植自 Akari `analysis/player/aggregate/{positions,champions,win-loss}.ts` +
 * `match-history/cherry.ts` 的 summary 层部分。
 *
 * 三个消费场景：
 * - 英雄分桶 → 卡片上「英雄使用环」（按场次降序，环色按该英雄胜率）
 * - 分路分布 → 卡片头部「本局分路 | 近期常玩分路」，以及补位识别
 * - 胜负三分桶 → all / normal / cherry。斗魂局的名次维度只在 cherry 桶存在，
 *   把斗魂局混进 normal 会让「前半数率」等指标失去意义
 */

import { computeAggregatedSummary, computeWinLoss } from './aggregateSummary'
import { computeAggregateScore } from './aggregateScore'
import type {
  AggregatedChampionAnalysis,
  AggregatedCherryWinLossAnalysis,
  AggregatedPositionMap,
  AggregatedSummaryAnalysis,
  AggregatedWinLossMap,
  PreparedGame
} from './types'

/**
 * 推算斗魂该局的小队总数。
 *
 * LCU 不直接给队伍数。按 Akari `getCherryTeamCount` 的口径：统计全场出现过的
 * 有效 `subteamId` 个数（名次 ≤ 0 的参与者不参与计数——他们的数据尚未落定）。
 *
 * @param game 单局（需含 `everyone`）
 * @returns 小队数；无法判定时返回 0（调用方据此跳过名次统计，不猜默认值）
 */
export function getCherryTeamCount(game: PreparedGame): number {
  const ids = new Set<number>()
  for (const p of game.everyone) {
    if (p.subteamPlacement !== null && p.subteamPlacement <= 0) continue
    if (p.subteamId > 0) ids.add(p.subteamId)
  }
  return ids.size
}

/** 斗魂「获胜」= 名次落在前一半（`floor(teamCount / 2)`），Akari 同口径 */
export function isCherryPlacementWin(placement: number, teamCount: number): boolean {
  return placement > 0 && placement <= Math.floor(teamCount / 2)
}

/**
 * 分路分布聚合。
 *
 * 某局分路为 null（timeline 缺失 / 别名无法识别）时**跳过**而非计入 `NONE`，
 * 否则分布会被大量 null 稀释，卡片上的「常玩分路」失真。
 */
export function computePositions(games: PreparedGame[]): AggregatedPositionMap {
  const map: AggregatedPositionMap = {}
  for (const g of games) {
    const pos = g.self.position
    if (!pos) continue
    map[pos] = (map[pos] ?? 0) + 1
  }
  return map
}

/**
 * 斗魂（CHERRY）胜负聚合：在普通胜负之上追加名次维度。
 *
 * `subteamPlacement` 为 null（LCU 不返回）时该局不计入名次统计，**但仍计入胜负**
 * ——名次缺失不代表这局没打。小队总数判不出来（0）时同样跳过名次统计，
 * 不猜默认值（Akari 用 `teamCount = 0` 时 `floor(0/2) = 0`，结果一致）。
 *
 * @param nowMs 当前时间（注入以便测试，见 `computeWinLoss`）
 */
export function computeCherryWinLoss(
  games: PreparedGame[],
  nowMs: number
): AggregatedCherryWinLossAnalysis {
  const base = computeWinLoss(games, nowMs)

  let top1s = 0
  let topHalfFinishes = 0
  let placementSum = 0
  let placementSamples = 0

  for (const g of games) {
    const placement = g.self.subteamPlacement
    const teamCount = getCherryTeamCount(g)
    if (placement === null || teamCount <= 0) continue

    if (placement === 1) top1s++
    if (isCherryPlacementWin(placement, teamCount)) topHalfFinishes++
    placementSum += placement
    placementSamples += 1
  }

  const count = base.count
  return {
    ...base,
    top1s,
    topHalfFinishes,
    top1Rate: count > 0 ? top1s / count : 0,
    topHalfRate: count > 0 ? topHalfFinishes / count : 0,
    avgSubteamPlacement: placementSamples > 0 ? placementSum / placementSamples : 0
  }
}

/**
 * 胜负三分桶：`all` / `normal` / `cherry`。
 *
 * @param games 时间倒序的对局列表
 * @param nowMs 当前时间（注入以便测试）
 */
export function computeWinLossMap(games: PreparedGame[], nowMs: number): AggregatedWinLossMap {
  const cherryGames = games.filter(g => g.basic.gameMode === 'CHERRY')
  const normalGames = games.filter(g => g.basic.gameMode !== 'CHERRY')
  return {
    all: computeWinLoss(games, nowMs),
    normal: computeWinLoss(normalGames, nowMs),
    cherry: computeCherryWinLoss(cherryGames, nowMs)
  }
}

/**
 * 英雄分桶聚合：按 championId 分组，每组独立跑一遍 summary / winLoss / score / positions。
 *
 * 卡片上「英雄使用环」的数据源。`championId === 0` 的局（未选人 / 数据缺失）跳过。
 *
 * 每组独立算分而非用总分的分摊：同一玩家用甲英雄 10 场 70% 与乙英雄 5 场 20%，
 * 合并算分会互相稀释，而卡片要回答的是"他用这个英雄行不行"。
 *
 * @param games 时间倒序的对局列表
 * @param nowMs 当前时间（注入以便测试）
 */
export function computeChampions(
  games: PreparedGame[],
  nowMs: number
): AggregatedChampionAnalysis[] {
  const buckets = new Map<number, PreparedGame[]>()
  for (const g of games) {
    const cid = g.self.championId
    if (!cid) continue
    const list = buckets.get(cid)
    if (list) list.push(g)
    else buckets.set(cid, [g])
  }

  const result: AggregatedChampionAnalysis[] = []
  for (const [championId, bucket] of buckets) {
    const summary: AggregatedSummaryAnalysis = computeAggregatedSummary(bucket)
    result.push({
      championId,
      count: bucket.length,
      summary,
      winLoss: computeWinLoss(bucket, nowMs),
      score: computeAggregateScore(bucket, summary.avgKda, summary.winRate),
      positions: computePositions(bucket)
    })
  }

  // 场次降序；场次相同按 championId 升序保证确定性（避免同场次时卡片顺序抖动）
  return result.sort((a, b) => b.count - a.count || a.championId - b.championId)
}
