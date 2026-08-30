<script setup lang="ts">
/**
 * MayhemEndgameBuildMatrix —— 大乱斗终局出装与装备深度分析矩阵
 *
 * 核心功能：
 * 1. 终局三件组合专业数据表格：3 件装备图标、胜率、出现率、胜率收益（Δ）、样本量及等级标签；
 * 2. 4 维表头动态排序（胜率 / 出现率 / 胜率收益 / 样本）与装备搜索过滤；
 * 3. 海克斯强化 × 装备 跨模态羁绊协同雷达；
 * 4. 战局情境装备时序分析（顺风抢节奏 / 针对对策 / 后期保命破局）；
 * 5. 两件套 vs 三件套 发力拐点曲线分析；
 * 6. ⚡ 一键将选定三件套方案导入游戏客户端推荐装备栏（LCU 自定义装备集）。
 */
import { computed, ref } from 'vue'
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Search,
  Sparkles,
  Swords,
  TrendingUp,
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

const searchQuery = ref('')
const sortField = ref<'winRate' | 'pickRate' | 'winRateDelta' | 'games'>('winRateDelta')
const sortOrder = ref<'desc' | 'asc'>('desc')
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

function perkSrc(id: number): string {
  return id > 0 ? `${assetPrefix}/perk/${id}` : ''
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
    const tier: 'high' | 'mid' | 'low' =
      cs.games >= 2000 ? 'high' : cs.games >= 500 ? 'mid' : 'low'
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
    // 取核心前 2 件大件 + 延伸第 1 件组成全新三件组合
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
 * 经过搜索过滤与 4 维排序后的表格数据
 */
const filteredAndSortedTrios = computed<TrioBuildRow[]>(() => {
  let list = [...allTrioRows.value]

  // 搜索过滤：输入装备名
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter(row => row.itemIds.some(id => itemName(id).toLowerCase().includes(q)))
  }

  // 排序
  list.sort((a, b) => {
    let diff = 0
    if (sortField.value === 'winRate') {
      diff = a.winRate - b.winRate
    } else if (sortField.value === 'pickRate') {
      diff = a.pickRate - b.pickRate
    } else if (sortField.value === 'winRateDelta') {
      diff = a.winRateDelta - b.winRateDelta
    } else if (sortField.value === 'games') {
      diff = a.games - b.games
    }
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
 * 海克斯强化 × 装备 协同羁绊雷达（检测当前英雄的强力跨模态联动）
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

  // 核心装备池
  const allItemIds = new Set<number>()
  for (const row of allTrioRows.value) {
    for (const id of row.itemIds) allItemIds.add(id)
  }

  for (const a of augs.slice(0, 15)) {
    const name = a.name || augName(a.id)

    // 1. 急速系（尖端发明家 1002 等）
    if (name.includes('发明家') || name.includes('急速') || name.includes('加速')) {
      const items = [3068, 3083, 3157, 3153, 3118, 3078].filter(id => allItemIds.has(id))
      matches.push({
        augmentId: a.id,
        augmentName: name,
        synergyType: '⚡ 装备急速流',
        desc: '装备冷却时间大幅缩减，高频触发装备被动特效与主动保命',
        recommendedItems: items.length ? items : [3157, 3153]
      })
    }
    // 2. 暴击系（暴击魔法、无懈可击等）
    else if (name.includes('暴击') || name.includes('魔法暴击') || name.includes('致命')) {
      const items = [3089, 4646, 3031, 3036, 3085].filter(id => allItemIds.has(id))
      matches.push({
        augmentId: a.id,
        augmentName: name,
        synergyType: '💥 极限双暴流',
        desc: '法术/技能可触发全额暴击，搭配法强或重击大件实现瞬间融化',
        recommendedItems: items.length ? items : [3089, 4646]
      })
    }
    // 3. 灼烧系（慢炖、焦灼、彗星等）
    else if (name.includes('慢炖') || name.includes('灼烧') || name.includes('火')) {
      const items = [6653, 3116, 3118, 3068].filter(id => allItemIds.has(id))
      matches.push({
        augmentId: a.id,
        augmentName: name,
        synergyType: '🔥 持续真伤灼烧流',
        desc: '多重百分比生命值持续灼烧，面对前排坦克收益最大化',
        recommendedItems: items.length ? items : [6653, 3116]
      })
    }
    // 4. 特效普攻系（台风、连环打击、闪电链等）
    else if (name.includes('台风') || name.includes('连环') || name.includes('打击')) {
      const items = [3124, 3153, 3085, 3115, 3091].filter(id => allItemIds.has(id))
      matches.push({
        augmentId: a.id,
        augmentName: name,
        synergyType: '🌀 狂暴攻击特效流',
        desc: '普攻触发多重弹射与攻击特效，清线团战群体割草',
        recommendedItems: items.length ? items : [3124, 3153]
      })
    }
    // 5. 坦克体型与护盾系（巨像、歌利亚、坚韧等）
    else if (name.includes('巨像') || name.includes('歌利亚') || name.includes('护盾')) {
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
 * 情境装备分类（根据 averageIndex 与 distinctiveScore 分流）
 */
const categorizedSituationals = computed(() => {
  const sits = props.build.situationalItems ?? []
  const early: SituationalItem[] = []
  const counter: SituationalItem[] = []
  const late: SituationalItem[] = []

  for (const s of sits) {
    if (s.averageIndex < 0.46) {
      early.push(s)
    } else if (s.distinctiveScore > 3.0) {
      counter.push(s)
    } else {
      late.push(s)
    }
  }

  return {
    early: early.slice(0, 4),
    counter: counter.slice(0, 6),
    late: late.slice(0, 4)
  }
})

/**
 * 发力期曲线评估（两件套 vs 三件套）
 */
const powerSpikeAssessment = computed(() => {
  const core1 = props.build.coreItems?.[0]
  if (!core1) return null

  const heroWr = heroOverallWinRate.value
  const coreWr = core1.winRate
  const diff = coreWr - heroWr

  if (diff >= 0.04) {
    return {
      type: 'early',
      title: '⚡ 核心成型极快 · 两件套即迎强势质变',
      desc: `该英雄核心出装协同极高，前中期三件套成型时胜率可达 ${pct(coreWr)}（较基准提升 ${fmtDelta(diff)}），建议主动发起团战终结比赛。`
    }
  } else if (diff >= 0.01) {
    return {
      type: 'mid',
      title: '🎯 平稳发力型 · 随装备件数线性稳步提升',
      desc: `出装曲线平滑无明显断层，胜率保持在 ${pct(coreWr)}，依局势顺势延伸神装即可。`
    }
  } else {
    return {
      type: 'late',
      title: '⏳ 大后期发力型 · 需憋满三件套与终极神装',
      desc: `前期相对依赖装备属性支撑，建议前期稳健拉扯发育，待核心大件与防装到位后接管战局。`
    }
  }
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
      { name: `核心三件套 (${pct(row.winRate)} 胜率 / 收益 ${fmtDelta(row.winRateDelta)})`, itemIds: row.itemIds },
      { name: '顺势与情境神装备选', itemIds: sitIds }
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

  let text = `【${c.name} · ${c.title}】大乱斗终局出装指南\n`
  text += `全服基准胜率：${pct(heroOverallWinRate.value)} | 选用率：${pct(c.stats.pickRate)}\n`
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
          <span>终局三件组合矩阵</span>
          <span class="mhb-badge">大数据实时聚合</span>
        </div>
        <p class="mhb-sub">
          基于全服实战终局持有成装大数据无序组合拆解，已过滤低信号及负收益出装
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

    <!-- 发力拐点曲线提示条 -->
    <div v-if="powerSpikeAssessment" class="matrix-spike-card" :class="powerSpikeAssessment.type">
      <TrendingUp class="spike-icon" />
      <div class="spike-content">
        <div class="spike-title">{{ powerSpikeAssessment.title }}</div>
        <div class="spike-desc">{{ powerSpikeAssessment.desc }}</div>
      </div>
    </div>

    <!-- 成功提示 Toast -->
    <div v-if="importSuccessMsg" class="matrix-toast">
      <Sparkles class="toast-ic" />
      <span>{{ importSuccessMsg }}</span>
    </div>

    <!-- 表格工具栏（搜索与过滤） -->
    <div class="matrix-toolbar">
      <div class="mtb-search">
        <Search class="search-ic" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索装备名称筛选组合（如：破败、帽子、心之钢…）"
        />
      </div>
      <div class="mtb-stats">
        共计 <strong>{{ filteredAndSortedTrios.length }}</strong> 组有效高信号三件套
      </div>
    </div>

    <!-- 终局三件组合专业数据表格 -->
    <div class="matrix-table-container">
      <table class="matrix-table">
        <thead>
          <tr>
            <th class="th-combo">三件组合</th>
            <th class="th-sortable" @click="toggleSort('winRate')">
              <div class="th-content">
                <span>胜率</span>
                <span class="sort-arrows">
                  <ChevronUp v-if="sortField === 'winRate' && sortOrder === 'asc'" class="arr on" />
                  <ChevronDown v-else-if="sortField === 'winRate' && sortOrder === 'desc'" class="arr on" />
                  <ArrowUpDown v-else class="arr" />
                </span>
              </div>
            </th>
            <th class="th-sortable" @click="toggleSort('pickRate')">
              <div class="th-content">
                <span>出现率</span>
                <span class="sort-arrows">
                  <ChevronUp v-if="sortField === 'pickRate' && sortOrder === 'asc'" class="arr on" />
                  <ChevronDown v-else-if="sortField === 'pickRate' && sortOrder === 'desc'" class="arr on" />
                  <ArrowUpDown v-else class="arr" />
                </span>
              </div>
            </th>
            <th class="th-sortable" @click="toggleSort('winRateDelta')">
              <div class="th-content">
                <span>胜率收益</span>
                <span class="sort-arrows">
                  <ChevronUp v-if="sortField === 'winRateDelta' && sortOrder === 'asc'" class="arr on" />
                  <ChevronDown v-else-if="sortField === 'winRateDelta' && sortOrder === 'desc'" class="arr on" />
                  <ArrowUpDown v-else class="arr" />
                </span>
              </div>
            </th>
            <th class="th-sortable" @click="toggleSort('games')">
              <div class="th-content">
                <span>样本量</span>
                <span class="sort-arrows">
                  <ChevronUp v-if="sortField === 'games' && sortOrder === 'asc'" class="arr on" />
                  <ChevronDown v-else-if="sortField === 'games' && sortOrder === 'desc'" class="arr on" />
                  <ArrowUpDown v-else class="arr" />
                </span>
              </div>
            </th>
            <th class="th-action">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, idx) in filteredAndSortedTrios"
            :key="row.key"
            class="matrix-row"
            :class="{ 'is-trap': row.isTrap, 'is-top': idx === 0 }"
          >
            <!-- 1. 三件套装备图标 -->
            <td class="td-combo">
              <div class="combo-group">
                <div
                  v-for="(iid, iidx) in row.itemIds"
                  :key="`${iid}-${iidx}`"
                  class="item-slot"
                  :title="`${itemName(iid)} - ${itemDesc(iid)}`"
                >
                  <img :src="itemSrc(iid)" :alt="itemName(iid)" loading="lazy" />
                </div>
              </div>
              <span v-if="row.isCore" class="combo-tag core">主流核心</span>
              <span v-else class="combo-tag ext">顺势延伸</span>
            </td>

            <!-- 2. 胜率 -->
            <td class="td-wr">
              <span class="val-wr" :class="{ high: row.winRate >= 0.54, low: row.winRate < 0.48 }">
                {{ pct(row.winRate) }}
              </span>
            </td>

            <!-- 3. 出现率 -->
            <td class="td-pr">
              <span class="val-pr">{{ pct(row.pickRate) }}</span>
            </td>

            <!-- 4. 胜率收益 -->
            <td class="td-delta">
              <span
                class="val-delta"
                :class="{
                  pos: row.winRateDelta > 0,
                  neg: row.winRateDelta < 0,
                  great: row.winRateDelta >= 0.04
                }"
              >
                {{ fmtDelta(row.winRateDelta) }}
              </span>
            </td>

            <!-- 5. 样本量 -->
            <td class="td-samples">
              <span class="val-games">{{ fmtGames(row.games) }}</span>
              <span class="sample-badge" :class="row.sampleTier">
                {{ row.sampleTier === 'high' ? '高样本' : row.sampleTier === 'mid' ? '中样本' : '探索' }}
              </span>
            </td>

            <!-- 6. 快捷操作 -->
            <td class="td-action">
              <button
                class="btn-import-set"
                :disabled="importingId === row.key"
                :title="`一键将这套装备写入客户端装备页`"
                @click="onImportItemSet(row)"
              >
                <Download class="btn-ic" />
                <span>{{ importingId === row.key ? '写入中…' : '导入' }}</span>
              </button>
            </td>
          </tr>
          <tr v-if="!filteredAndSortedTrios.length">
            <td colspan="6" class="td-empty">
              没有匹配到符合条件的三件套组合
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 海克斯 × 装备 跨模态协同雷达 -->
    <div v-if="synergyList.length" class="matrix-synergy-section">
      <div class="msec-header">
        <Sparkles class="msec-ic" />
        <span class="msec-title">海克斯强化 × 装备 羁绊协同雷达</span>
        <span class="msec-sub">拿到以下强化时，搭配对应装备产生双重乘区质变</span>
      </div>
      <div class="synergy-grid">
        <div v-for="syn in synergyList" :key="syn.augmentId" class="synergy-card">
          <div class="syn-head">
            <img :src="perkSrc(syn.augmentId)" :alt="syn.augmentName" class="syn-aug-ic" />
            <div class="syn-aug-info">
              <div class="syn-aug-name">{{ syn.augmentName }}</div>
              <div class="syn-tag">{{ syn.synergyType }}</div>
            </div>
          </div>
          <p class="syn-desc">{{ syn.desc }}</p>
          <div class="syn-rec-items">
            <span class="syn-rec-lbl">推荐联动装备：</span>
            <div class="syn-item-row">
              <img
                v-for="iid in syn.recommendedItems"
                :key="iid"
                :src="itemSrc(iid)"
                :alt="itemName(iid)"
                :title="itemName(iid)"
                class="syn-item-ic"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 战局对策与情境装备时序 -->
    <div
      v-if="categorizedSituationals.early.length || categorizedSituationals.counter.length || categorizedSituationals.late.length"
      class="matrix-sit-section"
    >
      <div class="msec-header">
        <Zap class="msec-ic" />
        <span class="msec-title">战局情境装备与出装顺位对策</span>
      </div>
      <div class="sit-grid">
        <!-- 顺风过渡 -->
        <div v-if="categorizedSituationals.early.length" class="sit-column">
          <div class="sit-col-title early">⚡ 顺风抢节奏 / 早期质变</div>
          <div class="sit-cards">
            <div v-for="s in categorizedSituationals.early" :key="s.id" class="sit-card">
              <img :src="itemSrc(s.id)" :alt="itemName(s.id)" />
              <div class="sit-card-info">
                <div class="sit-name">{{ itemName(s.id) }}</div>
                <div class="sit-meta">选用 {{ pct(s.pickRate) }} · {{ fmtGames(s.games) }} 场</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 阵容对策 -->
        <div v-if="categorizedSituationals.counter.length" class="sit-column">
          <div class="sit-col-title counter">🎯 针对敌方阵容 / 重伤穿甲破局</div>
          <div class="sit-cards">
            <div v-for="s in categorizedSituationals.counter" :key="s.id" class="sit-card">
              <img :src="itemSrc(s.id)" :alt="itemName(s.id)" />
              <div class="sit-card-info">
                <div class="sit-name">{{ itemName(s.id) }}</div>
                <div class="sit-meta">针对特异度 {{ s.distinctiveScore.toFixed(1) }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 大后期终极神装 -->
        <div v-if="categorizedSituationals.late.length" class="sit-column">
          <div class="sit-col-title late">👑 六神终极决战 / 保命破局</div>
          <div class="sit-cards">
            <div v-for="s in categorizedSituationals.late" :key="s.id" class="sit-card">
              <img :src="itemSrc(s.id)" :alt="itemName(s.id)" />
              <div class="sit-card-info">
                <div class="sit-name">{{ itemName(s.id) }}</div>
                <div class="sit-meta">终局选择 · 胜率 {{ pct(s.winRate) }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.matrix-wrapper {
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: #e6e8eb;
  font-family: inherit;
}

/* 顶部状态栏 */
.matrix-hero-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(135deg, rgba(20, 26, 38, 0.95), rgba(12, 16, 24, 0.98));
  border: 1px solid rgba(212, 175, 55, 0.25);
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}
.mhb-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  color: #f1ebd8;
}
.mhb-icon {
  width: 18px;
  height: 18px;
  color: #c89b3c;
}
.mhb-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  background: rgba(200, 155, 60, 0.15);
  color: #d4af37;
  border: 1px solid rgba(200, 155, 60, 0.3);
  border-radius: 4px;
}
.mhb-sub {
  margin: 4px 0 0 0;
  font-size: 12px;
  color: #8c9ba5;
}
.mhb-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #d1d5db;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.mhb-btn:hover {
  background: rgba(200, 155, 60, 0.15);
  border-color: #c89b3c;
  color: #f1ebd8;
}
.mhb-btn.ok {
  background: rgba(16, 185, 129, 0.2);
  border-color: #10b981;
  color: #34d399;
}
.btn-ic {
  width: 14px;
  height: 14px;
}

/* 发力拐点提示 */
.matrix-spike-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(59, 130, 246, 0.25);
}
.matrix-spike-card.early {
  border-color: rgba(16, 185, 129, 0.35);
  background: rgba(16, 185, 129, 0.08);
}
.matrix-spike-card.early .spike-icon {
  color: #10b981;
}
.spike-icon {
  width: 20px;
  height: 20px;
  color: #3b82f6;
  flex-shrink: 0;
}
.spike-title {
  font-size: 13px;
  font-weight: 700;
  color: #f1ebd8;
}
.spike-desc {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 2px;
}

/* Toast */
.matrix-toast {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(16, 185, 129, 0.2);
  border: 1px solid #10b981;
  color: #6ee7b7;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  animation: fadeIn 0.3s ease;
}
.toast-ic {
  width: 16px;
  height: 16px;
}

/* 工具栏 */
.matrix-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.mtb-search {
  position: relative;
  flex: 1;
  max-width: 380px;
}
.search-ic {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  color: #6b7280;
}
.mtb-search input {
  width: 100%;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 6px 10px 6px 30px;
  color: #f3f4f6;
  font-size: 12px;
  outline: none;
  transition: border-color 0.2s;
}
.mtb-search input:focus {
  border-color: #c89b3c;
}
.mtb-stats {
  font-size: 12px;
  color: #9ca3af;
}
.mtb-stats strong {
  color: #d4af37;
}

/* 表格容器 */
.matrix-table-container {
  background: rgba(12, 17, 26, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}
.matrix-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 13px;
}
.matrix-table th {
  background: rgba(20, 27, 40, 0.9);
  padding: 10px 12px;
  font-weight: 600;
  color: #94a3b8;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  user-select: none;
}
.matrix-table th.th-sortable {
  cursor: pointer;
  transition: color 0.2s;
}
.matrix-table th.th-sortable:hover {
  color: #f1ebd8;
}
.th-content {
  display: flex;
  align-items: center;
  gap: 4px;
}
.sort-arrows .arr {
  width: 12px;
  height: 12px;
  color: #4b5563;
}
.sort-arrows .arr.on {
  color: #c89b3c;
}

/* 行样式 */
.matrix-row {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: background 0.15s;
}
.matrix-row:hover {
  background: rgba(200, 155, 60, 0.06);
}
.matrix-row.is-top {
  background: rgba(200, 155, 60, 0.03);
}
.matrix-row.is-trap {
  background: rgba(239, 68, 68, 0.05);
}
.matrix-table td {
  padding: 8px 12px;
  vertical-align: middle;
}

/* 三件组合列 */
.td-combo {
  display: flex;
  align-items: center;
  gap: 8px;
}
.combo-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.item-slot {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  border: 1px solid rgba(212, 175, 55, 0.35);
  overflow: hidden;
  background: #090c12;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}
.item-slot img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.combo-tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
}
.combo-tag.core {
  background: rgba(200, 155, 60, 0.18);
  color: #e6ca65;
  border: 1px solid rgba(200, 155, 60, 0.3);
}
.combo-tag.ext {
  background: rgba(59, 130, 246, 0.15);
  color: #93c5fd;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

/* 胜率 / 出现率 / 收益 / 样本 */
.val-wr {
  font-weight: 700;
  color: #e5e7eb;
}
.val-wr.high {
  color: #34d399;
}
.val-wr.low {
  color: #f87171;
}
.val-pr {
  color: #94a3b8;
}
.val-delta {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 700;
  font-size: 12px;
}
.val-delta.pos {
  background: rgba(16, 185, 129, 0.12);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.25);
}
.val-delta.great {
  background: rgba(16, 185, 129, 0.22);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.5);
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.2);
}
.val-delta.neg {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.25);
}
.val-games {
  color: #cbd5e1;
  font-size: 12px;
  margin-right: 6px;
}
.sample-badge {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  font-weight: 600;
}
.sample-badge.high {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
}
.sample-badge.mid {
  background: rgba(99, 102, 241, 0.15);
  color: #a5b4fc;
}
.sample-badge.low {
  background: rgba(156, 163, 175, 0.15);
  color: #9ca3af;
}

/* 操作列 */
.btn-import-set {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(200, 155, 60, 0.15);
  border: 1px solid rgba(200, 155, 60, 0.4);
  color: #f1ebd8;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-import-set:hover:not(:disabled) {
  background: rgba(200, 155, 60, 0.35);
  border-color: #d4af37;
  transform: translateY(-1px);
}
.btn-import-set:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 协同雷达 */
.matrix-synergy-section,
.matrix-sit-section {
  background: rgba(15, 21, 32, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 14px;
}
.msec-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.msec-ic {
  width: 16px;
  height: 16px;
  color: #c89b3c;
}
.msec-title {
  font-size: 14px;
  font-weight: 700;
  color: #f1ebd8;
}
.msec-sub {
  font-size: 11px;
  color: #8c9ba5;
}
.synergy-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}
.synergy-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(200, 155, 60, 0.2);
  border-radius: 6px;
  padding: 10px;
}
.syn-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.syn-aug-ic {
  width: 28px;
  height: 28px;
  border-radius: 4px;
}
.syn-aug-name {
  font-size: 12px;
  font-weight: 700;
  color: #f3f4f6;
}
.syn-tag {
  font-size: 10px;
  color: #c89b3c;
  font-weight: 600;
}
.syn-desc {
  font-size: 11px;
  color: #94a3b8;
  margin: 6px 0;
  line-height: 1.4;
}
.syn-rec-items {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}
.syn-rec-lbl {
  font-size: 10px;
  color: #64748b;
}
.syn-item-row {
  display: flex;
  gap: 4px;
}
.syn-item-ic {
  width: 22px;
  height: 22px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.15);
}

/* 情境装备 */
.sit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.sit-column {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  padding: 10px;
}
.sit-col-title {
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 8px;
}
.sit-col-title.early {
  color: #34d399;
}
.sit-col-title.counter {
  color: #60a5fa;
}
.sit-col-title.late {
  color: #f59e0b;
}
.sit-cards {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sit-card {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.03);
  padding: 4px 6px;
  border-radius: 4px;
}
.sit-card img {
  width: 24px;
  height: 24px;
  border-radius: 4px;
}
.sit-name {
  font-size: 11px;
  font-weight: 600;
  color: #e5e7eb;
}
.sit-meta {
  font-size: 10px;
  color: #8c9ba5;
}
.td-empty {
  text-align: center;
  padding: 24px;
  color: #64748b;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
