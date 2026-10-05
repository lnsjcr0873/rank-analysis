/**
 * 单局占比 / 比率分析（`computeSingleSummary`）。
 *
 * 移植自 Akari `analysis/player/single/summary.ts`（116 行），公式逐项照搬。
 * 相比 Akari 删掉 3 个字段：`totalDamageShieldedOnTeammates` 的三个占比
 * —— rank 的 `ParticipantStats` 没有「为队友挡伤害」字段，删掉而非补 0。
 *
 * 本层是「理应贡献比」的唯一产地，也是跨局综合分（`aggregateScore.ts`）的核心输入。
 *
 * 三个比值族的语义区别（混淆会导致跨局分整体偏移）：
 * - `*RatioToTeamMax`：本人 / **队内最高者**。衡量"是不是队里最能打的那类指标"，
 *   强依赖队友水平，跨局不可比。
 * - `*RatioToMax`：本人 / **全场最高者**（含敌方）。衡量"在全场什么量级"。
 * - `*RatioToExpectedContribution`：**理应贡献比** = `本人值 / 队总值 / (1/队伍人数)`。
 *   1.0 = 恰好与队均一样，2.0 = 双倍队均。**与队友强弱无关**，故只有它适合跨局聚合，
 *   也是 9 维评分里伤害/承伤/经济/视野四项的唯一输入。
 */

import type { SelfGameStats, SingleSummaryAnalysis } from './types'
import { noZero } from './utils'

/** 视野分缺失时按 0 参与计算（Akari 同此：单局按 0，跨局用 avgVisionScore 区分缺失） */
function visionOf(p: SelfGameStats): number {
  return p.visionScore ?? 0
}

/**
 * 理应贡献比。
 *
 * 队伍只有 1 人时返回 0（无"队均"概念，记 0 而非 1，避免单人局把该维度算满）。
 */
function expectedContributionRatio(value: number, total: number, teamSize: number): number {
  if (teamSize <= 1) {
    return 0
  }
  return value / noZero(total) / (1 / teamSize)
}

/**
 * 计算一名玩家在单局中的全部占比/比率。
 *
 * @param self 本人归一化数据
 * @param teamMates 同队所有人（**含本人**，故 `teamMates.length` 即队伍人数）
 * @param everyone 全场所有人（用于 `*RatioToMax`）
 * @param gameDurationSeconds 对局时长（秒），`perMinute` 类指标的分母
 */
export function computeSingleSummary(
  self: SelfGameStats,
  teamMates: SelfGameStats[],
  everyone: SelfGameStats[],
  gameDurationSeconds: number
): SingleSummaryAnalysis {
  const teamSize = teamMates.length
  const minutes = gameDurationSeconds / 60

  /* ---- 队内极值 / 队总和 ---- */
  const teamMaxChampionDmg = Math.max(...teamMates.map(p => p.totalDamageDealtToChampions))
  const teamMaxDmgTaken = Math.max(...teamMates.map(p => p.totalDamageTaken))
  const teamMaxGold = Math.max(...teamMates.map(p => p.goldEarned))
  const teamMaxCs = Math.max(...teamMates.map(p => p.cs))
  const teamMaxTowerDmg = Math.max(...teamMates.map(p => p.totalDamageToTowers))

  const teamTotalChampionDmg = teamMates.reduce((a, p) => a + p.totalDamageDealtToChampions, 0)
  const teamTotalDmgTaken = teamMates.reduce((a, p) => a + p.totalDamageTaken, 0)
  const teamTotalGold = teamMates.reduce((a, p) => a + p.goldEarned, 0)
  const teamTotalCs = teamMates.reduce((a, p) => a + p.cs, 0)
  const teamTotalTowerDmg = teamMates.reduce((a, p) => a + p.totalDamageToTowers, 0)
  const teamTotalVision = teamMates.reduce((a, p) => a + visionOf(p), 0)
  const teamTotalKills = teamMates.reduce((a, p) => a + p.kills, 0)
  /** 队均承伤：治疗维度的分母基准 */
  const teamAverageDmgTaken = teamTotalDmgTaken / noZero(teamSize)

  /* ---- 全场极值 ---- */
  const maxChampionDmg = Math.max(...everyone.map(p => p.totalDamageDealtToChampions))
  const maxDmgTaken = Math.max(...everyone.map(p => p.totalDamageTaken))
  const maxGold = Math.max(...everyone.map(p => p.goldEarned))
  const maxCs = Math.max(...everyone.map(p => p.cs))
  const maxTowerDmg = Math.max(...everyone.map(p => p.totalDamageToTowers))

  return {
    /* 输出伤害 */
    championDamageRatioToTeamMax: self.totalDamageDealtToChampions / noZero(teamMaxChampionDmg),
    championDamageRatioToExpectedContribution: expectedContributionRatio(
      self.totalDamageDealtToChampions,
      teamTotalChampionDmg,
      teamSize
    ),
    championDamageRatioToMax: self.totalDamageDealtToChampions / noZero(maxChampionDmg),
    championDamagePercentageOfTeam: self.totalDamageDealtToChampions / noZero(teamTotalChampionDmg),
    championDamagePerMinute: self.totalDamageDealtToChampions / noZero(minutes),

    /* 承伤 */
    damageTakenRatioToTeamMax: self.totalDamageTaken / noZero(teamMaxDmgTaken),
    damageTakenRatioToExpectedContribution: expectedContributionRatio(
      self.totalDamageTaken,
      teamTotalDmgTaken,
      teamSize
    ),
    damageTakenRatioToMax: self.totalDamageTaken / noZero(maxDmgTaken),
    damageTakenPercentageOfTeam: self.totalDamageTaken / noZero(teamTotalDmgTaken),

    /* 治疗：相对队均承伤（不是队总承伤） */
    healingRatioToTeamAverageDamageTaken: self.totalHeal / noZero(teamAverageDmgTaken),
    teamParticipantCount: teamSize,

    /* 经济 */
    goldRatioToTeamMax: self.goldEarned / noZero(teamMaxGold),
    goldRatioToExpectedContribution: expectedContributionRatio(
      self.goldEarned,
      teamTotalGold,
      teamSize
    ),
    goldRatioToMax: self.goldEarned / noZero(maxGold),
    goldPercentageOfTeam: self.goldEarned / noZero(teamTotalGold),

    /* 补刀 */
    csRatioToTeamMax: self.cs / noZero(teamMaxCs),
    csRatioToMax: self.cs / noZero(maxCs),
    csPercentageOfTeam: self.cs / noZero(teamTotalCs),
    csPerMinute: self.cs / noZero(minutes),

    /* 推塔伤害 */
    towerDamageRatioToTeamMax: self.totalDamageToTowers / noZero(teamMaxTowerDmg),
    towerDamageRatioToMax: self.totalDamageToTowers / noZero(maxTowerDmg),
    towerDamagePercentageOfTeam: self.totalDamageToTowers / noZero(teamTotalTowerDmg),

    /* 视野 */
    visionScorePercentageOfTeam: visionOf(self) / noZero(teamTotalVision),
    visionScoreRatioToExpectedContribution: expectedContributionRatio(
      visionOf(self),
      teamTotalVision,
      teamSize
    ),

    /* KDA / 胜负 / 参团 */
    kda: self.kda,
    win: self.win,
    killParticipation: (self.kills + self.assists) / noZero(teamTotalKills),

    /* 伤金转化：输出 / 经济 */
    damageGoldEfficiency: self.totalDamageDealtToChampions / noZero(self.goldEarned),

    /**
     * 人头伤害占比：`(本人击杀占队比) / (本人输出占队比)`。
     * > 1 表示"抢人头多于其输出贡献"。
     * 队总击杀或队总输出为 0 时取 1（无效率差异，而非 0）。
     */
    killDamageEfficiency:
      teamTotalKills === 0 || teamTotalChampionDmg === 0
        ? 1
        : self.kills / teamTotalKills / (self.totalDamageDealtToChampions / teamTotalChampionDmg)
  }
}
