import { describe, it, expect } from 'vitest'
import { resolveMatchDataSource } from '../matchDataSource'

describe('resolveMatchDataSource', () => {
  it('空 region + 无 game → isCrossSgp false, missingGameVersion true', () => {
    expect(resolveMatchDataSource('')).toEqual({ isCrossSgp: false, missingGameVersion: true })
  })

  it('非空 region + 无 game → isCrossSgp true, missingGameVersion true', () => {
    expect(resolveMatchDataSource('TJ100')).toEqual({
      isCrossSgp: true,
      missingGameVersion: true
    })
  })

  it('有 gameVersion → missingGameVersion false', () => {
    expect(resolveMatchDataSource('TJ100', { gameVersion: '25.6.1.123' })).toEqual({
      isCrossSgp: true,
      missingGameVersion: false
    })
  })

  it('gameDetail.gameVersion 有值 → missingGameVersion false', () => {
    expect(resolveMatchDataSource('TJ100', { gameDetail: { gameVersion: '25.6.1.123' } })).toEqual({
      isCrossSgp: true,
      missingGameVersion: false
    })
  })

  it('空字符串 gameVersion → missingGameVersion true', () => {
    expect(resolveMatchDataSource('TJ100', { gameVersion: '' })).toEqual({
      isCrossSgp: true,
      missingGameVersion: true
    })
  })

  it('null/undefined game → missingGameVersion true', () => {
    expect(resolveMatchDataSource('TJ100', null)).toEqual({
      isCrossSgp: true,
      missingGameVersion: true
    })
    expect(resolveMatchDataSource('TJ100')).toEqual({
      isCrossSgp: true,
      missingGameVersion: true
    })
  })

  it('LCU 本区 + 有 gameVersion → 全 false', () => {
    expect(
      resolveMatchDataSource('', {
        gameDetail: { gameVersion: '25.14.0.877' },
        gameVersion: '25.14.0.877'
      })
    ).toEqual({ isCrossSgp: false, missingGameVersion: false })
  })
})
