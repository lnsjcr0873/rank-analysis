<template>
  <div v-if="game && mySummary" class="match-detail-inline">
    <div class="match-detail-page">
      <div class="match-detail-modal">
        <div class="match-detail-shell">
          <!-- Tab 栏：主组（概览/统计/符文/出装/时间线）+ 次组（事件/评分/回测，
               视觉弱化并加分隔——低频分析不与高频页签抢宽度，KeepAlive 保活 + 懒加载）。
               右侧操作区承接原展开头部的按钮（SGP 标/回放/AI/收起）——头部已按
               "统计进收起卡、按钮进页签行"合并去重删除。 -->
          <div class="match-detail-tabs">
            <div class="match-detail-tab-list" role="tablist">
              <template v-for="(tab, i) in tabs" :key="tab.key">
                <span
                  v-if="tab.minor && !(tabs[i - 1] && tabs[i - 1].minor)"
                  class="match-detail-tab-divider"
                  aria-hidden="true"
                ></span>
                <button
                  type="button"
                  role="tab"
                  class="match-detail-tab"
                  :class="{
                    'match-detail-tab--active': activeTab === tab.key,
                    'match-detail-tab--minor': tab.minor
                  }"
                  :aria-selected="activeTab === tab.key"
                  @click="activeTab = tab.key"
                >
                  {{ tab.label }}
                </button>
              </template>
            </div>

            <div class="match-detail-tab-actions">
              <n-tooltip v-if="dataSource.isCrossSgp" trigger="hover" placement="bottom-end">
                <template #trigger>
                  <span class="match-detail-source-pill">跨区 · SGP</span>
                </template>
                <span v-if="dataSource.missingGameVersion"
                  >本局目标区未返回版本号，回放可用性自动放行。</span
                >
                部分字段（如完整符文页、版本号）缺失时，相关子 Tab 均展示缺省提示，不会抛错。
              </n-tooltip>

              <n-tooltip trigger="hover" placement="bottom-end">
                <template #trigger>
                  <!--
                  进行中刻意不使用 :loading —— naive-ui Button 在 loading 态
                  根本不 emit click（Button.mjs:146），会让"进行中"意外等价于
                  "永久不可点"。这里只用 disabled 表达真正的不可用（客户端没开、
                  版本不符等），进行中靠 spin 图标与文案表达，语义不混。
                -->
                  <n-button
                    size="small"
                    secondary
                    class="match-detail-replay-button"
                    :disabled="!replay.canPlay.value"
                    @click="replay.play"
                  >
                    <template #icon>
                      <n-spin v-if="replay.busy.value" :size="14" />
                      <n-icon v-else><CirclePlay /></n-icon>
                    </template>
                    {{ replay.buttonLabel.value }}
                  </n-button>
                </template>
                {{ replay.disabledReason.value || '在游戏客户端中观看本局回放' }}
              </n-tooltip>

              <n-tooltip trigger="hover" placement="bottom-end">
                <template #trigger>
                  <!--
                  刻意不用 :loading —— naive-ui Button 在 loading 时根本不 emit click
                  （node_modules/naive-ui/es/button/src/Button.mjs:146），关掉面板后
                  就再也点不回来。进行中改用 spin 图标表达，按钮始终可点。
                -->
                  <n-button
                    size="small"
                    secondary
                    type="info"
                    class="match-detail-ai-button"
                    @click="onOverview"
                  >
                    <template #icon>
                      <n-spin v-if="ai.aiLoading.value" :size="14" />
                      <n-icon v-else><Sparkles /></n-icon>
                    </template>
                    AI 整局复盘
                  </n-button>
                </template>
                整局归因 + 单人责任分析
              </n-tooltip>

              <n-tooltip trigger="hover" placement="bottom-end">
                <template #trigger>
                  <n-button
                    size="small"
                    secondary
                    circle
                    class="match-detail-close-button"
                    @click="emit('close')"
                  >
                    <template #icon>
                      <n-icon><X /></n-icon>
                    </template>
                  </n-button>
                </template>
                收起详情
              </n-tooltip>
            </div>
          </div>

          <div class="match-detail-tab-pane">
            <KeepAlive :max="2">
              <component :is="activeTabComponent" />
            </KeepAlive>
          </div>

          <MatchAIPanel
            :show="ai.showAiModal.value"
            :mode="ai.aiMode.value"
            :target-participant-id="ai.aiTargetParticipantId.value"
            :loading="ai.aiLoading.value"
            :ai-loading="ai.aiLoading.value"
            :ai-state-label="ai.aiStateLabel.value"
            :report="ai.aiReport.value"
            :rendered-result="ai.renderedAiResult.value"
            :player-options="aiPlayerOptions"
            @update:show="ai.showAiModal.value = $event"
            @update:mode="ai.aiMode.value = $event"
            @update:target-participant-id="ai.aiTargetParticipantId.value = $event"
            @rerun="ai.runCurrentAiAnalysis"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, watch, onMounted, onUnmounted, toRef, provide } from 'vue'
import { CirclePlay, Sparkles, X } from 'lucide-vue-next'
import { NButton, NIcon, NTooltip } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'
import { useCopy } from '@renderer/composables/useCopy'

import { useTheme } from '@renderer/composables/useTheme'
import type { Game, ParticipantStats } from '@renderer/types/domain/match'
import type { Summoner } from '@renderer/types/domain/player'
import MatchAIPanel from './MatchAIPanel.vue'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import { useMatchDetailPlayers } from '@renderer/composables/useMatchDetailPlayers'
import { useMatchAIAnalysis } from '@renderer/composables/useMatchAIAnalysis'
import { useMatchReplay } from '@renderer/composables/useMatchReplay'
import { useMatchPlayerRanks } from '@renderer/composables/useMatchPlayerRanks'
import type { DetailPlayer } from '@renderer/composables/useMatchDetailPlayers'
import type { OneGamePlayer } from '@renderer/types/domain/analysis'
import { matchDetailContextKey, type SgpDetailStatus } from './matchDetailContext'
import { getSgpMatchDetail, type SgpGameDetail } from '@renderer/features/record/services/sgp'
import { resolveMatchDataSource } from './matchDataSource'
import MatchDetailSummaryTab from './tabs/MatchDetailSummaryTab.vue'
import MatchDetailStatsTab from './tabs/MatchDetailStatsTab.vue'
import MatchDetailRunesTab from './tabs/MatchDetailRunesTab.vue'
import MatchDetailEventsTab from './tabs/MatchDetailEventsTab.vue'
import MatchDetailBuildsTab from './tabs/MatchDetailBuildsTab.vue'
import MatchDetailTimelineTab from './tabs/MatchDetailTimelineTab.vue'
import MatchDetailScoreTab from './tabs/MatchDetailScoreTab.vue'
import MatchDetailBacktestTab from './tabs/MatchDetailBacktestTab.vue'
import MatchDetailReviewTab from './tabs/MatchDetailReviewTab.vue'

const props = defineProps<{ game: Game | null; region?: string }>()
const emit = defineEmits<{ close: [] }>()

const { isDark } = useTheme()

const currentSummoner = ref<Summoner | null>(null)

/** 优先使用当前登录用户匹配"我"，未获取到则回退到 game 的第一个参与者 */
const currentPlayerKey = computed(() => {
  if (currentSummoner.value) {
    return `${currentSummoner.value.gameName}#${currentSummoner.value.tagLine}`
  }
  const identity = props.game?.participantIdentities?.[0]?.player
  if (!identity) return ''
  return `${identity.gameName}#${identity.tagLine}`
})

const gameRef = toRef(() => props.game)
const regionRef = toRef(() => props.region ?? '')
const dataSource = computed(() => resolveMatchDataSource(regionRef.value, props.game))
const players = useMatchDetailPlayers(gameRef, currentPlayerKey)
const { detailPlayers, mySummary } = players
const ai = useMatchAIAnalysis(gameRef)
const replay = useMatchReplay(gameRef)
const assets = useRecordAssets()
const { copy } = useCopy()
// 段位跟随本局队列（440 灵活组排 / 其余单双排），语义与 useSessionTiers 的 pickQueueInfo 一致；
// 跨区详情（region 非空）走 SGP rankedStats 直查（LCU 段位端点只能查当前登录区）
const ranks = useMatchPlayerRanks(
  detailPlayers,
  () => props.game?.queueId,
  () => props.region
)

function itemIds(stats: ParticipantStats) {
  return [stats.item0, stats.item1, stats.item2, stats.item3, stats.item4, stats.item5, stats.item6]
}
function playerAugmentIds(stats: ParticipantStats) {
  return [
    stats.playerAugment1,
    stats.playerAugment2,
    stats.playerAugment3,
    stats.playerAugment4,
    stats.playerAugment5,
    stats.playerAugment6
  ].filter(id => id > 0)
}

/**
 * 由某玩家 + 当前对局拼出一条"遇见记录"（{@link OneGamePlayer}），
 * 保存备注时并入该玩家的遇见列表，复刻"遇见过"效果。
 * @param player - 详情页玩家
 */
function buildEncounter(player: DetailPlayer): OneGamePlayer | undefined {
  const g = props.game
  if (!g || !player.puuid) return undefined
  return {
    gameCreatedAt: g.gameCreationDate,
    index: 0,
    gameId: g.gameId,
    puuid: player.puuid,
    gameName: player.gameName,
    tagLine: player.tagLine,
    championId: player.championId,
    win: player.win,
    kills: player.stats.kills,
    deaths: player.stats.deaths,
    assists: player.stats.assists,
    isMyTeam: player.teamId === mySummary.value?.teamId,
    queueIdCn: g.queueName ?? ''
  }
}

const usesAugments = computed(() => {
  if (!props.game) return false
  // 斗魂所有变种（CHERRY）或海克斯大乱斗（2400）都使用 augment 系统
  const isAugmentMode = props.game.gameMode === 'CHERRY' || props.game.queueId === 2400
  if (!isAugmentMode) return false
  return detailPlayers.value.some(p => playerAugmentIds(p.stats).length > 0)
})

const aiPlayerOptions = computed(() =>
  detailPlayers.value.map(p => ({ label: p.displayName, value: p.participantId }))
)

function onOverview() {
  ai.openOverviewAnalysis(
    mySummary.value?.participantId ?? detailPlayers.value[0]?.participantId ?? null
  )
}

function loadAssetsIfNeeded() {
  if (!props.game) return
  const itemIdsToLoad = new Set<number>()
  const perkIdsToLoad = new Set<number>()
  const spellIdsToLoad = new Set<number>()
  for (const player of detailPlayers.value) {
    for (const id of itemIds(player.stats)) if (id > 0) itemIdsToLoad.add(id)
    for (const id of perkIdsOf(player)) if (id > 0) perkIdsToLoad.add(id)
    if (player.spell1Id > 0) spellIdsToLoad.add(player.spell1Id)
    if (player.spell2Id > 0) spellIdsToLoad.add(player.spell2Id)
  }
  assets.preload([
    { kind: 'item', ids: [...itemIdsToLoad] },
    { kind: 'perk', ids: [...perkIdsToLoad] },
    { kind: 'spell', ids: [...spellIdsToLoad] }
  ])
}

/**
 * 完整符文图标集合：扁平三字段（SummaryTab 用）+ 完整符文页（RunesTab 用：
 * styles 全量 selections + 风格 + statPerks 属性碎片）。
 * 无 `perks` 数组时退为 LCU 扁平 `stats.perk0..5` + 风格 id（RunesTab 据以重建）。
 */
function perkIdsOf(player: DetailPlayer): number[] {
  const ids = new Set<number>(displayedPerkIds(player.stats))
  const perks = player.perks
  if (!perks) {
    // 无完整 perks（旧缓存 LCU 平铺）：补上 RunesTab 据以重建完整符文页的扁平符文 id
    const s = player.stats
    for (const id of [
      s.perk0,
      s.perk1,
      s.perk2,
      s.perk3,
      s.perk4,
      s.perk5,
      s.perkPrimaryStyle,
      s.perkSubStyle
    ]) {
      if (id && id > 0) ids.add(id)
    }
    return [...ids]
  }
  for (const style of perks.styles) {
    if (style.style > 0) ids.add(style.style)
    for (const sel of style.selections) if (sel.perk > 0) ids.add(sel.perk)
  }
  const sp = perks.statPerks
  if (sp) {
    if (sp.offense > 0) ids.add(sp.offense)
    if (sp.flex > 0) ids.add(sp.flex)
    if (sp.defense > 0) ids.add(sp.defense)
  }
  return [...ids]
}

function displayedPerkIds(stats: ParticipantStats) {
  if (usesAugments.value) {
    const ids = playerAugmentIds(stats)
    if (ids.length > 0) return ids
  }
  return [stats.perk0, stats.perkSubStyle].filter(id => id > 0)
}

// ── SGP 单局详情（事件/时间线 tab 共用，懒加载 + 局级缓存）──
const sgpDetail = ref<SgpGameDetail | null>(null)
const sgpDetailStatus = ref<SgpDetailStatus>('idle')

async function loadSgpDetail() {
  // 幂等：loading 中不重复发；error 可重试（重试按钮直接调本函数）
  if (sgpDetailStatus.value === 'loading' || sgpDetailStatus.value === 'ready') return
  const g = props.game
  if (!g) return
  sgpDetailStatus.value = 'loading'
  try {
    const resp = await getSgpMatchDetail(g.platformId, g.gameId)
    if (resp === null) {
      // 服务层吞错返回 null（网络/token/主机映射失败）——置 error，tab 展示错误态 + 重试
      sgpDetail.value = null
      sgpDetailStatus.value = 'error'
      return
    }
    sgpDetail.value = resp.json ?? null
    sgpDetailStatus.value = 'ready'
  } catch (err) {
    console.error('[record] SGP DETAILS 加载失败', err)
    sgpDetail.value = null
    sgpDetailStatus.value = 'error'
  }
}

provide(matchDetailContextKey, {
  game: gameRef,
  region: regionRef,
  players,
  ranks,
  assets,
  ai,
  usesAugments,
  isDark,
  copy,
  buildEncounter,
  itemIds,
  playerAugmentIds,
  displayedPerkIds,
  sgpDetail,
  sgpDetailStatus,
  loadSgpDetail
})

/** tab 定义：7 tab（概览 / 数据对比 / 符文 / 事件 / 出装 / 时间线 / 评分）全部落地 */
const tabs = [
  { key: 'summary', label: '概览', component: MatchDetailSummaryTab },
  {
    key: 'stats',
    label: '数据对比',
    component: MatchDetailStatsTab
  },
  {
    key: 'runes',
    label: '符文',
    component: MatchDetailRunesTab
  },
  { key: 'events', label: '事件', component: MatchDetailEventsTab, minor: true },
  {
    key: 'builds',
    label: '出装',
    component: MatchDetailBuildsTab
  },
  {
    key: 'timeline',
    label: '时间线',
    component: MatchDetailTimelineTab
  },
  { key: 'score', label: '评分', component: MatchDetailScoreTab, minor: true },
  { key: 'review', label: '评审', component: MatchDetailReviewTab, minor: true },
  { key: 'backtest', label: '决策回测', component: MatchDetailBacktestTab, minor: true }
]

const activeTab = ref('summary')
const activeTabComponent = computed(() => {
  const tab = tabs.find(t => t.key === activeTab.value) ?? tabs[0]
  return tab.component
})

/** 依赖 SGP DETAILS 的 tab：切局时若停留其中需立即重拉（debug6 KeepAlive 保活不重挂载） */
const SGP_TABS = new Set(['events', 'builds', 'timeline'])

onMounted(async () => {
  try {
    currentSummoner.value = await invoke<Summoner>('get_my_summoner')
  } catch (error) {
    console.error('获取当前用户信息失败:', error)
  }
  loadAssetsIfNeeded()
})

watch(
  () => props.game?.gameId,
  () => {
    ai.resetOnGameChange(
      mySummary.value?.participantId ?? detailPlayers.value[0]?.participantId ?? null
    )
    loadAssetsIfNeeded()
    sgpDetail.value = null
    sgpDetailStatus.value = 'idle'
    // debug6：KeepAlive 保活的 SGP tab（事件/出装/时间线）只在 onMounted 拉一次，
    // 切局时若正停留在这些 tab，idle 会永久转圈。切局即重拉（loadSgpDetail 幂等，
    // 非 SGP tab 停留时拉了也只是预加载，无副作用）。
    if (SGP_TABS.has(activeTab.value)) {
      void loadSgpDetail()
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  sgpDetail.value = null
})
</script>

<style scoped>
.match-detail-inline {
  width: 100%;
  margin-top: var(--space-8);
}

.match-detail-page {
  width: 100%;
  padding: var(--space-2) var(--space-4) var(--space-4);
  box-sizing: border-box;
  background: var(--bg-base);
}

.match-detail-modal {
  width: 100%;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-sizing: border-box;
  color: var(--text-primary);
  background:
    radial-gradient(
      circle at top left,
      color-mix(in srgb, var(--semantic-win) 14%, transparent),
      transparent 28%
    ),
    radial-gradient(
      circle at top right,
      color-mix(in srgb, var(--accent-blue) 16%, transparent),
      transparent 32%
    ),
    var(--bg-base);
}

.match-detail-shell {
  display: flex;
  flex-direction: column;
}

.match-detail-source-pill {
  padding: 1px 7px;
  font-size: var(--font-size-2xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--brand);
  background: var(--brand-soft);
  border: 1px solid var(--brand-border);
  border-radius: var(--radius-sm);
  white-space: nowrap;
}

.match-detail-ai-button,
.match-detail-replay-button {
  -webkit-app-region: no-drag;
}

/* Tab 栏：金工 mtab 范式（底部描边切换条）+ 右侧操作区（原头部按钮合并位），概览默认激活 */
.match-detail-tabs {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-6) var(--space-12) 0;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.match-detail-tab-list {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
  overflow-x: auto;
}

.match-detail-tab-actions {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  margin-left: auto;
  flex-shrink: 0;
  padding-bottom: var(--space-2);
}

/* 次组页签：弱化 + 前置细分隔（R6：低频 tab 不与高频抢宽度） */
.match-detail-tab--minor {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
.match-detail-tab-divider {
  width: 1px;
  height: 14px;
  align-self: center;
  background: var(--border-subtle);
  margin: 0 var(--space-4);
}
.match-detail-tab {
  appearance: none;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  padding: var(--space-6) var(--space-10);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  position: relative;
  transition:
    color var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo);
}

.match-detail-tab:hover {
  color: var(--text-primary);
}

.match-detail-tab--active {
  color: var(--text-primary);
  font-weight: 700;
  border-bottom-color: var(--brand-border);
}

/* tab 内容区：KeepAlive 组件挂载点 */
.match-detail-tab-pane {
  display: flex;
  flex-direction: column;
}
</style>
