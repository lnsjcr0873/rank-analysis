/**
 * 对局名册抽取层——把 `SessionData`（选人期/局内、大乱斗/普通/斗魂共用的会话模型）
 * 拍平成「分组 → 成员」的稠密名册，供名册优先的对局页渲染。
 *
 * 背景：Akari 的对局面板是**名册优先**的信息架构——「在英雄选择阶段或游戏内，
 * 查看成员们的近期表现和组队情况」。此前本项目的对局页是**结论优先**
 * （结论横幅 → 阶段 → 信号 tabs → 卡片列），成员信息分散在多层卡片里，
 * 且大乱斗直接用 `MayhemDraftPanel` 替换掉整个情报舱，导致两套页面结构。
 *
 * 本模块是纯函数、零 UI、可完整单测，是名册视图的唯一数据出口。
 *
 * 关键设计约束：
 * - **复合 key**：选人期敌方是匿名的，`summoner.puuid === ''`，不能拿 puuid 当 key。
 * - **原地 mutate**：`useSessionSync` 会原地改写玩家对象并原地 sort `subteams`，
 *   因此调用方做 `deep` watch 时必须先投影成新数组（见 `useLineupScore` 的告警）。
 * - **不猜队伍**：CLASSIC 恒为 2 组 × 5 人（含大乱斗，`command/session.rs`），
 *   CHERRY 为 1~8 组；分组一律沿用后端给的 `subteams`，不做模式特判。
 *
 * @module features/gaming/services/roster
 */

import type {
  ChampSelect,
  SessionData,
  SessionPhase,
  SessionSummoner,
  Subteam
} from '@renderer/types/domain/gaming'
import type { RecentData } from '@renderer/types/domain/analysis'
import type { Game } from '@renderer/types/domain/match'

/** 名册成员所属阵营。CHERRY 下非我方的小队统一为 `'other'`。 */
export type RosterSide = 'mine' | 'enemy' | 'other'

/** 组标签来源：CLASSIC 走「我方/敌方」，CHERRY 走小队号。 */
export type RosterGroupKind = 'mine' | 'enemy' | 'squad'

/** 名册中的一个成员（一名玩家）。 */
export interface RosterMember {
  /**
   * 稳定行 key。
   *
   * 选人期敌方匿名（`puuid === ''`），故 puuid 为空时回退到
   * `anon-{subteamId}-{index}`——组内序号是该场景下唯一可用的身份。
   */
  key: string
  /** 原始会话对象（与 `sessionData` 同一引用，供已有子组件直接复用）。 */
  player: SessionSummoner
  /** 所处分组的 subteamId */
  subteamId: number
  /** 组内序号（0 起） */
  index: number
  /** 是否为自己 */
  isSelf: boolean
  /** 是否已锁定/存在英雄（0 表示尚未选定） */
  championId: number
  /** 选人态：none/intent/picking/banning/locked；非选人期为空串 */
  pickState: string
  /** 本局分配分路（小写 LCU 命名）；空串表示未知/无分配模式 */
  assignedPosition: string
  /** 是否仍是占位数据（后端未回填战绩） */
  isLoading: boolean
  /** 预组队标记名；无预组队为空串 */
  preGroupName: string
  /** 预组队标记类型 */
  preGroupType: SessionSummoner['preGroupMarkers']['type']
  /** 近期表现（模式/KDA/胜率等），直接透传给行组件 */
  recent: RecentData
  /** 最近 N 场对局，供 KDA 条渲染 */
  recentGames: Game[]
  /** 累计相遇场次 */
  meetTotal: number
}

/** 名册中的一个分组（一个 subteam）。 */
export interface RosterGroup {
  /** subteamId */
  subteamId: number
  /** 分组类别 */
  kind: RosterGroupKind
  /** 展示标签，如「我方」「敌方」「第 3 小队」 */
  label: string
  /** 是否自己所在的小队 */
  isMine: boolean
  /** 该组期望人数（由实际最大组推算，用于占位提示） */
  expectedSize: number
  /** 组内成员（已按原顺序） */
  members: RosterMember[]
}

/** `buildRoster` 的完整输出。 */
export interface Roster {
  groups: RosterGroup[]
  /** 全部成员（各组顺序拼接），便于扁平渲染 */
  members: RosterMember[]
  /** 单组期望人数：取各组实际人数的最大值，保证空组也能提示占位 */
  expectedSize: number
  /** 当前是否选人期（行组件据此决定是否渲染选人态） */
  isChampSelect: boolean
  /** 是否 CHERRY 多队模式（分组标签走「第 N 小队」） */
  isMultiTeam: boolean
  /** 选人阶段结构化视图（非选人期为空） */
  champSelect?: ChampSelect
}

/** 名册默认取用的近期对局场次（与既有卡片一致，够画一条紧凑 KDA 条）。 */
export const ROSTER_RECENT_GAME_LIMIT = 6

/** 空名册（未连接 / phase 为空时）。 */
export const EMPTY_ROSTER: Roster = {
  groups: [],
  members: [],
  expectedSize: 0,
  isChampSelect: false,
  isMultiTeam: false
}

/**
 * 为一名玩家生成稳定行 key。
 *
 * @param puuid 玩家 puuid（选人期敌方为空串）
 * @param subteamId 所属分组
 * @param index 组内序号
 * @returns puuid 非空时返回 puuid，否则返回 `anon-{subteamId}-{index}`
 */
export function rosterMemberKey(puuid: string, subteamId: number, index: number): string {
  return puuid || `anon-${subteamId}-${index}`
}

/**
 * 分组标签。
 *
 * CLASSIC（含大乱斗）只有两组，走「我方/敌方」；CHERRY 有 1~8 个小队，
 * 走「第 N 小队」，非我方的小队额外标注为「其他」。
 */
export function rosterGroupLabel(subteamId: number, isMine: boolean, isMultiTeam: boolean): string {
  if (isMine) return '我方'
  if (!isMultiTeam) return '敌方'
  return `第 ${subteamId} 小队`
}

/** 分组类别。 */
function groupKind(subteamId: number, mySubteamId: number, isMultiTeam: boolean): RosterGroupKind {
  if (subteamId === mySubteamId) return 'mine'
  return isMultiTeam ? 'squad' : 'enemy'
}

/**
 * 把单个 `Subteam` 转成 `RosterGroup`。
 *
 * @param subteam 后端给出的分组
 * @param mySubteamId 自己所在分组
 * @param myPuuid 自己的 puuid（空串表示未知，此时不标「我」）
 * @param isMultiTeam CHERRY 模式（标签走小队号）
 * @param expectedSize 单组期望人数
 * @param gameLimit 每名成员取用的近期对局场次
 * @returns 排好序的分组
 */
function toGroup(
  subteam: Subteam,
  mySubteamId: number,
  myPuuid: string,
  isMultiTeam: boolean,
  expectedSize: number,
  gameLimit: number
): RosterGroup {
  const isMine = subteam.subteamId === mySubteamId
  const members = subteam.players.map<RosterMember>((player, index) => ({
    key: rosterMemberKey(player.summoner.puuid ?? '', subteam.subteamId, index),
    player,
    subteamId: subteam.subteamId,
    index,
    isSelf: !!myPuuid && player.summoner.puuid === myPuuid,
    championId: player.championId ?? 0,
    pickState: player.pickState ?? '',
    assignedPosition: player.assignedPosition ?? '',
    isLoading: player.isLoading === true,
    preGroupName: player.preGroupMarkers?.name ?? '',
    preGroupType: player.preGroupMarkers?.type ?? '',
    recent: player.userTag.recentData,
    recentGames: (player.matchHistory?.games?.games ?? []).slice(-gameLimit),
    meetTotal: player.meetTotal ?? 0
  }))
  return {
    subteamId: subteam.subteamId,
    kind: groupKind(subteam.subteamId, mySubteamId, isMultiTeam),
    label: rosterGroupLabel(subteam.subteamId, isMine, isMultiTeam),
    isMine,
    expectedSize,
    members
  }
}

/**
 * 组排序：我方第一，其余按 subteamId 升序。
 *
 * CLASSIC 自然得到「我方 / 敌方」；CHERRY 得到「我方 / 第 2 小队 / 第 3 小队 …」，
 * 与 `Gaming.vue` 既有 `orderedSubteams` 口径一致。
 */
function sortGroups(groups: RosterGroup[]): RosterGroup[] {
  const mine = groups.filter(g => g.isMine)
  const others = groups.filter(g => !g.isMine).sort((a, b) => a.subteamId - b.subteamId)
  return mine.length > 0 ? [...mine, ...others] : others
}

/**
 * 从会话数据抽取名册。
 *
 * @param sessionData 会话数据（`useSessionSync` 的响应式单例）
 * @param myPuuid 自己的 puuid，用于标「我」；空串表示未知
 * @param gameLimit 每名成员取用的近期对局场次
 * @returns 名册（分组 + 扁平成员）
 * @example
 * ```ts
 * const roster = buildRoster(sessionData, mySummonerPuuid.value)
 * // roster.groups[0] 是我方；CHERRY 下有 1~8 组
 * ```
 */
export function buildRoster(
  sessionData: SessionData,
  myPuuid = '',
  gameLimit = ROSTER_RECENT_GAME_LIMIT
): Roster {
  if (!sessionData || !Array.isArray(sessionData.subteams) || sessionData.subteams.length === 0) {
    return EMPTY_ROSTER
  }
  const isMultiTeam = sessionData.isMultiTeam === true
  // 期望人数取实际最大组：后端 CLASSIC 恒 5 人、CHERRY 恒 2 人，但占位阶段
  // 实际人数可能不足，用最大值才能既不误报空位也不凭空多画占位。
  const expectedSize = sessionData.subteams.reduce(
    (max, st) => Math.max(max, st.players?.length ?? 0),
    0
  )
  const groups = sortGroups(
    sessionData.subteams.map(st =>
      toGroup(st, sessionData.mySubteamId, myPuuid, isMultiTeam, expectedSize, gameLimit)
    )
  )
  const phase: SessionPhase = sessionData.phase ?? ''
  return {
    groups,
    members: groups.flatMap(g => g.members),
    expectedSize,
    isChampSelect: phase === 'ChampSelect',
    isMultiTeam,
    champSelect: sessionData.champSelect
  }
}
