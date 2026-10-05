/**
 * 名册墙「历史画像」分析的类型契约。
 *
 * 移植自 Akari `shared/data-adapter/analysis/player/types/{single,aggregated,helpers}.ts`，
 * 裁掉 frames（打野路径/事件/资源节奏）相关部分——那些下沉 Rust（ADR-1）。
 *
 * 命名冲突提醒：本文件的 `AggregateScore` 是**跨局聚合分**（名册墙徽章），
 * 与 `@renderer/features/record/services/playerScore` 的 `PlayerScore`（Rust 单局分，
 * 用于 MVP/SVP、详情页评分页签、决策回测）是**同名不同量**。
 * 数学结构差异见 `aggregateScore.ts` 文件头与设计文档 ADR-2，禁止互相代入。
 */

/* ================================================================== *
 * 单局层（single）
 * ================================================================== */

/** 归一化后的对局基本信息（由 `gameAdapter.ts` 从 rank `Game` 派生） */
export interface BasicInfo {
  gameId: number
  /** 对局创建时间（毫秒）；`winLoss.ts` 的活跃 session 判定依赖它 */
  gameCreation: number
  /** 对局时长（秒）；所有「每分钟」指标的分母 */
  gameDuration: number
  gameType: string
  queueId: number
  gameMode: string
  mapId: number
  /** `gameMode === 'CHERRY'`（斗魂多队模式） */
  isCherrySubteam: boolean
}

/**
 * 单局占比/比率分析（Akari `SingleSummaryAnalysis`）。
 *
 * 命名分两类：
 * - `*RatioToTeamMax` / `*RatioToMax` / `*PercentageOfTeam`：与队内最高值、全场最高值、队总和的比；
 * - `*RatioToExpectedContribution`：**理应贡献比** = `本人值 / 队总值 / (1/队伍人数)`，
 *   1.0 表示恰好与队均一样，2.0 表示双倍队均——跨局综合分（`AggregateScore`）的核心输入。
 */
export interface SingleSummaryAnalysis {
  /* 输出伤害 */
  championDamageRatioToTeamMax: number
  championDamageRatioToExpectedContribution: number
  championDamageRatioToMax: number
  championDamagePercentageOfTeam: number
  championDamagePerMinute: number

  /* 承伤 */
  damageTakenRatioToTeamMax: number
  damageTakenRatioToExpectedContribution: number
  damageTakenRatioToMax: number
  damageTakenPercentageOfTeam: number

  /* 治疗：相对「队均承伤」的比值 */
  healingRatioToTeamAverageDamageTaken: number

  /** 本局队伍人数（1 = 单排/调试局，会影响治疗满分线） */
  teamParticipantCount: number

  /* 经济 */
  goldRatioToTeamMax: number
  goldRatioToExpectedContribution: number
  goldRatioToMax: number
  goldPercentageOfTeam: number

  /* 补刀 */
  csRatioToTeamMax: number
  csRatioToMax: number
  csPercentageOfTeam: number
  csPerMinute: number

  /* 推塔伤害 */
  towerDamageRatioToTeamMax: number
  towerDamageRatioToMax: number
  towerDamagePercentageOfTeam: number

  /* 视野 */
  visionScorePercentageOfTeam: number
  visionScoreRatioToExpectedContribution: number

  /* KDA / 胜负 / 参团 */
  kda: number
  win: boolean
  killParticipation: number

  /** 伤金转化：输出伤害 / 经济 */
  damageGoldEfficiency: number
  /**
   * 人头伤害占比：`(本人击杀/队总击杀) / (本人输出占队比)`。
   * > 1 表示「抢人头多于其输出贡献」，是"人头怪"的量化口径。
   * 队总击杀或队总输出为 0 时取 1（无效率差异）。
   */
  killDamageEfficiency: number
}

/**
 * 跨局综合分（**17 分制**，Akari 式）。
 *
 * ⚠️ 与 Rust `PlayerScore` 同权重、不同结构：这里的 `winScore` 是**跨局胜率斜坡**
 * 的连续值，而 Rust 单局分的 win 是 0/1。维度权重见 `constants.ts`（跨语言钉子）。
 */
export interface AggregateScore {
  kdaScore: number
  /** 跨局胜率的斜坡得分（**不是** Rust 单局分的 0/1 二值，见 `aggregateScore.ts` 对照表） */
  winRateScore: number
  damageScore: number
  damageTakenScore: number
  healingScore: number
  csScore: number
  goldScore: number
  participationScore: number
  visionScore: number
  /** 9 维之和，理论上限 `AGGREGATE_SCORE_MAX`（17） */
  total: number
  maxScore: number
  /** 总分 ≥ 6.5 且样本 ≥ 5 局 → 「卓越」tag */
  outstanding: boolean
  /** 总分 ≥ 8 且样本 ≥ 8 局 → 「非凡」tag */
  extraordinary: boolean
}

/* ================================================================== *
 * 跨局聚合层（aggregated）
 * ================================================================== */

/** 跨局汇总的比率/均值指标 */
export interface AggregatedSummaryAnalysis {
  avgChampionDamageRatioToTeamMax: number
  avgChampionDamageRatioToMax: number
  /** 平均输出占队比 —— 卡上「输出 N%」tag 的来源 */
  avgChampionDamagePercentageOfTeam: number
  avgChampionDamagePerMinute: number

  avgDamageTakenRatioToTeamMax: number
  avgDamageTakenRatioToMax: number
  /** 平均承伤占队比 —— 「承伤 N%」tag */
  avgDamageTakenPercentageOfTeam: number

  avgGoldRatioToTeamMax: number
  avgGoldRatioToMax: number
  /** 平均经济占队比 —— 「经济 N%」tag */
  avgGoldPercentageOfTeam: number

  avgCsRatioToTeamMax: number
  avgCsRatioToMax: number
  avgCsPercentageOfTeam: number
  /** 平均每分钟补刀 —— 「N 刀/分」tag */
  avgCsPerMinute: number

  avgTowerDamageRatioToTeamMax: number
  avgTowerDamageRatioToMax: number
  avgTowerDamagePercentageOfTeam: number

  /** 平均视野分 —— 「视野 N」tag */
  avgVisionScore: number
  avgVisionScorePercentageOfTeam: number

  /** 平均伤金转化 —— 「伤金 N%」tag */
  avgDamageGoldEfficiency: number
  /** 平均参团率 */
  avgKillParticipation: number
  /** 平均人头伤害占比 —— 「人头怪」/「伤害型」tag 的判定源 */
  avgKillDamageEfficiency: number

  /** 跨局累计 K/D/A */
  kills: number
  deaths: number
  assists: number
  /** 跨局合并 KDA = `(kills + assists) / deaths` */
  avgKda: number
  /** 场均 KDA 的变异系数；-1 = 无法计算（见 utils） */
  kdaCv: number
  /** 跨局胜率 0..1 */
  winRate: number

  /** 平均单杀数；**SGP 独有字段**，任一局缺失即 null（rank 走 LCU 摘要时恒为 null） */
  avgSoloKills: number | null
  /** 平均「敌方消失」信号数；**SGP 独有字段**，任一局缺失即 null */
  avgEnemyMissingPings: number | null
}

/** 胜负聚合（含连胜/连跪） */
export interface AggregatedWinLossAnalysis {
  /** 计入统计的局数 */
  count: number
  wins: number
  losses: number
  /** `wins / count` */
  winRate: number
  /** 从最近一局往前的连续胜场数 */
  winningStreak: number
  /** 从最近一局往前的连续败场数 */
  losingStreak: number
  /** 活跃 session 内胜场（见 `winLoss.ts`） */
  activeSessionWins: number
  /** 活跃 session 内败场 */
  activeSessionLosses: number
}

/** 斗魂（CHERRY）胜负聚合：在胜负之上追加名次维度 */
export interface AggregatedCherryWinLossAnalysis extends AggregatedWinLossAnalysis {
  /** 第 1 名次数 */
  top1s: number
  /** 前半数名次次数 */
  topHalfFinishes: number
  top1Rate: number
  topHalfRate: number
  /** 平均名次；无有效名次样本时为 0 */
  avgSubteamPlacement: number
}

/**
 * 胜负聚合三分桶。
 *
 * 名册墙默认展示 `all`；斗魂玩家额外看 `cherry`（名次维度只在斗魂存在）。
 */
export interface AggregatedWinLossMap {
  all: AggregatedWinLossAnalysis
  normal: AggregatedWinLossAnalysis
  cherry: AggregatedCherryWinLossAnalysis
}

/** 分路分布（键为 LCU 分路，值为场次） */
export type AggregatedPositionMap = Partial<Record<PositionKey, number>>

/** 分路键：归一化后的 LCU 分路取值 */
export type PositionKey = 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY'

/** 召唤师技能使用聚合（闪现数据，供「可疑闪现」tag 使用） */
export interface AggregatedSpellsAnalysis {
  /** 带闪现且闪现仍在 charges 中的局数 */
  flashOnD: number
  /** 带闪现且闪现已用完的局数 */
  flashOnF: number
}

/** 阵营分布 */
export interface AggregatedTeamSideAnalysis {
  redSideCount: number
  blueSideCount: number
}

/** 单个英雄的画像（英雄使用环的数据源） */
export interface AggregatedChampionAnalysis {
  championId: number
  /** 该英雄的场次 */
  count: number
  summary: AggregatedSummaryAnalysis
  winLoss: AggregatedWinLossAnalysis
  /** 该英雄的跨局综合分 */
  score: AggregateScore
  /** 该英雄最常打的位置 */
  positions: AggregatedPositionMap
}

/* ================================================================== *
 * 编排层
 * ================================================================== */

/** 单局分析产物：把归一化输入与单局结果绑在一起，供各聚合函数消费 */
export interface PreparedGame {
  gameId: number
  basic: BasicInfo
  /** 本人在该局的归一化数据（`gameAdapter.ts` 产出） */
  self: SelfGameStats
  /** 同队所有人（用于队内对比） */
  teamMates: SelfGameStats[]
  /** 全场 10 人（用于全场最高值对比） */
  everyone: SelfGameStats[]
  single: SingleSummaryAnalysis
}

/**
 * 归一化后的单人对局数据（由 `gameAdapter.ts` 从 rank `Participant` 派生）。
 *
 * 只保留 analysis 层需要的字段——Akari 的 `MatchParticipant` 有 40+ 字段
 * （含 items/runes/pings 细分），这里只取参与计算的部分，减少移植面。
 */
export interface SelfGameStats {
  participantId: number
  championId: number
  puuid: string
  /** LCU teamId（100/200；斗魂为 CHERRY-* 前缀） */
  teamId: number
  /** 归一化分路；无数据为 null */
  position: PositionKey | null
  kills: number
  deaths: number
  assists: number
  kda: number
  win: boolean
  goldEarned: number
  cs: number
  totalDamageDealtToChampions: number
  totalDamageTaken: number
  totalDamageToTowers: number
  totalHeal: number
  /** 视野分；部分数据源缺失为 null（按 0 参与计算但保留 null 以便区分） */
  visionScore: number | null
  /** 斗魂名次；非斗魂为 null */
  subteamPlacement: number | null
  /** 斗魂小队 ID（`stats.playerSubteamId`；非斗魂局为 0）。用于推算该局小队总数 */
  subteamId: number
  /** 召唤师技能 ID；数据缺失时为 null */
  spell1Id: number | null
  spell2Id: number | null
  /** 单杀数；**SGP 独有**，LCU 路径为 null */
  soloKills: number | null
  /** 「敌方消失」信号数；**SGP 独有**，LCU 路径为 null */
  enemyMissingPings: number | null
}

/** 一个玩家跨全部对局的画像（名册墙单张卡片的完整数据契约） */
export interface PlayerProfileAnalysis {
  /** 计入统计的局数 */
  count: number
  summary: AggregatedSummaryAnalysis
  winLoss: AggregatedWinLossMap
  /** 跨局综合分（17 分制） */
  score: AggregateScore
  positions: AggregatedPositionMap
  spells: AggregatedSpellsAnalysis
  teamSide: AggregatedTeamSideAnalysis
  /** 按场次降序的英雄画像（卡片上英雄使用环的数据源） */
  champions: AggregatedChampionAnalysis[]
  /** 各局单局分析，供战绩列表按需渲染（已按时间倒序） */
  games: PreparedGame[]
}
