/**
 * 名册墙的列数计算（复刻 Akari `OngoingGamePanel.columnsNeed`）。
 *
 * 抽成独立模块而非写在 `<script setup>` 里，有两个原因：
 * 1. `<script setup>` 不能 `export`，写在组件里就没法单测；
 * 2. **公式必须只有一处实现** —— 原型第一版在容器与队伍块各算过一次，
 *    导致「左右分栏」时固定 5 列 × 240px 撑破 flex 列宽（真实回归）。
 */

/** 卡片宽度（Akari `FIXED_CARD_WIDTH_PX_LITERAL` = 240） */
export const CARD_WIDTH_PX = 240

/** 卡片网格 gap（8px） */
export const GRID_GAP_PX = 8

/** 名册墙容器两端的 padding */
export const WALL_PADDING_PX = 32

/**
 * 计算卡片列数。
 *
 * 口径与 Akari 一致：`min(第一个满足宽度上限的列数, 队伍最大人数)`，
 * 再额外用 gap 折算做一次上界修正（Akari 公式不含 gap，短宽度下会多算一列）。
 *
 * @param perTeamWidth 每队可用宽度（px，已扣除容器 padding）
 * @param maxTeamSize 该队最大人数
 * @returns 列数，最小 1
 */
export function calcColumns(perTeamWidth: number, maxTeamSize: number): number {
  if (maxTeamSize <= 0) return 1

  // Akari 原式：宽度上限列（8→3 递减，找第一个满足 contentWidth > 240*(col+0.25)）
  const widthCapped = [8, 7, 6, 5, 4, 3].find(col => perTeamWidth > CARD_WIDTH_PX * (col + 0.25))
  const maxByWidth = widthCapped ?? 3

  // 计入 gap 的实际上限：n 张卡 + (n-1) 个 gap ≤ 可用宽度
  const byGap = Math.floor((perTeamWidth + GRID_GAP_PX) / (CARD_WIDTH_PX + GRID_GAP_PX))

  return Math.max(1, Math.min(maxByWidth, byGap, maxTeamSize))
}

/**
 * 由容器总宽度推导列数（上下堆叠：两队各占整宽）。
 *
 * @param containerWidth 名册墙容器实测/传入宽度
 * @param maxTeamSize 最大队伍人数
 */
export function calcColumnsFromContainer(containerWidth: number, maxTeamSize: number): number {
  return calcColumns(containerWidth - WALL_PADDING_PX, maxTeamSize)
}
