/**
 * 画像分析的取数与缓存层。
 *
 * 上层（`analysis/`）是纯函数零 IO；本模块负责把 session 已有的数据喂进去，
 * 并做三件纯函数层不该做的事：
 * 1. **按数据指纹缓存**——同一批对局重复渲染（如切页签、KeepAlive 复活）不重算；
 * 2. **批量降级**——某个玩家算不出画像时返回 null 并记录原因，不影响其余玩家；
 * 3. **时钟注入**——`nowMs` 由调用方传入，便于测试与"快照"语义。
 *
 * ⚠️ 零新增网络：入参 `SessionSummoner.matchHistory` 已由 Rust
 * `enrich_game_detail`（并发 3）填满每局全 10 人 stats 并随 `session-player-update`
 * 下发，见设计文档「事实 1」。
 */

import type { Game } from '@renderer/types/domain/match'
import type { SessionSummoner } from '@renderer/types/domain/gaming'

import { analyzePlayerProfile, DEFAULT_GAME_LIMIT } from '@renderer/features/gaming/analysis'
import type { PlayerProfileAnalysis } from '@renderer/features/gaming/analysis/types'

/** 单个玩家的分析结果 */
export interface PlayerAnalysis {
  puuid: string
  /** 画像；为 null 表示不可用（见 `EMPTY_REASON`） */
  profile: PlayerProfileAnalysis | null
  /** 不可用原因（仅 profile 为 null 时有值），供 UI 决定展示哪种空态 */
  emptyReason: PlayerEmptyReason | null
}

/** 画像不可用的原因 */
export type PlayerEmptyReason =
  /** 该玩家没有对局数据（新号 / 隐私模式 / 跨区无数据） */
  | 'no-games'
  /** 有对局但全部被筛选口径排除（清一色大乱斗 / 自定义房） */
  | 'all-filtered'

export interface AnalyzeRosterOptions {
  /** 取最近多少局，默认 50 */
  limit?: number
  /** 当前时间（注入以便测试） */
  nowMs: number
}

/* ------------------------------------------------------------------ *
 * 缓存
 * ------------------------------------------------------------------ */

/**
 * 数据指纹：仅取影响分析结果的字段。
 *
 * 刻意**不含** `championId`（选人期会变，会让画像缓存无谓失效）、
 * 不含 `pickState` / `preGroupMarkers`（不参与画像计算）。
 * 参与计算的是 `matchHistory.games.games` 的长度与各局 gameId + gameDuration
 * （后者影响 perMinute 指标）。
 */
export function fingerprintGames(games: Game[]): string {
  if (games.length === 0) return 'empty'
  return `${games.length}:${games.map(g => `${g.gameId}@${g.gameDuration}`).join(',')}`
}

/** 玩家分析结果缓存（模块级，随窗口生命周期） */
const CACHE = new Map<string, PlayerAnalysis>()

/** 缓存条目上限；名册墙最多 10 人 × 若干次切局，128 足够且不会无界增长 */
const CACHE_LIMIT = 128

/**
 * 清空分析缓存。
 *
 * 需在以下时机调用：对局切换（`phase` 进入新一局）、跨区切换、玩家备注变更
 * （会改变 tag 而非画像，但为简单起见一并清）。
 */
export function clearProfileCache(): void {
  CACHE.clear()
}

/** 缓存条目数（测试与调试用） */
export function profileCacheSize(): number {
  return CACHE.size
}

/* ------------------------------------------------------------------ *
 * 分析
 * ------------------------------------------------------------------ */

/**
 * 分析一名玩家。
 *
 * @param player session 中的玩家（其 `matchHistory` 已含全 10 人 stats）
 * @param options limit / nowMs
 * @returns 分析结果；命中缓存时直接返回缓存值
 */
export function analyzePlayer(
  player: Pick<SessionSummoner, 'summoner' | 'matchHistory'>,
  options: AnalyzeRosterOptions
): PlayerAnalysis {
  const limit = options.limit ?? DEFAULT_GAME_LIMIT
  const games = player.matchHistory?.games?.games ?? []
  const puuid = player.summoner.puuid
  const cacheKey = `${puuid}|${limit}|${fingerprintGames(games)}`

  const cached = CACHE.get(cacheKey)
  if (cached) return cached

  let result: PlayerAnalysis
  if (games.length === 0) {
    result = { puuid, profile: null, emptyReason: 'no-games' }
  } else {
    const profile = analyzePlayerProfile(games, puuid, options.nowMs, { limit })
    result = profile
      ? { puuid, profile, emptyReason: null }
      : { puuid, profile: null, emptyReason: 'all-filtered' }
  }

  // 简单的容量控制：超限时清掉最早插入的一半（FIFO 语义，Map 保序）
  if (CACHE.size >= CACHE_LIMIT) {
    const drop = Math.ceil(CACHE_LIMIT / 2)
    let n = 0
    for (const key of CACHE.keys()) {
      CACHE.delete(key)
      if (++n >= drop) break
    }
  }
  CACHE.set(cacheKey, result)
  return result
}

/**
 * 批量分析整份名册。
 *
 * 单个玩家失败（数据畸形等）不影响其余玩家——把该玩家标为 `all-filtered`
 * 并继续。这是「降级而非中断」的纪律：名册墙要能显示 9 张卡 + 1 张空态卡，
 * 而不是整页报错。
 */
export function analyzeRoster(
  players: Array<Pick<SessionSummoner, 'summoner' | 'matchHistory'>>,
  options: AnalyzeRosterOptions
): Map<string, PlayerAnalysis> {
  const out = new Map<string, PlayerAnalysis>()
  for (const p of players) {
    // puuid 缺失（畸形数据）也要能降级，不能让整批失败
    const puuid = p.summoner?.puuid ?? ''
    try {
      out.set(puuid, analyzePlayer(p, options))
    } catch (err) {
      console.warn('[gaming/analysis] 分析玩家失败', puuid, err)
      out.set(puuid, { puuid, profile: null, emptyReason: 'all-filtered' })
    }
  }
  return out
}
