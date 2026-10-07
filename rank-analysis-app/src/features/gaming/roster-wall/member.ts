/**
 * 名册墙成员的**展示视图模型**。
 *
 * 把「session 展示信息」与「画像分析结果」合成一个对象，使 `RosterWall` /
 * `TeamBlock` / `PlayerCard` 全部保持纯展示，不需要各自去猜数据在哪。
 *
 * 放在 `features/gaming/roster-wall/` 而非 `services/`，因为它含 UI 语义
 * （遮罩后的显示名、分路中文、预组字母），不属于可复用服务层。
 */

import type { SessionSummoner } from '@renderer/types/domain/gaming'

import type { PlayerAnalysis } from '../services/playerAnalysis'
import type { PlayerTimelineSummary } from '../services/playerTimeline'

/** 名册墙单个成员的完整展示契约 */
export interface RosterWallMember {
  puuid: string
  analysis: PlayerAnalysis
  /** 帧级画像（P1/P3）；不可用时为 null，C 类 Tag 据此隐藏 */
  timeline: PlayerTimelineSummary | null
  /** 已做遮罩处理的显示名 */
  displayName: string
  tagLine: string
  summonerLevel: number
  /** 本局所选英雄；未选人为 0 */
  championId: number
  /** 分路中文（由 `assignedPosition` 归一） */
  positionLabel: string
  /** 本局是否系统自动分配（补位） */
  autofilled: boolean
  soloTierLabel: string | null
  flexTierLabel: string | null
  soloTierKey: string | null
  flexTierKey: string | null
  /** 预组队字母 A/B/C…；无预组为 null */
  premadeGroup: string | null
  /** meet.db 累计相遇场次 */
  metTotal: number
  isSelf: boolean
  privacy: boolean
  masked: boolean
}

/** 分路键 → 中文（与 `normalizePosition` 的取值对齐） */
const POSITION_CN: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '射手',
  UTILITY: '辅助'
}

/**
 * 预组队字母：由 `preGroupMarkers.name` 取首字符大写。
 *
 * 后端已给 `队伍1/队伍2/…` 之类的固定标签（见 command/session.rs 的
 * `preGroupMarkers`），此处只取序号映射为 A/B/C 以对齐 Akari 的视觉语言。
 */
export function premadeGroupOf(
  markers: SessionSummoner['preGroupMarkers'] | undefined
): string | null {
  if (!markers || markers.type === '') return null
  const m = markers.name.match(/(\d+)/)
  if (!m) return null
  const idx = Number(m[1]) - 1
  // 最多展示到 D，超出用 muted 归入「其他」以免出现无对应色标的组
  return idx >= 0 && idx < 4 ? String.fromCharCode(65 + idx) : 'D'
}

/**
 * 由 session 玩家 + 分析结果构造展示模型。
 *
 * @param player session 中的玩家
 * @param analysis `analyzePlayer` 的结果
 * @param selfPuuid 本人 puuid（用于「我」标记）
 * @param tierMap puuid → 段位展示信息（来自 `useSessionTiers`）
 * @param streamerMode 直播模式：昵称遮罩
 * @param timeline 帧级画像（P1/P3）；缺省或不可用时为 null
 */
export function toRosterWallMember(
  player: SessionSummoner,
  analysis: PlayerAnalysis,
  selfPuuid: string,
  tierMap: Map<string, { imgUrl: string; tierCn: string }[]>,
  streamerMode = false,
  timeline: PlayerTimelineSummary | null = null
): RosterWallMember {
  const puuid = player.summoner?.puuid ?? ''
  const tiers = tierMap.get(puuid) ?? []
  const assigned = (player.assignedPosition ?? '').toLowerCase()

  return {
    puuid,
    analysis,
    timeline,
    // 直播模式下用英雄名占位，避免在观战/转播场景泄露身份
    displayName: streamerMode
      ? `玩家 ${player.championId || '?'}`
      : `${player.summoner?.gameName ?? '未知'}`,
    tagLine: streamerMode ? '' : (player.summoner?.tagLine ?? ''),
    summonerLevel: player.summoner?.summonerLevel ?? 0,
    championId: player.championId ?? 0,
    positionLabel: POSITION_CN[assigned.toUpperCase()] ?? '',
    // 「本局分路与历史分析分路不一致」视为补位信号；此处由调用方按需覆盖
    autofilled: false,
    soloTierLabel: tiers[0]?.tierCn ?? null,
    flexTierLabel: tiers[1]?.tierCn ?? null,
    soloTierKey: tiers[0]?.tierCn?.toLowerCase() ?? null,
    flexTierKey: tiers[1]?.tierCn?.toLowerCase() ?? null,
    premadeGroup: premadeGroupOf(player.preGroupMarkers),
    metTotal: player.meetTotal ?? 0,
    isSelf: puuid === selfPuuid,
    privacy: false,
    masked: streamerMode
  }
}
