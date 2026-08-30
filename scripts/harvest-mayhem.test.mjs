import test from 'node:test'
import assert from 'node:assert/strict'
import {
  wilsonScoreLower,
  sha256,
  parseRarity,
  computeHexScore,
  computeTier,
  SgpMatchAggregator,
  buildMayhemDatasets
} from './harvest-mayhem.mjs'

test('wilsonScoreLower should calculate conservative lower bound for small samples', () => {
  // 100% win rate with only 3 games
  const small = wilsonScoreLower(3, 3)
  // 55% win rate with 10000 games
  const large = wilsonScoreLower(5500, 10000)

  // 3/3 胜率虽然是 100%，但因样本太小，Wilson 95% 置信下界必然远低于 5500/10000 的大样本
  assert.ok(small < 0.6, `小样本下界过高: ${small}`)
  assert.ok(large > 0.53, `大样本下界不合理: ${large}`)
})

test('wilsonScoreLower edge cases', () => {
  assert.equal(wilsonScoreLower(0, 0), 0)
  assert.equal(wilsonScoreLower(-1, 10), 0)
  assert.equal(wilsonScoreLower(5, -1), 0)
})

test('computeHexScore should scale with netDelta and sample size', () => {
  const highGain = computeHexScore(0.08, 50000) // +8% gain with 50k games
  const lowGain = computeHexScore(-0.05, 5000) // -5% loss with 5k games
  assert.ok(highGain > 80, `High gain score too low: ${highGain}`)
  assert.ok(lowGain < 50, `Loss score too high: ${lowGain}`)
})

test('computeTier calculation', () => {
  assert.equal(computeTier(0.58, 0.15), 1)
  assert.equal(computeTier(0.52, 0.08), 2)
  assert.equal(computeTier(0.46, 0.04), 5)
})

test('sha256 calculation', () => {
  const hash = sha256('hello mayhem')
  assert.equal(typeof hash, 'string')
  assert.equal(hash.length, 64)
})

test('parseRarity mapping', () => {
  assert.deepEqual(parseRarity(0), { name: 'silver', displayName: '白银' })
  assert.deepEqual(parseRarity('kGold'), { name: 'gold', displayName: '黄金' })
  assert.deepEqual(parseRarity('kPrismatic'), { name: 'prismatic', displayName: '棱彩' })
})

test('SgpMatchAggregator should process match records and aggregate correctly', () => {
  const aggregator = new SgpMatchAggregator('16.17')
  const match = {
    gameDuration: 1200,
    participants: [
      { championId: 67, win: true, playerAugment1: 2095, item0: 3031, item1: 3085, item2: 3036, spell1Id: 4, spell2Id: 6 },
      { championId: 104, win: false, playerAugment1: 1220, item0: 6676, item1: 3031, item2: 3036, spell1Id: 4, spell2Id: 7 }
    ]
  }

  const ok = aggregator.processMatch(match)
  assert.ok(ok)
  assert.equal(aggregator.totalMatchesProcessed, 1)

  const datasets = aggregator.compileDatasets()
  assert.equal(datasets.champions.count, 2)
  assert.equal(datasets.augments.count, 2)
  assert.ok(datasets.shards['champion-shards/67.json'])
})

test('buildMayhemDatasets should construct valid manifest and sha256 checksums', () => {
  const dummyChampions = [
    {
      id: 67,
      name: 'Vayne',
      title: '暗夜猎手',
      stats: { winRate: 0.578 }
    }
  ]
  const dummyAugments = [
    {
      id: 2095,
      name: 'High Roller',
      rarity: 2
    }
  ]
  const shardsMap = {
    '67': { champion: dummyChampions[0], augments: [] }
  }

  const datasets = buildMayhemDatasets({
    championsList: dummyChampions,
    augmentsList: dummyAugments,
    shardsMap,
    patch: '16.17',
    reportDate: '2026-08-30'
  })

  assert.equal(datasets.manifest.schemaVersion, 1)
  assert.equal(datasets.manifest.patch, '16.17')
  assert.ok(datasets.manifest.files['champions.json'])
  assert.ok(datasets.manifest.files['augments.json'])
  assert.ok(datasets.manifest.files['champion-shards/67.json'])
  assert.equal(datasets.manifest.files['champion-shards/67.json'].sha256.length, 64)
  assert.ok(datasets.version.manifestHash)
})
