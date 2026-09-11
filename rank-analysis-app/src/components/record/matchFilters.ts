import type { Game } from '@renderer/types/domain/match'

/**
 * 战绩筛选状态：模式 / 英雄 / 胜负 / 时间窗口。
 *
 * 设计文档 M1-B2-1:趋势条与战绩列表共用同一份过滤逻辑（LCU 列表接口不支持
 * 服务端过滤，现实现是前端过滤）。所有过滤都是纯函数，可单测。
 */
export interface MatchFilterState {
  /** 模式 queueId，0 = 全部 */
  queueId: number
  /** 英雄 championId，0 = 全部 */
  championId: number
  /** 胜负，'all' = 全部 */
  result: 'all' | 'win' | 'loss'
  /** 时间窗口（小时），0 = 全部；仅统计今天起往回看的时间范围 */
  timeWindowHours: number
}

/** 时间窗口选项（小时）：近 3 小时 / 24 小时 / 7 天 / 30 天 */
export const TIME_WINDOW_HOURS = [0, 3, 24, 7 * 24, 30 * 24] as const

export const TIME_WINDOW_OPTIONS = [
  { label: '全部时间', value: 0 },
  { label: '近3小时', value: 3 },
  { label: '近24小时', value: 24 },
  { label: '近7天', value: 7 * 24 },
  { label: '近30天', value: 30 * 24 }
]

export const RESULT_OPTIONS = [
  { label: '全部', value: 'all' as const },
  { label: '胜', value: 'win' as const },
  { label: '负', value: 'loss' as const }
]

export function createDefaultFilter(): MatchFilterState {
  return { queueId: 0, championId: 0, result: 'all', timeWindowHours: 0 }
}

/** 是否启用了任何筛选条件（用于区分"无数据"与"筛选无结果"） */
export function hasActiveFilter(filter: MatchFilterState): boolean {
  return (
    filter.queueId > 0 ||
    filter.championId > 0 ||
    filter.result !== 'all' ||
    filter.timeWindowHours > 0
  )
}

/**
 * 同玩法多队列 ID 的规范化映射：别名 ID → 该组的「代表 ID」（debug4-22）。
 *
 * 与后端 `constant::game::QUEUE_ID_CANONICAL` 同源（430/490→400 匹配组；
 * 870/880/890→830/840/850 人机难度组）。模式下拉选项按分组去重后只存
 * 代表 ID，过滤必须按分组匹配，否则 870 人机选「人机(入门)」(830) 会
 * 被漏掉、列表显示 0 场。后端 `queue_ids_same_group` 同款语义。
 */
const QUEUE_ID_CANONICAL: ReadonlyMap<number, number> = new Map([
  [430, 400],
  [490, 400],
  [870, 830],
  [880, 840],
  [890, 850]
])

/** 队列 ID 的分组代表 ID（非别名返回自身） */
export function canonicalQueueId(id: number): number {
  return QUEUE_ID_CANONICAL.get(id) ?? id
}

/** 两个队列 ID 是否同属一模式分组（规范化后相等） */
export function queueIdsSameGroup(a: number, b: number): boolean {
  return canonicalQueueId(a) === canonicalQueueId(b)
}

/** 单场对局是否命中当前筛选 */
export function matchesFilter(game: Game, filter: MatchFilterState): boolean {
  if (filter.queueId > 0 && !queueIdsSameGroup(game.queueId, filter.queueId)) return false
  if (filter.championId > 0 && game.participants[0]?.championId !== filter.championId) return false
  const win = game.participants[0]?.stats?.win
  if (filter.result === 'win' && !win) return false
  if (filter.result === 'loss' && win) return false
  if (filter.timeWindowHours > 0) {
    const age = Date.now() - new Date(game.gameCreationDate).getTime()
    if (Number.isNaN(age) || age > filter.timeWindowHours * 3_600_000) return false
  }
  return true
}

/** 对列表做过滤（保持原顺序） */
export function filterMatches(games: Game[], filter: MatchFilterState): Game[] {
  return games.filter(game => matchesFilter(game, filter))
}
