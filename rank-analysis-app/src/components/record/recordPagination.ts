/**
 * 战绩分页桥接（对齐 Akari player-tab：分页 UI 从工具栏移到左栏顶部 / 列表顶粘顶工具条）。
 *
 * 分页状态归 MatchHistory 所有（页切片/末页 SGP 追加拉取逻辑不动），但 UI 渲染点
 * 由 Record.vue 双点分发：
 *  - 宽窗（>=1064）：左栏最顶部一个 MatchHistoryPagination
 *  - 窄窗（<1064）：内容区顶部粘顶工具条内（同组件，floating 变体）
 * 因此需要一个模块级桥接：MatchHistory 注册 next/prev 真实实现，两个挂载点只读
 * 状态 + 调注册的处理器（默认 no-op，未挂载/加载中安全）。
 */
import { reactive, readonly } from 'vue'

export interface RecordPaginationHandlers {
  next: () => void
  prev: () => void
}
export interface RecordPaginationState {
  page: number
  pageCount: number
  noMoreMatches: boolean
  perPage: number
  total: number
}

const EMPTY_HANDLERS: RecordPaginationHandlers = { next: () => {}, prev: () => {} }

const state = reactive<RecordPaginationState>({
  page: 1,
  pageCount: 1,
  noMoreMatches: false,
  perPage: 0,
  total: 0
})
let handlers: RecordPaginationHandlers = EMPTY_HANDLERS
let bound = false

/** MatchHistory 挂载时绑定真实翻页实现（同组件只存在一个，覆盖式注册） */
export function bindRecordPagination(h: RecordPaginationHandlers): void {
  handlers = h
  bound = true
}
/** MatchHistory 卸载时解绑，避免左栏残留闭包引用旧实例 */
export function unbindRecordPagination(): void {
  handlers = EMPTY_HANDLERS
  bound = false
}
/** 状态同步（MatchHistory 每次 page/pageCount 变化时调用） */
export function syncRecordPagination(next: Partial<RecordPaginationState>): void {
  Object.assign(state, next)
  bound = true
}

export function recordPaginationNext(): void {
  if (bound) handlers.next()
}
export function recordPaginationPrev(): void {
  if (bound) handlers.prev()
}

/** 测试/切换玩家时重置模块状态（卸载后的残留分页读数不应停留上一页） */
export function resetRecordPagination(): void {
  state.page = 1
  state.pageCount = 1
  state.noMoreMatches = false
  state.perPage = 0
  state.total = 0
  handlers = EMPTY_HANDLERS
  bound = false
}

export const recordPagination = readonly(state)
