<template>
  <div class="mdetail">
    <PageStage kicker="MAYHEM · 大乱斗详情" :title="heroTitle" :sub="heroSub" compact>
      <template #actions>
        <button class="btn gho sm" @click="goBack">返回榜单</button>
      </template>
    </PageStage>

    <div class="d-body">
      <div v-if="error" class="m-alert">
        <span>{{ error }}</span>
        <button class="chip" style="margin-left: 12px" @click="load">🔄 重新加载</button>
      </div>
      <div v-if="loading" class="m-empty">正在加载…</div>
      <div v-else-if="!detail" class="m-empty">
        <p>暂无该英雄的大乱斗数据（可能尚未同步或上游未覆盖）</p>
        <button class="btn gho sm" style="margin-top: 12px" @click="load">🔄 点击重新尝试</button>
      </div>

      <template v-else>
        <!-- 概要 -->
        <section class="d-hero">
          <img class="d-ava" :src="detail.champion.iconUrl" :alt="detail.champion.title" />
          <div class="d-heromain">
            <div class="d-nameline">
              <span class="ctier" :class="`t${tier}`">T{{ tier }}</span>
              <span class="d-name">{{ detail.champion.title }}</span>
              <span class="d-subname"
                >{{ detail.champion.name }} · {{ detail.champion.alias }}</span
              >
            </div>
            <div class="d-statsrow">
              <span><em>胜率</em>{{ pct(heroWinRate) }}</span>
              <span><em>选取率</em>{{ pct(detail.champion.stats.pickRate) }}</span>
              <span v-if="dateText"><em>数据日期</em>{{ dateText }}</span>
            </div>
            <div class="d-rolerow">
              <i v-for="role in detail.champion.roles" :key="role">{{ roleLabel(role) }}</i>
            </div>
            <div v-if="balanceTags.length" class="d-balrow">
              <span
                v-for="t in balanceTags"
                :key="t.label"
                class="dbal"
                :class="t.isBuff ? 'buff' : 'nerf'"
                :title="t.desc"
              >
                {{ t.label }}
              </span>
            </div>
          </div>
        </section>

        <!-- 推荐强化 -->
        <section class="d-sec">
          <div class="d-sechead">
            <div class="d-head-left">
              <h3>推荐强化</h3>
              <span class="d-sec-count">({{ sortedFilteredAugments.length }})</span>
            </div>
            <div class="d-head-actions">
              <!-- 稀有度筛选 -->
              <div class="m-roles">
                <button
                  v-for="r in RARITY_OPTIONS"
                  :key="r.key"
                  class="chip"
                  :class="{ 'chip--on': activeRarity === r.key }"
                  @click="activeRarity = r.key"
                >
                  {{ r.label }}
                </button>
              </div>

              <!-- 排序方式切换 -->
              <div class="d-sort-group">
                <button
                  class="chip"
                  :class="{ 'chip--on': augSortKey === 'winRate' }"
                  @click="toggleAugSort('winRate')"
                >
                  胜率 {{ augSortKey === 'winRate' ? (augSortOrder === 'desc' ? '↓' : '↑') : '' }}
                </button>
                <button
                  class="chip"
                  :class="{ 'chip--on': augSortKey === 'score' }"
                  @click="toggleAugSort('score')"
                >
                  Score {{ augSortKey === 'score' ? (augSortOrder === 'desc' ? '↓' : '↑') : '' }}
                </button>
                <button
                  class="chip"
                  :class="{ 'chip--on': augSortKey === 'pickRate' }"
                  @click="toggleAugSort('pickRate')"
                >
                  选取率
                  {{ augSortKey === 'pickRate' ? (augSortOrder === 'desc' ? '↓' : '↑') : '' }}
                </button>
              </div>

              <!-- 视图切换：列表 ⇋ 方块 -->
              <div class="aug-view-toggle">
                <button
                  class="chip"
                  :class="{ 'chip--on': augViewMode === 'list' }"
                  title="列表竖排模式（一行行详细对比）"
                  @click="augViewMode = 'list'"
                >
                  <List class="btn-ico-sm" /> 列表
                </button>
                <button
                  class="chip"
                  :class="{ 'chip--on': augViewMode === 'grid' }"
                  title="方块横排模式"
                  @click="augViewMode = 'grid'"
                >
                  <LayoutGrid class="btn-ico-sm" /> 方块
                </button>
              </div>
            </div>
          </div>
          <p class="d-hint">
            胜率为 aramgg 客户端自采口径（全球，≥{{ minGamesText }}
            场才展示）；选取率为腾讯国服口径。
          </p>

          <div v-if="!sortedFilteredAugments.length" class="m-empty">没有符合条件的强化</div>

          <!-- 模式 1：列表竖排（一行行） -->
          <div v-else-if="augViewMode === 'list'" class="d-augs-list">
            <div class="daug-list-header">
              <span class="dl-col-name">强化符文</span>
              <span class="dl-col-rarity">品质</span>
              <span class="dl-col-score">Score 评分</span>
              <span class="dl-col-wr">自采胜率 / 相对基准</span>
              <span class="dl-col-pr">国服选取率</span>
            </div>
            <div
              v-for="a in sortedFilteredAugments"
              :key="a.id"
              class="daug-list-row"
              :title="augTooltip(a.id)"
            >
              <div class="dl-col-name daug-name-cell">
                <img
                  class="daug-list-ico"
                  :class="`rr-border-${a.rarityName}`"
                  :src="perkSrc(a.id)"
                  :alt="augNameOf(a.id)"
                  loading="lazy"
                  @error="fallbackIcon($event, a.iconUrl)"
                />
                <div class="daug-name-meta">
                  <span class="daug-list-title">{{ augNameOf(a.id) }}</span>
                  <span class="daug-list-desc">{{ augDescOf(a.id) }}</span>
                </div>
              </div>
              <div class="dl-col-rarity">
                <span class="ararity" :class="`rr-${a.rarityName}`">{{ a.rarityDisplayName }}</span>
              </div>
              <div class="dl-col-score">
                <span
                  class="daug__score"
                  :class="augHexScore(a) >= 80 ? 'gold' : augHexScore(a) >= 65 ? 'blue' : 'gray'"
                >
                  Score {{ augHexScore(a) }}
                </span>
              </div>
              <div class="dl-col-wr">
                <span class="daug__wr">{{ pct(a.stats.winRate) }}</span>
                <span class="daug__delta" :class="{ pos: augDelta(a) >= 0, neg: augDelta(a) < 0 }">
                  {{ fmtDelta(augDelta(a)) }}
                </span>
              </div>
              <div class="dl-col-pr">
                <span class="daug__pr-val">{{ pct(a.stats.pickRate) }}</span>
              </div>
            </div>
          </div>

          <!-- 模式 2：方块横排 -->
          <div v-else class="d-augs">
            <div
              v-for="a in sortedFilteredAugments"
              :key="a.id"
              class="daug"
              :title="augTooltip(a.id)"
            >
              <img
                :src="perkSrc(a.id)"
                :alt="augNameOf(a.id)"
                loading="lazy"
                @error="fallbackIcon($event, a.iconUrl)"
              />
              <span class="daug__name">{{ augNameOf(a.id) }}</span>
              <span class="ararity" :class="`rr-${a.rarityName}`">{{ a.rarityDisplayName }}</span>
              <span
                class="daug__score"
                :class="augHexScore(a) >= 80 ? 'gold' : augHexScore(a) >= 65 ? 'blue' : 'gray'"
              >
                Score {{ augHexScore(a) }}
              </span>
              <span class="daug__wr">{{ pct(a.stats.winRate) }}</span>
              <span class="daug__delta" :class="{ pos: augDelta(a) >= 0, neg: augDelta(a) < 0 }">
                {{ fmtDelta(augDelta(a)) }}
              </span>
              <span class="daug__pr">选取 {{ pct(a.stats.pickRate) }}</span>
            </div>
          </div>
        </section>

        <!-- 强化组合 TOP -->
        <section v-if="trios.length" class="d-sec">
          <h3>强化组合 TOP {{ Math.min(trios.length, 5) }}</h3>
          <div class="d-trios">
            <div v-for="(t, i) in trios.slice(0, 5)" :key="i" class="dtrio-card dtrio">
              <div class="dtrio-rank-badge">#{{ i + 1 }}</div>
              <div class="dtrio-items-wrap">
                <template v-for="(aid, aidx) in t.augmentIds" :key="`${aid}-${aidx}`">
                  <div class="dtrio-single-item" :title="augTooltip(aid)">
                    <img
                      :src="perkSrc(aid)"
                      :alt="augNameOf(aid)"
                      class="dtrio-aug-ico"
                      loading="lazy"
                      @error="hideIcon($event)"
                    />
                    <span class="dtrio-aug-name">{{ augNameOf(aid) }}</span>
                  </div>
                  <span v-if="aidx < t.augmentIds.length - 1" class="dtrio-plus">+</span>
                </template>
              </div>
              <div class="dtrio-stats-col">
                <span class="dtrio__wr">{{ pct(t.stats.winRate) }} 胜率</span>
                <span class="dtrio__g">{{ fmtGames(t.stats.games) }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 出装流派体系（标签页切换展示） -->
        <section v-if="builds.length && currentBuild" class="d-sec d-builds-sec">
          <div class="d-sechead">
            <div class="d-head-left">
              <h3>出装与加点方案</h3>
              <span class="d-sec-count">({{ builds.length }} 个流派)</span>
            </div>
            <!-- 出装流派切换标签 -->
            <div class="build-tabs">
              <button
                v-for="(b, i) in builds"
                :key="i"
                class="build-tab-btn"
                :class="{ 'build-tab-btn--active': activeBuildIndex === i }"
                @click="activeBuildIndex = i"
              >
                <span class="build-tab-title">{{ buildTitle(b, i) }}</span>
                <span class="build-tab-sub">{{ pct(b.stats.winRate) }} 胜率</span>
              </button>
            </div>
          </div>

          <!-- 当前激活的出装流派卡片 -->
          <div class="build-panel-card">
            <div class="build-header-meta">
              <div class="build-header-left">
                <span class="build-badge">{{ buildTitle(currentBuild, activeBuildIndex) }}</span>
                <span class="build-meta-stat">
                  胜率 <em>{{ pct(currentBuild.stats.winRate) }}</em>
                </span>
                <span class="build-meta-stat">
                  总场次 <em>{{ fmtGames(currentBuild.stats.games) }}</em>
                </span>
                <span v-if="currentBuild.stats.pickRate != null" class="build-meta-stat">
                  选取率 <em>{{ pct(currentBuild.stats.pickRate) }}</em>
                </span>
              </div>
              <div class="build-header-actions">
                <button class="btn gho sm" @click="onCopyReport">
                  <Check v-if="copySuccess" class="btn-ico-sm" />
                  <Copy v-else class="btn-ico-sm" />
                  {{ copySuccess ? '已复制' : '复制实战小抄' }}
                </button>
              </div>
            </div>

            <!-- 1. 核心三件套（严格排除鞋子） -->
            <div class="build-block">
              <div class="build-block-title">
                <Swords :size="14" />
                <span>核心三件套（纯大件）</span>
              </div>
              <div class="d-coreset-wrap">
                <div class="core-chain d-coreset">
                  <template
                    v-for="(id, idx) in getCoreBuildItems(currentBuild)"
                    :key="`${id}-${idx}`"
                  >
                    <div class="core-item-card" :title="itemName(id)">
                      <img :src="itemSrc(id)" :alt="itemName(id)" loading="lazy" />
                      <span class="core-item-label">{{ itemName(id) }}</span>
                    </div>
                    <ArrowRight
                      v-if="idx < getCoreBuildItems(currentBuild).length - 1"
                      class="core-arrow"
                      :size="16"
                    />
                  </template>
                </div>
                <div v-if="currentBuild.coreItems?.[0]" class="core-meta-chip">
                  <span>{{ pct(currentBuild.coreItems[0].winRate) }} 核心胜率</span>
                  <span class="core-games">({{ fmtGames(currentBuild.coreItems[0].games) }})</span>
                </div>
              </div>
            </div>

            <!-- 2. 后续顺势延伸神装 -->
            <div v-if="topExtensions(currentBuild).length" class="build-block">
              <div class="build-block-title">
                <Zap :size="14" />
                <span>顺势延伸神装推荐（第 4/5 件）</span>
              </div>
              <div class="d-exts-grid">
                <div
                  v-for="(ex, ei) in topExtensions(currentBuild).slice(0, 6)"
                  :key="ei"
                  class="ext-card"
                  :title="`${itemName(ex.itemIds[0])} · 胜率 ${pct(ex.winRate)}`"
                >
                  <img
                    :src="itemSrc(ex.itemIds[0])"
                    :alt="itemName(ex.itemIds[0])"
                    class="ext-item-ico"
                    loading="lazy"
                  />
                  <div class="ext-card-info">
                    <span class="ext-card-name">{{ itemName(ex.itemIds[0]) }}</span>
                    <div class="ext-card-stats">
                      <span class="ext-card-wr">{{ pct(ex.winRate) }} 胜率</span>
                      <span class="ext-card-g">{{ fmtGames(ex.games) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 3. 出门装与召唤师技能组合 -->
            <div class="build-dual-row">
              <!-- 出门装 -->
              <div v-if="currentBuild.startingItems.length" class="dual-col-card">
                <div class="build-block-title">
                  <Shield :size="14" />
                  <span>出门装组合</span>
                </div>
                <div class="starters-list">
                  <div
                    v-for="(st, si) in currentBuild.startingItems.slice(0, 3)"
                    :key="si"
                    class="starter-row"
                  >
                    <div class="starter-icons">
                      <img
                        v-for="(iid, iidx) in st.itemIds"
                        :key="`${iid}-${iidx}`"
                        :src="itemSrc(iid)"
                        :alt="itemName(iid)"
                        :title="itemName(iid)"
                        loading="lazy"
                      />
                    </div>
                    <span class="starter-meta">
                      {{ pct(st.winRate) }} 胜率 · {{ fmtGames(st.games) }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- 召唤师技能 -->
              <div v-if="currentBuild.summonerSpells.length" class="dual-col-card">
                <div class="build-block-title">
                  <Flame :size="14" />
                  <span>召唤师技能组合</span>
                </div>
                <div class="spells-list">
                  <div
                    v-for="(sp, spi) in currentBuild.summonerSpells.slice(0, 3)"
                    :key="spi"
                    class="spell-row"
                  >
                    <div class="spell-icons">
                      <img
                        v-for="(sid, sidx) in sp.summonerSpellIds"
                        :key="`${sid}-${sidx}`"
                        :src="spellSrc(sid)"
                        :alt="spellName(sid)"
                        :title="spellName(sid)"
                        loading="lazy"
                      />
                    </div>
                    <span class="spell-meta">
                      {{ pct(sp.winRate) }} 胜率 · 选取 {{ pct(sp.pickRate) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 4. 技能加点推荐 -->
            <div v-if="currentBuild.skillOrders.length" class="build-block">
              <div class="build-block-title">
                <Activity :size="14" />
                <span>技能加点推荐</span>
              </div>
              <div class="skills-list d-skills">
                <div
                  v-for="(so, soi) in currentBuild.skillOrders.slice(0, 2)"
                  :key="soi"
                  class="skill-ladder-row d-skillline"
                >
                  <span class="skill-summary-badge d-sksum">{{ skillSummary(so.skillKeys) }}</span>
                  <div class="skillbar">
                    <i
                      v-for="(k, ki) in so.skillKeys"
                      :key="ki"
                      :class="`k-${k.toLowerCase()}`"
                      :title="`第 ${ki + 1} 级点 ${k}`"
                    >
                      {{ k }}
                    </i>
                  </div>
                  <span class="skill-meta d-skmeta">
                    {{ pct(so.winRate) }} 胜率 · 选取 {{ pct(so.pickRate) }}
                  </span>
                </div>
              </div>
            </div>

            <!-- 5. 针对性情境装备 -->
            <div v-if="situationals(currentBuild).length" class="build-block">
              <div class="build-block-title">
                <Sparkles :size="14" />
                <span>针对性情境装备</span>
              </div>
              <div class="d-sits-grid">
                <div
                  v-for="s in situationals(currentBuild).slice(0, 12)"
                  :key="s.id"
                  class="sit-card"
                  :title="`${itemName(s.id)}（差异化分 ${s.distinctiveScore.toFixed(1)}）`"
                >
                  <img :src="itemSrc(s.id)" :alt="itemName(s.id)" loading="lazy" />
                  <span class="sit-name">{{ itemName(s.id) }}</span>
                  <span class="sit-score">+{{ s.distinctiveScore.toFixed(1) }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * MayhemChampionDetail —— 大乱斗英雄详情子页（feature-expansion-plan A1 Tab3）
 * 数据：champion-shards 单英雄条目（推荐强化/TOP组合/多流派出装/召唤师技能/加点/延伸件）。
 * 图标走本地资产协议；名称用 get_asset_details 预载，失败回退远端 CDN / id 占位。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Activity,
  ArrowRight,
  Check,
  Copy,
  Flame,
  LayoutGrid,
  List,
  Shield,
  Sparkles,
  Swords,
  Zap
} from 'lucide-vue-next'

import PageStage from '../components/ui/PageStage.vue'
import { invoke } from '@tauri-apps/api/core'
import { assetPrefix } from '../services/http'
import { useRecordAssets } from '../composables/useRecordAssets'
import {
  buildBalanceTags,
  type AramBalanceData,
  type BalanceTag
} from '../composables/useAramBalance'
import {
  getMayhemChampionDetail,
  type ChampionDetailEntry,
  type ItemExtension,
  type MayhemBuild,
  type SituationalItem
} from '../features/mayhem/services/mayhemData'
import { useMayhemStore } from '../features/mayhem/stores/mayhemStore'
import { getAramChampionBuilds, type AramChampionBuilds } from '@renderer/services/opgg'
import { isBootItem } from '@renderer/utils/item'

const ROLE_LABELS: Record<string, string> = {
  tank: '坦克',
  fighter: '战士',
  assassin: '刺客',
  mage: '法师',
  marksman: '射手',
  support: '辅助'
}

const RARITY_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'prismatic', label: '棱彩' },
  { key: 'gold', label: '黄金' },
  { key: 'silver', label: '白银' }
]

const route = useRoute()
const router = useRouter()
const assets = useRecordAssets()
const mayhemStore = useMayhemStore()

const detail = ref<ChampionDetailEntry | null>(null)
const loading = ref(false)
const error = ref('')
const activeRarity = ref('all')
const activeBuildIndex = ref(0)
const copySuccess = ref(false)

/** 强化列表模式与排序 */
const augViewMode = ref<'list' | 'grid'>('list')
const augSortKey = ref<'winRate' | 'score' | 'pickRate'>('winRate')
const augSortOrder = ref<'desc' | 'asc'>('desc')

function toggleAugSort(key: 'winRate' | 'score' | 'pickRate') {
  if (augSortKey.value === key) {
    augSortOrder.value = augSortOrder.value === 'desc' ? 'asc' : 'desc'
  } else {
    augSortKey.value = key
    augSortOrder.value = 'desc'
  }
}

/** 大乱斗平衡参数（fandom 口径，450/2400 共用同一套修正） */
const balanceTags = ref<BalanceTag[]>([])

const championId = computed(() => Number.parseInt(String(route.params.id ?? ''), 10))

const heroTitle = computed(() => (detail.value ? `${detail.value.champion.title} · 大乱斗` : '…'))
const heroSub = computed(() =>
  detail.value ? `${detail.value.champion.name} · ${detail.value.champion.alias}` : ''
)
const tier = computed(() => clampTier(detail.value?.champion.stats.tier ?? 5))
const heroWinRate = computed(() => detail.value?.champion.stats.winRate ?? null)
const dateText = computed(() => {
  const d = detail.value?.champion.stats.date
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(5) : (d ?? '')
})

/** 详情页强化：按稀有度筛选，自采胜率/评分/选取率动态排序 */
const sortedFilteredAugments = computed(() => {
  const list = detail.value?.augments ?? []
  const filtered = list.filter(
    a => activeRarity.value === 'all' || a.rarityName === activeRarity.value
  )
  const isDesc = augSortOrder.value === 'desc'

  return [...filtered].sort((a, b) => {
    let valA = 0
    let valB = 0
    if (augSortKey.value === 'winRate') {
      valA = a.stats.winRate ?? -1
      valB = b.stats.winRate ?? -1
    } else if (augSortKey.value === 'score') {
      valA = augHexScore(a)
      valB = augHexScore(b)
    } else if (augSortKey.value === 'pickRate') {
      valA = a.stats.pickRate ?? 0
      valB = b.stats.pickRate ?? 0
    }
    return isDesc ? valB - valA : valA - valB
  })
})

const trios = computed(() => detail.value?.augmentTrios ?? [])
const builds = computed<MayhemBuild[]>(() => detail.value?.builds ?? [])
const currentBuild = computed<MayhemBuild | null>(
  () => builds.value[activeBuildIndex.value] ?? builds.value[0] ?? null
)

const minGamesText = computed(() => {
  const first = detail.value?.augments.find(a => a.stats.winRateMinimumGames != null)
  return String(first?.stats.winRateMinimumGames ?? 255)
})

function goBack() {
  void router.push({ name: 'Mayhem' })
}

function pct(v: number | null | undefined): string {
  if (v == null) return '--'
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

function clampTier(v: number): number {
  return Math.min(Math.max(v, 1), 5)
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

function perkSrc(id: number): string {
  return `${assetPrefix}/perk/${id}`
}

function itemSrc(id: number): string {
  return id > 0 ? `${assetPrefix}/item/${id}` : ''
}

function spellSrc(id: number): string {
  return id > 0 ? `${assetPrefix}/spell/${id}` : ''
}

function augNameOf(id: number): string {
  return assets.detailOf('perk', id)?.name ?? `强化 #${id}`
}

function augDescOf(id: number): string {
  const raw = assets.detailOf('perk', id)?.description ?? ''
  return raw.replace(/<[^>]*>/g, '').trim()
}

function itemName(id: number): string {
  return assets.detailOf('item', id)?.name ?? `装备 #${id}`
}

function spellName(id: number): string {
  return assets.detailOf('spell', id)?.name ?? `技能 #${id}`
}

type DetailAugment = ChampionDetailEntry['augments'][number]

function augTooltip(id: number): string {
  const a = assets.detailOf('perk', id)
  return a?.description || a?.name || `强化 #${id}`
}

function augDelta(a: DetailAugment): number {
  if (a.stats.winRate == null) return 0
  const base = heroWinRate.value ?? 0.5
  return a.stats.winRate - base
}

function augHexScore(a: DetailAugment): number {
  const delta = augDelta(a)
  const games = a.stats.games ?? a.stats.winRateMinimumGames ?? 255
  const sampleBonus = Math.min(Math.log10(games + 1) * 6, 25)
  const score = Math.min(99.9, Math.max(25.0, 50.0 + delta * 450 + (sampleBonus - 10)))
  return Number(score.toFixed(1))
}

function fallbackIcon(ev: Event, remoteUrl?: string) {
  applyFallback(ev, remoteUrl)
}

function hideIcon(ev: Event) {
  applyFallback(ev, undefined)
}

function applyFallback(ev: Event, remoteUrl?: string) {
  const img = ev.target as HTMLImageElement | null
  if (!img) return
  if (!remoteUrl) {
    img.style.display = 'none'
    return
  }
  if (img.dataset.fallback === remoteUrl) return
  img.dataset.fallback = remoteUrl
  img.src = remoteUrl
}

function situationals(b: MayhemBuild): SituationalItem[] {
  return [...(b.situationalItems ?? [])].sort((x, y) => y.distinctiveScore - x.distinctiveScore)
}

/** 核心出装链（严格排除鞋子并补齐 3 件套） */
function getCoreBuildItems(b?: MayhemBuild | null): number[] {
  if (!b) return []
  const nonBootIds = (b.coreItems?.[0]?.itemIds ?? []).filter(id => !isBootItem(id))
  if (nonBootIds.length >= 3) return nonBootIds.slice(0, 3)
  const ext = (b.itemExtensions ?? []).find(e =>
    e.itemIds?.some(id => !isBootItem(id) && !nonBootIds.includes(id))
  )
  const third = ext?.itemIds?.find(id => !isBootItem(id) && !nonBootIds.includes(id))
  return third ? [...nonBootIds, third] : nonBootIds
}

function topExtensions(b: MayhemBuild): ItemExtension[] {
  const map = new Map<number, ItemExtension>()
  const primaryCoreIds = new Set<number>(getCoreBuildItems(b))

  for (const ext of b.itemExtensions ?? []) {
    const itemId = ext.itemIds.find(id => !isBootItem(id))
    if (!itemId || primaryCoreIds.has(itemId)) continue
    const existing = map.get(itemId)
    if (!existing) {
      map.set(itemId, { ...ext, itemIds: [itemId] })
    } else {
      const totalGames = existing.games + ext.games
      const totalWins =
        (existing.wins ?? Math.round(existing.winRate * existing.games)) +
        (ext.wins ?? Math.round(ext.winRate * ext.games))
      existing.games = totalGames
      existing.wins = totalWins
      existing.winRate = totalGames > 0 ? totalWins / totalGames : existing.winRate
    }
  }

  return Array.from(map.values()).sort((x, y) => y.games - x.games)
}

function buildTitle(b: MayhemBuild, index: number): string {
  const tag = Object.values(b.tags ?? {})[0]
  return tag || `流派 ${index + 1}`
}

function fmtGames(games: number): string {
  return games >= 10000 ? `${(games / 10000).toFixed(1)}万场` : `${games}场`
}

/** 主副系摘要：首个主点技能为主系，随后第一个非 R 技能为副系，如 "主W·副Q" */
function skillSummary(keys: string[]): string {
  const main = keys[0] ?? 'Q'
  let second = ''
  for (const k of keys) {
    if (k !== main && k !== 'R') {
      second = k
      break
    }
  }
  return `主${main}${second ? `·副${second}` : ''}`
}

function onCopyReport() {
  if (!detail.value || !currentBuild.value) return
  const c = detail.value.champion
  const b = currentBuild.value
  const coreNames = getCoreBuildItems(b)
    .map(id => itemName(id))
    .join(' + ')
  const text = `【${c.name} · ${c.title}】大乱斗实战指南
全服胜率：${pct(c.stats.winRate)} | 选用率：${pct(c.stats.pickRate)}
推荐流派：${buildTitle(b, activeBuildIndex.value)}
核心三件套：${coreNames || '无'}
技能加点：${b?.skillOrders[0] ? skillSummary(b.skillOrders[0].skillKeys) : '主 Q 副 E'}`

  navigator.clipboard?.writeText(text).then(() => {
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  })
}

/** 收集本页所有图标 id，按类型一次性预载名称 */
function preloadNames(entry: ChampionDetailEntry) {
  const perkIds = new Set<number>()
  const itemIds = new Set<number>()
  const spellIds = new Set<number>()

  for (const a of entry.augments) perkIds.add(a.id)
  for (const t of entry.augmentTrios ?? []) for (const id of t.augmentIds) perkIds.add(id)

  const collectBuild = (b: MayhemBuild) => {
    for (const cs of [...(b.coreItems ?? []), ...(b.fullItems ?? [])]) {
      for (const id of cs.itemIds) itemIds.add(id)
    }
    for (const st of b.startingItems ?? []) for (const id of st.itemIds) itemIds.add(id)
    for (const s of b.situationalItems ?? []) itemIds.add(s.id)
    for (const ex of b.itemExtensions ?? []) {
      for (const id of ex.coreItemIds) itemIds.add(id)
      for (const id of ex.itemIds) itemIds.add(id)
    }
    for (const sp of b.summonerSpells ?? []) for (const id of sp.summonerSpellIds) spellIds.add(id)
  }
  for (const b of entry.builds ?? []) collectBuild(b)

  assets.preload([
    { kind: 'perk', ids: [...perkIds] },
    { kind: 'item', ids: [...itemIds] },
    { kind: 'spell', ids: [...spellIds] }
  ])
}

async function load() {
  if (!championId.value || Number.isNaN(championId.value)) {
    error.value = '无效的英雄 ID'
    return
  }
  loading.value = true
  error.value = ''
  try {
    detail.value = await mayhemStore.getChampionDetail(championId.value)
    if (!detail.value) {
      detail.value = await getMayhemChampionDetail(championId.value)
    }
    if (detail.value) {
      preloadNames(detail.value)
      const balance = await invoke<AramBalanceData | null>('get_aram_balance', {
        id: championId.value
      }).catch(() => null)
      balanceTags.value = buildBalanceTags(balance)

      // 🌟 深度数据融合：若狂暴大乱斗数据中缺少加点时序或召唤师技能，自动通过 OP.GG ARAM 官方深度库融合
      const opggAram = (await getAramChampionBuilds(championId.value).catch(
        () => null
      )) as AramChampionBuilds | null
      if (opggAram && detail.value.builds?.length) {
        for (const b of detail.value.builds) {
          if (!b.skillOrders?.length && opggAram.skillMasteries?.length) {
            b.skillOrders = opggAram.skillMasteries.map(
              (sm: { ids: string[]; play: number; win: number; pickRate: number }) => ({
                skillOrder: sm.ids.map((k: string) =>
                  k === 'Q' ? 1 : k === 'W' ? 2 : k === 'E' ? 3 : 4
                ),
                skillKeys: sm.ids,
                games: Number(sm.play),
                wins: Number(sm.win),
                winRate: sm.win / Math.max(sm.play, 1),
                pickRate: sm.pickRate
              })
            )
          }
          if (!b.summonerSpells?.length && opggAram.summonerSpells?.length) {
            b.summonerSpells = opggAram.summonerSpells.map(
              (ss: { ids: number[]; play: number; win: number; pickRate: number }) => ({
                summonerSpellIds: ss.ids,
                games: Number(ss.play),
                wins: Number(ss.win),
                winRate: ss.win / Math.max(ss.play, 1),
                pickRate: ss.pickRate
              })
            )
          }
          if (!b.startingItems?.length && opggAram.starterItems?.length) {
            b.startingItems = opggAram.starterItems.map(
              (st: { ids: number[]; play: number; win: number; pickRate: number }) => ({
                itemIds: st.ids,
                games: Number(st.play),
                wins: Number(st.win),
                winRate: st.win / Math.max(st.play, 1),
                pickRate: st.pickRate
              })
            )
          }
        }
      }
    } else {
      error.value = '暂未查询到该英雄的大乱斗数据（可能尚未同步或上游未覆盖）'
    }
  } catch (e) {
    error.value = `读取英雄详情失败：${String(e)}`
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped src="./MayhemChampionDetail.styles.css"></style>
