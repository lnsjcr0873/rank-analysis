/**
 * rank `Game` → 分析层归一化模型（`SelfGameStats` / `BasicInfo`）的适配层。
 *
 * 移植自 Akari `data-adapter/match-history/{match-basic,participants}.ts`，
 * 但**大幅精简**：Akari 的 `MatchParticipant` 有 40+ 字段（装备/符文/信号细分/海克斯），
 * analysis 层只用到其中约 15 个，故只搬运需要的部分，减少移植面与回归面。
 *
 * 关键点：`enrich_game_detail` 已把每局全 10 人填进 `gameDetail.participants`，
 * 因此适配层**零网络请求**，纯内存映射。
 *
 * 与 rank 现有类型的两处偏差（刻意不改共享类型，只在本文件归一）：
 * - `timeline`（分路/角色）在 Rust `Participant` 上有，但 TS `Participant` 接口未声明。
 *   沿用 `services/ai/shared/snapshot.ts` 既有的 `LcuParticipantExtras` cast 约定，
 *   不去动 `types/domain/match.ts`（避免波及其他消费方）。
 * - 字段改名：rank 用 `damageDealtToTurrets`，Akari 用 `totalDamageToTowers`。
 */

import type { Game, MatchPlayerIdentity, Participant } from '@renderer/types/domain/match'

import type { BasicInfo, PositionKey, SelfGameStats } from './types'

/**
 * LCU `Participant` 上未在 TS 类型中声明、但运行时存在的字段。
 *
 * Rust `lcu/api/model.rs` 的 `Participant` 带
 * `#[serde(rename = "timeline")] pub timeline: Option<ParticipantTimeline>`，
 * 且另有 `teamPosition`。二者经 IPC 原样透传到前端，只是 TS 接口没写。
 *
 * 与 `services/ai/shared/snapshot.ts` 的同名类型保持一致，避免出现第二种读法。
 */
type ParticipantExtras = {
  teamPosition?: string
  timeline?: { lane?: string; role?: string }
}

/** 闪现的召唤师技能 ID（LCU 常量）；用于「可疑闪现」tag 的 `flashOnD` / `flashOnF` */
export const SUMMONER_SPELL_FLASH_ID = 4

/**
 * 归一化分路。
 *
 * 值域比 Akari 宽：国服 LCU 摘要常给 `MID` / `ADC` / `SUPPORT` 别名，
 * 与 Rust `pugg/aggregate.rs::normalize_lane` 的映射表逐项一致。
 *
 * @returns 归一化分路；无法识别（含空串、`NONE`、`DUO_*` 等）返回 null
 */
export function normalizePosition(lane: string | undefined | null): PositionKey | null {
  switch ((lane ?? '').trim().toUpperCase()) {
    case 'TOP':
      return 'TOP'
    case 'JUNGLE':
      return 'JUNGLE'
    case 'MIDDLE':
    case 'MID':
      return 'MIDDLE'
    case 'BOTTOM':
    case 'ADC':
      return 'BOTTOM'
    case 'UTILITY':
    case 'SUPPORT':
      return 'UTILITY'
    default:
      return null
  }
}

/**
 * 取本局的 10 名参与者。
 *
 * 优先 `gameDetail.participants`（含完整 stats）；缺失时回退 `game.participants`
 * （摘要只有本人视角的完整 stats）。与 `buildScoreInputsFromGame` / `snapshot.ts`
 * 的取数口径一致。
 */
export function getParticipants(game: Game): Participant[] {
  return game.gameDetail?.participants?.length ? game.gameDetail.participants : game.participants
}

/** 取本局的身份列表；同样优先 `gameDetail`。 */
export function getParticipantIdentities(game: Game): MatchPlayerIdentity[] {
  return game.gameDetail?.participantIdentities?.length
    ? game.gameDetail.participantIdentities
    : game.participantIdentities
}

/**
 * 解析局内创建时间（毫秒）。
 *
 * rank 的 `gameCreationDate` 是 **ISO 字符串**，而 Akari 的 `basic.gameCreation`
 * 已是毫秒数——`winLoss.ts` 的活跃 session 判定强依赖它，故此处必须解析。
 * 解析失败返回 0（而非 NaN）：让上层按"时间未知"降级，而不是让 NaN 污染比较链。
 */
function parseCreationMs(game: Game): number {
  const parsed = Date.parse(game.gameCreationDate)
  return Number.isFinite(parsed) ? parsed : 0
}

/** 派生 `BasicInfo`（分路/阵营等参与者级信息不在此层）。 */
export function toBasicInfo(game: Game): BasicInfo {
  return {
    gameId: game.gameId,
    gameCreation: parseCreationMs(game),
    gameDuration: game.gameDuration,
    gameType: game.gameType,
    queueId: game.queueId,
    // 后端 `enrich_info_cn` 已把 queueName 本地化成中文，直接用，不在前端另建映射
    queueName: game.queueName,
    gameMode: game.gameMode,
    mapId: game.mapId,
    isCherrySubteam: game.gameMode === 'CHERRY'
  }
}

/**
 * 把一名参与者归一化为 `SelfGameStats`。
 *
 * @param participant 局内参与者
 * @param identity 对应身份（用于取 puuid）；可为 undefined，此时 puuid 为空串
 *
 * 身份索引的兜底（`participantId - 1` → 数组下标）由调用方 `normalizeGame` 负责，
 * 本函数只做单点映射，避免同一处查找逻辑散落在两层。
 */
export function toSelfGameStats(
  participant: Participant,
  identity: MatchPlayerIdentity | undefined
): SelfGameStats {
  const extras = participant as Participant & ParticipantExtras
  const stats = participant.stats
  const lane = extras.timeline?.lane ?? extras.teamPosition

  return {
    participantId: participant.participantId,
    championId: participant.championId,
    puuid: identity?.player?.puuid ?? '',
    teamId: participant.teamId,
    position: normalizePosition(lane),
    kills: stats.kills,
    deaths: stats.deaths,
    assists: stats.assists,
    kda: (stats.kills + stats.assists) / Math.max(stats.deaths, 1),
    win: stats.win,
    goldEarned: stats.goldEarned,
    // 与 `buildScoreInputsFromGame` 同口径：总补刀含野怪
    cs: stats.totalMinionsKilled + stats.neutralMinionsKilled,
    totalDamageDealtToChampions: stats.totalDamageDealtToChampions,
    totalDamageTaken: stats.totalDamageTaken,
    // rank 字段名为 damageDealtToTurrets（Akari 为 totalDamageToTowers）
    totalDamageToTowers: stats.damageDealtToTurrets ?? 0,
    totalHeal: stats.totalHeal,
    // rank 的 visionScore 是可选字段（旧缓存缺失）；保留 null 以便上层区分
    // 「没做视野(0)」与「数据缺失(null)」—— Akari 同此处理
    visionScore: stats.visionScore ?? null,
    // 非斗魂局为 0，归一为 null 以免把 0 当成"第 0 名"
    subteamPlacement: stats.subteamPlacement > 0 ? stats.subteamPlacement : null,
    // 斗魂小队 ID；非斗魂为 0，保留原值供「小队总数」推算
    subteamId: stats.playerSubteamId ?? 0,
    spell1Id: participant.spell1Id ?? null,
    spell2Id: participant.spell2Id ?? null,
    // SGP 独有字段：rank 的 ParticipantStats 无 soloKills / 敌方消失信号，
    // 走 LCU 摘要时恒为 null（`avgIfAllNonNull` 会据此整体判 null ⇒ 相关 tag 隐藏）
    soloKills: null,
    enemyMissingPings: null
  }
}

/** 一局内本人的归一化数据 + 同队 / 全场，供单局分析消费 */
export interface NormalizedGame {
  basic: BasicInfo
  /** 本人（按 puuid 匹配） */
  self: SelfGameStats
  /** 同队（含本人） */
  teamMates: SelfGameStats[]
  /** 全场 10 人 */
  everyone: SelfGameStats[]
}

/**
 * 把一局归一化，并把本人从队伍/全场里定位出来。
 *
 * @param game 原始 `Game`
 * @param puuid 本人 puuid
 * @returns 归一化结果；`puuid` 在本局找不到（对局被跨区归属变化遮挡、身份缺失）时返回 null
 */
export function normalizeGame(game: Game, puuid: string): NormalizedGame | null {
  const participants = getParticipants(game)
  const identities = getParticipantIdentities(game)

  const everyone = participants.map((p, index) =>
    // 身份索引优先按 participantId-1（LCU 约定），缺失时退回数组下标
    toSelfGameStats(p, identities[p.participantId - 1] ?? identities[index])
  )

  const self = everyone.find(s => s.puuid === puuid)
  if (!self) {
    return null
  }

  return {
    basic: toBasicInfo(game),
    self,
    teamMates: everyone.filter(s => s.teamId === self.teamId),
    everyone
  }
}

/** 是否本局带闪现（两个召唤师技能位任一为闪现） */
export function hasFlash(stats: SelfGameStats): boolean {
  return stats.spell1Id === SUMMONER_SPELL_FLASH_ID || stats.spell2Id === SUMMONER_SPELL_FLASH_ID
}
