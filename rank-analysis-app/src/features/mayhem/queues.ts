/**
 * 大乱斗 / 大乱斗类队列判定（单一事实来源）。
 *
 * 此前 `[2400, 2410, 2450]` 这份列表被复制在三处并各自演化：
 * `composables/useInGameServices.ts`、`views/Gaming.vue`、
 * `components/gaming/MayhemDraftPanel.vue`。漏改任一处都会导致「某个变体队列
 * 进大乱斗时助手不启动」这类只在特定队列复现的故障。
 *
 * 口径与后端 `command/mayhem.rs::mayhem_draft_context` 保持一致。
 *
 * @module features/mayhem/queues
 */

/** 大乱斗队列 ID 集合（2400 狂暴大乱斗 / 2410 / 2450）。 */
export const MAYHEM_QUEUE_IDS: readonly number[] = [2400, 2410, 2450]

/**
 * 是否大乱斗队列。
 *
 * @param queueId LCU `queue.id`
 * @returns 命中大乱斗队列返回 true
 * @example
 * ```ts
 * if (isMayhemQueue(sessionData.queueId)) { ... }
 * ```
 */
export function isMayhemQueue(queueId: number): boolean {
  return MAYHEM_QUEUE_IDS.includes(queueId)
}
