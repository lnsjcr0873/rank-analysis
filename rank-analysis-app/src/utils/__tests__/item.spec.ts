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

  it('has comprehensive boot item set', () => {
    expect(BOOT_ITEM_IDS.size).toBeGreaterThanOrEqual(10)
  })
})
