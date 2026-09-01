<script setup lang="ts">
/**
 * 选人期 & 对局期狂暴大乱斗助手面板（QueueId 2400）。
 *
 * 深度打通大乱斗矩阵页面数据：
 * 1. 板凳席与手牌候选英雄：T1~T5 官方评级、全服胜率、个人战绩、平衡性 Buff/Nerf 调整。
 * 2. 阵容缺口智能诊断（前排/AD/AP/控制缺口）。
 * 3. 选中英雄即时展开大乱斗出装方案（核心出装链、去重延伸神装、出门装、召唤师技能、技能加点、天胡三强化）。
 * 4. 支持一键复制指南与跳转大乱斗矩阵看板。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { invoke } from '@tauri-apps/api/core'
import {
  Activity,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Flame,
  Shield,
  Swords
} from 'lucide-vue-next'
import { useMessage } from 'naive-ui'

import { assetPrefix } from '@renderer/services/http'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import {
  buildBalanceTags,
  type BalanceTag,
  type AramBalanceData
} from '@renderer/composables/useAramBalance'
import {
  extractMayhemChampions,
  getMayhemChampions,
  getMyChampionStats,
  getMayhemChampionDetail,
  type MayhemChampion,
  type MyChampionStat,
  type ChampionDetailEntry,
  type MayhemBuild,
  type ItemExtension
} from '@renderer/features/mayhem/services/mayhemData'
import {
  compositionGaps,
  scoreBench,
  type BenchEntry,
  type ChampMetaMap
} from '@renderer/features/mayhem/draft'
import { isBootItem } from '@renderer/utils/item'

interface DraftContext {
  queueId: number | null
  localCellId: number
  myTeam: Array<{ championId: number; cellId: number; selectedPosition?: string }>
  bench: number[]
}

export interface SessionPlayerFallback {
  championId: number
  summoner?: { puuid?: string }
}

const props = defineProps<{
  queueId?: number
  myPuuid?: string
  myTeam?: SessionPlayerFallback[]
}>()

const MAYHEM_QUEUE_IDS = [2400, 2410, 2450]

const router = useRouter()
const message = useMessage()
const assets = useRecordAssets()

const ctx = ref<DraftContext | null>(null)
const champions = ref<MayhemChampion[]>([])
const myRecords = ref<Record<number, MyChampionStat>>({})
const selectedChampionId = ref<number | null>(null)
const championDetail = ref<ChampionDetailEntry | null>(null)
const detailLoading = ref(false)
const balanceTagsMap = ref<Record<number, BalanceTag[]>>({})
const copySuccess = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const metaMap = computed<ChampMetaMap>(() => {
  const map: ChampMetaMap = {}
  for (const c of champions.value) {
    map[c.id] = { tier: c.stats.tier, roles: c.roles }
  }
  return map
})

const isMayhem = computed(
  () =>
    MAYHEM_QUEUE_IDS.includes(ctx.value?.queueId ?? 0) ||
    MAYHEM_QUEUE_IDS.includes(props.queueId ?? 0)
)

const myHandChampionId = computed<number>(() => {
  if (ctx.value?.myTeam?.length) {
    const me = ctx.value.myTeam.find(p => p.cellId === ctx.value?.localCellId)
    if (me?.championId) return me.championId
  }
  // 回退至 Gaming 视图传入的 sessionData
  if (props.myTeam?.length && props.myPuuid) {
    const me = props.myTeam.find(p => p.summoner?.puuid === props.myPuuid)
    if (me?.championId) return me.championId
  }
  return 0
})

const lockedTeamIds = computed(() => {
  if (ctx.value?.myTeam?.length) {
    const ids = ctx.value.myTeam.filter(p => p.championId > 0).map(p => p.championId)
    if (ids.length) return ids
  }
  if (props.myTeam?.length) {
    return props.myTeam.filter(p => (p.championId ?? 0) > 0).map(p => p.championId)
  }
  return []
})

/** 阵容缺口（按已选/已锁定英雄计算） */
const gaps = computed(() =>
  isMayhem.value ? compositionGaps(lockedTeamIds.value, metaMap.value) : null
)

const benchEntries = computed<BenchEntry[]>(() =>
  isMayhem.value ? scoreBench(ctx.value?.bench ?? [], metaMap.value, toMine(myRecords.value)) : []
)

function toMine(recs: Record<number, MyChampionStat>) {
  const out: Record<number, { games: number; wins: number }> = {}
  for (const [id, r] of Object.entries(recs)) out[Number(id)] = { games: r.games, wins: r.wins }
  return out
}

function champData(id: number): MayhemChampion | undefined {
  return champions.value.find(x => x.id === id)
}

function champName(id: number): string {
  const c = champData(id)
  return c ? `${c.title}` : `英雄 #${id}`
}

function champIcon(id: number): string {
  return `${assetPrefix}/champion/${id}`
}

function pct(v: number | null | undefined): string {
  if (v == null) return '--%'
  const abs = Math.abs(v)
  const text = (abs * 100).toFixed(abs >= 0.1 ? 1 : 2)
  return v < 0 ? `-${text}%` : `${text}%`
}

function fmtGames(games: number): string {
  return games >= 10000 ? `${(games / 10000).toFixed(1)}万` : `${games}`
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

function itemName(id: number): string {
  return assets.detailOf('item', id)?.name ?? `装备 #${id}`
}

function spellName(id: number): string {
  return assets.detailOf('spell', id)?.name ?? `技能 #${id}`
}

function augNameOf(id: number): string {
  return assets.detailOf('perk', id)?.name ?? `强化 #${id}`
}

function tierBadgeClass(tier: number | null | undefined): string {
  if (!tier) return 'tier-none'
  return `tier-t${tier}`
}

/** 核心出装链（严格排除鞋子） */
function getCoreBuildItems(b?: MayhemBuild): number[] {
  if (!b) return []
  const nonBootIds = (b.coreItems?.[0]?.itemIds ?? []).filter(id => !isBootItem(id))
  if (nonBootIds.length >= 3) return nonBootIds.slice(0, 3)
  const ext = (b.itemExtensions ?? []).find(e =>
    e.itemIds?.some(id => !isBootItem(id) && !nonBootIds.includes(id))
  )
  const third = ext?.itemIds?.find(id => !isBootItem(id) && !nonBootIds.includes(id))
  return third ? [...nonBootIds, third] : nonBootIds
}

/** 延伸装备去重聚合（严格排除鞋子） */
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

async function loadDetail(championId: number) {
  if (!championId) {
    championDetail.value = null
    return
  }
  detailLoading.value = true
  try {
    const d = await getMayhemChampionDetail(championId)
    championDetail.value = d
    if (d) {
      const itemIds = new Set<number>()
      const perkIds = new Set<number>()
      const spellIds = new Set<number>()
      for (const b of d.builds ?? []) {
        for (const cs of b.coreItems ?? []) for (const id of cs.itemIds) itemIds.add(id)
        for (const st of b.startingItems ?? []) for (const id of st.itemIds) itemIds.add(id)
        for (const ex of b.itemExtensions ?? []) for (const id of ex.itemIds) itemIds.add(id)
        for (const sp of b.summonerSpells ?? [])
          for (const id of sp.summonerSpellIds) spellIds.add(id)
      }
      for (const t of d.augmentTrios ?? []) for (const id of t.augmentIds) perkIds.add(id)
      assets.preload([
        { kind: 'item', ids: [...itemIds] },
        { kind: 'perk', ids: [...perkIds] },
        { kind: 'spell', ids: [...spellIds] }
      ])
    }
  } catch {
    championDetail.value = null
  } finally {
    detailLoading.value = false
  }
}

async function loadBalanceTag(id: number) {
  if (!id || balanceTagsMap.value[id]) return
  try {
    const rawBalance = await invoke<AramBalanceData | null>('get_aram_balance', { id }).catch(
      () => null
    )
    balanceTagsMap.value[id] = buildBalanceTags(rawBalance)
  } catch {
    balanceTagsMap.value[id] = []
  }
}

function selectHero(id: number) {
  if (selectedChampionId.value === id) {
    selectedChampionId.value = null
  } else {
    selectedChampionId.value = id
    void loadDetail(id)
    void loadBalanceTag(id)
  }
}

function openMayhemDetail(id?: number) {
  const targetId = id || selectedChampionId.value || myHandChampionId.value
  if (targetId) {
    void router.push({ path: `/Mayhem/champion/${targetId}` })
  } else {
    void router.push('/Mayhem')
  }
}

function copyGuide() {
  if (!championDetail.value) return
  const c = championDetail.value.champion
  const b = championDetail.value.builds?.[0]
  const coreNames = getCoreBuildItems(b)
    .map(id => itemName(id))
    .join(' + ')
  const text = `【${c.name} · ${c.title}】狂暴大乱斗指南
全服胜率：${pct(c.stats.winRate)} | 选用率：${pct(c.stats.pickRate)}
核心三件套：${coreNames || '无'}
加点路线：${b?.skillOrders[0] ? skillSummary(b.skillOrders[0].skillKeys) : '主 Q 副 E'}`

  navigator.clipboard?.writeText(text).then(() => {
    copySuccess.value = true
    message.success('已复制大乱斗配置指南')
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  })
}

async function poll() {
  try {
    const data = (await invoke('mayhem_draft_context')) as DraftContext | null
    ctx.value = data
    if (isMayhem.value) {
      if (!champions.value.length) {
        void loadMeta()
      }
      if (myHandChampionId.value && !selectedChampionId.value) {
        selectedChampionId.value = myHandChampionId.value
        void loadDetail(myHandChampionId.value)
        void loadBalanceTag(myHandChampionId.value)
      }
      if (data?.bench?.length) {
        for (const bid of data.bench) void loadBalanceTag(bid)
      }
    }
  } catch {
    /* LCU 离线 */
  }
}

async function loadMeta() {
  try {
    const [champRes] = await Promise.all([
      getMayhemChampions(),
      getMyChampionStats().then(
        stats => (myRecords.value = Object.fromEntries(stats.map(s => [s.championId, s]))),
        () => {}
      )
    ])
    champions.value = extractMayhemChampions(champRes)
  } catch {
    /* 元数据兜底 */
  }
}

watch(myHandChampionId, newId => {
  if (newId && !selectedChampionId.value) {
    selectedChampionId.value = newId
    void loadDetail(newId)
    void loadBalanceTag(newId)
  }
})

onMounted(() => {
  void poll()
  timer = setInterval(() => void poll(), 2_000)
})

onUnmounted(() => {
  if (timer != null) clearInterval(timer)
})
</script>

<template>
  <div v-if="isMayhem" class="mayhem-draft-panel">
    <!-- 头部：狂暴大乱斗专属标识与阵容诊断 -->
    <div class="mdp-header">
      <div class="mdp-title-wrap">
        <span class="mdp-tag">MAYHEM 2400</span>
        <span class="mdp-title">狂暴大乱斗 · 实战与出装矩阵</span>
      </div>
      <div
        class="mdp-gaps-badge"
        :class="{ 'mdp-gaps-badge--warn': gaps && gaps.sentence !== '阵容均衡' }"
      >
        <Shield v-if="gaps?.sentence === '阵容均衡'" :size="13" />
        <Activity v-else :size="13" />
        <span>{{ gaps?.sentence ?? '阵容分析中…' }}</span>
      </div>
      <button class="mdp-matrix-link" @click="openMayhemDetail()">
        <ExternalLink :size="13" />
        <span>大乱斗数据中心</span>
      </button>
    </div>

    <!-- 英雄选人池（手牌 + 板凳席候选） -->
    <div class="mdp-roster-row">
      <!-- 我的手牌英雄 -->
      <div v-if="myHandChampionId" class="mdp-hand-group">
        <span class="mdp-group-label">我的当前手牌</span>
        <div
          class="mdp-card mdp-card--hand"
          :class="{ active: selectedChampionId === myHandChampionId }"
          @click="selectHero(myHandChampionId)"
        >
          <div class="mdp-card-avatar-wrap">
            <img
              :src="champIcon(myHandChampionId)"
              :alt="champName(myHandChampionId)"
              class="mdp-avatar"
            />
            <span
              v-if="champData(myHandChampionId)?.stats.tier"
              class="mdp-tier-badge"
              :class="tierBadgeClass(champData(myHandChampionId)?.stats.tier)"
            >
              T{{ champData(myHandChampionId)?.stats.tier }}
            </span>
          </div>
          <div class="mdp-card-info">
            <div class="mdp-card-name-row">
              <span class="mdp-card-name">{{ champName(myHandChampionId) }}</span>
              <span class="mdp-card-hand-tag">当前选择</span>
            </div>
            <div class="mdp-card-meta-row">
              <span class="mdp-card-winrate">
                胜率 {{ pct(champData(myHandChampionId)?.stats.winRate) }}
              </span>
              <span v-if="myRecords[myHandChampionId]?.games" class="mdp-card-myrecord">
                我的
                {{ pct(myRecords[myHandChampionId].wins / myRecords[myHandChampionId].games) }} ({{
                  myRecords[myHandChampionId].games
                }}场)
              </span>
            </div>
          </div>
          <!-- 平衡性标签 -->
          <div v-if="balanceTagsMap[myHandChampionId]?.length" class="mdp-balance-tags">
            <span
              v-for="b in balanceTagsMap[myHandChampionId]"
              :key="b.label"
              class="mdp-balance-chip"
              :class="b.isBuff ? 'buff' : 'nerf'"
              :title="b.desc"
            >
              {{ b.label }}
            </span>
          </div>
        </div>
      </div>

      <!-- 板凳席候选英雄池 -->
      <div v-if="benchEntries.length" class="mdp-bench-group">
        <span class="mdp-group-label">板凳席备选推荐 (高分优先)</span>
        <div class="mdp-bench-scroll">
          <div
            v-for="e in benchEntries"
            :key="e.championId"
            class="mdp-card mdp-card--bench"
            :class="{ active: selectedChampionId === e.championId }"
            :title="e.reasons.join(' · ')"
            @click="selectHero(e.championId)"
          >
            <div class="mdp-card-avatar-wrap">
              <img
                :src="champIcon(e.championId)"
                :alt="champName(e.championId)"
                class="mdp-avatar"
              />
              <span
                v-if="champData(e.championId)?.stats.tier"
                class="mdp-tier-badge"
                :class="tierBadgeClass(champData(e.championId)?.stats.tier)"
              >
                T{{ champData(e.championId)?.stats.tier }}
              </span>
            </div>
            <div class="mdp-card-info">
              <div class="mdp-card-name-row">
                <span class="mdp-card-name">{{ champName(e.championId) }}</span>
                <span class="mdp-card-score">{{ e.score }}分</span>
              </div>
              <div class="mdp-card-meta-row">
                <span class="mdp-card-winrate">
                  胜率 {{ pct(champData(e.championId)?.stats.winRate) }}
                </span>
                <span v-if="myRecords[e.championId]?.games" class="mdp-card-myrecord">
                  我的 {{ pct(myRecords[e.championId].wins / myRecords[e.championId].games) }}
                </span>
              </div>
            </div>
            <div v-if="balanceTagsMap[e.championId]?.length" class="mdp-balance-tags">
              <span
                v-for="b in balanceTagsMap[e.championId]"
                :key="b.label"
                class="mdp-balance-chip"
                :class="b.isBuff ? 'buff' : 'nerf'"
                :title="b.desc"
              >
                {{ b.label }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 选中英雄的大乱斗专属出装与符文即时预览 -->
    <div v-if="selectedChampionId && championDetail" class="mdp-detail-section">
      <div class="mdp-detail-header">
        <div class="mdp-detail-hero-brief">
          <img
            :src="champIcon(selectedChampionId)"
            :alt="champName(selectedChampionId)"
            class="mdp-detail-hero-avatar"
          />
          <div class="mdp-detail-hero-texts">
            <div class="mdp-detail-hero-title">
              <strong
                >{{ championDetail.champion.name }} · {{ championDetail.champion.title }}</strong
              >
              <span
                v-if="championDetail.champion.stats.tier"
                class="mdp-tier-badge"
                :class="tierBadgeClass(championDetail.champion.stats.tier)"
              >
                T{{ championDetail.champion.stats.tier }}
              </span>
              <span class="mdp-detail-hero-wr"
                >全服胜率 {{ pct(championDetail.champion.stats.winRate) }}</span
              >
              <span class="mdp-detail-hero-pr"
                >选用 {{ pct(championDetail.champion.stats.pickRate) }}</span
              >
            </div>
            <div class="mdp-detail-hero-sub">
              <span
                >流派：{{
                  championDetail.builds?.[0]?.tags
                    ? Object.values(championDetail.builds[0].tags)[0]
                    : '默认推荐'
                }}</span
              >
              <span>场次：{{ fmtGames(championDetail.builds?.[0]?.stats.games ?? 0) }}</span>
            </div>
          </div>
        </div>
        <div class="mdp-detail-actions">
          <button class="mdp-btn mdp-btn--copy" @click="copyGuide">
            <Check v-if="copySuccess" :size="13" />
            <Copy v-else :size="13" />
            <span>{{ copySuccess ? '已复制' : '复制指南' }}</span>
          </button>
          <button class="mdp-btn mdp-btn--matrix" @click="openMayhemDetail(selectedChampionId)">
            <ExternalLink :size="13" />
            <span>英雄详情</span>
          </button>
        </div>
      </div>

      <!-- 出装推荐区：核心链 + 延伸神装 + 出门装 + 召唤师技能 + 天胡三强化 -->
      <div v-if="championDetail.builds?.[0]" class="mdp-builds-grid">
        <!-- 核心出装链 -->
        <div class="mdp-build-col">
          <div class="mdp-col-label"><Swords :size="13" /> 核心出装链</div>
          <div class="mdp-core-items-row">
            <template
              v-for="(id, idx) in getCoreBuildItems(championDetail.builds[0])"
              :key="`${id}-${idx}`"
            >
              <div class="mdp-item-slot" :title="itemName(id)">
                <img :src="itemSrc(id)" :alt="itemName(id)" loading="lazy" />
              </div>
              <ChevronRight
                v-if="idx < getCoreBuildItems(championDetail.builds[0]).length - 1"
                class="mdp-arrow"
              />
            </template>
            <span class="mdp-core-wr">
              {{ pct(championDetail.builds[0].coreItems?.[0]?.winRate) }} 胜率
            </span>
          </div>

          <!-- 后续顺势延伸神装（已去重） -->
          <div v-if="topExtensions(championDetail.builds[0]).length" class="mdp-extensions-row">
            <span class="mdp-sub-label">延伸推荐：</span>
            <div class="mdp-ext-slots">
              <div
                v-for="(ext, ei) in topExtensions(championDetail.builds[0]).slice(0, 5)"
                :key="ei"
                class="mdp-item-slot mdp-item-slot--sm"
                :title="`${itemName(ext.itemIds[0])} · ${pct(ext.winRate)} 胜率 (${fmtGames(ext.games)}场)`"
              >
                <img
                  :src="itemSrc(ext.itemIds[0])"
                  :alt="itemName(ext.itemIds[0])"
                  loading="lazy"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- 出门装与技能加点 -->
        <div class="mdp-build-col">
          <div class="mdp-col-label"><Shield :size="13" /> 出门装 & 技能路线</div>
          <div class="mdp-starter-row">
            <div class="mdp-starter-icons">
              <img
                v-for="(id, idx) in championDetail.builds[0].startingItems?.[0]?.itemIds ?? []"
                :key="`${id}-${idx}`"
                :src="itemSrc(id)"
                :alt="itemName(id)"
                :title="itemName(id)"
                class="mdp-item-slot mdp-item-slot--sm"
                loading="lazy"
              />
            </div>
            <div class="mdp-spells-icons">
              <img
                v-for="(sid, sidx) in championDetail.builds[0].summonerSpells?.[0]
                  ?.summonerSpellIds ?? []"
                :key="`${sid}-${sidx}`"
                :src="spellSrc(sid)"
                :alt="spellName(sid)"
                :title="spellName(sid)"
                class="mdp-spell-slot"
                loading="lazy"
              />
            </div>
          </div>
          <div v-if="championDetail.builds[0].skillOrders?.[0]" class="mdp-skill-summary">
            <span
              >加点：<strong>{{
                skillSummary(championDetail.builds[0].skillOrders[0].skillKeys)
              }}</strong></span
            >
            <span class="mdp-skill-wr"
              >{{ pct(championDetail.builds[0].skillOrders[0].winRate) }} 胜率</span
            >
          </div>
        </div>

        <!-- 天胡三海克斯联动组合 -->
        <div v-if="championDetail.augmentTrios?.length" class="mdp-build-col mdp-build-col--trio">
          <div class="mdp-col-label"><Flame :size="13" /> 天胡海克斯 TOP 羁绊</div>
          <div class="mdp-trios-list">
            <div
              v-for="(trio, ti) in championDetail.augmentTrios.slice(0, 2)"
              :key="ti"
              class="mdp-trio-item"
            >
              <div class="mdp-trio-icons">
                <img
                  v-for="(aid, aidx) in trio.augmentIds"
                  :key="`${aid}-${aidx}`"
                  :src="perkSrc(aid)"
                  :alt="augNameOf(aid)"
                  :title="augNameOf(aid)"
                  class="mdp-trio-img"
                  loading="lazy"
                />
              </div>
              <div class="mdp-trio-meta">
                <span class="mdp-trio-wr">{{ pct(trio.stats.winRate) }} 胜率</span>
                <span class="mdp-trio-games">{{ fmtGames(trio.stats.games) }}场</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mayhem-draft-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
  padding: var(--space-12) var(--space-16);
  margin-bottom: var(--space-16);
  background: rgba(18, 22, 28, 0.55);
  border: 1px solid color-mix(in srgb, var(--brand-border) 65%, transparent);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}

.mdp-header {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  flex-wrap: wrap;
}

.mdp-title-wrap {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.mdp-tag {
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  font-size: 10px;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 4px;
  color: #1a1200;
  background: linear-gradient(135deg, var(--accent-gold), var(--accent-gold-deep));
  letter-spacing: 0.05em;
}

.mdp-title {
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: var(--text-primary);
}

.mdp-gaps-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 600;
  color: var(--semantic-win-bright);
  background: color-mix(in srgb, var(--semantic-win) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--semantic-win) 30%, transparent);
}

.mdp-gaps-badge--warn {
  color: #fbbf24;
  background: color-mix(in srgb, #f59e0b 14%, transparent);
  border-color: color-mix(in srgb, #f59e0b 35%, transparent);
}

.mdp-matrix-link {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: var(--radius-control);
  font-size: 11px;
  font-weight: 600;
  color: var(--accent-gold);
  background: color-mix(in srgb, var(--accent-gold) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-gold) 35%, transparent);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-expo);
}

.mdp-matrix-link:hover {
  background: color-mix(in srgb, var(--accent-gold) 22%, transparent);
  border-color: var(--accent-gold);
  transform: translateY(-1px);
}

.mdp-roster-row {
  display: flex;
  gap: var(--space-16);
  flex-wrap: wrap;
  align-items: flex-start;
}

.mdp-hand-group,
.mdp-bench-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.mdp-hand-group {
  flex-shrink: 0;
}

.mdp-bench-group {
  flex: 1;
  min-width: 0;
}

.mdp-group-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  letter-spacing: 0.02em;
}

.mdp-bench-scroll {
  display: flex;
  gap: var(--space-8);
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: thin;
}

.mdp-card {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: 6px 10px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid color-mix(in srgb, var(--border-subtle) 90%, transparent);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-expo);
  flex-shrink: 0;
}

.mdp-card:hover {
  background: rgba(255, 255, 255, 0.07);
  transform: translateY(-1px);
  border-color: var(--glass-bg-high);
}

.mdp-card.active {
  background: color-mix(in srgb, var(--accent-gold) 15%, transparent);
  border-color: var(--accent-gold);
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.25);
}

.mdp-card--hand {
  border-color: color-mix(in srgb, var(--accent-gold) 45%, transparent);
}

.mdp-card-avatar-wrap {
  position: relative;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
}

.mdp-avatar {
  width: 100%;
  height: 100%;
  border-radius: var(--radius-sm);
  object-fit: cover;
  border: 1px solid var(--border-subtle);
}

.mdp-tier-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  font-size: 9px;
  font-weight: 800;
  padding: 0 4px;
  height: 13px;
  line-height: 13px;
  border-radius: 3px;
  color: #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
}

.tier-t1 {
  background: linear-gradient(135deg, #f59e0b, #b45309);
}
.tier-t2 {
  background: linear-gradient(135deg, #a855f7, #6b21a8);
}
.tier-t3 {
  background: linear-gradient(135deg, #0ea5e9, #0369a1);
}
.tier-t4 {
  background: linear-gradient(135deg, #10b981, #047857);
}
.tier-t5,
.tier-none {
  background: linear-gradient(135deg, #64748b, #334155);
}

.mdp-card-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mdp-card-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mdp-card-name {
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: var(--text-primary);
}

.mdp-card-hand-tag {
  font-size: 9px;
  padding: 0 4px;
  border-radius: 2px;
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.2);
  border: 1px solid rgba(245, 158, 11, 0.4);
}

.mdp-card-score {
  font-size: 10px;
  font-weight: 700;
  color: var(--semantic-win-bright);
}

.mdp-card-meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
}

.mdp-card-winrate {
  color: var(--text-secondary);
}

.mdp-card-myrecord {
  color: var(--accent-gold);
  font-weight: 600;
}

.mdp-balance-tags {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-left: 2px;
}

.mdp-balance-chip {
  font-size: 8px;
  padding: 0 3px;
  border-radius: 2px;
  line-height: 11px;
}

.mdp-balance-chip.buff {
  color: #57d9a3;
  background: rgba(87, 217, 163, 0.18);
}

.mdp-balance-chip.nerf {
  color: #e07a7a;
  background: rgba(224, 122, 122, 0.18);
}

/* 详情抽屉/预览区 */
.mdp-detail-section {
  margin-top: var(--space-8);
  padding-top: var(--space-10);
  border-top: 1px dashed color-mix(in srgb, var(--border-subtle) 80%, transparent);
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
}

.mdp-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  flex-wrap: wrap;
}

.mdp-detail-hero-brief {
  display: flex;
  align-items: center;
  gap: var(--space-10);
}

.mdp-detail-hero-avatar {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--accent-gold);
}

.mdp-detail-hero-title {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  font-size: var(--font-size-sm);
}

.mdp-detail-hero-wr {
  color: var(--semantic-win-bright);
  font-weight: 700;
}

.mdp-detail-hero-pr {
  font-size: 11px;
  color: var(--text-tertiary);
}

.mdp-detail-hero-sub {
  font-size: 11px;
  color: var(--text-secondary);
  display: flex;
  gap: var(--space-10);
}

.mdp-detail-actions {
  display: flex;
  gap: var(--space-8);
}

.mdp-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--radius-control);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-expo);
}

.mdp-btn--copy {
  color: var(--text-primary);
  background: var(--glass-bg-low);
  border: 1px solid var(--border-subtle);
}

.mdp-btn--copy:hover {
  background: var(--glass-bg-high);
}

.mdp-btn--matrix {
  color: #1a1200;
  background: linear-gradient(135deg, var(--accent-gold), var(--accent-gold-deep));
  border: none;
}

.mdp-btn--matrix:hover {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.mdp-builds-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-12);
  background: rgba(0, 0, 0, 0.2);
  padding: var(--space-10) var(--space-12);
  border-radius: var(--radius-md);
  border: 1px solid color-mix(in srgb, var(--border-subtle) 60%, transparent);
}

.mdp-build-col {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.mdp-col-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-gold);
}

.mdp-core-items-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mdp-item-slot {
  width: 26px;
  height: 26px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  flex-shrink: 0;
}

.mdp-item-slot img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mdp-item-slot--sm {
  width: 22px;
  height: 22px;
}

.mdp-arrow {
  width: 12px;
  height: 12px;
  color: var(--text-tertiary);
}

.mdp-core-wr {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 700;
  color: var(--semantic-win-bright);
}

.mdp-extensions-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.mdp-sub-label {
  font-size: 10px;
  color: var(--text-tertiary);
}

.mdp-ext-slots {
  display: flex;
  gap: 4px;
}

.mdp-starter-row {
  display: flex;
  align-items: center;
  gap: var(--space-12);
}

.mdp-starter-icons,
.mdp-spells-icons {
  display: flex;
  gap: 4px;
}

.mdp-spell-slot {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  object-fit: cover;
  border: 1px solid var(--border-subtle);
}

.mdp-skill-summary {
  font-size: 11px;
  color: var(--text-secondary);
  display: flex;
  justify-content: space-between;
}

.mdp-skill-wr {
  color: var(--semantic-win-bright);
}

.mdp-trios-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mdp-trio-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.02);
}

.mdp-trio-icons {
  display: flex;
  gap: 4px;
}

.mdp-trio-img {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
}

.mdp-trio-meta {
  display: flex;
  gap: 6px;
  font-size: 10px;
}

.mdp-trio-wr {
  color: var(--semantic-win-bright);
  font-weight: 700;
}

.mdp-trio-games {
  color: var(--text-tertiary);
}
</style>
