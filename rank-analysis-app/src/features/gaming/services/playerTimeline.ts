/**
 * 帧级分析（timeline）前端接入层。
 *
 * 数据来自 Rust `get_player_timelines`（P1/P3），是 C 类 Tag
 * （极好抓 / 好抓 / 难抓 / 可疑闪现）与 P5 打野路径卡的唯一数据源。
 *
 * ## 与 summary 分析（P2）的关键差异
 *
 * | | summary（P2） | timeline（本文件） |
 * |---|---|---|
 * | 数据来源 | session 里已有的 50 局 | 需按 gameId 拉 SGP `DETAILS` |
 * | 耗时 | 同步，纯计算 | 异步 + 网络 + 逐分钟帧解析 |
 * | 失败影响 | 该玩家降级为「无画像」 | **只影响 C 类 Tag**，其余 Tag 照常 |
 *
 * 因此这里刻意**不阻塞** summary 分析：Tag 是锦上添花，
 * 不能让一个慢 3 秒的网络请求把整张名册墙卡在白屏上。
 *
 * ## 降级纪律
 *
 * 任一局拿不到帧、或 `degraded` 非空、或某玩家未出现在结果里 ⇒
 * 该玩家本项按 `null` 上抛，`playerTags` 据此**隐藏** C 类 Tag，
 * 而不是用 0 或猜测值填充（`0` 会被判成「难抓」，是误导性结论）。
 */

/** 单个玩家在一局的帧级结论（与 Rust `PlayerTimelineEntry` 对齐） */
export interface PlayerTimelineEntry {
  framesAnalyzed: number
  /** 清野顺序，camelCase 营地名，如 `blueBuff` */
  junglePath: string[]
  firstCampAtMs: number | null
  invadedBefore3min: boolean
  earlyDeaths: number
  earlyDeathScore: number
  allEarlyDeathsSolo: boolean
  contestedObjectives: number
  /** 因敌方打野在场的前期死亡次数 */
  earlyDeathsWithEnemyJungler: number
  inferredJungleRole: boolean
}

/** 单局结果 */
export interface TimelineEntry {
  /** 非空表示本局降级，`players` 不可信 */
  degraded: string | null
  /** puuid → 结论 */
  players: Record<string, PlayerTimelineEntry>
}

/** 调用方需提供的玩家身份（队伍由前端给：SGP 帧里没有队伍字段） */
export interface TimelinePlayerInput {
  puuid: string
  teamId: number
}

/** 跨局汇总后的帧级画像（喂给 Tag 层） */
export interface PlayerTimelineSummary {
  /** 有多少局成功拿到帧级数据（0 ⇒ 不可用） */
  gamesAnalyzed: number
  /**
   * 「因敌方打野在场的前期死亡」跨局均值。
   * 为 null 表示数据不可用（C 类 Tag 应隐藏）。
   */
  earlyDeathsWithEnemyJungler: number | null
  /** 打野路径出现最多的营地序列（按出现频次排序），空数组表示无数据 */
  topJunglePath: string[]
  /** 首次清野的中位时刻（ms），null 表示无数据 */
  medianFirstCampAtMs: number | null
  /** 是否有样本在开局 3 分钟内开野（入侵信号） */
  invadedEarlyRate: number | null
  /** 早期被单杀（无人协防）的比例，null 表示不可用 */
  soloDeathRate: number | null
  /** 参与资源节奏的场均次数，null 表示不可用 */
  avgContestedObjectives: number | null
}

/** 数据不可用时的统一形态 */
const UNAVAILABLE: PlayerTimelineSummary = {
  gamesAnalyzed: 0,
  earlyDeathsWithEnemyJungler: null,
  topJunglePath: [],
  medianFirstCampAtMs: null,
  invadedEarlyRate: null,
  soloDeathRate: null,
  avgContestedObjectives: null
}

/** invoke 的注入点（测试替换，生产用真实 Tauri） */
type InvokeFn = (
  cmd: string,
  args?: Record<string, unknown>
) => Promise<Record<number, TimelineEntry | null>>

let invokeImpl: InvokeFn | null = null

/** 注入 IPC 实现；传 null 恢复真实调用 */
export function setTimelineInvoke(fn: InvokeFn | null): void {
  invokeImpl = fn
}

async function invokeTimeline(
  region: string,
  gameIds: number[],
  players: TimelinePlayerInput[]
): Promise<Record<number, TimelineEntry | null>> {
  if (invokeImpl) return invokeImpl('get_player_timelines', { region, gameIds, players })
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<Record<number, TimelineEntry | null>>('get_player_timelines', {
    region,
    gameIds,
    players
  })
}

/* ------------------------------------------------------------------ *
 * 缓存
 * ------------------------------------------------------------------ */

const CACHE_LIMIT = 64
const cache = new Map<string, PlayerTimelineSummary>()

/** 缓存条目数（测试与调试用） */
export function timelineCacheSize(): number {
  return cache.size
}

/** 清空缓存（测试用） */
export function clearTimelineCache(): void {
  cache.clear()
}

function cacheKey(puuid: string, gameIds: number[]): string {
  return `${puuid}|${gameIds.length}|${gameIds.slice(0, 3).join(',')}`
}

/** FIFO 淘汰：超限时清掉最早插入的一半 */
function trimCache(): void {
  if (cache.size < CACHE_LIMIT) return
  const drop = Math.floor(cache.size / 2)
  let i = 0
  for (const k of [...cache.keys()]) {
    if (i >= drop) break
    cache.delete(k)
    i++
  }
}

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

/** 多数投票取「最常见的前 N 个营地序列」，用于展示打野风格 */
function dominantPath(paths: string[][]): string[] {
  const freq = new Map<string, number>()
  for (const p of paths) {
    if (p.length === 0) continue
    const key = p.join('>')
    freq.set(key, (freq.get(key) ?? 0) + 1)
  }
  if (freq.size === 0) return []
  // 频次相同时按序列字典序，保证结果确定
  const best = [...freq.entries()].sort((a, b) =>
    b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1]
  )[0]
  return best[0].split('>')
}

/** 中位数：偶数个取中间两数的均值。空数组返回 null（不是 0——「没数据」≠「时刻为 0」） */
function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * 跨局汇总。
 *
 * **只用 `degraded` 为空的局**——降级局的数据不可信，混进来会污染均值。
 */
function summarize(entries: TimelineEntry[], puuid: string): PlayerTimelineSummary {
  const mine = entries
    .filter(e => e && !e.degraded && e.players?.[puuid])
    .map(e => e.players[puuid])

  if (mine.length === 0) return { ...UNAVAILABLE }

  const gankDeaths = mine.reduce((s, e) => s + e.earlyDeathsWithEnemyJungler, 0)
  const soloDeaths = mine.filter(e => e.allEarlyDeathsSolo).length
  const withAnyDeath = mine.filter(e => e.earlyDeaths > 0).length
  const objectives = mine.reduce((s, e) => s + e.contestedObjectives, 0)
  const firstCamps = mine
    .map(e => e.firstCampAtMs)
    .filter((v): v is number => typeof v === 'number')
  const invaded = mine.filter(e => e.invadedBefore3min).length

  return {
    gamesAnalyzed: mine.length,
    earlyDeathsWithEnemyJungler: gankDeaths / mine.length,
    topJunglePath: dominantPath(mine.map(e => e.junglePath)),
    medianFirstCampAtMs: median(firstCamps),
    invadedEarlyRate: mine.length === 0 ? null : invaded / mine.length,
    // 没有死亡时也给 0（「无人死亡」是有效结论，不是不确定）
    soloDeathRate: withAnyDeath === 0 ? 0 : soloDeaths / withAnyDeath,
    avgContestedObjectives: objectives / mine.length
  }
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

/**
 * 批量拉取并汇总帧级画像。
 *
 * 绝不抛异常：任何失败都退化为 `UNAVAILABLE`（C 类 Tag 隐藏）。
 * 理由——帧级数据是增强项，让它把整页拖进错误态是本末倒置。
 *
 * @param region 大区 platformId（如 `TJ100`）
 * @param gameIds 要分析的 gameId 列表（会按玩家缓存）
 * @param players 玩家身份（puuid + 队伍）
 * @returns puuid → 汇总画像；无数据的玩家值为 `UNAVAILABLE` 的形状
 */
export async function fetchPlayerTimelines(
  region: string,
  gameIds: number[],
  players: TimelinePlayerInput[]
): Promise<Record<string, PlayerTimelineSummary>> {
  const out: Record<string, PlayerTimelineSummary> = {}
  if (!region || gameIds.length === 0 || players.length === 0) {
    for (const p of players) out[p.puuid] = { ...UNAVAILABLE }
    return out
  }

  // 先查缓存，只对缺失的 puuid 真正发请求
  const pending: TimelinePlayerInput[] = []
  for (const p of players) {
    const key = cacheKey(p.puuid, gameIds)
    const hit = cache.get(key)
    if (hit) out[p.puuid] = hit
    else pending.push(p)
  }
  if (pending.length === 0) return out

  let raw: Record<number, TimelineEntry | null> = {}
  try {
    raw = (await invokeTimeline(region, gameIds, pending)) ?? {}
  } catch {
    // 降级：不报错，C 类 Tag 隐藏
    for (const p of pending) out[p.puuid] = { ...UNAVAILABLE }
    return out
  }

  const entries = Object.values(raw).filter(
    (e): e is TimelineEntry => e !== null && e !== undefined
  )
  for (const p of pending) {
    const s = summarize(entries, p.puuid)
    cache.set(cacheKey(p.puuid, gameIds), s)
    trimCache()
    out[p.puuid] = s
  }
  return out
}

/** 单个玩家的便捷入口（内部走批量，保持同一份缓存） */
export async function fetchPlayerTimeline(
  region: string,
  gameIds: number[],
  player: TimelinePlayerInput
): Promise<PlayerTimelineSummary> {
  const all = await fetchPlayerTimelines(region, gameIds, [player])
  return all[player.puuid] ?? { ...UNAVAILABLE }
}
