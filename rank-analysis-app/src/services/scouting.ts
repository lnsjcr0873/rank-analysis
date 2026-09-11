/**
 * 赛前威胁评级（M4 战场六）：从 champ-select 会话获取敌方玩家威胁评级。
 *
 * 每条评级包含威胁等级、风格标签、相遇次数、对线侵略性、近期表现分等。
 * 敌方数据不足时降级为 Low + caveats。
 */

import { invoke } from '@tauri-apps/api/core'

/** 威胁等级（与 Rust ThreatLevel 对齐，camelCase） */
export type ThreatLevel = 'Low' | 'Medium' | 'High' | 'Critical'

/** 单名敌方玩家威胁评级（与 Rust ThreatRating 对齐，camelCase） */
export interface ThreatRating {
  threatLevel: ThreatLevel
  styleTags: string[]
  encounterCount: number
  laneAggression: number
  recentPerformance: number
  mainChampionWinRate: number | null
  caveats: string[]
  puuid: string
  position: string
}

/** 威胁等级 → 中文标签 */
export const THREAT_LEVEL_LABELS: Record<ThreatLevel, string> = {
  Low: '低威胁',
  Medium: '中等',
  High: '高威胁',
  Critical: '极高威胁'
}

/** 威胁等级 → 颜色 */
export const THREAT_LEVEL_COLORS: Record<ThreatLevel, string> = {
  Low: '#4ade80',
  Medium: '#facc15',
  High: '#f97316',
  Critical: '#ef4444'
}

/** 威胁评级响应（与 Rust ThreatRatingsResponse 对齐，camelCase） */
export interface ThreatRatingsResponse {
  ratings: ThreatRating[]
  /** 选人会话中敌方人数 */
  enemyCount: number
  /** 其中无身份人数 */
  anonymousCount: number
  /** 有敌方但全匿名（Riot 反侦查）→ 渲染显式引导而非静默空白 */
  isEnemyAnonymous: boolean
}

/** 空响应（无选人会话/非选人期兜底） */
export const EMPTY_THREAT_RESPONSE: ThreatRatingsResponse = {
  ratings: [],
  enemyCount: 0,
  anonymousCount: 0,
  isEnemyAnonymous: false
}

/** 从当前 champ-select 会话获取敌方玩家威胁评级（含匿名状态） */
export async function getThreatRatings(): Promise<ThreatRatingsResponse> {
  const raw = await invoke<ThreatRatingsResponse | ThreatRating[]>('get_threat_ratings')
  // 向后兼容：旧后端/mock 桩可能直接返回数组
  if (Array.isArray(raw)) {
    return { ...EMPTY_THREAT_RESPONSE, ratings: raw }
  }
  return {
    ratings: Array.isArray(raw.ratings) ? raw.ratings : [],
    enemyCount: raw.enemyCount ?? 0,
    anonymousCount: raw.anonymousCount ?? 0,
    isEnemyAnonymous: raw.isEnemyAnonymous ?? false
  }
}
