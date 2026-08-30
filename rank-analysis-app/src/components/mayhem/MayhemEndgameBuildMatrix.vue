<script setup lang="ts">
/**
 * MayhemEndgameBuildMatrix —— 大乱斗终局出装与深度分析矩阵（全功能旗舰版）
 *
 * 核心功能：
 * 1. 🌟 核心质变神装 vs ⚠️ 高频大众陷阱 & 💡 智能平替决策雷达；
 * 2. 🗺️ 出装时序进化科技树（Step 1 第3件分叉 → Step 2 第4件延伸 → Step 3 六神装）；
 * 3. 📑 终局三件组合专业矩阵表格（4 维表头动态排序 + 装备名即时搜索 + ⚡ 一键写入 LCU 推荐装备集）；
 * 4. 🛡️ 大后期针对性情境装备工具箱（多前排穿甲 / 强回复重伤 / 高爆发自保 + 顺位时机建议）；
 * 5. 📈 技能加点陷阱揭秘 & ⚡ 召唤师技能组合胜率榜；
 * 6. 🌟 海克斯强化 × 装备 跨模态羁绊协同雷达；
 * 7. 📋 一键复制开黑战术小抄到剪贴板。
 */
import { computed, ref } from 'vue'
import {
  ArrowRight,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Flame,
  GitBranch,
  Layers,
  Lightbulb,
  Search,
  Shield,
  ShieldAlert,
  Sparkles,
  Swords,
  Wand2,
  Zap
} from 'lucide-vue-next'

import { assetPrefix } from '@renderer/services/http'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import {
  type ChampionDetailEntry,
  type MayhemBuild,
  type SituationalItem
} from '@renderer/features/mayhem/services/mayhemData'
import { importMayhemItemSet } from '@renderer/services/importRunes'

interface ChampionBaseInfo {
  id: number
  name: string
  title: string
  alias?: string
  stats: {
    winRate: number | null
    games?: number | null
    pickRate?: number | null
  }
}

export type DetailAugment = ChampionDetailEntry['augments'][number]

const props = defineProps<{
  build: MayhemBuild
  champion: ChampionBaseInfo
  augments?: DetailAugment[]
}>()

const assets = useRecordAssets()

/** 当前激活视图：'matrix' (矩阵表格) | 'tree' (时序进化树) | 'items' (单装强度榜) | 'toolbox' (对策工具箱) */
const activeView = ref<'matrix' | 'tree' | 'items' | 'toolbox'>('matrix')

const searchQuery = ref('')
const sortField = ref<'winRate' | 'pickRate' | 'winRateDelta' | 'games'>('winRateDelta')
const sortOrder = ref<'desc' | 'asc'>('desc')
const itemSortField = ref<'hexScore' | 'winRate' | 'netDelta' | 'games'>('hexScore')
const itemSortOrder = ref<'desc' | 'asc'>('desc')
const importingId = ref<string | null>(null)
const importSuccessMsg = ref('')
const copySuccess = ref(false)

export interface TrioBuildRow {
  key: string
  itemIds: number[]
  games: number
  wins: number
  winRate: number
  pickRate: number
  winRateDelta: number // 组合胜率 - 英雄整体胜率
  sampleTier: 'high' | 'mid' | 'low'
  isTrap: boolean
  isCore: boolean
  sourceLabel: string
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '--%'
  const abs = Math.abs(v)
  const text = (abs * 100).toFixed(abs >= 0.1 ? 1 : 2)
  return v < 0 ? `-${text}%` : `${text}%`
}

function fmtDelta(v: number): string {
  if (!Number.isFinite(v)) return '--'
  const abs = Math.abs(v)
  const text = (abs * 100).toFixed(1)
  return v >= 0 ? `+${text}%` : `-${text}%`
}

function fmtGames(games: number): string {
  if (!games) return '0'
  return games >= 10000 ? `${(games / 10000).toFixed(1)}万` : games.toLocaleString()
}

function itemSrc(id: number): string {
  return id > 0 ? `${assetPrefix}/item/${id}` : ''
}

function spellSrc(id: number): string {
  return id > 0 ? `${assetPrefix}/spell/${id}` : ''
}

function itemName(id: number): string {
  return assets.detailOf('item', id)?.name ?? `装备 #${id}`
}

function itemDesc(id: number): string {
  const detail = assets.detailOf('item', id)
  return detail?.description || detail?.name || `装备 #${id}`
}

function augName(id: number): string {
  return assets.detailOf('perk', id)?.name ?? `强化 #${id}`
}

function spellName(id: number): string {
  const map: Record<number, string> = {
    4: '闪现',
    6: '幽灵疾步',
    7: '治疗术',
    11: '惩戒',
    12: '传送',
    13: '清晰术',
    14: '引燃',
    21: '屏障',
    32: '标记(雪球)',
    39: '魄罗投掷'
  }
  return map[id] ?? `技能 #${id}`
}

/** 英雄整体胜率基准 */
const heroOverallWinRate = computed(() => {
  return props.champion.stats.winRate ?? props.build.stats.winRate ?? 0.5
})

/**
 * 组装终局三件组合列表（融合 coreItems + itemExtensions 延伸组合）
 */
const allTrioRows = computed<TrioBuildRow[]>(() => {
  const rows: TrioBuildRow[] = []
  const seenKey = new Set<string>()
  const baseHeroWr = heroOverallWinRate.value

  // 1. 从 coreItems 导入主要核心三件套
  for (const [idx, cs] of (props.build.coreItems ?? []).entries()) {
    if (!cs.itemIds || cs.itemIds.length < 2) continue
    const ids = [...cs.itemIds].slice(0, 3)
    const sortedKey = [...ids].sort().join('-')
    if (seenKey.has(sortedKey)) continue
    seenKey.add(sortedKey)

    const delta = cs.winRate - baseHeroWr
    const tier: 'high' | 'mid' | 'low' = cs.games >= 2000 ? 'high' : cs.games >= 500 ? 'mid' : 'low'
    const isTrap = delta < -0.015 && (cs.pickRate ?? 0) > 0.05

    rows.push({
      key: sortedKey,
      itemIds: ids,
      games: cs.games,
      wins: cs.wins,
      winRate: cs.winRate,
      pickRate: cs.pickRate ?? 0,
      winRateDelta: delta,
      sampleTier: tier,
      isTrap,
      isCore: true,
      sourceLabel: `核心方案 #${idx + 1}`
    })
  }

  // 2. 从 itemExtensions 融合第 4/5 件神装的延伸三件套
  for (const ext of props.build.itemExtensions ?? []) {
    if (!ext.coreItemIds || ext.coreItemIds.length < 2 || !ext.itemIds?.length) continue
    const primary2 = ext.coreItemIds.filter(id => id > 0).slice(0, 2)
    const extItem = ext.itemIds[0]
    if (!extItem || primary2.includes(extItem)) continue

    const ids = [...primary2, extItem]
    const sortedKey = [...ids].sort().join('-')
    if (seenKey.has(sortedKey)) continue
    seenKey.add(sortedKey)

    const delta = ext.winRate - baseHeroWr
    const tier: 'high' | 'mid' | 'low' =
      ext.games >= 1500 ? 'high' : ext.games >= 300 ? 'mid' : 'low'
    const isTrap = delta < -0.02

    rows.push({
      key: sortedKey,
      itemIds: ids,
      games: ext.games,
      wins: ext.wins ?? Math.round(ext.winRate * ext.games),
      winRate: ext.winRate,
      pickRate: ext.games / Math.max(props.build.stats.games || 1, 1),
      winRateDelta: delta,
      sampleTier: tier,
      isTrap,
      isCore: false,
      sourceLabel: `顺势延伸套`
    })
  }

  return rows
})

/**
 * ---------------------------------------------------------------------------
 * 🌟 核心算法：单装备边际收益归因（Shapley-style Net Delta Attribution）
 * ---------------------------------------------------------------------------
 */
interface ItemAttribution {
  id: number
  netDelta: number
  totalGames: number
  positiveCombosCount: number
  negativeCombosCount: number
  sampleWeight: number
}

const itemAttributions = computed<Map<number, ItemAttribution>>(() => {
  const map = new Map<
    number,
    {
      id: number
      weightedDeltaSum: number
      weightSum: number
      totalGames: number
      posCount: number
      negCount: number
    }
  >()

  for (const row of allTrioRows.value) {
    const weight = Math.log10(row.games + 10)
    for (const id of row.itemIds) {
      if (!map.has(id)) {
        map.set(id, {
          id,
          weightedDeltaSum: 0,
          weightSum: 0,
          totalGames: 0,
          posCount: 0,
          negCount: 0
        })
      }
      const stat = map.get(id)!
      stat.weightedDeltaSum += row.winRateDelta * weight
      stat.weightSum += weight
      stat.totalGames += row.games
      if (row.winRateDelta > 0.015) stat.posCount++
      if (row.winRateDelta < -0.01) stat.negCount++
    }
  }

  const result = new Map<number, ItemAttribution>()
  for (const [id, s] of map.entries()) {
    result.set(id, {
      id,
      netDelta: s.weightSum > 0 ? s.weightedDeltaSum / s.weightSum : 0,
      totalGames: s.totalGames,
      positiveCombosCount: s.posCount,
      negativeCombosCount: s.negCount,
      sampleWeight: s.weightSum
    })
  }
  return result
})

/** 🌟 核心质变神装（在多个高胜率组合高频出现且净收益 > +2.5%） */
const crownJewelItems = computed(() => {
  const list = Array.from(itemAttributions.value.values())
  return list
    .filter(a => a.netDelta >= 0.02 && a.totalGames >= 300)
    .sort((a, b) => b.netDelta - a.netDelta)
    .slice(0, 3)
})

/** ⚠️ 高频大众陷阱（场次较高但净收益显著为负 < -0.8%） */
const popularTrapItems = computed(() => {
  const list = Array.from(itemAttributions.value.values())
  return list
    .filter(a => a.netDelta <= -0.008 && a.totalGames >= 400)
    .sort((a, b) => a.netDelta - b.netDelta)
    .slice(0, 3)
})

/** 💡 智能平替建议（将大众陷阱映射至最佳质变神装） */
const smartSwaps = computed(() => {
  const swaps: Array<{
    trapId: number
    trapDelta: number
    trapGames: number
    betterId: number
    betterDelta: number
    gainPct: number
  }> = []

  const jewels = crownJewelItems.value
  const traps = popularTrapItems.value

  if (traps.length && jewels.length) {
    const bestJewel = jewels[0]
    for (const trap of traps) {
      if (trap.id === bestJewel.id) continue
      const gain = bestJewel.netDelta - trap.netDelta
      swaps.push({
        trapId: trap.id,
        trapDelta: trap.netDelta,
        trapGames: trap.totalGames,
        betterId: bestJewel.id,
        betterDelta: bestJewel.netDelta,
        gainPct: gain
      })
    }
  }

  return swaps.slice(0, 2)
})

/**
 * ---------------------------------------------------------------------------
 * 📊 单装强度榜（对比 hexdata.com.cn 深度升级：HexScore + 独立胜率 + 净收益归因 + 标签）
 * ---------------------------------------------------------------------------
 */
export interface ItemRankingRow {
  id: number
  name: string
  winRate: number
  netDelta: number
  games: number
  hexScore: number
  isCrown: boolean
  isTrap: boolean
  tags: string[]
}

const allItemRankings = computed<ItemRankingRow[]>(() => {
  const baseWr = heroOverallWinRate.value
  const list: ItemRankingRow[] = []

  for (const [id, s] of itemAttributions.value.entries()) {
    const name = itemName(id)
    if (!name || name.startsWith('装备 #')) continue
    const winRate = Math.min(Math.max(baseWr + s.netDelta, 0.25), 0.85)
    // 综合 HexScore 评分：基准 50 + 净收益增益 * 400 + 样本置信度加成 (0~25)
    const sampleBonus = Math.min(Math.log10(s.totalGames + 1) * 6, 25)
    const hexScore = Math.min(99.9, Math.max(25.0, 50 + s.netDelta * 400 + (sampleBonus - 10)))
    const isCrown = s.netDelta >= 0.02 && s.totalGames >= 300
    const isTrap = s.netDelta <= -0.008 && s.totalGames >= 400

    const tags: string[] = []
    if (isCrown) tags.push('🌟 质变神装')
    if (isTrap) tags.push('⚠️ 避坑陷阱')
    if (s.totalGames >= 5000) tags.push('🔥 高频主力')

    list.push({
      id,
      name,
      winRate,
      netDelta: s.netDelta,
      games: s.totalGames,
      hexScore: Number(hexScore.toFixed(1)),
      isCrown,
      isTrap,
      tags
    })
  }

  return list.sort((a, b) => b.hexScore - a.hexScore)
})

const filteredItemRankings = computed<ItemRankingRow[]>(() => {
  let list = [...allItemRankings.value]
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter(r => r.name.toLowerCase().includes(q))
  }
  list.sort((a, b) => {
    let diff = 0
    if (itemSortField.value === 'hexScore') diff = a.hexScore - b.hexScore
    else if (itemSortField.value === 'winRate') diff = a.winRate - b.winRate
    else if (itemSortField.value === 'netDelta') diff = a.netDelta - b.netDelta
    else if (itemSortField.value === 'games') diff = a.games - b.games
    return itemSortOrder.value === 'desc' ? -diff : diff
  })
  return list
})

function toggleItemSort(field: 'hexScore' | 'winRate' | 'netDelta' | 'games') {
  if (itemSortField.value === field) {
    itemSortOrder.value = itemSortOrder.value === 'desc' ? 'asc' : 'desc'
  } else {
    itemSortField.value = field
    itemSortOrder.value = 'desc'
  }
}

/**
 * ---------------------------------------------------------------------------
 * 🗺️ 出装时序分支树（Step 1 第3件抉择 → Step 2 第4件收尾 → Step 3 六神装）
 * ---------------------------------------------------------------------------
 */
interface EvolutionStepNode {
  step: number
  itemIds: number[]
  games: number
  wins: number
  winRate: number
  delta: number
}

interface EvolutionBranch {
  baseCoreIds: number[]
  step1Nodes: EvolutionStepNode[]
  step2Nodes: EvolutionStepNode[]
  step3Nodes: EvolutionStepNode[]
}

const evolutionBranches = computed<EvolutionBranch[]>(() => {
  const branches: EvolutionBranch[] = []
  const exts = props.build.itemExtensions ?? []
  if (!exts.length) return branches

  // 按基础前两件/三件分组
  const map = new Map<string, { base: number[]; exts: typeof exts }>()
  for (const e of exts) {
    const baseKey = e.coreItemIds.slice(0, 2).sort().join('-')
    if (!map.has(baseKey)) {
      map.set(baseKey, { base: e.coreItemIds.slice(0, 2), exts: [] })
    }
    map.get(baseKey)!.exts.push(e)
  }

  const baseWr = heroOverallWinRate.value

  for (const [_, group] of map.entries()) {
    const step1: EvolutionStepNode[] = []
    const step2: EvolutionStepNode[] = []
    const step3: EvolutionStepNode[] = []

    for (const e of group.exts) {
      const node: EvolutionStepNode = {
        step: e.step,
        itemIds: e.itemIds,
        games: e.games,
        wins: e.wins ?? Math.round(e.winRate * e.games),
        winRate: e.winRate,
        delta: e.winRate - baseWr
      }
      if (e.step === 1) step1.push(node)
      else if (e.step === 2) step2.push(node)
      else if (e.step === 3) step3.push(node)
    }

    step1.sort((a, b) => b.winRate - a.winRate)
    step2.sort((a, b) => b.winRate - a.winRate)
    step3.sort((a, b) => b.winRate - a.winRate)

    if (step1.length || step2.length) {
      branches.push({
        baseCoreIds: group.base,
        step1Nodes: step1.slice(0, 4),
        step2Nodes: step2.slice(0, 4),
        step3Nodes: step3.slice(0, 3)
      })
    }
  }

  return branches.slice(0, 2)
})

/**
 * ---------------------------------------------------------------------------
 * 🛡️ 大后期针对性情境装备工具箱（4~6 件装备归类）
 * ---------------------------------------------------------------------------
 */
interface CategorizedToolbox {
  antiTank: SituationalItem[]
  antiHeal: SituationalItem[]
  survivability: SituationalItem[]
  capstonePower: SituationalItem[]
}

const situationalToolbox = computed<CategorizedToolbox>(() => {
  const sits = props.build.situationalItems ?? []
  const antiTank: SituationalItem[] = []
  const antiHeal: SituationalItem[] = []
  const survivability: SituationalItem[] = []
  const capstonePower: SituationalItem[] = []

  for (const s of sits) {
    const name = itemName(s.id)
    if (
      name.includes('多米尼克') ||
      name.includes('黑色切割者') ||
      name.includes('巨杀') ||
      name.includes('赛瑞尔达') ||
      name.includes('虚空')
    ) {
      antiTank.push(s)
    } else if (
      name.includes('凡性') ||
      name.includes('莫雷洛') ||
      name.includes('重伤') ||
      name.includes('炼金') ||
      name.includes('荆棘')
    ) {
      antiHeal.push(s)
    } else if (
      name.includes('玛莫提乌斯') ||
      name.includes('死舞') ||
      name.includes('中娅') ||
      name.includes('守护天使') ||
      name.includes('自然之力') ||
      name.includes('冰心') ||
      name.includes('夜之锋刃')
    ) {
      survivability.push(s)
    } else {
      capstonePower.push(s)
    }
  }

  return {
    antiTank: antiTank.slice(0, 3),
    antiHeal: antiHeal.slice(0, 3),
    survivability: survivability.slice(0, 3),
    capstonePower: capstonePower.slice(0, 3)
  }
})

/**
 * ---------------------------------------------------------------------------
 * 📈 技能加点 & 召唤师技能陷阱拆解
 * ---------------------------------------------------------------------------
 */
const skillOrderTactics = computed(() => {
  const orders = props.build.skillOrders ?? []
  if (!orders.length) return null

  // 按胜率排序
  const sorted = [...orders].sort((a, b) => b.winRate - a.winRate)
  const best = sorted[0]
  // 最热门
  const popular = [...orders].sort((a, b) => b.games - a.games)[0]

  const hasTrap = popular && best && popular !== best && best.winRate - popular.winRate >= 0.03

  return {
    best,
    popular,
    hasTrap,
    diffPct: hasTrap ? best.winRate - popular.winRate : 0
  }
})

const spellCombosTactics = computed(() => {
  const spells = props.build.summonerSpells ?? []
  if (!spells.length) return []
  return [...spells].sort((a, b) => b.winRate - a.winRate).slice(0, 3)
})

/**
 * ---------------------------------------------------------------------------
 * 过滤与排序后的表格数据
 * ---------------------------------------------------------------------------
 */
const filteredAndSortedTrios = computed<TrioBuildRow[]>(() => {
  let list = [...allTrioRows.value]

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter(row => row.itemIds.some(id => itemName(id).toLowerCase().includes(q)))
  }

  list.sort((a, b) => {
    let diff = 0
    if (sortField.value === 'winRate') diff = a.winRate - b.winRate
    else if (sortField.value === 'pickRate') diff = a.pickRate - b.pickRate
    else if (sortField.value === 'winRateDelta') diff = a.winRateDelta - b.winRateDelta
    else if (sortField.value === 'games') diff = a.games - b.games
    return sortOrder.value === 'desc' ? -diff : diff
  })

  return list
})

function toggleSort(field: 'winRate' | 'pickRate' | 'winRateDelta' | 'games') {
  if (sortField.value === field) {
    sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  } else {
    sortField.value = field
    sortOrder.value = 'desc'
  }
}

/**
 * 海克斯强化 × 装备 协同羁绊雷达
 */
interface SynergyMatch {
  augmentId: number
  augmentName: string
  synergyType: string
  desc: string
  recommendedItems: number[]
}

const synergyList = computed<SynergyMatch[]>(() => {
  const matches: SynergyMatch[] = []
  const augs = props.augments ?? []
  if (!augs.length) return matches

  const allItemIds = new Set<number>()
  for (const row of allTrioRows.value) {
    for (const id of row.itemIds) allItemIds.add(id)
  }

  for (const a of augs.slice(0, 15)) {
    const name = a.name || augName(a.id)

    if (name.includes('发明家') || name.includes('急速') || name.includes('加速')) {
      const items = [3068, 3083, 3157, 3153, 3118, 3078].filter(id => allItemIds.has(id))
      matches.push({
        augmentId: a.id,
        augmentName: name,
        synergyType: '⚡ 装备急速流',
        desc: '装备冷却时间大幅缩减，高频触发装备被动特效与主动保命',
        recommendedItems: items.length ? items : [3157, 3153]
      })
    } else if (name.includes('暴击') || name.includes('魔法暴击') || name.includes('致命')) {
      const items = [3089, 4646, 3031, 3036, 3085].filter(id => allItemIds.has(id))
      matches.push({
        augmentId: a.id,
        augmentName: name,
        synergyType: '💥 极限双暴流',
        desc: '法术/技能可触发全额暴击，搭配法强或重击大件实现瞬间融化',
        recommendedItems: items.length ? items : [3089, 4646]
      })
    } else if (name.includes('慢炖') || name.includes('灼烧') || name.includes('火')) {
      const items = [6653, 3116, 3118, 3068].filter(id => allItemIds.has(id))
      matches.push({
        augmentId: a.id,
        augmentName: name,
        synergyType: '🔥 持续真伤灼烧流',
        desc: '多重百分比生命值持续灼烧，面对前排坦克收益最大化',
        recommendedItems: items.length ? items : [6653, 3116]
      })
    } else if (name.includes('台风') || name.includes('连环') || name.includes('打击')) {
      const items = [3124, 3153, 3085, 3115, 3091].filter(id => allItemIds.has(id))
      matches.push({
        augmentId: a.id,
        augmentName: name,
        synergyType: '🌀 狂暴攻击特效流',
        desc: '普攻触发多重弹射与攻击特效，清线团战群体割草',
        recommendedItems: items.length ? items : [3124, 3153]
      })
    } else if (name.includes('巨像') || name.includes('歌利亚') || name.includes('护盾')) {
      const items = [3083, 3068, 6665, 3143, 3075].filter(id => allItemIds.has(id))
      matches.push({
        augmentId: a.id,
        augmentName: name,
        synergyType: '🛡️ 巨像不死坦装流',
        desc: '超大体型与额外护盾加成，吸收成吨伤害屹立不倒',
        recommendedItems: items.length ? items : [3083, 6665]
      })
    }

    if (matches.length >= 3) break
  }

  return matches
})

/**
 * 一键导入到客户端自定义装备方案
 */
async function onImportItemSet(row: TrioBuildRow) {
  importingId.value = row.key
  importSuccessMsg.value = ''
  try {
    const starterIds = props.build.startingItems?.[0]?.itemIds ?? [1055, 2003]
    const sitIds = (props.build.situationalItems ?? []).slice(0, 6).map(s => s.id)

    const blocks = [
      { name: '推荐出门装', itemIds: starterIds },
      {
        name: `核心三件套 (${pct(row.winRate)} 胜率 / 收益 ${fmtDelta(row.winRateDelta)})`,
        itemIds: row.itemIds
      },
      { name: '顺势与大后期对策备选', itemIds: sitIds }
    ]

    const title = `${props.champion.title}·${row.sourceLabel}`
    await importMayhemItemSet(props.champion.id, title, blocks)
    importSuccessMsg.value = `已成功将「${title}」写入客户端推荐装备页！`
    setTimeout(() => {
      importSuccessMsg.value = ''
    }, 4000)
  } catch (e) {
    alert(`写入客户端装备页失败: ${String(e)}`)
  } finally {
    importingId.value = null
  }
}

/**
 * 复制战术小抄到剪贴板
 */
function onCopySummary() {
  const c = props.champion
  const top3 = filteredAndSortedTrios.value.slice(0, 3)

  let text = `【${c.name} · ${c.title}】大乱斗实战出装小抄\n`
  text += `全服基准胜率：${pct(heroOverallWinRate.value)} | 选用率：${pct(c.stats.pickRate)}\n`
  if (crownJewelItems.value.length) {
    text += `🌟 核心质变神装：${crownJewelItems.value.map(j => `${itemName(j.id)}(${fmtDelta(j.netDelta)})`).join('、')}\n`
  }
  if (popularTrapItems.value.length) {
    text += `⚠️ 高频避坑陷阱：${popularTrapItems.value.map(t => `${itemName(t.id)}(${fmtDelta(t.netDelta)})`).join('、')}\n`
  }
  text += `推荐终局组合 TOP3：\n`
  for (const [i, row] of top3.entries()) {
    const names = row.itemIds.map(id => itemName(id)).join(' + ')
    text += ` #${i + 1} [${names}] 胜率 ${pct(row.winRate)} (收益 ${fmtDelta(row.winRateDelta)}, 样本 ${fmtGames(row.games)})\n`
  }

  void navigator.clipboard.writeText(text).then(() => {
    copySuccess.value = true
    setTimeout(() => (copySuccess.value = false), 2500)
  })
}
</script>

<template>
  <div class="matrix-wrapper">
    <!-- 顶部状态栏与基准说明 -->
    <div class="matrix-hero-bar">
      <div class="mhb-left">
        <div class="mhb-title">
          <Swords class="mhb-icon" />
          <span>终局出装决策矩阵</span>
          <span class="mhb-badge">大数据实时归因</span>
        </div>
        <p class="mhb-sub">
          深度融合实战三件套胜率收益、单装边际净贡献归因与时序进化分支，指导实战质变决策
        </p>
      </div>
      <div class="mhb-right">
        <button class="mhb-btn" :class="{ ok: copySuccess }" @click="onCopySummary">
          <Check v-if="copySuccess" class="btn-ic" />
          <Copy v-else class="btn-ic" />
          {{ copySuccess ? '小抄已复制' : '复制战术小抄' }}
        </button>
      </div>
    </div>

    <!-- 🌟 红绿双极战术雷达卡（核心质变神装 vs 大众陷阱） -->
    <div class="matrix-tactical-radar">
      <!-- 左：质变神装 -->
      <div class="radar-card positive">
        <div class="radar-card-head">
          <Sparkles class="radar-ic gold" />
          <span class="radar-title">🌟 核心质变神装 (胜率拉升引擎)</span>
        </div>
        <div v-if="crownJewelItems.length" class="radar-items-list">
          <div v-for="jewel in crownJewelItems" :key="jewel.id" class="radar-item-row">
            <img
              :src="itemSrc(jewel.id)"
              :alt="itemName(jewel.id)"
              :title="itemDesc(jewel.id)"
              class="radar-item-icon jewel-border"
            />
            <div class="radar-item-meta">
              <div class="radar-item-name">{{ itemName(jewel.id) }}</div>
              <div class="radar-item-sub">
                在 {{ jewel.positiveCombosCount }} 套高胜率方案中共同出现
              </div>
            </div>
            <div class="radar-item-badge delta-pos">净收益 {{ fmtDelta(jewel.netDelta) }}</div>
          </div>
        </div>
        <div v-else class="radar-empty">当前流派装备收益相对均衡，按核心路线正常延伸即可</div>
      </div>

      <!-- 右：避坑陷阱 & 智能平替 -->
      <div class="radar-card negative">
        <div class="radar-card-head">
          <ShieldAlert class="radar-ic red" />
          <span class="radar-title">⚠️ 高频避坑指南 (大众胜率陷阱)</span>
        </div>
        <div v-if="popularTrapItems.length" class="radar-items-list">
          <div v-for="trap in popularTrapItems" :key="trap.id" class="radar-item-row">
            <img
              :src="itemSrc(trap.id)"
              :alt="itemName(trap.id)"
              :title="itemDesc(trap.id)"
              class="radar-item-icon trap-border"
            />
            <div class="radar-item-meta">
              <div class="radar-item-name">{{ itemName(trap.id) }}</div>
              <div class="radar-item-sub">
                {{ fmtGames(trap.totalGames) }} 场选用，但普遍拖累胜率
              </div>
            </div>
            <div class="radar-item-badge delta-neg">净收益 {{ fmtDelta(trap.netDelta) }}</div>
          </div>

          <!-- 💡 智能平替建议横幅 -->
          <div v-if="smartSwaps.length" class="smart-swap-banner">
            <div class="swap-header">
              <Lightbulb class="swap-ic" />
              <span>智能决策平替建议</span>
            </div>
            <div v-for="sw in smartSwaps" :key="sw.trapId" class="swap-row">
              <span class="swap-from"
                >❌ 放弃 <strong>{{ itemName(sw.trapId) }}</strong></span
              >
              <ArrowRight class="swap-arrow" />
              <span class="swap-to"
                >💡 改出 <strong>{{ itemName(sw.betterId) }}</strong></span
              >
              <span class="swap-gain">胜率预期提升 +{{ (sw.gainPct * 100).toFixed(1) }}%</span>
            </div>
          </div>
        </div>
        <div v-else class="radar-empty">✅ 太棒了！当前英雄暂未检测到明显拖后腿的高频陷阱装</div>
      </div>
    </div>

    <!-- 成功提示 Toast -->
    <div v-if="importSuccessMsg" class="matrix-toast">
      <Sparkles class="toast-ic" />
      <span>{{ importSuccessMsg }}</span>
    </div>

    <!-- 视图切换 Tab 条 -->
    <div class="matrix-view-tabs">
      <button
        class="matrix-tab-btn"
        :class="{ active: activeView === 'matrix' }"
        @click="activeView = 'matrix'"
      >
        <Layers class="tab-ic" />
        <span>终局三件组合矩阵 ({{ filteredAndSortedTrios.length }})</span>
      </button>
      <button
        class="matrix-tab-btn"
        :class="{ active: activeView === 'items' }"
        @click="activeView = 'items'"
      >
        <Flame class="tab-ic" />
        <span>单装强度排行 ({{ allItemRankings.length }})</span>
      </button>
      <button
        class="matrix-tab-btn"
        :class="{ active: activeView === 'tree' }"
        @click="activeView = 'tree'"
      >
        <GitBranch class="tab-ic" />
        <span>出装时序分支树 ({{ evolutionBranches.length }})</span>
      </button>
      <button
        class="matrix-tab-btn"
        :class="{ active: activeView === 'toolbox' }"
        @click="activeView = 'toolbox'"
      >
        <Shield class="tab-ic" />
        <span>大后期针对性对策箱 (4~6件)</span>
      </button>
    </div>

    <!-- ==================== VIEW 1: 终局三件组合矩阵表格 ==================== -->
    <div v-if="activeView === 'matrix'" class="view-panel">
      <!-- 表格工具栏 -->
      <div class="matrix-toolbar">
        <div class="mtb-search">
          <Search class="search-ic" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索装备名称筛选（如：无尽、死舞、狂妄、破败…）"
          />
        </div>
        <div class="mtb-stats">
          基准胜率 <strong>{{ pct(heroOverallWinRate) }}</strong> · 已按置信度归因
        </div>
      </div>

      <!-- 终局三件组合数据表格 -->
      <div class="matrix-table-container">
        <table class="matrix-table">
          <thead>
            <tr>
              <th class="th-combo">三件组合方案</th>
              <th class="th-sortable" @click="toggleSort('winRate')">
                <div class="th-content">
                  <span>胜率</span>
                  <span class="sort-arrows">
                    <ChevronUp
                      v-if="sortField === 'winRate' && sortOrder === 'asc'"
                      class="arr on"
                    />
                    <ChevronDown
                      v-else-if="sortField === 'winRate' && sortOrder === 'desc'"
                      class="arr on"
                    />
                    <ArrowUpDown v-else class="arr" />
                  </span>
                </div>
              </th>
              <th class="th-sortable" @click="toggleSort('winRateDelta')">
                <div class="th-content">
                  <span>胜率收益 (Δ)</span>
                  <span class="sort-arrows">
                    <ChevronUp
                      v-if="sortField === 'winRateDelta' && sortOrder === 'asc'"
                      class="arr on"
                    />
                    <ChevronDown
                      v-else-if="sortField === 'winRateDelta' && sortOrder === 'desc'"
                      class="arr on"
                    />
                    <ArrowUpDown v-else class="arr" />
                  </span>
                </div>
              </th>
              <th class="th-sortable" @click="toggleSort('pickRate')">
                <div class="th-content">
                  <span>出现率</span>
                  <span class="sort-arrows">
                    <ChevronUp
                      v-if="sortField === 'pickRate' && sortOrder === 'asc'"
                      class="arr on"
                    />
                    <ChevronDown
                      v-else-if="sortField === 'pickRate' && sortOrder === 'desc'"
                      class="arr on"
                    />
                    <ArrowUpDown v-else class="arr" />
                  </span>
                </div>
              </th>
              <th class="th-sortable" @click="toggleSort('games')">
                <div class="th-content">
                  <span>实战样本</span>
                  <span class="sort-arrows">
                    <ChevronUp v-if="sortField === 'games' && sortOrder === 'asc'" class="arr on" />
                    <ChevronDown
                      v-else-if="sortField === 'games' && sortOrder === 'desc'"
                      class="arr on"
                    />
                    <ArrowUpDown v-else class="arr" />
                  </span>
                </div>
              </th>
              <th class="th-act">客户端联动</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in filteredAndSortedTrios"
              :key="row.key"
              class="matrix-row"
              :class="{ 'row-trap': row.isTrap, 'row-core': row.isCore }"
            >
              <!-- 组合装备图标与名称 -->
              <td class="td-combo">
                <div class="combo-icons">
                  <div v-for="id in row.itemIds" :key="id" class="combo-icon-wrap">
                    <img
                      :src="itemSrc(id)"
                      :alt="itemName(id)"
                      :title="`${itemName(id)} - ${itemDesc(id)}`"
                      class="item-icon"
                      loading="lazy"
                    />
                  </div>
                </div>
                <div class="combo-names">
                  <span class="names-text">{{
                    row.itemIds.map(id => itemName(id)).join(' + ')
                  }}</span>
                  <span v-if="row.isCore" class="combo-tag core">核心方案</span>
                  <span v-if="row.isTrap" class="combo-tag trap">⚠️ 避坑</span>
                </div>
              </td>

              <!-- 胜率 -->
              <td class="td-num">
                <span
                  class="val-wr"
                  :class="{ high: row.winRate >= 0.54, low: row.winRate < 0.48 }"
                >
                  {{ pct(row.winRate) }}
                </span>
              </td>

              <!-- 胜率收益 Delta -->
              <td class="td-num">
                <span
                  class="val-delta"
                  :class="{ pos: row.winRateDelta >= 0, neg: row.winRateDelta < 0 }"
                >
                  {{ fmtDelta(row.winRateDelta) }}
                </span>
              </td>

              <!-- 出现率 -->
              <td class="td-num">
                <span class="val-pick">{{ pct(row.pickRate) }}</span>
              </td>

              <!-- 样本量与等级 -->
              <td class="td-num">
                <div class="sample-box">
                  <span class="sample-count font-number">{{ fmtGames(row.games) }}</span>
                  <span class="tier-badge" :class="row.sampleTier">
                    {{
                      row.sampleTier === 'high'
                        ? '🔥高样本'
                        : row.sampleTier === 'mid'
                          ? '⚡中样本'
                          : '🌱探索'
                    }}
                  </span>
                </div>
              </td>

              <!-- 操作：一键写入客户端 -->
              <td class="td-act">
                <button
                  class="btn-import"
                  :disabled="importingId === row.key"
                  :title="`一键将「${row.itemIds.map(id => itemName(id)).join('+')}」写入客户端装备栏`"
                  @click="onImportItemSet(row)"
                >
                  <Download class="btn-ic" />
                  <span>{{ importingId === row.key ? '写入中…' : '导入客户端' }}</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ==================== VIEW 2: 单装强度排行表格 (hexdata 深度升级版) ==================== -->
    <div v-else-if="activeView === 'items'" class="view-panel">
      <!-- 工具栏 -->
      <div class="matrix-toolbar">
        <div class="mtb-search">
          <Search class="search-ic" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索单件装备（如：金铲铲、破败、无尽、流水法杖…）"
          />
        </div>
        <div class="mtb-stats">
          已聚合 <strong>{{ filteredItemRankings.length }}</strong> 件装备 · 包含
          <strong>HexScore 综合评分</strong>、独立胜率与净贡献
        </div>
      </div>

      <!-- 单装数据表格 -->
      <div class="matrix-table-container">
        <table class="matrix-table">
          <thead>
            <tr>
              <th class="th-combo">装备名称</th>
              <th class="th-sortable" @click="toggleItemSort('hexScore')">
                <div class="th-content">
                  <span>HexScore 综合评分</span>
                  <span class="sort-arrows">
                    <ChevronUp
                      v-if="itemSortField === 'hexScore' && itemSortOrder === 'asc'"
                      class="arr on"
                    />
                    <ChevronDown
                      v-else-if="itemSortField === 'hexScore' && itemSortOrder === 'desc'"
                      class="arr on"
                    />
                    <ArrowUpDown v-else class="arr" />
                  </span>
                </div>
              </th>
              <th class="th-sortable" @click="toggleItemSort('winRate')">
                <div class="th-content">
                  <span>单装独立胜率</span>
                  <span class="sort-arrows">
                    <ChevronUp
                      v-if="itemSortField === 'winRate' && itemSortOrder === 'asc'"
                      class="arr on"
                    />
                    <ChevronDown
                      v-else-if="itemSortField === 'winRate' && itemSortOrder === 'desc'"
                      class="arr on"
                    />
                    <ArrowUpDown v-else class="arr" />
                  </span>
                </div>
              </th>
              <th class="th-sortable" @click="toggleItemSort('netDelta')">
                <div class="th-content">
                  <span>胜率净收益 (Δ)</span>
                  <span class="sort-arrows">
                    <ChevronUp
                      v-if="itemSortField === 'netDelta' && itemSortOrder === 'asc'"
                      class="arr on"
                    />
                    <ChevronDown
                      v-else-if="itemSortField === 'netDelta' && itemSortOrder === 'desc'"
                      class="arr on"
                    />
                    <ArrowUpDown v-else class="arr" />
                  </span>
                </div>
              </th>
              <th class="th-sortable" @click="toggleItemSort('games')">
                <div class="th-content">
                  <span>样本场次</span>
                  <span class="sort-arrows">
                    <ChevronUp
                      v-if="itemSortField === 'games' && itemSortOrder === 'asc'"
                      class="arr on"
                    />
                    <ChevronDown
                      v-else-if="itemSortField === 'games' && itemSortOrder === 'desc'"
                      class="arr on"
                    />
                    <ArrowUpDown v-else class="arr" />
                  </span>
                </div>
              </th>
              <th class="th-act">实战标签与定位</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in filteredItemRankings"
              :key="item.id"
              class="matrix-row"
              :class="{ 'row-core': item.isCrown, 'row-trap': item.isTrap }"
            >
              <td class="td-combo">
                <div class="combo-icons">
                  <div class="combo-icon-wrap">
                    <img
                      :src="itemSrc(item.id)"
                      :alt="item.name"
                      :title="`${item.name} - ${itemDesc(item.id)}`"
                      class="item-icon"
                      loading="lazy"
                    />
                  </div>
                </div>
                <div class="combo-names">
                  <span class="names-text">{{ item.name }}</span>
                </div>
              </td>
              <td class="td-num">
                <span
                  class="hex-score-badge"
                  :class="item.hexScore >= 80 ? 'gold' : item.hexScore >= 65 ? 'blue' : 'gray'"
                >
                  {{ item.hexScore }}
                </span>
              </td>
              <td class="td-num">
                <span
                  class="val-wr"
                  :class="{ high: item.winRate >= 0.54, low: item.winRate < 0.48 }"
                >
                  {{ pct(item.winRate) }}
                </span>
              </td>
              <td class="td-num">
                <span
                  class="val-delta"
                  :class="{ pos: item.netDelta >= 0, neg: item.netDelta < 0 }"
                >
                  {{ fmtDelta(item.netDelta) }}
                </span>
              </td>
              <td class="td-num">
                <span class="sample-count font-number">{{ fmtGames(item.games) }}</span>
              </td>
              <td class="td-act">
                <div class="item-tag-list">
                  <span
                    v-for="tag in item.tags"
                    :key="tag"
                    class="item-tag"
                    :class="{ crown: item.isCrown, trap: item.isTrap }"
                  >
                    {{ tag }}
                  </span>
                  <span v-if="!item.tags.length" class="item-tag normal">常规对策</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ==================== VIEW 3: 出装时序分支树 ==================== -->
    <div v-else-if="activeView === 'tree'" class="view-panel">
      <div v-if="evolutionBranches.length" class="tree-branches-list">
        <div v-for="(branch, bi) in evolutionBranches" :key="bi" class="branch-card">
          <div class="branch-header">
            <span class="branch-tag">底牌两件套起手</span>
            <div class="branch-base-items">
              <div v-for="id in branch.baseCoreIds" :key="id" class="base-item-wrap">
                <img
                  :src="itemSrc(id)"
                  :alt="itemName(id)"
                  :title="itemName(id)"
                  class="item-icon"
                />
                <span class="base-item-name">{{ itemName(id) }}</span>
              </div>
            </div>
          </div>

          <div class="branch-evolution-grid">
            <!-- Step 1: 第 3 件质变抉择 -->
            <div class="step-col">
              <div class="step-title">
                <span class="step-badge">STEP 1</span>
                <span>第 3 件质变抉择分支</span>
              </div>
              <div class="step-nodes-list">
                <div
                  v-for="(node, ni) in branch.step1Nodes"
                  :key="ni"
                  class="step-node"
                  :class="{ best: ni === 0, trap: node.delta < -0.015 }"
                >
                  <img
                    :src="itemSrc(node.itemIds[0])"
                    :alt="itemName(node.itemIds[0])"
                    class="node-icon"
                  />
                  <div class="node-meta">
                    <div class="node-name">{{ itemName(node.itemIds[0]) }}</div>
                    <div class="node-stats">
                      <span class="wr">{{ pct(node.winRate) }}</span>
                      <span class="delta" :class="{ pos: node.delta >= 0, neg: node.delta < 0 }">
                        ({{ fmtDelta(node.delta) }})
                      </span>
                    </div>
                  </div>
                  <span v-if="ni === 0" class="node-tag crown">👑 胜率首选</span>
                  <span v-else-if="node.delta < -0.015" class="node-tag trap">⚠️ 掉胜率</span>
                </div>
              </div>
            </div>

            <!-- Step 2: 第 4/5 件大后期成型 -->
            <div v-if="branch.step2Nodes.length" class="step-col">
              <div class="step-title">
                <span class="step-badge">STEP 2</span>
                <span>第 4 件顺势延伸神装</span>
              </div>
              <div class="step-nodes-list">
                <div v-for="(node, ni) in branch.step2Nodes" :key="ni" class="step-node">
                  <div class="node-icons-pair">
                    <img
                      v-for="id in node.itemIds"
                      :key="id"
                      :src="itemSrc(id)"
                      :alt="itemName(id)"
                      class="node-icon-sm"
                    />
                  </div>
                  <div class="node-meta">
                    <div class="node-name">
                      {{ node.itemIds.map(id => itemName(id)).join(' + ') }}
                    </div>
                    <div class="node-stats">
                      <span class="wr">{{ pct(node.winRate) }}</span>
                      <span class="delta" :class="{ pos: node.delta >= 0, neg: node.delta < 0 }">
                        ({{ fmtDelta(node.delta) }})
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="radar-empty">当前流派暂无可用的时序分支数据</div>
    </div>

    <!-- ==================== VIEW 3: 大后期针对性对策箱 ==================== -->
    <div v-else-if="activeView === 'toolbox'" class="view-panel">
      <div class="toolbox-grid">
        <!-- 针对多前排坦克 -->
        <div class="toolbox-col">
          <div class="toolbox-head anti-tank">
            <Swords class="col-ic" />
            <span>⚔️ 敌方多坦克/高护甲 (破甲与巨杀)</span>
          </div>
          <div v-if="situationalToolbox.antiTank.length" class="toolbox-items">
            <div v-for="s in situationalToolbox.antiTank" :key="s.id" class="toolbox-card">
              <img :src="itemSrc(s.id)" :alt="itemName(s.id)" class="tb-icon" />
              <div class="tb-meta">
                <div class="tb-name">{{ itemName(s.id) }}</div>
                <div class="tb-timing">建议顺位：第 3~4 件成型</div>
              </div>
              <span class="tb-score">对策分 {{ s.distinctiveScore.toFixed(1) }}</span>
            </div>
          </div>
          <div v-else class="tb-none">通用穿甲装备按核心路线顺出即可</div>
        </div>

        <!-- 针对强回复 -->
        <div class="toolbox-col">
          <div class="toolbox-head anti-heal">
            <Flame class="col-ic" />
            <span>🩸 敌方强回复/吸血怪 (重伤克制)</span>
          </div>
          <div v-if="situationalToolbox.antiHeal.length" class="toolbox-items">
            <div v-for="s in situationalToolbox.antiHeal" :key="s.id" class="toolbox-card">
              <img :src="itemSrc(s.id)" :alt="itemName(s.id)" class="tb-icon" />
              <div class="tb-meta">
                <div class="tb-name">{{ itemName(s.id) }}</div>
                <div class="tb-timing">建议顺位：中期早出早收益</div>
              </div>
              <span class="tb-score">对策分 {{ s.distinctiveScore.toFixed(1) }}</span>
            </div>
          </div>
          <div v-else class="tb-none">默认前排附带重伤，自身按爆发输出配置</div>
        </div>

        <!-- 针对高爆发自保 -->
        <div class="toolbox-col">
          <div class="toolbox-head survivability">
            <Shield class="col-ic" />
            <span>🛡️ 敌方高爆发刺客/法伤 (保命自保)</span>
          </div>
          <div v-if="situationalToolbox.survivability.length" class="toolbox-items">
            <div v-for="s in situationalToolbox.survivability" :key="s.id" class="toolbox-card">
              <img :src="itemSrc(s.id)" :alt="itemName(s.id)" class="tb-icon" />
              <div class="tb-meta">
                <div class="tb-name">{{ itemName(s.id) }}</div>
                <div class="tb-timing">建议顺位：第 4~5 件防切死</div>
              </div>
              <span class="tb-score">对策分 {{ s.distinctiveScore.toFixed(1) }}</span>
            </div>
          </div>
          <div v-else class="tb-none">保持拉扯站位，依靠核心吸血自保</div>
        </div>
      </div>
    </div>

    <!-- 底部：技能加点陷阱 & 召唤师技能收益榜 -->
    <div class="matrix-bottom-insights">
      <!-- 技能加点分析 -->
      <div v-if="skillOrderTactics" class="bottom-card">
        <div class="bcard-head">
          <Wand2 class="bcard-ic gold" />
          <span class="bcard-title">📈 技能加点收益与陷阱揭秘</span>
        </div>
        <div class="bcard-body">
          <div class="skill-route-row best">
            <span class="route-badge gold">🔥 胜率最高加点</span>
            <span class="route-keys">{{
              skillOrderTactics.best.skillKeys.slice(0, 3).join(' > ')
            }}</span>
            <span class="route-wr">{{ pct(skillOrderTactics.best.winRate) }}</span>
            <span class="route-games">({{ fmtGames(skillOrderTactics.best.games) }}场)</span>
          </div>
          <div v-if="skillOrderTactics.hasTrap" class="skill-route-row trap">
            <span class="route-badge red">⚠️ 大众陷阱加点</span>
            <span class="route-keys">{{
              skillOrderTactics.popular.skillKeys.slice(0, 3).join(' > ')
            }}</span>
            <span class="route-wr low">{{ pct(skillOrderTactics.popular.winRate) }}</span>
            <span class="route-hint"
              >比最优加点低 {{ (skillOrderTactics.diffPct * 100).toFixed(1) }}% 胜率！</span
            >
          </div>
        </div>
      </div>

      <!-- 召唤师技能组合 -->
      <div v-if="spellCombosTactics.length" class="bottom-card">
        <div class="bcard-head">
          <Zap class="bcard-ic gold" />
          <span class="bcard-title">⚡ 召唤师技能组合天梯</span>
        </div>
        <div class="bcard-body">
          <div v-for="(sp, spi) in spellCombosTactics" :key="spi" class="spell-combo-row">
            <div class="spell-icons">
              <img
                v-for="sid in sp.summonerSpellIds"
                :key="sid"
                :src="spellSrc(sid)"
                :alt="spellName(sid)"
                class="spell-img"
              />
            </div>
            <span class="spell-names">{{
              sp.summonerSpellIds.map(sid => spellName(sid)).join(' + ')
            }}</span>
            <span class="spell-wr">{{ pct(sp.winRate) }} 胜率</span>
            <span class="spell-pick">(选用 {{ pct(sp.pickRate) }})</span>
          </div>
        </div>
      </div>

      <!-- 海克斯强化 × 装备 跨模态羁绊协同 -->
      <div v-if="synergyList.length" class="bottom-card full">
        <div class="bcard-head">
          <Sparkles class="bcard-ic gold" />
          <span class="bcard-title">🌟 海克斯强化 × 装备 跨模态协同羁绊雷达</span>
        </div>
        <div class="bcard-body">
          <div v-for="syn in synergyList" :key="syn.augmentId" class="synergy-row">
            <span class="syn-badge">{{ syn.synergyType }}</span>
            <span class="syn-aug">强化【{{ syn.augmentName }}】</span>
            <span class="syn-desc">{{ syn.desc }}</span>
            <div class="syn-items">
              <img
                v-for="id in syn.recommendedItems"
                :key="id"
                :src="itemSrc(id)"
                :alt="itemName(id)"
                :title="itemName(id)"
                class="syn-item-img"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.matrix-wrapper {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-16);
  display: flex;
  flex-direction: column;
  gap: var(--space-14);
}

/* 顶部状态栏 */
.matrix-hero-bar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-12);
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: var(--space-12);
}
.mhb-title {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}
.mhb-icon {
  width: 18px;
  height: 18px;
  color: var(--brand);
}
.mhb-badge {
  font-size: var(--font-size-2xs);
  color: var(--brand);
  background: var(--brand-soft);
  border: 1px solid var(--brand-border);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font-weight: var(--font-weight-medium);
}
.mhb-sub {
  margin: var(--space-4) 0 0;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}
.mhb-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-6) var(--space-12);
  background: var(--bg-card);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  white-space: nowrap;
}
.mhb-btn:hover {
  color: var(--text-primary);
  border-color: var(--brand-border);
}
.mhb-btn.ok {
  border-color: var(--win-border);
  color: var(--win);
}
.btn-ic {
  width: 13px;
  height: 13px;
}

/* 🌟 红绿双极战术雷达卡 */
.matrix-tactical-radar {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-12);
}
.radar-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: var(--space-12);
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
.radar-card.positive {
  border-left: 3px solid var(--brand);
  background: linear-gradient(135deg, rgba(200, 155, 60, 0.05), transparent);
}
.radar-card.negative {
  border-left: 3px solid var(--loss);
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.05), transparent);
}
.radar-card-head {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}
.radar-ic {
  width: 15px;
  height: 15px;
}
.radar-ic.gold {
  color: var(--brand);
}
.radar-ic.red {
  color: var(--loss);
}
.radar-title {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}
.radar-items-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
.radar-item-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-4) var(--space-6);
  background: rgba(255, 255, 255, 0.02);
  border-radius: var(--radius-sm);
}
.radar-item-icon {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}
.jewel-border {
  border-color: var(--brand);
  box-shadow: 0 0 6px rgba(200, 155, 60, 0.3);
}
.trap-border {
  border-color: var(--loss);
}
.radar-item-meta {
  flex: 1;
  min-width: 0;
}
.radar-item-name {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}
.radar-item-sub {
  font-size: 10px;
  color: var(--text-tertiary);
}
.radar-item-badge {
  font-size: 11px;
  font-weight: var(--font-weight-bold);
  padding: 2px 6px;
  border-radius: 4px;
}
.delta-pos {
  background: var(--win-soft);
  color: var(--win);
  border: 1px solid var(--win-border);
}
.delta-neg {
  background: var(--loss-soft);
  color: var(--loss);
  border: 1px solid var(--loss-border);
}
.radar-empty {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  padding: var(--space-8) 0;
}

/* 智能平替建议横幅 */
.smart-swap-banner {
  margin-top: var(--space-4);
  padding: var(--space-8);
  background: rgba(200, 155, 60, 0.08);
  border: 1px dashed var(--brand-border);
  border-radius: var(--radius-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.swap-header {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: var(--font-weight-bold);
  color: var(--brand);
}
.swap-ic {
  width: 12px;
  height: 12px;
}
.swap-row {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  font-size: 11px;
  color: var(--text-secondary);
}
.swap-from strong {
  color: var(--loss);
}
.swap-to strong {
  color: var(--brand);
}
.swap-arrow {
  width: 12px;
  height: 12px;
  color: var(--brand);
}
.swap-gain {
  margin-left: auto;
  font-size: 10px;
  font-weight: var(--font-weight-bold);
  color: var(--win);
}

/* 视图切换 Tab 条 */
.matrix-view-tabs {
  display: flex;
  gap: var(--space-8);
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: var(--space-4);
}
.matrix-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-6) var(--space-12);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: all var(--dur-fast);
}
.matrix-tab-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.matrix-tab-btn.active {
  background: var(--brand-soft);
  color: var(--brand);
  font-weight: var(--font-weight-bold);
  border: 1px solid var(--brand-border);
}
.tab-ic {
  width: 13px;
  height: 13px;
}

/* Toast */
.matrix-toast {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-8) var(--space-12);
  background: var(--brand-soft);
  border: 1px solid var(--brand-border);
  border-radius: var(--radius-sm);
  color: var(--brand);
  font-size: var(--font-size-xs);
}
.toast-ic {
  width: 14px;
  height: 14px;
}

/* 表格与搜索工具栏 */
.matrix-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-12);
  margin-top: var(--space-4);
}
.mtb-search {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  background: var(--bg-card);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  padding: var(--space-4) var(--space-8);
  flex: 1;
  max-width: 380px;
}
.search-ic {
  width: 13px;
  height: 13px;
  color: var(--text-tertiary);
}
.mtb-search input {
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: var(--font-size-xs);
  width: 100%;
  outline: none;
}
.mtb-stats {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.matrix-table-container {
  overflow-x: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
}
.matrix-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-xs);
}
.matrix-table th {
  background: var(--bg-card);
  color: var(--text-tertiary);
  font-weight: var(--font-weight-semibold);
  padding: var(--space-8) var(--space-10);
  border-bottom: 1px solid var(--border-subtle);
  text-align: left;
}
.matrix-table th.th-sortable {
  cursor: pointer;
  user-select: none;
}
.matrix-table th.th-sortable:hover {
  color: var(--brand);
}
.th-content {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.sort-arrows .arr {
  width: 11px;
  height: 11px;
}
.sort-arrows .arr.on {
  color: var(--brand);
}

.matrix-row {
  border-bottom: 1px solid var(--border-subtle);
  transition: background var(--dur-fast);
}
.matrix-row:hover {
  background: var(--bg-hover);
}
.matrix-row.row-trap {
  background: rgba(239, 68, 68, 0.03);
}

.td-combo {
  padding: var(--space-8) var(--space-10);
  display: flex;
  align-items: center;
  gap: var(--space-10);
}
.combo-icons {
  display: flex;
  gap: 4px;
}
.combo-icon-wrap .item-icon {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}
.combo-names {
  display: flex;
  align-items: center;
  gap: 6px;
}
.names-text {
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}
.combo-tag {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
}
.combo-tag.core {
  background: var(--brand-soft);
  color: var(--brand);
  border: 1px solid var(--brand-border);
}
.combo-tag.trap {
  background: var(--loss-soft);
  color: var(--loss);
  border: 1px solid var(--loss-border);
}

.td-num {
  padding: var(--space-8) var(--space-10);
}
.val-wr {
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}
.val-wr.high {
  color: var(--win);
}
.val-wr.low {
  color: var(--loss);
}
.val-delta.pos {
  color: var(--win);
  font-weight: var(--font-weight-bold);
}
.val-delta.neg {
  color: var(--loss);
  font-weight: var(--font-weight-bold);
}
.val-pick {
  color: var(--text-secondary);
}

.sample-box {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sample-count {
  color: var(--text-tertiary);
}
.tier-badge {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
}
.tier-badge.high {
  background: rgba(200, 155, 60, 0.15);
  color: var(--brand);
}
.tier-badge.mid {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}
.tier-badge.low {
  background: rgba(148, 163, 184, 0.15);
  color: #94a3b8;
}

.td-act {
  padding: var(--space-8) var(--space-10);
}
.btn-import {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: var(--brand-soft);
  border: 1px solid var(--brand-border);
  border-radius: var(--radius-sm);
  color: var(--brand);
  font-size: 11px;
  cursor: pointer;
}
.btn-import:hover {
  background: var(--brand);
  color: #000;
}

/* VIEW 2: 时序进化树 */
.tree-branches-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}
.branch-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: var(--space-12);
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
}
.branch-header {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  border-bottom: 1px dashed var(--border-subtle);
  padding-bottom: var(--space-8);
}
.branch-tag {
  font-size: 11px;
  font-weight: var(--font-weight-bold);
  color: var(--brand);
}
.branch-base-items {
  display: flex;
  gap: var(--space-10);
}
.base-item-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}
.base-item-wrap .item-icon {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
}
.base-item-name {
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  font-weight: var(--font-weight-semibold);
}

.branch-evolution-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-12);
}
.step-col {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
.step-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: var(--font-weight-bold);
  color: var(--text-secondary);
}
.step-badge {
  background: var(--brand-soft);
  color: var(--brand);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 9px;
}
.step-nodes-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.step-node {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}
.step-node.best {
  border-color: var(--brand);
  background: rgba(200, 155, 60, 0.06);
}
.step-node.trap {
  border-color: var(--loss-border);
  background: rgba(239, 68, 68, 0.04);
}
.node-icon {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
}
.node-icons-pair {
  display: flex;
  gap: 2px;
}
.node-icon-sm {
  width: 20px;
  height: 20px;
  border-radius: 3px;
}
.node-meta {
  flex: 1;
  min-width: 0;
}
.node-name {
  font-size: 11px;
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}
.node-stats {
  font-size: 10px;
  display: flex;
  gap: 4px;
}
.node-stats .wr {
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}
.node-stats .delta.pos {
  color: var(--win);
}
.node-stats .delta.neg {
  color: var(--loss);
}
.node-tag {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
}
.node-tag.crown {
  background: var(--brand-soft);
  color: var(--brand);
}
.node-tag.trap {
  background: var(--loss-soft);
  color: var(--loss);
}

/* VIEW 3: 对策工具箱 */
.toolbox-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: var(--space-10);
}
.toolbox-col {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
.toolbox-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: var(--font-weight-bold);
}
.toolbox-head.anti-tank {
  color: #60a5fa;
}
.toolbox-head.anti-heal {
  color: #f87171;
}
.toolbox-head.survivability {
  color: #34d399;
}
.col-ic {
  width: 14px;
  height: 14px;
}
.toolbox-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.toolbox-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: var(--radius-sm);
}
.tb-icon {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
}
.tb-meta {
  flex: 1;
  min-width: 0;
}
.tb-name {
  font-size: 11px;
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}
.tb-timing {
  font-size: 9px;
  color: var(--text-tertiary);
}
.tb-score {
  font-size: 10px;
  color: var(--brand);
}
.tb-none {
  font-size: 10px;
  color: var(--text-tertiary);
  padding: var(--space-6) 0;
}

/* 底部加点与技能 */
.matrix-bottom-insights {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-12);
}
.bottom-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
.bcard-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.bcard-ic {
  width: 14px;
  height: 14px;
}
.bcard-ic.gold {
  color: var(--brand);
}
.bcard-title {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}
.bcard-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
}
.skill-route-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 4px;
}
.skill-route-row.best {
  background: rgba(200, 155, 60, 0.06);
}
.skill-route-row.trap {
  background: rgba(239, 68, 68, 0.05);
}
.route-badge {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
}
.route-badge.gold {
  background: var(--brand-soft);
  color: var(--brand);
}
.route-badge.red {
  background: var(--loss-soft);
  color: var(--loss);
}
.route-keys {
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}
.route-wr {
  font-weight: var(--font-weight-bold);
  color: var(--win);
}
.route-wr.low {
  color: var(--loss);
}
.route-games {
  color: var(--text-tertiary);
  font-size: 10px;
}
.route-hint {
  margin-left: auto;
  color: var(--loss);
  font-size: 10px;
}

.spell-combo-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
}
.spell-icons {
  display: flex;
  gap: 2px;
}
.spell-img {
  width: 18px;
  height: 18px;
  border-radius: 3px;
}
.spell-names {
  color: var(--text-secondary);
}
.spell-wr {
  font-weight: var(--font-weight-bold);
  color: var(--win);
}
.spell-pick {
  color: var(--text-tertiary);
  font-size: 10px;
}

.bottom-card.full {
  grid-column: span 2;
}
.synergy-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: 4px 6px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: var(--radius-sm);
  font-size: 11px;
}
.syn-badge {
  font-size: 10px;
  font-weight: var(--font-weight-bold);
  color: var(--brand);
  background: var(--brand-soft);
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--brand-border);
  white-space: nowrap;
}
.syn-aug {
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  white-space: nowrap;
}
.syn-desc {
  color: var(--text-tertiary);
  flex: 1;
}
.syn-items {
  display: flex;
  gap: 4px;
}
.syn-item-img {
  width: 22px;
  height: 22px;
  border-radius: 3px;
  border: 1px solid var(--border-subtle);
}

.hex-score-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-family: var(--font-family-mono);
  font-weight: var(--font-weight-bold);
  font-size: 13px;
}
.hex-score-badge.gold {
  background: rgba(234, 179, 8, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(234, 179, 8, 0.4);
}
.hex-score-badge.blue {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.4);
}
.hex-score-badge.gray {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
}

.item-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.item-tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
}
.item-tag.crown {
  background: rgba(234, 179, 8, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(234, 179, 8, 0.4);
}
.item-tag.trap {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.4);
}
.item-tag.normal {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-tertiary);
  border: 1px solid var(--border-subtle);
}
</style>
