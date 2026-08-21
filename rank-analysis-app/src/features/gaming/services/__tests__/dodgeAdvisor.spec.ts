import { describe, it, expect } from 'vitest'
import { evaluateDodgeQuality } from '../dodgeAdvisor'
import type { LineupScore } from '../lineupScore'
import type { ThreatRating } from '@renderer/services/scouting'

describe('dodgeAdvisor', () => {
  it('returns balanced result for neutral inputs', () => {
    const res = evaluateDodgeQuality({})
    expect(res.qualityScore).toBe(50)
    expect(res.recommendation).toBe('caution')
    expect(res.predictedWinRate).toBe(50)
  })

  it('suggests play when my team is strongly favored', () => {
    const myTeamScore: LineupScore = {
      score: 56.5,
      covered: 5,
      total: 5,
      bestTier: 1,
      playerAdjusted: true,
      breakdown: []
    }
    const theirTeamScore: LineupScore = {
      score: 48.0,
      covered: 5,
      total: 5,
      bestTier: 3,
      playerAdjusted: false,
      breakdown: []
    }
    const res = evaluateDodgeQuality({ myTeamScore, theirTeamScore })
    expect(res.qualityScore).toBeGreaterThanOrEqual(60)
    expect(res.advantages.length).toBeGreaterThan(0)
    expect(res.recommendation).toBe('play')
  })

  it('suggests dodge when facing critical threats and severe off-role teammates', () => {
    const threatRatings: ThreatRating[] = [
      {
        puuid: 'p1',
        position: 'MID',
        threatLevel: 'Critical',
        styleTags: ['绝活哥 68% 胜率'],
        caveats: ['代练嫌疑'],
        encounterCount: 3,
        laneAggression: 80,
        recentPerformance: 85,
        mainChampionWinRate: 0.68
      },
      {
        puuid: 'p2',
        position: 'JUNGLE',
        threatLevel: 'High',
        styleTags: ['近期5连胜'],
        caveats: [],
        encounterCount: 1,
        laneAggression: 60,
        recentPerformance: 75,
        mainChampionWinRate: 0.6
      }
    ]
    const res = evaluateDodgeQuality({
      threatRatings,
      teammateProfiles: [
        {
          positionDistribution: [],
          championDistribution: [],
          positionChampionDistribution: [],
          mainPosition: 'TOP',
          isOffRole: true,
          offRoleSeverity: 'severe',
          currentLanePlayedRatio: 0.05,
          recentWinRate: 0.2,
          recentKda: 1.2,
          streak: { kind: 'loss', count: 4 },
          currentChampionMastery: null
        }
      ],
      isRankedQueue: true
    })
    expect(res.qualityScore).toBeLessThanOrEqual(40)
    expect(res.recommendation).toBe('dodge')
    expect(res.risks.length).toBeGreaterThanOrEqual(2)
  })
})
