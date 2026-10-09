/**
 * 名册墙设置项测试（ADR-3 的 9 个 key）。
 *
 * 重点是 `normalizeRosterWallSettings` 的**逐字段兜底**语义：
 * 配置坏在一个字段时，其余八个字段仍应取到默认值，而不是整体回落 DEFAULTS。
 * 整体兜底会让「用户只改错了 loadCount」变成「所有偏好被重置」。
 */

import { describe, it, expect } from 'vitest'
import { DEFAULTS, normalizeRosterWallSettings, type RosterWallSettings } from './settings'

describe('DEFAULTS', () => {
  it('与 ADR-3 表格一致（9 个 key）', () => {
    expect(DEFAULTS).toEqual({
      enabled: true,
      loadCount: 50,
      timelineGameCount: 6,
      showJunglePathing: true,
      showJungleForAll: false,
      showChampionUsage: 'recent',
      orderPlayerBy: 'position',
      showMatchItemBorder: false,
      playerTags: {}
    })
  })
})

describe('normalizeRosterWallSettings', () => {
  it('undefined / null / 非对象 → 全量默认值', () => {
    for (const input of [undefined, null, 'nonsense', 42, []]) {
      expect(normalizeRosterWallSettings(input)).toEqual(DEFAULTS)
    }
  })

  it('合法配置原样透传', () => {
    const good: RosterWallSettings = {
      ...DEFAULTS,
      enabled: false,
      loadCount: 30,
      timelineGameCount: 10,
      showJungleForAll: true,
      showChampionUsage: 'mastery',
      orderPlayerBy: 'winrate'
    }
    expect(normalizeRosterWallSettings(good)).toEqual(good)
  })

  it('loadCount 夹到 [20,100]', () => {
    expect(normalizeRosterWallSettings({ loadCount: 0 }).loadCount).toBe(20)
    expect(normalizeRosterWallSettings({ loadCount: -5 }).loadCount).toBe(20)
    expect(normalizeRosterWallSettings({ loadCount: 9999 }).loadCount).toBe(100)
    expect(normalizeRosterWallSettings({ loadCount: 37.6 }).loadCount).toBe(38)
  })

  it('timelineGameCount 夹到 [3,20]', () => {
    expect(normalizeRosterWallSettings({ timelineGameCount: 0 }).timelineGameCount).toBe(3)
    expect(normalizeRosterWallSettings({ timelineGameCount: 1 }).timelineGameCount).toBe(3)
    expect(normalizeRosterWallSettings({ timelineGameCount: 999 }).timelineGameCount).toBe(20)
    expect(normalizeRosterWallSettings({ timelineGameCount: 12 }).timelineGameCount).toBe(12)
  })

  it('非数字的数值字段回落默认（而不是变 NaN）', () => {
    const n = normalizeRosterWallSettings({ loadCount: 'abc', timelineGameCount: null })
    expect(n.loadCount).toBe(DEFAULTS.loadCount)
    expect(n.timelineGameCount).toBe(DEFAULTS.timelineGameCount)
    expect(Number.isNaN(n.loadCount)).toBe(false)
  })

  it('Infinity / NaN 同样回落默认', () => {
    const n = normalizeRosterWallSettings({
      loadCount: Number.POSITIVE_INFINITY,
      timelineGameCount: Number.NaN
    })
    expect(n.loadCount).toBe(DEFAULTS.loadCount)
    expect(n.timelineGameCount).toBe(DEFAULTS.timelineGameCount)
  })

  it('枚举字段非法时回落默认', () => {
    expect(normalizeRosterWallSettings({ showChampionUsage: 'garbage' }).showChampionUsage).toBe(
      'recent'
    )
    expect(normalizeRosterWallSettings({ orderPlayerBy: 'whatever' }).orderPlayerBy).toBe(
      'position'
    )
    // 合法值不被误伤
    expect(normalizeRosterWallSettings({ orderPlayerBy: 'akari' }).orderPlayerBy).toBe('akari')
    expect(normalizeRosterWallSettings({ showChampionUsage: 'none' }).showChampionUsage).toBe(
      'none'
    )
  })

  it('逐字段兜底：一个字段坏，其余字段仍取到（用户配置）', () => {
    const n = normalizeRosterWallSettings({
      loadCount: -1,
      enabled: false,
      orderPlayerBy: 'kda'
    })
    expect(n.loadCount).toBe(20) // 被夹住
    expect(n.enabled).toBe(false) // 用户的合法修改被保留
    expect(n.orderPlayerBy).toBe('kda') // 同上
    // 其余未提供的字段仍走默认值
    expect(n.timelineGameCount).toBe(DEFAULTS.timelineGameCount)
    expect(n.showJunglePathing).toBe(DEFAULTS.showJunglePathing)
  })

  it('playerTags 只保留布尔值，但保留未知 key（对齐 looseObject）', () => {
    const n = normalizeRosterWallSettings({
      playerTags: { veryEasyGank: true, hardGank: false, junk: 'yes', nully: null }
    })
    expect(n.playerTags).toEqual({ veryEasyGank: true, hardGank: false })
  })

  it('playerTags 缺失或非对象时回落空对象', () => {
    expect(normalizeRosterWallSettings({}).playerTags).toEqual({})
    expect(normalizeRosterWallSettings({ playerTags: 'nope' }).playerTags).toEqual({})
  })
})
