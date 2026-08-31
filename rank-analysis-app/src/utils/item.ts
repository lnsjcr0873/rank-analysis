/**
 * 装备相关通用工具函数与靴子分类
 */

/**
 * 英雄联盟鞋子类装备 ID 集合（基础鞋/二级鞋/特殊鞋/神奇之鞋）
 */
export const BOOT_ITEM_IDS = new Set<number>([
  1001, // 速度之靴 (Boots of Speed)
  2422, // 略微神奇之鞋 (Slightly Magical Footwear)
  3005, // 灵龟之靴 / 幽灵行者 (Ghostcrawlers)
  3006, // 狂战士胫甲 (Berserker's Greaves)
  3009, // 轻灵之靴 (Boots of Swiftness)
  3020, // 法师之靴 (Sorcerer's Shoes)
  3047, // 铁板靴 (Plated Steelcaps)
  3111, // 水银之靴 (Mercury's Treads)
  3117, // 疾行之靴 (Boots of Mobility)
  3158 // 明朗之靴 (Ionian Boots of Lucidity)
])

/**
 * 判定指定装备 ID 是否为鞋子
 */
export function isBootItem(id: number | null | undefined): boolean {
  if (!id || typeof id !== 'number') return false
  return BOOT_ITEM_IDS.has(id)
}
