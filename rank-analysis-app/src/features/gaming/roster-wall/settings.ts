/**
 * 名册墙设置项（ADR-3 的 9 个 key）。
 *
 * 设计要点：**缺省值是唯一的真相**。
 * ADR-3 的表格列了默认值，但表格不会跟着代码变——所以这里把默认值收敛成
 * 一个 `DEFAULTS` 常量，所有读路径都从它取，不在调用点写字面量。
 * 这样调整默认值只需改一处，也不会出现「文档说 true、代码判 false」。
 *
 * 命名与 Akari 的 `z.looseObject` 语义对齐：未知 key 透传不报错
 * （旧版本配置升级后多出来的字段不该导致读失败）。
 */

import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'

/** 英雄使用习惯的展示口径 */
export type ChampionUsageMode = 'recent' | 'mastery' | 'none'

/** 队员排序口径 */
export type OrderPlayerBy = 'default' | 'position' | 'premade' | 'winrate' | 'kda' | 'akari'

export interface RosterWallSettings {
  /** 总开关：关掉则整块 band 不渲染 */
  enabled: boolean
  /** 每人战绩条数（对齐 Akari matchHistoryLoadCount） */
  loadCount: number
  /** 打野路径样本场数。SGP 按 gameId 计费，Akari 的 20 场成本过高故压到 6 */
  timelineGameCount: number
  /** 打野路径总开关 */
  showJunglePathing: boolean
  /** 非打野位也显示（用其最常用打野英雄） */
  showJungleForAll: boolean
  showChampionUsage: ChampionUsageMode
  orderPlayerBy: OrderPlayerBy
  /** 战绩行描边 */
  showMatchItemBorder: boolean
  /** 21 个 Tag 的独立开关，缺失即视为开启 */
  playerTags: Record<string, boolean>
}

/**
 * 默认值（ADR-3）。
 *
 * `loadCount` 夹在 [20, 100]：`limit` 直接决定 `analyzePlayerProfile` 的循环次数，
 * 0 或负数会让画像恒为空；过大会拖慢首屏。
 * `timelineGameCount` 夹在 [3, 20]：下限保证路径有统计意义（1 场只能看到开局），
 * 上限是 SGP 成本护栏。
 */
export const DEFAULTS: RosterWallSettings = {
  enabled: true,
  loadCount: 50,
  timelineGameCount: 6,
  showJunglePathing: true,
  showJungleForAll: false,
  showChampionUsage: 'recent',
  orderPlayerBy: 'position',
  showMatchItemBorder: false,
  playerTags: {}
}

const LOAD_COUNT_RANGE: [number, number] = [20, 100]
const TIMELINE_COUNT_RANGE: [number, number] = [3, 20]

const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback

/**
 * 把任意（可能是旧版本/手改坏的）配置收敛成合法设置。
 *
 * 逐字段校验而不是整体兜底：配置坏在一个字段时，不该让另外八个字段也一起丢默认值。
 */
export function normalizeRosterWallSettings(raw: unknown): RosterWallSettings {
  const r = (raw ?? {}) as Partial<RosterWallSettings>
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULTS.enabled,
    loadCount: clamp(r.loadCount, LOAD_COUNT_RANGE[0], LOAD_COUNT_RANGE[1], DEFAULTS.loadCount),
    timelineGameCount: clamp(
      r.timelineGameCount,
      TIMELINE_COUNT_RANGE[0],
      TIMELINE_COUNT_RANGE[1],
      DEFAULTS.timelineGameCount
    ),
    showJunglePathing:
      typeof r.showJunglePathing === 'boolean' ? r.showJunglePathing : DEFAULTS.showJunglePathing,
    showJungleForAll:
      typeof r.showJungleForAll === 'boolean' ? r.showJungleForAll : DEFAULTS.showJungleForAll,
    showChampionUsage: oneOf(
      r.showChampionUsage,
      ['recent', 'mastery', 'none'] as const,
      DEFAULTS.showChampionUsage
    ),
    orderPlayerBy: oneOf(
      r.orderPlayerBy,
      ['default', 'position', 'premade', 'winrate', 'kda', 'akari'] as const,
      DEFAULTS.orderPlayerBy
    ),
    showMatchItemBorder:
      typeof r.showMatchItemBorder === 'boolean'
        ? r.showMatchItemBorder
        : DEFAULTS.showMatchItemBorder,
    // Tag 开关是开放字典：只保留布尔值，丢掉脏数据但保留未知 key（对齐 looseObject）
    playerTags: Object.fromEntries(
      Object.entries(r.playerTags ?? {}).filter(([, v]) => typeof v === 'boolean')
    ) as Record<string, boolean>
  }
}

const PREFIX = 'gaming.rosterWall.'

/** 读单个 key（配置不存在时返回 undefined，由调用方决定回落） */
async function read<T>(key: string): Promise<T | undefined> {
  try {
    return await getConfigByIpc<T>(PREFIX + key)
  } catch {
    return undefined
  }
}

async function write(key: string, value: unknown): Promise<void> {
  await putConfigByIpc(PREFIX + key, value)
}

/** 读取全部设置（任一 key 缺失/损坏都回落到对应默认值） */
export async function loadRosterWallSettings(): Promise<RosterWallSettings> {
  const [
    enabled,
    loadCount,
    timelineGameCount,
    showJunglePathing,
    showJungleForAll,
    showChampionUsage,
    orderPlayerBy,
    showMatchItemBorder,
    playerTags
  ] = await Promise.all([
    read<boolean>('enabled'),
    read<number>('loadCount'),
    read<number>('timelineGameCount'),
    read<boolean>('showJunglePathing'),
    read<boolean>('showJungleForAll'),
    read<ChampionUsageMode>('showChampionUsage'),
    read<OrderPlayerBy>('orderPlayerBy'),
    read<boolean>('showMatchItemBorder'),
    read<Record<string, boolean>>('playerTags')
  ])

  return normalizeRosterWallSettings({
    enabled,
    loadCount,
    timelineGameCount,
    showJunglePathing,
    showJungleForAll,
    showChampionUsage,
    orderPlayerBy,
    showMatchItemBorder,
    playerTags
  })
}

/** 写入单个设置项（调用方负责合并后整体保存，这里只提供单 key 写） */
export async function saveRosterWallSetting<K extends keyof RosterWallSettings>(
  key: K,
  value: RosterWallSettings[K]
): Promise<void> {
  await write(key, value)
}
