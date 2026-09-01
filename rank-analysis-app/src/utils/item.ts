/**
 * 装备相关通用工具函数与靴子分类
 */

/**
 * 英雄联盟鞋子类装备 ID 全集（一级/二级/三级升级鞋/特殊鞋）。
 *
 * 口径以大乱斗数据包 `items.json` 的 `categories` 含 `"Boots"` 为准，**并额外补入
 * 3172**——它是 3006 的三级升级鞋，但上游把它标成了 `NonbootsMovement` 而非 `Boots`，
 * 只按类目筛会漏。因此这里维持显式 ID 全集，不要改成运行时读 categories。
 *
 * 维护方式：数据包版本升级后重新对账
 * `{id | 'Boots' ∈ categories} ∪ {3172}`，缺哪个补哪个。
 */
export const BOOT_ITEM_IDS = new Set<number>([
  // ── 一级鞋 ──
  1001, // 鞋子 (Boots of Speed)

  // ── 二级鞋 ──
  3006, // 狂战士胫甲 (Berserker's Greaves)
  3008, // 暴食胫甲 (Symbiotic Soles)
  3009, // 轻灵之靴 (Boots of Swiftness)
  3010, // 共生鞋鱼 (Chain Boots)
  3013, // 灵犀众魂 (Synchronized Souls)
  3020, // 法师之靴 (Sorcerer's Shoes)
  3047, // 铁板靴 (Plated Steelcaps)
  3111, // 水银之靴 (Mercury's Treads)
  3117, // 疾行之靴 (Boots of Mobility)
  3158, // 明朗之靴 (Ionian Boots of Lucidity)

  // ── 三级升级鞋（S15 新增；玩家实际合成的终局鞋，最容易漏进"纯大件"展示）──
  3168, // 不朽之路 ← 3008
  3170, // 迅速进军 ← 3009
  3171, // 猩红明朗 ← 3158
  3172, // 炮铜胫甲 ← 3006（上游类目为 NonbootsMovement，须显式列出）
  3173, // 带链碾碎者 ← 3111
  3174, // 装甲战靴 ← 3047
  3175, // 灵能使之靴 ← 3020
  3176, // 永远前进 ← 3013

  // ── 特殊/历史鞋 ──
  1111, // 嘉文一世之靴
  2422, // 有点神奇之鞋 (Slightly Magical Footwear)
  3005 // 幽灵行者 (Ghostcrawlers)：已从游戏移除，保留以正确解析历史战绩
])

/**
 * 模式专属装备变体的 ID 前缀（如大乱斗的 223008 即 3008 的变体）。
 *
 * 上游对同一件装备在不同模式下会另发一个 `<前缀><基础id>` 的 ID，数值不同但仍是同一件鞋。
 * 逐个枚举变体会随模式增加而反复漏，这里统一剥前缀后回落到基础 ID 判定。
 */
const MODE_VARIANT_PREFIXES = ['22', '32'] as const

/**
 * 判定指定装备 ID 是否为鞋子（含模式专属变体）
 *
 * @param id - 装备 ID；null / undefined / 0 视为非鞋子
 * @returns 是鞋子返回 true
 * @example
 * ```ts
 * isBootItem(3174)   // true —— 装甲战靴（三级鞋）
 * isBootItem(223008) // true —— 大乱斗变体，剥前缀后命中 3008
 * isBootItem(3031)   // false —— 无尽之刃
 * ```
 */
export function isBootItem(id: number | null | undefined): boolean {
  if (!id || typeof id !== 'number') return false
  if (BOOT_ITEM_IDS.has(id)) return true

  // 模式变体：剥掉已知前缀后按基础 ID 再判一次
  const text = String(id)
  for (const prefix of MODE_VARIANT_PREFIXES) {
    if (!text.startsWith(prefix) || text.length <= prefix.length) continue
    const base = Number(text.slice(prefix.length))
    if (Number.isInteger(base) && BOOT_ITEM_IDS.has(base)) return true
  }
  return false
}
