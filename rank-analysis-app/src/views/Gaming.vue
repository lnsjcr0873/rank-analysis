<!--
  注意：本组件被 Framework 的 <Transition mode="out-in"> 包裹，模板根层级
  （含各 v-if 分支的直接子级）必须保持单元素——dev 模式下模板注释会保留成
  vnode，与元素并列会让根变成 Fragment，离场过渡卡死。
-->
<template>
  <template v-if="!sessionData.phase && currentPhase !== 'ChampSelect' && currentPhase !== 'InProgress'">
    <LoadingComponent :hint="isConnected ? '进入英雄选择后这里会自动展示对局分析' : undefined">
      {{ isConnected ? '等待加入游戏...' : '未连接到客户端' }}
    </LoadingComponent>
  </template>
  <template v-else-if="!sessionData.phase">
    <LoadingComponent
      :hint="currentPhase === 'ChampSelect' ? '已进入英雄选择，正在同步双方队伍与英雄数据...' : '对局已开始，正在同步实时战况...'"
    >
      {{ currentPhase === 'ChampSelect' ? '正在载入选人数据...' : '正在载入对局数据...' }}
    </LoadingComponent>
  </template>
  <template v-else>
    <div
      class="gaming-page relative flex h-full flex-col gap-3 p-3.5 pr-14 select-none overflow-y-auto"
    >
      <!-- Floating Actions: Settings & AI Assistant -->
      <n-button
        circle
        secondary
        type="primary"
        class="gaming-config-btn absolute right-2.5 top-[45%] z-30 shadow-lg backdrop-blur-md transition-all hover:scale-110"
        title="战绩显示设置"
        @click="showConfig = true"
      >
        <template #icon>
          <n-icon><SettingsOutline /></n-icon>
        </template>
      </n-button>

      <n-tooltip v-model:show="showAITooltip" placement="left" :duration="5000">
        <template #trigger>
          <n-button
            circle
            secondary
            type="info"
            class="gaming-ai-btn absolute right-2.5 top-[55%] z-30 shadow-lg backdrop-blur-md transition-all hover:scale-110"
            :disabled="!sessionData.phase"
            title="AI 战术军师"
            @click="handleOpenPanel"
          >
            <template #icon>
              <n-spin v-if="ai.loading.value || live.loading.value" :size="14" />
              <n-icon v-else><SparklesOutline /></n-icon>
            </template>
          </n-button>
        </template>
        ✨ AI 战术军师：选人期阵容分析、对局实时情报与赛后胜负归因
      </n-tooltip>

      <!-- Match Count Config Modal -->
      <n-modal v-model:show="showConfig" preset="card" title="战绩显示设置" style="width: 380px">
        <n-form-item label="战绩历史显示数量">
          <n-input-number
            v-model:value="matchCount"
            :min="1"
            :max="20"
            @update:value="handleUpdateConfig"
          />
        </n-form-item>
        <span class="gaming-config-hint text-xs text-white/50">设置将在下一次刷新或对局时生效</span>
      </n-modal>

      <!-- AI Tactical Assistant Panel Modal -->
      <n-modal
        v-model:show="ai.showPanel.value"
        preset="card"
        :title="aiPanelTitle"
        style="width: 680px; max-width: 90vw"
      >
        <template #header-extra>
          <n-button
            size="small"
            tertiary
            type="primary"
            :disabled="currentTabLoading"
            @click="rerunCurrentTab"
          >
            重新分析
          </n-button>
        </template>
        <n-tabs v-model:value="aiTab" type="line" animated>
          <n-tab-pane name="champSelect" tab="选人期">
            <div
              v-if="champSelectRendered"
              class="ai-result-content ai-report max-h-[60vh] overflow-y-auto"
              v-html="champSelectRendered"
            ></div>
            <div
              v-else-if="ai.kindState.champSelect.loading.value"
              class="ai-result-skeleton flex flex-col gap-3 py-4"
            >
              <div class="ai-result-skeleton-label text-xs font-semibold text-white/70">
                AI 正在深度推演选人期阵容...
              </div>
              <n-skeleton text :repeat="4" />
              <n-skeleton text style="width: 60%" />
            </div>
            <div v-else class="ai-result-empty py-8 text-center text-xs text-white/50">
              暂无选人期分析结果，点击「重新分析」生成。
            </div>
          </n-tab-pane>

          <n-tab-pane name="live" tab="对局中">
            <div v-if="live.inGame.value" class="ai-live-hint mb-2 text-xs text-cyan-400/80">
              对局实时数据每 15 秒自动更新<template v-if="liveUpdatedAt">
                · 最后更新 {{ liveUpdatedAt }}</template
              >
            </div>
            <div
              v-if="live.renderedResult.value"
              class="ai-result-content ai-report max-h-[60vh] overflow-y-auto"
              v-html="live.renderedResult.value"
            ></div>
            <div v-else-if="live.loading.value" class="ai-result-skeleton flex flex-col gap-3 py-4">
              <div class="ai-result-skeleton-label text-xs font-semibold text-white/70">
                AI 正在分析对局实时数据...
              </div>
              <n-skeleton text :repeat="4" />
              <n-skeleton text style="width: 60%" />
            </div>
            <div v-else class="ai-result-empty py-8 text-center text-xs text-white/50">
              {{
                live.inGame.value
                  ? '暂无对局中分析结果，点击「重新分析」生成。'
                  : '当前不在对局中。'
              }}
            </div>
          </n-tab-pane>

          <n-tab-pane name="game" tab="赛后">
            <div
              v-if="gameRendered"
              class="ai-result-content ai-report max-h-[60vh] overflow-y-auto"
              v-html="gameRendered"
            ></div>
            <div
              v-else-if="ai.kindState.game.loading.value"
              class="ai-result-skeleton flex flex-col gap-3 py-4"
            >
              <div class="ai-result-skeleton-label text-xs font-semibold text-white/70">
                AI 正在深度复盘整局...
              </div>
              <n-skeleton text :repeat="4" />
              <n-skeleton text style="width: 60%" />
            </div>
            <div v-else class="ai-result-empty py-8 text-center text-xs text-white/50">
              暂无赛后分析结果，点击「重新分析」生成。
            </div>
          </n-tab-pane>
        </n-tabs>
      </n-modal>

      <!-- Top Intel Banner -->
      <div
        class="gaming-intel-banner rounded-xl border border-white/10 bg-[rgba(15,22,36,0.7)] p-3 backdrop-blur-xl shadow-md"
      >
        <div class="banner-main" :class="{ 'banner-main-split': champSelectStage }">
          <!-- Stage Stepper -->
          <div v-if="champSelectStage" class="stage-stepper flex items-center gap-1.5">
            <template v-for="(step, i) in STAGE_STEPS" :key="step.key">
              <div
                class="stage-step flex items-center gap-1 text-xs"
                :class="{
                  'stage-step-active text-amber-300 font-bold': i === currentStageIndex,
                  'stage-step-done text-white/70': i < currentStageIndex,
                  'text-white/40': i > currentStageIndex
                }"
              >
                <span
                  class="stage-dot h-2 w-2 rounded-full transition-all"
                  :class="[
                    i === currentStageIndex
                      ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] scale-110'
                      : i < currentStageIndex
                        ? 'bg-emerald-400'
                        : 'bg-white/20'
                  ]"
                />
                <span class="stage-label">{{ step.label }}</span>
              </div>
              <span
                v-if="i < STAGE_STEPS.length - 1"
                class="stage-connector h-[1px] w-4 bg-white/15"
                :class="{ 'stage-connector-done bg-emerald-400/60': i < currentStageIndex }"
              />
            </template>
          </div>

          <!-- Banner Metadata & OP.GG Tier Select -->
          <div class="banner-meta text-xs text-white/70 flex items-center gap-2">
            <span>
              <template v-if="bannerPhaseLabel">{{ bannerPhaseLabel }} · </template>
              {{ sessionData.typeCn }}
              <template v-if="opggStatus">
                · OP.GG {{ opggStatus.patch }}
                <span v-if="opggStatus.stale" class="banner-stale text-rose-400 font-bold"
                  >（数据滞后）</span
                >
              </template>
            </span>
            <n-select
              v-if="opggMode === 'ranked'"
              :value="opggTier"
              :options="TIER_OPTIONS"
              :loading="opggTierLoading"
              :disabled="opggTierLoading"
              size="tiny"
              class="banner-tier-select w-24"
              @update:value="onTierChange"
            />
          </div>
        </div>

        <!-- Ban Bar -->
        <div
          v-if="hasBans"
          class="ban-bar mt-2 flex items-center justify-between border-t border-white/10 pt-2 text-xs"
        >
          <!-- My Bans -->
          <div class="ban-group flex items-center gap-2">
            <span class="ban-group-label text-white/60 font-semibold">我方禁用</span>
            <div v-if="myBans.length > 0" class="ban-icons flex items-center gap-1">
              <img
                v-for="id in myBans"
                :key="`my-ban-${id}`"
                class="ban-icon h-5 w-5 rounded-full object-cover border border-rose-500/40"
                :src="getChampionUrl(id)"
                :alt="`ban-${id}`"
              />
            </div>
            <span v-else class="ban-group-empty text-white/40">-</span>
          </div>

          <!-- Their Bans -->
          <div class="ban-group flex items-center gap-2">
            <span class="ban-group-label text-white/60 font-semibold">敌方禁用</span>
            <div v-if="theirBans.length > 0" class="ban-icons flex items-center gap-1">
              <img
                v-for="id in theirBans"
                :key="`their-ban-${id}`"
                class="ban-icon h-5 w-5 rounded-full object-cover border border-rose-500/40"
                :src="getChampionUrl(id)"
                :alt="`ban-${id}`"
              />
            </div>
            <span v-else class="ban-group-empty text-white/40">-</span>
          </div>
        </div>

        <!-- Rival & Friend Instant Alert Banner -->
        <RivalFriendAlertBanner v-if="radarAlerts.length > 0" :alerts="radarAlerts" />

        <!-- BP Decision Bar -->
        <BpDecisionBar
          :decision="bp.decision.value"
          :display-secs="bp.displaySecs.value"
          @save-rule="handleSaveRule"
        />

        <!-- Dodge Advisor Card (ChampSelect) -->
        <DodgeAdvisorCard
          v-if="sessionData.phase === 'ChampSelect'"
          :result="dodgeAdvice"
          class="mb-2"
        />

        <!-- ARAM Balance & Bench Comp Advisor (ARAM mode) -->
        <AramBalanceCard
          v-if="opggMode === 'aram'"
          :my-team-champion-ids="myChampionIds"
          class="mb-2"
        />

        <!-- Team Strength Comparison Bar -->
        <TeamStrengthBar
          :mine="lineupScores.scores.value.mine"
          :enemy="lineupScores.scores.value.enemy"
        />

        <!-- Enemy Threat Rating Card -->
        <EnemyThreatCard :ratings="threatRatings ?? []" />

        <!-- Next Action Tactical Card -->
        <NextActionCard :actions="nextActions ?? []" />

        <!-- Matchup Hints -->
        <div
          v-if="lineupScores.scores.value.matchupHints.length > 0"
          class="matchup-hints mt-2 flex flex-col gap-1"
        >
          <div
            v-for="(hint, i) in lineupScores.scores.value.matchupHints"
            :key="i"
            class="matchup-hint rounded bg-[rgba(251,191,36,0.12)] px-2.5 py-1 text-xs text-amber-200 border border-amber-500/20 font-medium"
          >
            {{ hint }}
          </div>
        </div>

        <!-- Jungle Pattern Line -->
        <div
          v-if="lineupScores.scores.value.junglePatternLine"
          class="jungle-pattern mt-1.5 rounded bg-[rgba(56,189,248,0.12)] px-2.5 py-1 text-xs text-cyan-200 border border-cyan-500/20 font-medium"
        >
          {{ lineupScores.scores.value.junglePatternLine }}
        </div>
      </div>

      <!-- Battlefield Subteam 5v5 Grid -->
      <div class="gaming-grid" :class="{ 'gaming-grid-multi': sessionData.isMultiTeam }">
        <div v-for="st of orderedSubteams" :key="`subteam-col-${st.subteamId}`" class="subteam-col">
          <BestPicksPanel
            v-if="showBestPicks && panelForColumn(st)"
            :enemy-ids="enemyLockedIds"
            :candidate-ids="bestPickCandidates"
            :teammate-ids="teammatePickedIds"
            :teammate-positions="teammatePositions"
            :my-position="teammatesMyPosition"
            :tier="opggTier"
            :tier-loading="opggTierLoading"
            :region="'global'"
            :my-summoner-name="mySummonerName"
            @switch-tier="onTierChange"
          />
          <SubteamCard
            :subteam="st"
            :is-mine="st.subteamId === sessionData.mySubteamId"
            :expected-size="expectedSubteamSize"
            :type-cn="sessionData.typeCn"
            :mode-type="sessionData.type"
            :queue-id="sessionData.queueId"
            :tiers-by-subteam="tiersBySubteam"
            :density="density"
            :phase="sessionData.phase"
            :opgg-mode="opggMode"
            :my-champion-ids="myChampionIds"
            :my-puuid="mySummonerPuuid"
            :my-position="teammatesMyPosition"
            :tier="opggTier"
          />
        </div>
      </div>
    </div>
  </template>
</template>

<script lang="ts" setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { invoke } from '@tauri-apps/api/core'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { SettingsOutline, SparklesOutline } from '@vicons/ionicons5'
import { useMessage } from 'naive-ui'

import LoadingComponent from '@renderer/components/LoadingComponent.vue'
import SubteamCard from '@renderer/components/gaming/SubteamCard.vue'
import BestPicksPanel from '@renderer/components/gaming/BestPicksPanel.vue'
import BpDecisionBar from '@renderer/components/gaming/BpDecisionBar.vue'
import TeamStrengthBar from '@renderer/components/gaming/TeamStrengthBar.vue'
import EnemyThreatCard from '@renderer/components/gaming/EnemyThreatCard.vue'
import NextActionCard from '@renderer/components/gaming/NextActionCard.vue'
import DodgeAdvisorCard from '@renderer/components/gaming/DodgeAdvisorCard.vue'
import AramBalanceCard from '@renderer/components/gaming/AramBalanceCard.vue'
import RivalFriendAlertBanner, { type RadarAlert } from '@renderer/components/gaming/RivalFriendAlertBanner.vue'
import { evaluateDodgeQuality, type DodgeAdvisorResult } from '@renderer/features/gaming/services/dodgeAdvisor'
import { usePlayerNotesStore } from '@renderer/features/settings/stores/playerNotes'
import { useGamingAIAnalysis } from '@renderer/composables/useGamingAIAnalysis'
import { useLiveAIAnalysis } from '@renderer/composables/useLiveAIAnalysis'
import { renderAnalysisReport } from '@renderer/services/ai/matchDetail/renderReport'
import { useBpDecision } from '@renderer/composables/useBpDecision'
import { useLineupScore } from '@renderer/composables/useLineupScore'
import { useSessionSync } from '@renderer/composables/useSessionSync'
import { useSessionTiers } from '@renderer/composables/useSessionTiers'
import { useGameState } from '@renderer/composables/useGameState'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import { usePickRules, useBanRules } from '@renderer/composables/useRules'
import {
  ensureOpggData,
  getOpggStatus,
  queueIdToOpggMode,
  TIER_OPTIONS,
  type OpggStatus,
  type OpggTier
} from '@renderer/services/opgg'
import { useOpggTier } from '@renderer/composables/useOpggTier'
import { buildRuleDraft } from '@renderer/features/gaming/services/bpRuleDraft'
import { normalizeLcuPosition } from '@renderer/features/gaming/services/counterIntel'
import { getChampionName, loadChampionNames } from '@renderer/services/ai/champion-names'
import { getThreatRatings, type ThreatRating } from '@renderer/services/scouting'
import { getNextActions, type NextAction } from '@renderer/services/nextAction'
import type { Position, PickRule, BanRule } from '@renderer/types/rules'
import type { ChampSelect, Subteam } from '@renderer/types/domain/gaming'
import type { championOption } from '@renderer/types/domain/champion'

/** 选人阶段 stepper 的四步定义，顺序与展示文案固定 */
const STAGE_STEPS: Array<{ key: string; label: string }> = [
  { key: 'planning', label: '预选' },
  { key: 'banning', label: '禁用' },
  { key: 'picking', label: '选人' },
  { key: 'finalization', label: '确认' }
]

const { sessionData, requestSessionData } = useSessionSync()
const tiersBySubteam = useSessionTiers(sessionData)
const { getChampionUrl } = useAssetUrl()
const { isConnected, currentPhase, summoner: mySummoner } = useGameState()

/** 自己的 puuid，用于在玩家卡上标出「我」 */
const mySummonerPuuid = computed(() => mySummoner.value?.puuid ?? '')

/** 自己的召唤师名（格式 名称#标签），供推荐面板拉取我的英雄池；无召唤师信息时为空 */
const mySummonerName = computed(() => {
  const s = mySummoner.value
  return s?.gameName ? `${s.gameName}#${s.tagLine ?? ''}` : ''
})

const density = computed<'normal' | 'compact'>(() =>
  sessionData.isMultiTeam ? 'compact' : 'normal'
)

const expectedSubteamSize = computed(() => (sessionData.isMultiTeam ? 2 : 5))

const orderedSubteams = computed(() => {
  const my = sessionData.subteams.find(s => s.subteamId === sessionData.mySubteamId)
  const others = sessionData.subteams
    .filter(s => s.subteamId !== sessionData.mySubteamId)
    .sort((a, b) => a.subteamId - b.subteamId)
  return my ? [my, ...others] : others
})

/** 推荐条落列规则 */
const panelForColumn = (st: Subteam): boolean => {
  if (st.subteamId === sessionData.mySubteamId) {
    return enemyLockedIds.value.length < 2 && teammatePickedIds.value.length >= 1
  }
  return enemyLockedIds.value.length >= 2
}

/** 我方已亮队友英雄 id */
const teammatePickedIds = computed(() => {
  const my = orderedSubteams.value.find(s => s.subteamId === sessionData.mySubteamId)
  return (
    my?.players
      .filter(
        p =>
          p.championId > 0 &&
          p.pickState !== 'banning' &&
          p.summoner.puuid !== mySummonerPuuid.value
      )
      .map(p => p.championId) ?? []
  )
})

/** 我方已亮队友的本局分路 */
const teammatePositions = computed<Record<number, string>>(() => {
  const my = orderedSubteams.value.find(s => s.subteamId === sessionData.mySubteamId)
  const map: Record<number, string> = {}
  for (const p of my?.players ?? []) {
    if (
      p.championId <= 0 ||
      p.pickState === 'banning' ||
      p.summoner.puuid === mySummonerPuuid.value
    )
      continue
    const pos = p.assignedPosition?.toLowerCase()
    if (pos && normalizeLcuPosition(pos)) map[p.championId] = pos
  }
  return map
})

/** 我本局分路 */
const teammatesMyPosition = computed(() => {
  const pos = myPosition.value
  return pos && normalizeLcuPosition(pos) ? pos : ''
})

/** 当前对局对应的 OP.GG 数据模式 */
const opggMode = computed(() => queueIdToOpggMode(sessionData.queueId))

/** 我方已亮出的英雄 id 列表 */
const myChampionIds = computed(
  () =>
    orderedSubteams.value
      .find(s => s.subteamId === sessionData.mySubteamId)
      ?.players.map(p => p.championId)
      .filter(id => id > 0) ?? []
)

/** P2 候选池：全量英雄列表 */
const allChampionIds = ref<number[]>([])
let championOptionsLoaded = false

async function ensureChampionOptions(): Promise<void> {
  if (championOptionsLoaded) return
  try {
    const options = await invoke<championOption[]>('get_champion_options')
    allChampionIds.value = options.map(o => o.value)
    championOptionsLoaded = true
  } catch (e) {
    console.warn('[gaming] 候选池拉取失败:', e)
  }
}

/** 敌方已锁英雄 id */
const enemyLockedIds = computed(() =>
  orderedSubteams.value
    .filter(s => s.subteamId !== sessionData.mySubteamId)
    .flatMap(s => s.players)
    .map(p => p.championId)
    .filter(id => id > 0)
)

/** 推荐候选池数据源 */
const bestPickCandidates = computed<number[]>(() => {
  if (allChampionIds.value.length > 0) return allChampionIds.value
  const fromMeta = sessionData.subteams.flatMap(s => s.players.map(p => p.championId))
  return Array.from(new Set(fromMeta.filter(id => id > 0)))
})

/** 协同+克制推荐总开关 */
const showBestPicks = computed(() => {
  if (sessionData.phase !== 'ChampSelect') return false
  if (opggMode.value !== 'ranked') return false
  return enemyLockedIds.value.length >= 1 || teammatePickedIds.value.length >= 1
})

watch(
  showBestPicks,
  needed => {
    if (needed) void ensureChampionOptions()
  },
  { immediate: true }
)

const opggStatus = ref<OpggStatus | null>(null)
const { tier: opggTier, loading: opggTierLoading, switchTier } = useOpggTier()

watch(
  opggMode,
  mode => {
    getOpggStatus(mode).then(s => (opggStatus.value = s))
  },
  { immediate: true }
)

const onTierChange = async (next: string) => {
  const ok = await switchTier(next as OpggTier)
  if (ok) {
    opggStatus.value = await getOpggStatus(opggMode.value)
  }
}

const lastChampSelect = ref<ChampSelect | null>(null)

watch(
  () => sessionData.phase,
  (next, prev) => {
    if (next === 'ChampSelect' && prev !== 'ChampSelect') {
      lastChampSelect.value = null
    }
  }
)

watch(
  () => sessionData.champSelect,
  cs => {
    if (cs) lastChampSelect.value = cs
  }
)

const displayChampSelect = computed<ChampSelect | null>(
  () => sessionData.champSelect ?? lastChampSelect.value
)

const champSelectStage = computed<string>(() => displayChampSelect.value?.stage ?? '')

const currentStageIndex = computed<number>(() => {
  const stage = champSelectStage.value
  if (!stage) return -1
  return STAGE_STEPS.findIndex(s => s.key === stage)
})

const myBans = computed<number[]>(() => displayChampSelect.value?.myBans ?? [])
const theirBans = computed<number[]>(() => displayChampSelect.value?.theirBans ?? [])
const hasBans = computed<boolean>(() => myBans.value.length > 0 || theirBans.value.length > 0)

const bannerPhaseLabel = computed<string>(() => {
  switch (sessionData.phase) {
    case 'ChampSelect':
      return '选人期'
    case 'InProgress':
      return '对局中'
    case 'EndOfGame':
    case 'PreEndOfGame':
      return '结算中'
    case 'Lobby':
      return '房间中'
    case 'Matchmaking':
      return '匹配中'
    case 'ReadyCheck':
      return '对局就绪'
    default:
      return ''
  }
})

const myPosition = computed<Position | undefined>(() => {
  const me = orderedSubteams.value
    .find(s => s.subteamId === sessionData.mySubteamId)
    ?.players.find(p => p.summoner.puuid === mySummonerPuuid.value)
  const pos = me?.assignedPosition?.toLowerCase()
  if (
    pos === 'top' ||
    pos === 'jungle' ||
    pos === 'middle' ||
    pos === 'bottom' ||
    pos === 'utility'
  ) {
    return pos as Position
  }
  return undefined
})

const bp = useBpDecision(() => sessionData.phase)

const lineupScores = useLineupScore(sessionData, opggMode, {
  includePlayerProfiles: true,
  prefetchProfiles: true
})

const threatRatings = ref<ThreatRating[]>([])
const nextActions = ref<NextAction[]>([])

let notesStore: ReturnType<typeof usePlayerNotesStore> | null = null
try {
  notesStore = usePlayerNotesStore()
} catch {
  // Pinia not active in isolated component tests
}

const dodgeAdvice = computed<DodgeAdvisorResult>(() =>
  evaluateDodgeQuality({
    myTeamScore: lineupScores.scores.value.mine,
    theirTeamScore: lineupScores.scores.value.enemy,
    threatRatings: threatRatings.value,
    myPosition: teammatesMyPosition.value,
    isRankedQueue: sessionData.queueId === 420 || sessionData.queueId === 440
  })
)

const radarAlerts = computed<RadarAlert[]>(() => {
  if (!notesStore) return []
  const alerts: RadarAlert[] = []
  for (const st of orderedSubteams.value) {
    const isEnemy = st.subteamId !== sessionData.mySubteamId
    for (const player of st.players) {
      if (!player.summoner?.puuid) continue
      const note = notesStore.getNote(player.summoner.puuid)
      if (note && note.note) {
        const isBad = note.label === 'blacklist' || note.label === 'careful'
        const isGood = note.label === 'friendly'
        alerts.push({
          type: isBad ? 'rival' : isGood ? 'friend' : 'warning',
          title: `${isEnemy ? '敌方' : '己方'}【${player.summoner.gameName || '玩家'}】备注提醒`,
          badge: isBad ? '避坑/宿敌' : isGood ? '大腿/好友' : '标记玩家',
          detail: note.note,
          side: isEnemy ? 'enemy' : 'ally'
        })
      }
    }
  }
  return alerts
})

watch(
  () => sessionData.phase,
  async phase => {
    if (phase === 'ChampSelect') {
      threatRatings.value = await getThreatRatings()
    } else {
      threatRatings.value = []
    }
  },
  { immediate: true }
)

let nextActionTimer: ReturnType<typeof setInterval> | null = null

async function updateNextActionsAndPushOverlay() {
  if (sessionData.phase !== 'InProgress') return
  const myPlayer = orderedSubteams.value
    .find(s => s.subteamId === sessionData.mySubteamId)
    ?.players.find(p => p.summoner.puuid === mySummonerPuuid.value)
  const myChampionId = myPlayer?.championId ?? 0
  const myGameName = myPlayer?.summoner?.gameName ?? ''
  const actions = await getNextActions(
    myChampionId,
    myGameName,
    mySummonerPuuid.value,
    sessionData.queueId
  )
  nextActions.value = actions
  if (actions && actions.length > 0) {
    await invoke('push_overlay_data', { actions }).catch(() => {})
  }
}

watch(
  () => sessionData.phase,
  async phase => {
    if (nextActionTimer) {
      clearInterval(nextActionTimer)
      nextActionTimer = null
    }

    if (phase === 'InProgress') {
      await invoke('show_overlay_window').catch(() => {})
      await updateNextActionsAndPushOverlay()
      nextActionTimer = setInterval(updateNextActionsAndPushOverlay, 2000)
    } else {
      await invoke('hide_overlay_window').catch(() => {})
      nextActions.value = []
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (nextActionTimer) {
    clearInterval(nextActionTimer)
    nextActionTimer = null
  }
})

const showConfig = ref(false)
const matchCount = ref(4)
const showAITooltip = ref(false)
let hasShownAITip = false

const router = useRouter()
const message = useMessage()

const ai = useGamingAIAnalysis(sessionData, opggMode, {
  champSelectExtras: computed(() => ({
    bpDecision: bp.decision.value,
    lineupScore: lineupScores.scores.value
  }))
})
const live = useLiveAIAnalysis(sessionData, { mySummoner })

type AITabKey = 'champSelect' | 'live' | 'game'
const aiTab = ref<AITabKey>('champSelect')

const defaultAiTab = computed<AITabKey>(() => {
  if (sessionData.phase === 'ChampSelect') return 'champSelect'
  if (sessionData.phase === 'InProgress') return 'live'
  return 'game'
})

watch(
  () => sessionData.phase,
  () => {
    aiTab.value = defaultAiTab.value
  }
)

const champSelectRendered = computed<string>(() => {
  const raw = ai.kindState.champSelect.result.value
  return raw ? renderAnalysisReport(raw) : ''
})

const gameRendered = computed<string>(() => {
  const raw = ai.kindState.game.result.value
  return raw ? renderAnalysisReport(raw) : ''
})

const liveUpdatedAt = computed<string>(() => {
  const t = live.lastPollAt.value
  if (!t) return ''
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})

const currentTabLoading = computed<boolean>(() => {
  if (aiTab.value === 'live') return live.loading.value
  return ai.kindState[aiTab.value].loading.value
})

const aiPanelTitle = computed<string>(() => {
  const phase = sessionData.phase
  const name =
    phase === 'ChampSelect'
      ? '选人期阵容分析'
      : phase === 'InProgress'
        ? '对局实时分析'
        : '赛后整局复盘'
  return `AI 战术军师 · ${name}`
})

function handleOpenPanel(): void {
  const tab = defaultAiTab.value
  aiTab.value = tab
  ai.showPanel.value = true
  if (tab === 'live') live.ensureStarted()
  else ai.openPanel()
}

function rerunCurrentTab(): void {
  if (aiTab.value === 'live') void live.rerun()
  else void ai.rerunKind(aiTab.value)
}

const savingRule = ref(false)

async function handleSaveRule(): Promise<void> {
  if (savingRule.value) return
  const d = bp.decision.value
  if (!d) return
  const draft = buildRuleDraft({
    decision: d,
    myPosition: myPosition.value ?? null,
    championName: getChampionName
  })
  if (!draft) {
    message.warning('当前没有可保存的目标')
    return
  }

  savingRule.value = true
  try {
    await loadChampionNames()
    if (d.action_type === 'Ban') {
      const { rules, reload, save } = useBanRules()
      await reload()
      await save([...rules.value, draft as BanRule])
    } else {
      const { rules, reload, save } = usePickRules()
      await reload()
      await save([...rules.value, draft as PickRule])
    }

    message.success(`已存为规则「${draft.name}」`)
    await router.push('/Settings/Automation')
  } catch (e) {
    message.error('保存规则失败: ' + (e instanceof Error ? e.message : String(e)))
  } finally {
    savingRule.value = false
  }
}

const handleUpdateConfig = async (value: number | null) => {
  if (!value) return
  try {
    await putConfigByIpc('matchHistoryCount', value)
    await requestSessionData()
    message.success('设置已保存，已刷新当前对局数据')
  } catch (e) {
    message.error('保存失败')
  }
}

onMounted(async () => {
  try {
    const val = await getConfigByIpc<number>('matchHistoryCount')
    if (typeof val === 'number') {
      matchCount.value = val
    }
  } catch (e) {
    console.error(e)
  }

  void loadChampionNames()

  if (!hasShownAITip) {
    setTimeout(() => {
      showAITooltip.value = true
      hasShownAITip = true
      setTimeout(() => {
        showAITooltip.value = false
      }, 5000)
    }, 2000)
  }

  void Promise.all([ensureOpggData('ranked'), ensureOpggData('aram')]).then(() =>
    getOpggStatus(opggMode.value).then(s => (opggStatus.value = s))
  )
})
</script>

<style scoped>
.gaming-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  width: 100%;
  max-width: 2600px;
  margin: 0 auto;
  align-items: start;
}

@media (max-width: 960px) {
  .gaming-grid {
    grid-template-columns: 1fr;
  }
}

.subteam-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  min-width: 0;
  width: 100%;
}

.gaming-grid-multi {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
}

.banner-main-split {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
