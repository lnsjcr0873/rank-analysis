<!--
  注意：本组件被 Framework 的 <Transition mode="out-in"> 包裹，模板根层级
  （含各 v-if 分支的直接子级）必须保持单元素——dev 模式下模板注释会保留成
  vnode，与元素并列会让根变成 Fragment，离场过渡卡死（表现为切页黑屏、点不回去）。
  要写注释请放元素内部或这里。
-->
<template>
  <template v-if="!sessionData.phase">
    <LoadingComponent :hint="waitingHint">
      <!-- 已连接时不提示「启动客户端」——那会跟左下角的绿色连接灯自相矛盾 -->
      {{ isConnected ? '等待加入游戏...' : '未连接到客户端' }}
    </LoadingComponent>
  </template>
  <template v-else>
    <div class="gaming-page">
      <!-- 右下 dock：常态可见的操作区，替代旧 opacity 0.6 悬浮钮（设计系统 v3 §C2） -->
      <div class="gaming-dock">
        <!-- 刻意不用 :loading —— naive-ui Button loading 时不 emit click，会把用户锁在
             面板外。进行中改用 spin 表达，按钮始终可点、随时能开回面板。 -->
        <button
          class="dock-btn dock-btn--ai"
          :disabled="!sessionData.phase"
          @click="handleOpenPanel"
        >
          <n-spin v-if="ai.loading.value || live.loading.value" :size="13" />
          <n-icon v-else :size="15"><Sparkles /></n-icon>
          <span>AI 分析</span>
        </button>
        <button class="dock-btn" @click="showConfig = true">
          <n-icon :size="15"><Settings /></n-icon>
          <span>设置</span>
        </button>
      </div>

      <n-modal v-model:show="showConfig" preset="card" title="显示设置" style="width: 400px">
        <n-form-item label="战绩显示数量">
          <n-input-number
            v-model:value="matchCount"
            :min="1"
            :max="20"
            @update:value="handleUpdateConfig"
          />
        </n-form-item>
        <span class="gaming-config-hint">设置将在下一次刷新或对局时生效</span>
      </n-modal>

      <!-- AI 分析面板：右侧抽屉——选人期可与阵容并看，不再锁模态 -->
      <n-drawer
        v-model:show="ai.showPanel.value"
        placement="right"
        :width="aiDrawerWidth"
        :trap-focus="false"
      >
        <n-drawer-content :title="aiPanelTitle" closable>
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
                class="ai-result-content ai-report"
                v-html="champSelectRendered"
              ></div>
              <div v-else-if="ai.kindState.champSelect.loading.value" class="ai-result-skeleton">
                <div class="ai-result-skeleton-label">AI 正在分析选人期阵容...</div>
                <n-skeleton text :repeat="4" />
                <n-skeleton text style="width: 60%" />
              </div>
              <div v-else class="ai-result-empty">暂无选人期分析结果，点「重新分析」生成。</div>
            </n-tab-pane>
            <n-tab-pane name="live" tab="对局中">
              <div v-if="live.inGame.value" class="ai-live-hint">
                对局实时数据每 15 秒自动更新<template v-if="liveUpdatedAt">
                  · 最后更新 {{ liveUpdatedAt }}</template
                >
              </div>
              <div
                v-if="live.renderedResult.value"
                class="ai-result-content ai-report"
                v-html="live.renderedResult.value"
              ></div>
              <div v-else-if="live.loading.value" class="ai-result-skeleton">
                <div class="ai-result-skeleton-label">AI 正在分析对局实时数据...</div>
                <n-skeleton text :repeat="4" />
                <n-skeleton text style="width: 60%" />
              </div>
              <div v-else class="ai-result-empty">
                {{
                  live.inGame.value
                    ? '暂无对局中分析结果，点「重新分析」生成。'
                    : '当前不在对局中。'
                }}
              </div>
            </n-tab-pane>
            <n-tab-pane name="game" tab="赛后">
              <div
                v-if="gameRendered"
                class="ai-result-content ai-report"
                v-html="gameRendered"
              ></div>
              <div v-else-if="ai.kindState.game.loading.value" class="ai-result-skeleton">
                <div class="ai-result-skeleton-label">AI 正在分析整局...</div>
                <n-skeleton text :repeat="4" />
                <n-skeleton text style="width: 60%" />
              </div>
              <div v-else class="ai-result-empty">暂无赛后分析结果，点「重新分析」生成。</div>
            </n-tab-pane>
          </n-tabs>
        </n-drawer-content>
      </n-drawer>

      <!-- ================= 2400 狂暴大乱斗专属选人面板（替换峡谷 BP 情报舱） ================= -->
      <MayhemDraftPanel
        v-if="isMayhem"
        :queue-id="sessionData.queueId"
        :my-puuid="mySummonerPuuid"
        :my-team="mySubteamPlayers"
      />

      <!-- ================= 情报舱：结论区 → 阶段区 → 信号区（非狂暴大乱斗时展示） =================
           大乱斗走上面的 MayhemDraftPanel，但两者共用这一层外壳，名册始终在下方渲染，
           避免「选人有面板、局内空一块」的两套页面结构。 -->
      <div v-if="!isMayhem" class="intel-bay">
        <!-- ① 最优应对推荐条：只在选人期且候选池就绪时出现，作为名册上方的结论补充 -->
        <BestPicksPanel
          v-if="showBestPicks && showBestPicksPanel"
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

        <!-- ② 结论区：VerdictBanner + 梯度选择（梯度影响推荐依据，就近放结论旁）；
             兜底态追加「存为规则」入口，把兜底转化为用户自己的规则 -->
        <div class="intel-bay__verdict">
          <VerdictBanner
            class="intel-verdict"
            :state="verdictState"
            :verb="verdictVerb"
            :champion="verdictChampion"
            :reason="verdictReason"
            :seconds="bp.displaySecs.value"
            :total="30"
          />
          <n-select
            v-if="opggMode === 'ranked'"
            :value="opggTier"
            :options="TIER_OPTIONS"
            :loading="opggTierLoading"
            :disabled="opggTierLoading"
            size="tiny"
            class="banner-tier-select intel-tier"
            @update:value="onTierChange"
          />
          <button
            v-if="verdictState === 'fallback'"
            class="intel-save-rule"
            title="把这条兜底建议固化为你自己的规则"
            @click="handleSaveRule"
          >
            存为规则
          </button>
        </div>

        <!-- ③ 阶段区 -->
        <div class="intel-bay__stage">
          <div class="intel-stage-row">
            <!-- 阶段 stepper：预选/禁用/选人/确认，仅 stage 非空时展示 -->
            <div v-if="champSelectStage" class="stage-stepper">
              <template v-for="(step, i) in STAGE_STEPS" :key="step.key">
                <div
                  class="stage-step"
                  :class="{
                    'stage-step-active': i === currentStageIndex,
                    'stage-step-done': i < currentStageIndex
                  }"
                >
                  <span class="stage-dot"></span>
                  <span class="stage-label">{{ step.label }}</span>
                </div>
                <span
                  v-if="i < STAGE_STEPS.length - 1"
                  class="stage-connector"
                  :class="{ 'stage-connector-done': i < currentStageIndex }"
                ></span>
              </template>
            </div>
            <div class="banner-meta">
              <template v-if="bannerPhaseLabel">{{ bannerPhaseLabel }} · </template
              >{{ sessionData.typeCn }}
              <template v-if="opggStatus">
                · OP.GG {{ opggStatus.patch
                }}<span v-if="opggStatus.stale" class="banner-stale">（数据滞后）</span>
              </template>
            </div>
          </div>

          <!-- 双方 ban 条：任一方有 ban 才展示整块 -->
          <div v-if="hasBans" class="ban-bar">
            <div class="ban-group">
              <span class="ban-group-label">我方禁用</span>
              <div v-if="myBans.length > 0" class="ban-icons">
                <img
                  v-for="id in myBans"
                  :key="`my-ban-${id}`"
                  class="ban-icon"
                  :src="getChampionUrl(id)"
                  :alt="`ban-${id}`"
                />
              </div>
              <span v-else class="ban-group-empty">-</span>
            </div>
            <div class="ban-group">
              <span class="ban-group-label">敌方禁用</span>
              <div v-if="theirBans.length > 0" class="ban-icons">
                <img
                  v-for="id in theirBans"
                  :key="`their-ban-${id}`"
                  class="ban-icon"
                  :src="getChampionUrl(id)"
                  :alt="`ban-${id}`"
                />
              </div>
              <span v-else class="ban-group-empty">-</span>
            </div>
          </div>
        </div>

        <!-- ④ 信号区：tab 化，默认强度对比；有内容的 tab 挂数量角标 -->
        <div class="intel-sigs">
          <div class="intel-sigs__tabs" role="tablist">
            <button
              v-for="t in signalTabs"
              :key="t.key"
              type="button"
              role="tab"
              class="sig-tab"
              :class="{ 'sig-tab--on': activeSignalTab === t.key }"
              :aria-selected="activeSignalTab === t.key"
              @click="activeSignalTab = t.key"
            >
              {{ t.label
              }}<sup
                v-if="
                  (t.key === 'threat' && (threatRatings?.length ?? 0) > 0) ||
                  (t.key === 'next' && (nextActions?.length ?? 0) > 0)
                "
                class="sig-badge"
                >{{ t.key === 'threat' ? threatRatings?.length : nextActions?.length }}</sup
              ><sup
                v-else-if="t.key === 'threat' && isEnemyAnonymous"
                class="sig-badge"
                title="敌方匿名"
                >!</sup
              >
            </button>
          </div>
          <div class="intel-sigs__pane">
            <!-- 双方阵容强度对比条：锁定英雄 ≥1 即出现，数据不足时整块隐藏 -->
            <TeamStrengthBar
              v-if="activeSignalTab === 'strength'"
              :mine="lineupScores.scores.value.mine"
              :enemy="lineupScores.scores.value.enemy"
            />
            <EnemyThreatCard
              v-else-if="activeSignalTab === 'threat'"
              :ratings="threatRatings"
              :anonymous="isEnemyAnonymous"
            />
            <NextActionCard v-else-if="activeSignalTab === 'next'" :actions="nextActions" />
            <template v-else>
              <!-- 对位分析（同分路画像均值差 ≥2%，确定性计算） -->
              <div v-if="lineupScores.scores.value.matchupHints.length > 0" class="matchup-hints">
                <div
                  v-for="(hint, i) in lineupScores.scores.value.matchupHints"
                  :key="i"
                  class="matchup-hint"
                >
                  {{ hint }}
                </div>
              </div>
              <!-- 敌方打野节奏（SGP 战绩前 10 分钟击杀分布，确定性计算） -->
              <div v-if="lineupScores.scores.value.junglePatternLine" class="jungle-pattern">
                {{ lineupScores.scores.value.junglePatternLine }}
              </div>
              <p
                v-if="
                  lineupScores.scores.value.matchupHints.length === 0 &&
                  !lineupScores.scores.value.junglePatternLine
                "
                class="psub intel-empty"
              >
                暂无对位/野区信号——需要更多已锁定英雄数据
              </p>
            </template>
          </div>
        </div>
      </div>

      <!-- ================= 名册墙：Akari 情报卡（历史画像深度） =================
           插在 .intel-bay 之后、.roster 之前（设计文档 ADR-4）。
           与下方 .roster 定位不同：本 band 答「他是谁」，.roster 答「本局该怎么做」。 -->
      <RosterWall
        v-if="rosterWallVisible"
        class="roster-wall-band"
        :ally="rosterWallAlly"
        :enemy="rosterWallEnemy"
        :champion-name="getChampionName"
        :self-puuid="mySummonerPuuid"
        :density="rosterWallDensity"
      />

      <!-- ================= 名册：全模式共用同一外壳（选人期 / 局内 / 大乱斗） ================= -->
      <div
        class="roster"
        :class="{ 'roster-multi': roster.isMultiTeam, 'roster-mayhem': isMayhem }"
      >
        <div v-for="group in roster.groups" :key="`roster-${group.subteamId}`" class="roster-group">
          <div class="roster-group__head">
            <span class="roster-group__label">{{ group.label }}</span>
            <span class="roster-group__count"
              >{{ group.members.length }}/{{ group.expectedSize }}</span
            >
          </div>
          <div class="roster-group__body">
            <RosterRow
              v-for="(member, i) in group.members"
              :key="member.key"
              :member="member"
              :index="i"
              :side="rosterSideOf(group.subteamId)"
              :is-self="member.isSelf"
              :is-loading="member.isLoading"
              :champ-select="roster.isChampSelect"
              :density="rosterDensity"
              :opgg-mode="opggMode"
              :opgg-tier="opggTier"
              :queue-id="sessionData.queueId"
              :tier-icon-url="tierByMemberKey.get(member.key)?.imgUrl ?? ''"
              :tier-cn="tierByMemberKey.get(member.key)?.tierCn ?? '无'"
              :teammate-champion-ids="group.isMine ? myChampionIds : enemyLockedIds"
              :style="{ '--stagger-i': i }"
            />
            <div
              v-for="i in placeholderCount(group.members.length)"
              :key="`placeholder-${group.subteamId}-${i}`"
              class="roster-placeholder"
            >
              <span>{{ roster.isChampSelect ? '等待选人…' : '已离开' }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </template>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { invoke } from '@tauri-apps/api/core'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { Settings, Sparkles } from 'lucide-vue-next'
import { useMessage } from 'naive-ui'

import VerdictBanner from '@renderer/components/ui/VerdictBanner.vue'
import LoadingComponent from '@renderer/components/LoadingComponent.vue'
import RosterRow from '@renderer/components/gaming/RosterRow.vue'
import RosterWall from '@renderer/components/gaming/roster-wall/RosterWall.vue'
import BestPicksPanel from '@renderer/components/gaming/BestPicksPanel.vue'
import MayhemDraftPanel from '@renderer/components/gaming/MayhemDraftPanel.vue'
import TeamStrengthBar from '@renderer/components/gaming/TeamStrengthBar.vue'
import EnemyThreatCard from '@renderer/components/gaming/EnemyThreatCard.vue'
import NextActionCard from '@renderer/components/gaming/NextActionCard.vue'
import { useGamingAIAnalysis } from '@renderer/composables/useGamingAIAnalysis'
import { useLiveAIAnalysis } from '@renderer/composables/useLiveAIAnalysis'
import { renderAnalysisReport } from '@renderer/services/ai/matchDetail/renderReport'
import { useBpDecision } from '@renderer/composables/useBpDecision'
import { useLineupScore } from '@renderer/composables/useLineupScore'
import { useSessionSync } from '@renderer/composables/useSessionSync'
import { useSessionTiers } from '@renderer/composables/useSessionTiers'
import { useGameState } from '@renderer/composables/useGameState'
import { useReconnectBanner } from '@renderer/composables/useReconnectBanner'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import { useInGameServices } from '@renderer/composables/useInGameServices'
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
import { buildRoster, type RosterSide } from '@renderer/features/gaming/services/roster'
import { analyzeRoster } from '@renderer/features/gaming/services/playerAnalysis'
import {
  toRosterWallMember,
  type RosterWallMember
} from '@renderer/features/gaming/roster-wall/member'
import {
  fetchPlayerTimelines,
  type PlayerTimelineSummary
} from '@renderer/features/gaming/services/playerTimeline'
import { getCurrentSgpRegion } from '@renderer/features/record/services/sgp'
import { isMayhemQueue } from '@renderer/features/mayhem/queues'
import { normalizeLcuPosition } from '@renderer/features/gaming/services/counterIntel'
import { getChampionName, loadChampionNames } from '@renderer/services/ai/champion-names'
import { getThreatRatings, type ThreatRating } from '@renderer/services/scouting'
import type { Position, PickRule, BanRule } from '@renderer/types/rules'
import type { ChampSelect } from '@renderer/types/domain/gaming'
import type { championOption } from '@renderer/types/domain/champion'

/** 选人阶段 stepper 的四步定义，顺序与展示文案固定 */
const STAGE_STEPS: Array<{ key: string; label: string }> = [
  { key: 'planning', label: '预选' },
  { key: 'banning', label: '禁用' },
  { key: 'picking', label: '选人' },
  { key: 'finalization', label: '确认' }
]

const { sessionData, requestSessionData } = useSessionSync()
const isMayhem = computed(() => isMayhemQueue(sessionData.queueId))
const tiersBySubteam = useSessionTiers(sessionData)
const { getChampionUrl } = useAssetUrl()
const { isConnected, summoner: mySummoner, currentPhase } = useGameState()

/** 重连成功后短暂展示的恢复提示（3s 后回到常态文案），时序逻辑见 useReconnectBanner */
const { reconnected } = useReconnectBanner(isConnected)

/** 等待态副文案与 phase 联动：大厅/匹配中给出更贴近当前的说明 */
const waitingHint = computed(() => {
  if (!isConnected.value) return undefined
  if (reconnected.value) return '连接已恢复 · 正在同步对局状态'
  switch (currentPhase.value) {
    case 'Lobby':
      return '已在大厅 · 创建或加入对局后自动切入分析'
    case 'MatchMaking':
    case 'ReadyCheck':
      return '正在匹配 · 接受对局后自动进入分析'
    default:
      return '进入英雄选择后这里会自动展示对局分析'
  }
})

/** 自己的 puuid，用于在玩家卡上标出「我」 */
const mySummonerPuuid = computed(() => mySummoner.value?.puuid ?? '')

/** 自己的召唤师名（格式 名称#标签），供推荐面板拉取我的英雄池；无召唤师信息时为空 */
const mySummonerName = computed(() => {
  const s = mySummoner.value
  return s?.gameName ? `${s.gameName}#${s.tagLine ?? ''}` : ''
})

/* ================= 名册（Akari 式名册优先布局） ================= */

/**
 * 名册行密度。
 *
 * - `full`：身份 + 近期表现 + 最近对局缩略条
 * - `normal`：身份 + 近期表现（窄窗或大乱斗，人数多时先保可读）
 * - `minimal`：仅身份行（极窄窗兜底）
 */
const rosterDensity = computed<'full' | 'normal' | 'minimal'>(() => {
  if (viewportWidth.value < 900) return 'minimal'
  if (isMayhem.value || roster.value.members.length > 12) return 'normal'
  if (viewportWidth.value < 1200) return 'normal'
  return 'full'
})

/** 视口宽度：名册密度断点用，挂载时取一次并监听 resize */
const viewportWidth = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)
onMounted(() => {
  const onResize = (): void => {
    viewportWidth.value = window.innerWidth
  }
  window.addEventListener('resize', onResize)
  onUnmounted(() => window.removeEventListener('resize', onResize))
})

/**
 * 名册数据出口。
 *
 * `buildRoster` 是纯函数，这里只负责喂 `sessionData` 与自己的 puuid。
 * 注意它内部读的是响应式 `sessionData.subteams`，`useSessionSync` 原地 mutate
 * 也能触发重算；不需要自己再 deep watch 一份副本。
 */
const roster = computed(() => buildRoster(sessionData, mySummonerPuuid.value, matchCount.value))

/**
 * 每名成员的段位展示。
 *
 * 优先按 puuid 检索，匿名时回退组内索引（选人期敌方无身份，同序即唯一对应）。
 * 做成 puuid/索引双键 Map，避免模板里做查找。
 */
const tierByMemberKey = computed(() => {
  const out = new Map<string, { imgUrl: string; tierCn: string }>()
  for (const group of roster.value.groups) {
    const tiers = tiersBySubteam.value[group.subteamId] ?? []
    const byPuuid = new Map<string, (typeof tiers)[number]>()
    group.members.forEach((m, i) => {
      const key = m.player.summoner.puuid
      if (key && !byPuuid.has(key)) byPuuid.set(key, tiers[i])
    })
    for (const m of group.members) {
      const key = m.player.summoner.puuid
      out.set(m.key, (key ? byPuuid.get(key) : undefined) ?? tiers[m.index])
    }
  }
  return out
})

/** CHERRY 下非我方小队算「其他」阵营，CLASSIC 保留我方/敌方 */
function rosterSideOf(subteamId: number): RosterSide {
  if (subteamId === sessionData.mySubteamId) return 'mine'
  return roster.value.isMultiTeam ? 'other' : 'enemy'
}

/** 占位行：人数不足期望值时补空位（选人期未满员 / 中途离开） */
function placeholderCount(groupSize: number): number {
  return Math.max(0, roster.value.expectedSize - groupSize)
}

/* ================================================================
   名册墙（Akari 情报卡）：历史画像深度 band
   设计文档 docs/superpowers/specs/2026-10-05-gaming-roster-wall-design.md
   ================================================================ */

/** 名册墙最小视口宽度：低于此值 .roster 已是 minimal，名册墙不再重复 */
const ROSTER_WALL_MIN_WIDTH = 1400

/**
 * 名册墙可见性（ADR-4 密度档）。
 *
 * 三道门：
 * - 非大乱斗：大乱斗已有 MayhemDraftPanel 承担「选谁」，名册墙是历史画像，会打架
 * - 非多队：名册墙只有「我方 / 敌方」两栏，斗魂（CHERRY）三方平铺无法映射
 * - 视口 ≥1400：窄窗下 .roster 已是最小密度，名册墙会把页面推得过长
 *
 * 用本文件既有的响应式 viewportWidth（挂载时取一次 + 监听 resize），不用裸 window.innerWidth，
 * 否则缩放窗口时这道门不会重算。
 */
const rosterWallVisible = computed(() => {
  if (isMayhem.value) return false
  if (sessionData.isMultiTeam) return false
  return viewportWidth.value >= ROSTER_WALL_MIN_WIDTH
})

/** 名册墙密度：与既有 rosterDensity 判据同源，避免两处规则漂移 */
const rosterWallDensity = computed<'full' | 'slim'>(() =>
  rosterDensity.value === 'full' ? 'full' : 'slim'
)

/** puuid → 该玩家的段位列表（`useSessionTiers` 按 subteam 给，需按 puuid 重索引） */
const tiersByPuuid = computed(() => {
  const out = new Map<string, { imgUrl: string; tierCn: string }[]>()
  for (const group of roster.value.groups) {
    const tiers = tiersBySubteam.value[group.subteamId] ?? []
    group.members.forEach((m, i) => {
      const puuid = m.player.summoner?.puuid
      if (puuid && tiers[i] && !out.has(puuid)) out.set(puuid, tiers)
    })
  }
  return out
})

/**
 * 帧级画像（P1/P3）：C 类 Tag 的数据源。
 *
 * **不阻塞** summary 分析——名册墙先按现有数据渲染，帧级数据到位后
 * 自动补上 C 类 Tag。让一个数秒级的网络请求卡住整页是本末倒置。
 */
const timelinesByPuuid = ref(new Map<string, PlayerTimelineSummary>())

/** 本次要分析的 gameId：取各玩家近期对局的并集（去重），并按 P3 约定限量 */
const timelineGameIds = computed<number[]>(() => {
  if (!rosterWallVisible.value) return []
  const ids = new Set<number>()
  for (const s of sessionData.subteams) {
    for (const p of s.players) {
      for (const g of p.matchHistory?.games?.games ?? []) ids.add(g.gameId)
    }
  }
  return [...ids].slice(0, TIMELINE_GAME_LIMIT)
})

/** 帧级分析只对「有历史对局」的玩家有意义，且限量避免拉太多局 */
const TIMELINE_GAME_LIMIT = 6

/** 拉取帧级画像；失败静默（playerTimeline 内部已降级为 null） */
async function loadTimelines(): Promise<void> {
  const gameIds = timelineGameIds.value
  if (gameIds.length === 0) return

  // SGP 只提供按 gameId 的帧端点，且帧里没有队伍字段 ⇒ 队伍由前端给
  const players = sessionData.subteams.flatMap(s =>
    s.players.map(p => ({
      puuid: p.summoner?.puuid ?? '',
      // CLASSIC 下 subteamId 即队伍；斗魂多队时名册墙本就不显示
      teamId: s.subteamId
    }))
  )
  const valid = players.filter(p => p.puuid)
  if (valid.length === 0) return

  try {
    const region = await getCurrentSgpRegion()
    if (!region) return
    timelinesByPuuid.value = new Map(
      Object.entries(await fetchPlayerTimelines(region, gameIds, valid))
    )
  } catch {
    // 降级而非中断：留空 map，C 类 Tag 自动隐藏
    timelinesByPuuid.value = new Map()
  }
}

/** 名册墙成员：复用 analyzeRoster 的批量分析与降级结果 */
const rosterWallMembers = computed<RosterWallMember[]>(() => {
  const players = sessionData.subteams.flatMap(s => s.players)
  if (players.length === 0) return []

  const results = analyzeRoster(players, { nowMs: Date.now(), limit: matchCount.value * 10 })
  const tierMap = tiersByPuuid.value
  const members: RosterWallMember[] = []
  for (const p of players) {
    const puuid = p.summoner?.puuid ?? ''
    if (!puuid) continue
    const analysis = results.get(puuid)
    if (!analysis) continue
    members.push(
      toRosterWallMember(
        p,
        analysis,
        mySummonerPuuid.value,
        tierMap,
        false,
        // 帧级数据未就绪时为 null ⇒ C 类 Tag 自动隐藏（见 playerTimeline 降级纪律）
        timelinesByPuuid.value.get(puuid) ?? null
      )
    )
  }

  // 排序：预组队优先（像 Akari 的 orderPlayerBy='premade-team'）
  return members.sort((a, b) => {
    if (!!a.premadeGroup !== !!b.premadeGroup) return a.premadeGroup ? -1 : 1
    return (b.analysis.profile?.score.total ?? 0) - (a.analysis.profile?.score.total ?? 0)
  })
})

const rosterWallAlly = computed(() =>
  rosterWallMembers.value.filter(m => rosterSideOf(subteamIdOf(m.puuid)) === 'mine')
)
const rosterWallEnemy = computed(() =>
  rosterWallMembers.value.filter(m => rosterSideOf(subteamIdOf(m.puuid)) !== 'mine')
)

/** puuid → subteamId（名册墙只按 puuid 拿到成员，需反查阵营） */
function subteamIdOf(puuid: string): number {
  for (const s of sessionData.subteams) {
    if (s.players.some(p => p.summoner?.puuid === puuid)) return s.subteamId
  }
  return -1
}

/** 我方小队玩家列表，供 MayhemDraftPanel 复用（不再硬取 subteams[0]） */
const mySubteamPlayers = computed(
  () => sessionData.subteams.find(s => s.subteamId === sessionData.mySubteamId)?.players ?? []
)

const orderedSubteams = computed(() => {
  // 我方排第一格；其它按 subteamId 升序
  const my = sessionData.subteams.find(s => s.subteamId === sessionData.mySubteamId)
  const others = sessionData.subteams
    .filter(s => s.subteamId !== sessionData.mySubteamId)
    .sort((a, b) => a.subteamId - b.subteamId)
  return my ? [my, ...others] : others
})

/**
 * 推荐条是否出现（原先是「落哪一列」，名册布局下统一收到名册上方，故退化为布尔）。
 *
 * 敌方已锁 ≥2 → 对位视角；敌方未锁/不足但我方队友已亮 ≥1 → 纯协同视角。
 * 两态互斥，避免面板重复。
 */
const showBestPicksPanel = computed(
  () => enemyLockedIds.value.length >= 2 || teammatePickedIds.value.length >= 1
)

/**
 * 我方已亮队友英雄 id（含 intent/picking/locked，排除 ban 态与我自己）：
 * 协同推荐以「队友预选/锁定」为锚（场景：辅助预选 X → 推荐协同最优 AD）。
 */
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

/**
 * 我方已亮队友的本局分路（championId → LCU 命名，如 { 103: 'top' }）。
 * 与 teammatePickedIds 同一批玩家（排除 ban 态与我），供协同计算用实际位置
 * 拉取 synergies——比英雄主分路更贴近本局打法（如赛娜打辅助）。
 */
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

/** 我本局分路（LCU 命名 top/jungle/...；空 = 位置未知，不过滤候选池） */
const teammatesMyPosition = computed(() => {
  const pos = myPosition.value
  // 大小写不敏感校验：LCU 下发的是小写，直接 positionToOpgg 会漏判
  return pos && normalizeLcuPosition(pos) ? pos : ''
})

/** 当前对局对应的 OP.GG 数据模式（ARAM 队列走 aram，其余走 ranked） */
const opggMode = computed(() => queueIdToOpggMode(sessionData.queueId))

/** 我方已亮出的英雄 id 列表（用于敌方情报卡的克制提示，过滤未选中的 0/负值） */
const myChampionIds = computed(
  () =>
    orderedSubteams.value
      .find(s => s.subteamId === sessionData.mySubteamId)
      ?.players.map(p => p.championId)
      .filter(id => id > 0) ?? []
)

/**
 * P2 候选池：全量英雄列表（get_champion_options 一次性拉取，懒加载）。
 * 只依赖后端命令，与 loadChampionNames 各自独立、无冲突。
 */
const allChampionIds = ref<number[]>([])
let championOptionsLoaded = false

/** 候选池懒加载：仅 ranked && ChampSelect 且敌方锁定 ≥1 时才首次拉取 */
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

/** 敌方已锁英雄 id（>0 即已锁定；敌方 intent 恒 0 无需区分 pickState） */
const enemyLockedIds = computed(
  () =>
    orderedSubteams.value
      .filter(s => s.subteamId !== sessionData.mySubteamId)
      .flatMap(s => s.players.map(p => p.championId))
      .filter(id => id > 0) ?? []
)

/** 推荐隐藏规则：ranked 队列 && 选人阶段 && 候选池已就绪 */
const showBestPicks = computed(
  () =>
    opggMode.value === 'ranked' &&
    sessionData.phase === 'ChampSelect' &&
    allChampionIds.value.length > 0
)

/**
 * 候选集：全量池排除 双方 ban / 我方已亮（含 intent、picking、locked）/
 * 敌方已锁——被占用或被禁的英雄不参与「最优应对」推荐。
 */
const bestPickCandidates = computed(() => {
  if (allChampionIds.value.length === 0) return []
  const taken = new Set<number>([
    ...myBans.value,
    ...theirBans.value,
    ...myChampionIds.value,
    ...enemyLockedIds.value
  ])
  return allChampionIds.value.filter(id => !taken.has(id))
})

// 选人阶段敌方锁定后触发候选池懒加载（数据源就绪后 watch 重算推荐）
watch(
  () => [sessionData.phase, enemyLockedIds.value.length] as const,
  ([phase, n]) => {
    if (phase === 'ChampSelect' && n > 0) void ensureChampionOptions()
  },
  { immediate: true }
)

/**
 * 最后一次选人期快照。
 *
 * 离开选人期后后端不再下发 champSelect，sessionData.champSelect 会被 undefined 覆盖，
 * 但 ban 条与阶段条要留着供对局中/赛后回看，故前端自留一份。
 */
const lastChampSelect = ref<ChampSelect | undefined>(undefined)

// 新一局进入选人期时，新的 champSelect 数据还没到达——这个窗口里若不清掉快照，
// 横幅会误显示上一局的 ban（比什么都不显示更糟：用户会以为那是本局的）。
// phase 一变成 ChampSelect 立即清空，等新数据到达后由下面的 watch 重新填入。
watch(
  () => sessionData.phase,
  (newVal, oldVal) => {
    if (newVal === 'ChampSelect' && oldVal !== 'ChampSelect') {
      lastChampSelect.value = undefined
    }
  }
)

watch(
  () => sessionData.champSelect,
  cs => {
    if (cs !== undefined) lastChampSelect.value = cs
  }
)

/** 赛前威胁评级（M4 战场六）：选人阶段拉取敌方威胁数据 */
const threatRatings = ref<ThreatRating[]>([])
/** 敌方匿名（Riot 反侦查）：有敌方但全无身份，渲染显式引导而非静默空白 */
const isEnemyAnonymous = ref(false)
watch(
  () => sessionData.phase,
  phase => {
    if (phase === 'ChampSelect') {
      void getThreatRatings()
        .then(r => {
          // 后端/测试桩可能返回 undefined：归一为数组，避免模板读 length 崩溃
          threatRatings.value = Array.isArray(r?.ratings) ? r.ratings : []
          isEnemyAnonymous.value = r?.isEnemyAnonymous ?? false
        })
        .catch(() => {})
    } else {
      threatRatings.value = []
      isEnemyAnonymous.value = false
    }
  }
)

/**
 * 对局中下一动作建议（M5a 战场四）：只读绑定全局局内服务（debug4-4）。
 *
 * 轮询 + overlay 推送 + mayhem 调度已提升到 Framework 常驻的 useInGameServices，
 * 切页不再中断；这里不再自建 timer、不再 stop 调度、不再 hide 浮窗。
 */
const { nextActions } = useInGameServices()

/** 展示用 champSelect：实时数据优先，选人期结束后回退到最后一次快照，供离开选人期后继续展示阶段/ban 条 */
const displayChampSelect = computed(() => sessionData.champSelect ?? lastChampSelect.value)

/** 选人阶段结构化视图的 stage 字段（''=未知，驱动 stepper 是否展示） */
const champSelectStage = computed(() => displayChampSelect.value?.stage ?? '')
/** 当前 stage 在 STAGE_STEPS 中的下标，未匹配（如 '' 或非法值）时为 -1，stepper 各步均不高亮 */
const currentStageIndex = computed(() =>
  STAGE_STEPS.findIndex(s => s.key === champSelectStage.value)
)
/** 我方 / 敌方已 ban 英雄 id 列表，非选人期或无 ban 数据时为空数组 */
const myBans = computed(() => displayChampSelect.value?.myBans ?? [])
const theirBans = computed(() => displayChampSelect.value?.theirBans ?? [])
/** 任一方存在 ban 记录才展示 ban 条整块 */
const hasBans = computed(() => myBans.value.length > 0 || theirBans.value.length > 0)

/**
 * 横幅首段状态文案，随 sessionData.phase 变化（横幅不再限定选人期展示，见 Gaming.vue 模板）。
 * - `ChampSelect` → 选人中
 * - `GameStart` / `InProgress` → 对局中（`GameStart` 是选人结束到正式进圈前的过渡态，
 *   目前后端 `process_session_data` 的 `valid_phases` 未下发它，但 `useSessionSync`
 *   的重试/轮询逻辑仍多处按这个取值判断，这里一并纳入保持口径一致）
 * - `PreEndOfGame` / `EndOfGame` → 对局结束
 * - 其余取值（如 `Lobby`/`Matchmaking`/`ReadyCheck`）目前不会真正到达这里——
 *   `.gaming-page` 只在 `sessionData.phase` 非空时渲染，而后端只在上述四个阶段才会
 *   下发非空 phase，这里仅作防御性兜底：不编造一个无法验证含义的状态词，
 *   直接不给前缀，只显示 `typeCn`
 */
const bannerPhaseLabel = computed(() => {
  switch (sessionData.phase) {
    case 'ChampSelect':
      return '选人中'
    case 'GameStart':
    case 'InProgress':
      return '对局中'
    case 'PreEndOfGame':
    case 'EndOfGame':
      return '对局结束'
    default:
      return ''
  }
})

/** OP.GG 数据状态（版本号/是否滞后），驱动选人期数据横幅 */
const opggStatus = ref<OpggStatus | null>(null)
watch(opggMode, m => getOpggStatus(m).then(s => (opggStatus.value = s)), { immediate: true })

/**
 * 选人期 BP 决策预告。与 useSessionSync 平行——决策快照是会话级单例、
 * 一次算完、纯展示，不进 per-player 的同步链。
 */
const bp = useBpDecision(() => sessionData.phase)

/* ================= v3 情报舱 ================= */

/** 结论带动词：决策动作类型直译 */
const verdictVerb = computed(() => (bp.decision.value?.action_type === 'Ban' ? 'BAN' : '选'))

/** 结论英雄名：champion-names 缓存在 onMounted 预热，ban 阶段也有名字可显 */
const verdictChampion = computed(() => {
  const id = bp.decision.value?.target?.champion_id
  return id ? getChampionName(id) : ''
})

/**
 * 一句话理由（结论带只给一行）：
 * 手动覆盖 > 规则来源 > 兜底来源；evidence 对位风险并入兜底文案尾部。
 */
const verdictReason = computed(() => {
  const d = bp.decision.value
  if (!d || !d.target) return '当前无可执行目标，按兵不动'
  if (d.user_overridden) return '你已手动操作，本条建议仅作参考'
  const o = d.target.origin
  if (o.type === 'Rule') return `来自你的规则「${o.rule_name}」`
  const ev = d.target.evidence
  return `系统兜底（池内 ${o.pool_size} 个候选）${ev ? ` · 注意被 counter 风险` : ''}`
})

/** 三态：正常金 / 兜底弱化 / 无目标 idle —— 与 VerdictBanner 契约一致 */
const verdictState = computed<'decision' | 'fallback' | 'idle'>(() => {
  const d = bp.decision.value
  if (!d || !d.target) return 'idle'
  return d.user_overridden || d.target.origin.type === 'Fallback' ? 'fallback' : 'decision'
})

type SignalTab = 'strength' | 'threat' | 'next' | 'matchup'
const activeSignalTab = ref<SignalTab>('strength')
const signalTabs: Array<{ key: SignalTab; label: string }> = [
  { key: 'strength', label: '强度对比' },
  { key: 'threat', label: '威胁评级' },
  { key: 'next', label: '下一步' },
  { key: 'matchup', label: '对位 / 野区' }
]

/** AI 抽屉宽度：宽屏固定侧栏宽，窄窗占满（挂载时取一次即可） */
const aiDrawerWidth = Math.min(520, typeof window !== 'undefined' ? window.innerWidth : 520)

const router = useRouter()

/** 我的分路，取自会话里标着「我」的那名玩家；ARAM 等无分路模式为 null */
const myPosition = computed<Position | null>(() => {
  const me = orderedSubteams.value
    .flatMap(s => s.players)
    .find(p => p.summoner.puuid === mySummonerPuuid.value)
  const p = me?.assignedPosition?.toLowerCase()
  return p === 'top' || p === 'jungle' || p === 'middle' || p === 'bottom' || p === 'utility'
    ? p
    : null
})

const showConfig = ref(false)
const matchCount = ref(4)
const message = useMessage()

const { tier: opggTier, loading: opggTierLoading, loadTier, switchTier } = useOpggTier()
onMounted(loadTier)

/**
 * 段位切换。成功后补刷 opggStatus——换段位可能连补丁号一起变，
 * 横幅上的版本号不跟着更新就会和卡片数据对不上。
 */
const onTierChange = async (next: OpggTier) => {
  const ok = await switchTier(next)
  if (ok) {
    opggStatus.value = await getOpggStatus(opggMode.value)
  } else {
    message.error('段位数据拉取失败，已保持原段位显示')
  }
}

/**
 * AI 分析状态。面板显隐与请求生命周期是分开的两件事——按钮只管「打开面板」，
 * 关掉面板后随时能点回来看进度或已有结果，不会白烧一次调用。见
 * {@link useGamingAIAnalysis}。
 *
 * 选人期跑 prompt 前注入确定性事实：规则引擎决策（useBpDecision 快照）+ 双方
 * 阵容强度分（useLineupScore 按已锁定英雄聚合 OP.GG meta）。AI 只做解释层——
 * 引用这些数字，不得改写。
 */
const lineupScores = useLineupScore(sessionData, opggMode, {
  includePlayerProfiles: true,
  prefetchProfiles: true
})
const ai = useGamingAIAnalysis(sessionData, opggMode, {
  champSelectExtras: () => ({
    bpDecision: bp.decision.value,
    lineup: {
      mine: lineupScores.scores.value.mine,
      enemy: lineupScores.scores.value.enemy
    },
    matchup: lineupScores.scores.value.matchupHints,
    junglePatternLines: lineupScores.scores.value.junglePatternLine
      ? [lineupScores.scores.value.junglePatternLine]
      : null
  })
})

/**
 * 对局中实时分析（D-P2 对局中 tab）。
 *
 * 与 {@link useGamingAIAnalysis} 平行：对局中自动轮询 liveclientdata 快照，
 * 分析前先经 liveGameIntel 确定性聚合，AI 只引用不改写。赛前/赛后无实时数据
 * 时该 tab 展示「当前不在对局中」，轮询与限流由 composable 自管。
 */
const live = useLiveAIAnalysis(sessionData, { mySummoner })

/** AI 面板的 tab 结构（D-P2 三 tab）：选人期 / 对局中 / 赛后 */
type AiTab = 'champSelect' | 'live' | 'game'
const aiTab = ref<AiTab>('champSelect')

/** 按当前阶段决定面板默认打开的 tab；其余阶段（含兜底）一律赛后 */
const defaultAiTab = computed<AiTab>(() => {
  if (sessionData.phase === 'ChampSelect') return 'champSelect'
  if (sessionData.phase === 'InProgress' || sessionData.phase === 'GameStart') return 'live'
  return 'game'
})

/** 面板标题随当前 tab 变化 */
const aiPanelTitle = computed(() =>
  aiTab.value === 'champSelect'
    ? '选人期阵容分析'
    : aiTab.value === 'live'
      ? '对局中实时分析'
      : '赛后复盘'
)

/** 各 tab 独立渲染（kindState 按 kind 隔离，rendered 由报告渲染器统一转码） */
const champSelectRendered = computed(() =>
  renderAnalysisReport(ai.kindState.champSelect.result.value)
)
const gameRendered = computed(() => renderAnalysisReport(ai.kindState.game.result.value))
const liveUpdatedAt = computed(() =>
  live.lastPollAt.value
    ? new Date(live.lastPollAt.value).toLocaleTimeString('zh-CN', { hour12: false })
    : ''
)

/** 当前 tab 是否在进行中（决定「重新分析」按钮是否可点） */
const currentTabLoading = computed(() =>
  aiTab.value === 'live' ? live.loading.value : ai.kindState[aiTab.value].loading.value
)

/**
 * AI 按钮入口：打开面板并切到当前阶段对应的 tab；面板里没东西可看才自动发起
 * （live 走 useLiveAIAnalysis 的 ensureStarted，其余走 ai.openPanel 的限流逻辑）。
 */
function handleOpenPanel(): void {
  const tab = defaultAiTab.value
  aiTab.value = tab
  ai.showPanel.value = true
  if (tab === 'live') live.ensureStarted()
  else ai.openPanel()
}

/** 面板内「重新分析」：只重跑当前 tab 对应的分析（不限流） */
function rerunCurrentTab(): void {
  if (aiTab.value === 'live') void live.rerun()
  else void ai.rerunKind(aiTab.value)
}

/** 存规则进行中标志：防连点导致两次 reload 同一基线、后写覆盖先写丢规则 */
const savingRule = ref(false)

/**
 * 把当前决策固化成一条规则并跳转到配置页。
 *
 * 选人期只读、不提供就地编辑——30 秒窗口内改配置不现实。
 */
async function handleSaveRule(): Promise<void> {
  if (savingRule.value) return
  const d = bp.decision.value
  if (!d) return
  const draft = buildRuleDraft({
    decision: d,
    myPosition: myPosition.value,
    championName: getChampionName
  })
  if (!draft) {
    message.warning('当前没有可保存的目标')
    return
  }

  savingRule.value = true
  try {
    // ban 阶段没人 hover 过任何英雄时，英雄名缓存可能从未被触发加载
    // （ChampionIntelCard 只在有人 hover 后才加载）——存规则前先兜底加载一次，
    // 避免把「对位英雄60」这种占位文案写进持久化规则名。loadChampionNames
    // 本身幂等（缓存非空时立即返回），重复调用无副作用。
    await loadChampionNames()
    // 必须先 reload——usePickRules/useBanRules 每次调用都返回全新的空 ref，
    // 直接 save 会把已有规则整个清掉。
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
    // 立即重拉 session，让新 matchHistoryCount 立刻生效（无需等下局）
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

  // 英雄名缓存懒加载：此前只有 ChampionIntelCard 在有人 hover 后才触发，
  // 导致 ban 阶段（尚无人 hover）整段时间决策带只能显示「英雄157」占位符。
  // 提前在页面挂载时触发一次，幂等（已加载时立即返回）。
  void loadChampionNames()
  // 帧级画像（P1/P3）：不阻塞首屏，异步补 C 类 Tag
  void loadTimelines()

  // OP.GG 数据兜底刷新：后端启动已预热，此处 fire-and-forget 兜底软件长开超 12h 未重启的场景。
  // 两个模式都刷新完成后，重新拉取当前模式状态以更新横幅（版本号/滞后标记跟着变化）。
  void Promise.all([ensureOpggData('ranked'), ensureOpggData('aram')]).then(() =>
    getOpggStatus(opggMode.value).then(s => (opggStatus.value = s))
  )
})
</script>

<style scoped src="./Gaming.styles.css"></style>
