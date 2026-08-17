/**
 * 轻量 unknown → 单行错误文案工具（catch unknown 收敛,见 T19）。
 *
 * 语义（与各调用点旧文案 `e?.message || '兜底'` 完全一致）：
 * - Error 且 message 非空 → message
 * - 非空字符串 → 原文（service 层抛出的字符串错误）
 * - 其余（null/undefined/对象/空串）→ fallback（默认 '未知错误'）
 *
 * @param e - catch 到的 unknown 错误值
 * @param fallback - 无法提取消息时的兜底文案,默认 '未知错误'
 * @returns 单行错误文案
 * @example
 * ```ts
 * try { ... } catch (e: unknown) {
 *   message.error('AI 分析出错: ' + errorMessage(e))
 * }
 * ```
 */

// 二期清单（仍为 `catch (e: any)` 或按 any 使用,待逐一收敛）：
// - src/composables/useMatchAIAnalysis.ts:159（runToken 代次互斥路径,迁移需保留 token 校验）
// - src/views/settings/Tags.vue ×4（194/226/294/305）
// - src/views/settings/General.vue:460

export function errorMessage(e: unknown, fallback: string = '未知错误'): string {
  if (e instanceof Error) return e.message || fallback
  if (typeof e === 'string' && e) return e
  return fallback
}
