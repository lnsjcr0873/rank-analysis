/**
 * 营地标识 → 中文名与视觉分组。
 *
 * Rust `geometry::Camp` 以 camelCase 序列化（`blueBuff` / `riftHerald`…），
 * 这里做展示层翻译。**新增营地只需在此加一行**，别在组件里写 switch——
 * 组件是纯展示，不该知道营地有哪些。
 */

/** 营地在路径序列里的语义分组，决定配色与排序权重 */
export type CampGroup = 'buff' | 'farm' | 'objective'

export interface CampMeta {
  /** 短名（卡片窄，2 字优先） */
  label: string
  /** 完整名（tooltip / aria-label） */
  title: string
  group: CampGroup
}

/**
 * 已知营地。未收录的标识返回 undefined ⇒ 组件按「未知营地」渲染，
 * **不丢弃也不猜测**——路径序列必须与后端产出一一对应，
 * 悄悄跳过会让用户看到的路径与服务端算出的不一致。
 */
export const CAMP_META: Record<string, CampMeta> = {
  blueBuff: { label: '蓝', title: '蓝buff', group: 'buff' },
  redBuff: { label: '红', title: '红buff', group: 'buff' },
  gromp: { label: '魔像', title: '远古魔像', group: 'farm' },
  wolves: { label: '三狼', title: '灰烬狼', group: 'farm' },
  krugs: { label: '石甲', title: '补刀刀锋', group: 'farm' },
  riftScuttler: { label: '河蟹', title: '河道迅捷蟹', group: 'farm' },
  riftHerald: { label: '先锋', title: '峡谷先锋', group: 'objective' },
  dragon: { label: '小龙', title: '元素亚龙', group: 'objective' },
  baron: { label: '男爵', title: '纳什男爵', group: 'objective' }
}

/** 取营地元信息；未知标识给出保守兜底（group=farm，不参与特殊配色） */
export function campMeta(key: string): CampMeta {
  return CAMP_META[key] ?? { label: key.slice(0, 2), title: key, group: 'farm' }
}

/** 开局 3 分钟内开野 = 入侵信号（P1/P3 的 `invaded_before_3min` 阈值） */
export const INVASION_WINDOW_MS = 3 * 60 * 1000

/** 「未知营地」计数超过此比例时，提示序列可能与后端口径不一致 */
export const UNKNOWN_CAMP_WARN_RATIO = 0.34

/** 毫秒 → mm:ss */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '--:--'
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 比例 → 百分比文案；null 显示占位符而非 0% */
export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}
