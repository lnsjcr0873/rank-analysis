import { describe, expect, it } from 'vitest'
import { isBootItem, BOOT_ITEM_IDS } from '../item'

describe('isBootItem', () => {
  it('identifies standard boots correctly', () => {
    expect(isBootItem(3006)).toBe(true) // Berserker's Greaves
    expect(isBootItem(3020)).toBe(true) // Sorcerer's Shoes
    expect(isBootItem(3047)).toBe(true) // Plated Steelcaps
    expect(isBootItem(3111)).toBe(true) // Mercury's Treads
    expect(isBootItem(3158)).toBe(true) // Ionian Boots of Lucidity
    expect(isBootItem(3009)).toBe(true) // Boots of Swiftness
    expect(isBootItem(1001)).toBe(true) // Boots of Speed
  })

  it('rejects non-boot legendary / core items', () => {
    expect(isBootItem(3078)).toBe(false) // Trinity Force
    expect(isBootItem(3089)).toBe(false) // Rabadon's Deathcap
    expect(isBootItem(3031)).toBe(false) // Infinity Edge
    expect(isBootItem(3157)).toBe(false) // Zhonya's Hourglass
    expect(isBootItem(3053)).toBe(false) // Sterak's Gage
    expect(isBootItem(0)).toBe(false)
    expect(isBootItem(null)).toBe(false)
    expect(isBootItem(undefined)).toBe(false)
  })

  // 三级鞋是玩家真正合成的终局鞋，最容易漏进"核心三件套（纯大件）"展示。
  // 原先只断言 size >= 10（恰好等于当时的集合大小）属于自我实现的断言，
  // 漏掉整批三级鞋也照样通过——这里改为逐个点名。
  it('identifies tier-3 upgraded boots', () => {
    expect(isBootItem(3168)).toBe(true) // 不朽之路 ← 3008
    expect(isBootItem(3170)).toBe(true) // 迅速进军 ← 3009
    expect(isBootItem(3171)).toBe(true) // 猩红明朗 ← 3158
    expect(isBootItem(3173)).toBe(true) // 带链碾碎者 ← 3111
    expect(isBootItem(3174)).toBe(true) // 装甲战靴 ← 3047
    expect(isBootItem(3175)).toBe(true) // 灵能使之靴 ← 3020
    expect(isBootItem(3176)).toBe(true) // 永远前进 ← 3013
  })

  it('identifies 3172 despite upstream tagging it NonbootsMovement', () => {
    // 3006 的三级升级鞋，上游 categories 是 NonbootsMovement 而非 Boots；
    // 这条守住"不要改成运行时按 categories 判定"的结论
    expect(isBootItem(3172)).toBe(true)
  })

  it('identifies mode-specific item variants by stripping the id prefix', () => {
    expect(isBootItem(223008)).toBe(true) // 大乱斗变体 → 基础 3008
    expect(isBootItem(323020)).toBe(true) // 前缀 32 变体 → 基础 3020
    expect(isBootItem(223031)).toBe(false) // 3031 无尽之刃不是鞋，变体同样不是
  })

  it('covers every Boots-category id shipped in the mayhem item dataset', () => {
    // 与数据包 items.json 中 categories 含 "Boots" 的条目对账（dataVersion 16.16.3），
    // 外加类目失真的 3172。数据包升级后若上游新增鞋子，此断言先红。
    const datasetBootIds = [
      1001, 1111, 2422, 3006, 3008, 3009, 3010, 3013, 3020, 3047, 3111, 3117, 3158, 3168, 3170,
      3171, 3173, 3174, 3175, 3176, 223008, 3172
    ]
    for (const id of datasetBootIds) {
      expect(isBootItem(id), `装备 ${id} 应被判定为鞋子`).toBe(true)
    }
    expect(BOOT_ITEM_IDS.size).toBeGreaterThanOrEqual(21)
  })
})
