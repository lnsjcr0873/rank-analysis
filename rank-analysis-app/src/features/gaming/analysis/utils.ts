/**
 * 名册墙「历史画像」分析的纯数学工具。
 *
 * 移植自 Akari `shared/data-adapter/utils.ts` + `analysis/player/utils/math.ts`。
 * 全部为幂等纯函数，无 IO、无 Date.now、可直接单测。
 *
 * ⚠️ 语义刻意与 Akari 保持一致（不是"看起来等价"），因为数值口径直接影响
 * 卡片上显示的百分比：
 * - `noZero(x)` 是 `x || 1`，即 **0 与 NaN 都落到 1**（避免除零产生 Infinity）；
 * - `calculateCoefficientOfVariation` 空数组或均值为 0 时返回 **-1** 哨兵
 *   （不是 0，避免"无波动"被误读为"完美稳定"）。
 * 修改任一语义都必须同步 Akari 与本文件两侧的测试。
 */

/**
 * 除零保护：0 与 NaN 视为 1。
 *
 * 用于所有「本人值 / 队总值」形式的占比计算——队总伤害为 0（极端局/数据缺失）时，
 * 返回 `本人值 / 1` 而非 Infinity，使上层拿到有限值并在 UI 显式降级。
 */
export function noZero(value: number): number {
  return value || 1
}

/** 均值；空数组返回 0 */
export function avgOrZero(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((s, v) => s + v, 0) / noZero(values.length)
}

/**
 * 均值；空数组返回 1（而非 0）。
 *
 * 专用于「效率类」指标（如伤金转化、人头伤害占比）：样本为空时语义上应视为
 * 「无效率差异」= 1，而不是「效率为 0」，否则空样本会把卡片拉成极端值。
 */
export function avgOrOne(values: number[]): number {
  if (values.length === 0) return 1
  return values.reduce((s, v) => s + v, 0) / noZero(values.length)
}

/** 均值；空数组返回 null（数据不足，不编数字） */
export function avgOrNull(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((s, v) => s + v, 0) / values.length
}

/**
 * 均值，但**任一元素为 null 即整体返回 null**。
 *
 * 专用于「部分数据源才有的字段」（SGP 独有的单杀数、敌方消失信号）。
 * 只要有一局缺该字段就整体不可信，避免用半数样本算出误导性的均值
 * ——这与 `avgOrNull`（空数组才 null）的区别是刻意的。
 */
export function avgIfAllNonNull(values: (number | null)[]): number | null {
  if (values.length === 0) return null
  if (!values.every(v => v !== null)) return null
  const nonNulls = values as number[]
  return nonNulls.reduce((s, v) => s + v, 0) / noZero(nonNulls.length)
}

/**
 * 极差标准化到 0..1；全等时返回全 0。
 *
 * 供变异系数使用：先标准化再算 CV，否则量纲大的指标（伤害）会主导波动度。
 */
export function standardize(numbers: number[]): number[] {
  if (numbers.length === 0) return []

  const min = Math.min(...numbers)
  const max = Math.max(...numbers)
  const range = max - min

  if (range === 0) {
    return new Array(numbers.length).fill(0)
  }

  return numbers.map(num => (num - min) / range)
}

/**
 * 变异系数（标准差 / 均值），衡量稳定性。
 *
 * 空数组或均值为 0 时返回 **-1 哨兵**（Akari 语义）：调用方须显式判 -1 并降级，
 * 不得当作 0 使用——「无法计算」与「零波动」是两件事。
 */
export function calculateCoefficientOfVariation(numbers: number[]): number {
  if (!numbers || numbers.length === 0) {
    return -1
  }

  const mean = numbers.reduce((sum, num) => sum + num, 0) / numbers.length
  if (mean === 0) {
    return -1
  }

  const variance = numbers.reduce((sum, num) => sum + (num - mean) ** 2, 0) / numbers.length
  const standardDeviation = Math.sqrt(variance)

  return standardDeviation / mean
}

/**
 * 线性插值分位数（`p` 取 0..1）。
 *
 * 数组会被视作已排序输入；调用方需自行先 sort（见 `findOutliersByIqr`）。
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0
  }

  const index = p * (sorted.length - 1)
  const lower = Math.floor(index)
  const fraction = index - lower

  if (lower === sorted.length - 1) {
    return sorted[lower]
  }

  return sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower])
}

/**
 * 箱线法找出过高/过低的离群项。
 *
 * 名册墙用它给「场均 KDA 明显高于/低于全场」的玩家染色（Akari 面板阈值
 * `IQR_THRESHOLD = 0.65`，比通用默认 1.5 更激进——同场 10 人样本太小，
 * 用 1.5 几乎标不出人）。
 *
 * @param data 待检数组
 * @param keyGetter 取比较数值；省略时要求元素本身是 number
 * @param threshold IQR 倍数，缺省 1.5
 * @returns `below` 低于下界、`over` 高于上界的原始元素
 */
export function findOutliersByIqr<T>(
  data: T[],
  keyGetter?: (value: T) => number,
  threshold = 1.5
): { below: T[]; over: T[] } {
  const get = keyGetter ?? ((value: T) => value as unknown as number)

  const sorted = data.slice().sort((a, b) => get(a) - get(b))
  const q1 = percentile(sorted.map(get), 0.25)
  const q3 = percentile(sorted.map(get), 0.75)
  const iqr = q3 - q1
  const lowerBound = q1 - threshold * iqr
  const upperBound = q3 + threshold * iqr

  const below: T[] = []
  const over: T[] = []

  for (const d of data) {
    const v = get(d)
    if (v < lowerBound) {
      below.push(d)
    } else if (v > upperBound) {
      over.push(d)
    }
  }

  return { below, over }
}

/**
 * 求和；空数组返回 0（区别于 Akari 的 `reduce` 无初值会抛错）。
 */
export function sumOrZero(values: number[]): number {
  return values.reduce((s, v) => s + v, 0)
}
