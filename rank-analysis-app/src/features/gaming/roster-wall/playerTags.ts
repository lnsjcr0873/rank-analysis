/**
 * 名册墙玩家 Tag 定义（21 个）。
 *
 * 移植自 Akari `ongoing-game-panel/widgets/player-info-card/player-card-tags/`，
 * 但**颜色全部重做**：Akari 用了 21 个任意硬编码 hex（`#37246c` / `#7e2c85` / …），
 * 违反 `CODE_QUALITY.md`「禁止硬编码色」的设计系统禁令。此处改为引用
 * `--tag-*` 语义 token 的**色调族**（8 族），本文件不出现任何 hex。
 *
 * 设计取向差异（有意为之）：Akari 让每个 Tag 颜色唯一以利扫视；这里收敛到 8 族，
 * 因为 Tag 的主要信息载体是**文字**，颜色只做辅助强化。8 族已足够在密集网格里
 * 区分「身份 / 趋势 / 结论 / 风险 / 数据指标」五类语义。
 *
 * 数据可得性（详见设计文档 §3）：
 * - A 类（零新增数据）15 个 → 纯前端可算
 * - B 类（SGP summary 字段）2 个 → LCU 路径恒隐藏
 * - C 类（SGP frames）4 个 → 依赖 P1/P3，未接管道前隐藏
 * - 不可得 1 个（隐私）→ 不实现
 */

import {
  EXTRAORDINARY_MIN_COUNT,
  EXTRAORDINARY_THRESHOLD,
  OUTSTANDING_MIN_COUNT,
  OUTSTANDING_THRESHOLD
} from '@renderer/features/gaming/analysis/constants'
import type {
  AggregatedSummaryAnalysis,
  AggregatedWinLossAnalysis,
  PlayerProfileAnalysis
} from '@renderer/features/gaming/analysis/types'
import { findOutliersByIqr } from '@renderer/features/gaming/analysis/utils'

/** 语义色调族；取值对应 `--tag-{tone}` / `--tag-on-{tone}` */
export type TagTone = 'neutral' | 'info' | 'win' | 'loss' | 'brand' | 'warn' | 'danger' | 'muted'

/** 单个 Tag 的渲染描述 */
export interface PlayerTag {
  /** 稳定 id，供设置项开关与埋点使用 */
  id: string
  /** 显示文本（中文；本仓无 i18n 框架） */
  label: string
  tone: TagTone
  /** hover 详情；缺省时不渲染 popover */
  detail?: string
}

/** KDA 离群方向 */
export type KdaOutlier = 'over' | 'below' | null

/**
 * 计算全体玩家的 KDA 离群标记。
 *
 * 阈值 0.65（Akari `IQR_THRESHOLD`），比通用默认 1.5 激进得多——同场 10 人样本太小，
 * 1.5 几乎标不出人。少于 5 人不标（样本不足时离群判定无意义）。
 *
 * @param avgs 各玩家 avgKda
 * @returns puuid → 离群方向
 */
export function computeKdaOutliers(
  entries: Array<{ puuid: string; avgKda: number }>
): Map<string, KdaOutlier> {
  const out = new Map<string, KdaOutlier>()
  if (entries.length < 5) {
    for (const e of entries) out.set(e.puuid, null)
    return out
  }
  const { below, over } = findOutliersByIqr(entries, e => e.avgKda, KDA_IQR_THRESHOLD)
  for (const e of entries) {
    if (over.includes(e)) out.set(e.puuid, 'over')
    else if (below.includes(e)) out.set(e.puuid, 'below')
    else out.set(e.puuid, null)
  }
  return out
}

/** IQR 阈值，与 Akari ongoing-game-panel 一致 */
export const KDA_IQR_THRESHOLD = 0.65

/** Tag 展示上限；超出部分收进「+N」，点击展开 */
export const TAG_COLLAPSED_LIMIT = 6

/**
 * 是否为可用数值。
 *
 * ⚠️ **必须显式判 `undefined`**，不能用 `!== null`：
 * `undefined !== null` 为 true，而 `avgSoloKills` 这类「部分数据源才有」的字段
 * 在 SGP/LCU 映射差异下真的会缺失（undefined），此时 `.toFixed()` 直接崩掉整张卡片。
 * 这类字段曾因此在 SGP 局上炸过一次，故固化为具名判定。
 */
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/* ------------------------------------------------------------------ *
 * 判定阈值（集中在此，便于与设计文档 §3 对照）
 * ------------------------------------------------------------------ */

/** 「高胜率」：样本 ≥ 16 且胜率 ≥ 85%（Akari 同） */
const HIGH_WIN_RATE_MIN_COUNT = 16
const HIGH_WIN_RATE_MIN = 0.85

/** 连胜/连跪门槛（Akari 同） */
const STREAK_MIN = 3

/* 卓越/非凡的阈值与最小样本数直接复用 analysis/constants（与跨局综合分同源，
   避免同一档位在两处定义漂移）。 */

/** 伤害型/承伤型占比门槛 */
const HIGH_DAMAGE_SHARE = 0.28
const HIGH_TAKEN_SHARE = 0.3
const HIGH_GOLD_SHARE = 0.275
const HIGH_CS_PER_MIN = 7
const HIGH_VISION = 50
const HIGH_PINGS = 3

/** 人头伤害占比阈值（> 为人头怪 / < 为伤害型，Akari 同） */
const KDE_HIGH = 1.35
const KDE_LOW = 0.65

/** 好抓/极好抓：前 15 分钟敌方打野在场的死亡次数（Akari 同） */
const EASY_GANK = 1.5
const VERY_EASY_GANK = 2

/**
 * 生成一名玩家的全部 Tag。
 *
 * ⚠️ 各 Tag 的 `enabled` 参数对应设置项开关（Akari 有 21 个独立布尔）。
 * 默认全开；调用方按设置过滤。**B/C 类 Tag 在数据缺失时直接不产出**
 * （而非产出「0」或灰态），避免出现"有 tag 但数据是空的"假象。
 *
 * @param profile 该玩家画像
 * @param ctx 跨玩家上下文（用于 KDA 离群判定）
 * @param enabled 各 Tag 的开关
 */
export function buildPlayerTags(
  profile: PlayerProfileAnalysis,
  ctx: TagContext,
  enabled: PlayerTagSettings = ALL_TAGS_ON
): PlayerTag[] {
  const tags: PlayerTag[] = []
  const s: AggregatedSummaryAnalysis = profile.summary
  const wl: AggregatedWinLossAnalysis = profile.winLoss.all

  const add = (id: string, label: string, tone: TagTone, detail?: string) => {
    if (enabled[id] === false) return
    tags.push({ id, label, tone, detail })
  }

  /* ---- A 类 · 身份与关系 ---- */
  if (ctx.isSelf) add('self', '我', 'brand', '这是你自己')
  if (ctx.premadeGroup) {
    add(
      'premade',
      `预组 ${ctx.premadeGroup}`,
      'info',
      `近期多次同队（阈值 ${ctx.premadeThreshold} 场），大概率一起排的`
    )
  }
  if (ctx.metTotal > 0) {
    add('met', `遇见过 ${ctx.metTotal}`, 'info', `meet.db 累计相遇 ${ctx.metTotal} 场`)
  }

  /* ---- A 类 · 趋势 ---- */
  // 注意判据是**总场次** count 而非 wins：16 场 14 胜（87.5%）同样算高胜率，
  // 若按 wins >= 16 判定会把这类「样本量小的高胜率」玩家漏掉。
  if (profile.count >= HIGH_WIN_RATE_MIN_COUNT && wl.winRate >= HIGH_WIN_RATE_MIN) {
    add(
      'highWinRate',
      `胜率 ${(wl.winRate * 100).toFixed(0)}%`,
      'win',
      `${wl.wins} 胜 / ${wl.count} 场`
    )
  }
  if (wl.winningStreak >= STREAK_MIN) {
    add(
      'winningStreak',
      `连胜 ${wl.winningStreak}`,
      'win',
      `从最近一局往前连续 ${wl.winningStreak} 胜`
    )
  }
  if (wl.losingStreak >= STREAK_MIN) {
    add(
      'losingStreak',
      `连跪 ${wl.losingStreak}`,
      'loss',
      `从最近一局往前连续 ${wl.losingStreak} 败`
    )
  }

  /* ---- A 类 · 实力结论（金，克制使用） ---- */
  // Akari 的 GREAT_PERFORMANCE_TAG 是「一个 Tag 带两档」，此处沿用：
  // 拆成两个金色标签只会重复表达同一件事，纯属视觉噪音。
  const score = profile.score.total
  if (score >= EXTRAORDINARY_THRESHOLD && profile.count >= EXTRAORDINARY_MIN_COUNT) {
    add('performance', `非凡 ${score.toFixed(1)}`, 'brand', `跨局 ${profile.count} 场综合分`)
  } else if (score >= OUTSTANDING_THRESHOLD && profile.count >= OUTSTANDING_MIN_COUNT) {
    add('performance', `卓越 ${score.toFixed(1)}`, 'brand', `跨局 ${profile.count} 场综合分`)
  }
  add('score', `17分 ${score.toFixed(2)}`, 'muted', `满分 17，跨局 ${profile.count} 场`)

  /* ---- A 类 · 数据指标 ---- */
  if (s.avgChampionDamagePercentageOfTeam >= HIGH_DAMAGE_SHARE) {
    add(
      'damageShare',
      `输出 ${(s.avgChampionDamagePercentageOfTeam * 100).toFixed(0)}%`,
      'neutral',
      `平均占本队输出的 ${(s.avgChampionDamagePercentageOfTeam * 100).toFixed(2)}%`
    )
  }
  if (s.avgDamageTakenPercentageOfTeam >= HIGH_TAKEN_SHARE) {
    add(
      'takenShare',
      `承伤 ${(s.avgDamageTakenPercentageOfTeam * 100).toFixed(0)}%`,
      'neutral',
      `平均占本队承伤的 ${(s.avgDamageTakenPercentageOfTeam * 100).toFixed(2)}%（坦克/辅助偏高属正常）`
    )
  }
  if (s.avgGoldPercentageOfTeam >= HIGH_GOLD_SHARE) {
    add(
      'goldShare',
      `经济 ${(s.avgGoldPercentageOfTeam * 100).toFixed(0)}%`,
      'neutral',
      '平均占本队经济'
    )
  }
  if (s.avgCsPerMinute >= HIGH_CS_PER_MIN) {
    add(
      'cs',
      `${s.avgCsPerMinute.toFixed(1)} 刀/分`,
      'neutral',
      `全场平均 ${s.avgCsPerMinute.toFixed(2)}`
    )
  }
  if (s.avgVisionScore >= HIGH_VISION) {
    add(
      'vision',
      `视野 ${s.avgVisionScore.toFixed(0)}`,
      'neutral',
      `全场平均 ${s.avgVisionScore.toFixed(1)}`
    )
  }
  if (s.avgDamageGoldEfficiency > 1) {
    add(
      'damageGoldEfficiency',
      `伤金 ${(s.avgDamageGoldEfficiency * 100).toFixed(0)}%`,
      'neutral',
      `输出/经济 = ${(s.avgDamageGoldEfficiency * 100).toFixed(2)}%`
    )
  }
  // 人头伤害占比：> KDE_HIGH 人头怪 / < KDE_LOW 伤害型，中间区间不产出
  if (s.avgKillDamageEfficiency > KDE_HIGH) {
    add(
      'kdeHigh',
      '人头怪',
      'warn',
      `击杀占比高于输出占比 ${(s.avgKillDamageEfficiency * 100).toFixed(0)}%`
    )
  } else if (s.avgKillDamageEfficiency < KDE_LOW) {
    add(
      'kdeLow',
      '伤害型',
      'info',
      `输出占比高于击杀占比 ${(s.avgKillDamageEfficiency * 100).toFixed(0)}%`
    )
  }

  /* ---- B 类 · SGP 独有（rank 走 LCU 恒为 null/undefined → 不产出） ---- */
  if (isNum(s.avgSoloKills)) {
    add('soloKills', `单杀 ${s.avgSoloKills.toFixed(1)}`, 'neutral', 'SGP 数据源字段')
  }
  if (isNum(s.avgEnemyMissingPings) && s.avgEnemyMissingPings >= HIGH_PINGS) {
    add(
      'enemyMissingPings',
      `敌人消失 ${s.avgEnemyMissingPings.toFixed(1)}`,
      'neutral',
      'SGP 数据源字段'
    )
  }

  /* ---- C 类 · 需 SGP frames（P1/P3 接入前 ctx.earlyDeaths 为 null） ---- */
  const early = ctx.earlyDeathsWithEnemyJungler
  if (isNum(early) && ctx.isSelf === false) {
    if (early > VERY_EASY_GANK) {
      add(
        'veryEasyGank',
        '极好抓',
        'danger',
        `前 15 分钟因敌方打野在场的死亡平均 ${early.toFixed(2)} 次`
      )
    } else if (early >= EASY_GANK) {
      add('easyGank', '好抓', 'warn', `前 15 分钟因敌方打野在场的死亡平均 ${early.toFixed(2)} 次`)
    } else if (early < 1) {
      add('hardGank', '难抓', 'info', `前 15 分钟因敌方打野在场的死亡平均 ${early.toFixed(2)} 次`)
    }
  }

  return tags
}

/** 跨玩家上下文（单个 Tag 需要但 profile 里没有的信息） */
export interface TagContext {
  /** 是否本人 */
  isSelf: boolean
  /** 预组队字母 A/B/C…；无预组为 null */
  premadeGroup: string | null
  /** 预组队判定阈值（用于说明文案） */
  premadeThreshold: number
  /** meet.db 累计相遇场次 */
  metTotal: number
  /** 前 15 分钟因敌方打野在场的死亡均值；C 类 Tag 的数据源，未接入时 null */
  earlyDeathsWithEnemyJungler: number | null | undefined
}

/** 各 Tag 的开关（对应设置项 `gaming.rosterWall.playerTags`） */
export type PlayerTagSettings = Record<string, boolean>

/** 全开 */
const ALL_TAGS_ON: PlayerTagSettings = {}

/** 全部 Tag id（设置页渲染开关列表用；顺序即默认展示顺序） */
export const PLAYER_TAG_IDS = [
  'self',
  'premade',
  'met',
  'highWinRate',
  'winningStreak',
  'losingStreak',
  'performance',
  'score',
  'damageShare',
  'takenShare',
  'goldShare',
  'cs',
  'vision',
  'damageGoldEfficiency',
  'kdeHigh',
  'kdeLow',
  'soloKills',
  'enemyMissingPings',
  'veryEasyGank',
  'easyGank',
  'hardGank'
] as const

/** 阈值常量导出，供设置页说明文案与单测引用 */
export const TAG_THRESHOLDS = {
  HIGH_WIN_RATE_MIN_COUNT,
  HIGH_WIN_RATE_MIN,
  STREAK_MIN,
  OUTSTANDING_THRESHOLD: 6.5,
  OUTSTANDING_MIN_COUNT,
  EXTRAORDINARY_THRESHOLD: 8,
  EXTRAORDINARY_MIN_COUNT,
  HIGH_DAMAGE_SHARE,
  HIGH_TAKEN_SHARE,
  HIGH_GOLD_SHARE,
  HIGH_CS_PER_MIN,
  HIGH_VISION,
  HIGH_PINGS,
  KDE_HIGH,
  KDE_LOW,
  EASY_GANK,
  VERY_EASY_GANK
} as const
