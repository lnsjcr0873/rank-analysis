import { describe, it, expect } from 'vitest'
import { analyzeAramComp } from '../aramAdvisor'

describe('aramAdvisor', () => {
  it('detects balanced composition', () => {
    // 1 (Annie, AP), 11 (Yi, AD), 15 (Sivir, AD), 103 (Ahri, AP)
    const res = analyzeAramComp([1, 11, 15, 103])
    expect(res.balanceStatus).toBe('balanced')
    expect(res.adPercent).toBe(50)
    expect(res.apPercent).toBe(50)
  })

  it('flags all AP team and recommends bench AD champions', () => {
    // 1, 103, 99 (Lux), 134 (Syndra) -> all AP
    const res = analyzeAramComp([1, 103, 99, 134], [15, 11], id => (id === 15 ? '希维尔' : '易'))
    expect(res.balanceStatus).toBe('all_ap')
    expect(res.recommendations.length).toBeGreaterThan(0)
    expect(res.recommendations[0].championId).toBe(15)
  })
})
