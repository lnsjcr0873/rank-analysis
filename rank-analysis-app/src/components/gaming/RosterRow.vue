<template>
  <!--
    名册行：一名成员的全部可读信息压在一行里（名册优先布局）。
    与旧的成员卡片不同，这里**没有外层卡片壳**——行由父级名册容器统一提供
    分隔线与悬停底色，这样连续 10 行能读成一张表而不是 10 张卡片。
    英雄头像仍走 CounterHover 的对位弹层；段位/T 级/胜率沿用既有数据源与配色。
  -->
  <div
    class="roster-row"
    :class="[
      `roster-row--${side}`,
      `roster-row--density-${density}`,
      {
        'roster-row--self': isSelf,
        'roster-row--loading': isLoading,
        'roster-row--champ-select': champSelect,
        [pickStateClass]: champSelect && !!pickStateClass
      }
    ]"
    :style="{ '--stagger-i': index }"
  >
    <div class="roster-row__main">
      <!-- 头像 + 召唤师等级 -->
      <div class="avatar-wrapper">
        <CounterHover
          v-if="opggMode === 'ranked' && championId > 0"
          :champion-id="championId"
          :position="opggMeta?.position ?? ''"
          :tier="opggTier"
        >
          <n-image
            width="100%"
            :src="assetPrefix + '/champion/' + championId"
            preview-disabled
            :fallback-src="nullImg"
            class="champion-img"
          />
        </CounterHover>
        <n-image
          v-else
          width="100%"
          :src="assetPrefix + '/champion/' + championId"
          preview-disabled
          :fallback-src="nullImg"
          class="champion-img"
        />
        <div class="level-badge">{{ level }}</div>
      </div>

      <!-- 身份 + 段位 + 标签 -->
      <div class="info-wrapper">
        <n-flex align="center" :wrap="false" class="name-row">
          <n-button text class="name-btn" :title="fullName" @click="searchSummoner(fullName)">
            <n-ellipsis class="name-ellipsis" :tooltip="false">
              {{ displayName }}
            </n-ellipsis>
          </n-button>
          <n-tag v-if="isSelf" size="small" type="info">我</n-tag>
          <!-- 常用位置：局内同样有效（后端回填 selectedPosition），无需等画像预取 -->
          <n-tag v-if="positionLabel" size="small" class="pos-tag">{{ positionLabel }}</n-tag>
          <PlayerNoteBadge :puuid="puuid" :game-name="gameName" :tag-line="tagLine" size="small" />
          <n-icon
            v-if="puuid"
            class="copy-btn"
            :title="copied ? '已复制' : '复制 ID'"
            @click="onCopy"
          >
            <Check v-if="copied" />
            <Copy v-else />
          </n-icon>
        </n-flex>

        <n-flex align="center" :size="[6, 2]" class="meta-row">
          <span v-if="tagLine" class="tag-line">#{{ tagLine }}</span>
          <n-flex align="center" class="tier-row">
            <span v-if="tierIconUrl.includes('unranked')" class="tier-icon-placeholder">
              <n-icon><CircleHelp /></n-icon>
            </span>
            <LazyImg v-else class="tier-icon" :src="tierIconUrl" alt="tier" />
            <span class="tier-text">{{ tierCn }}</span>
          </n-flex>
          <n-tooltip v-if="opggMeta" trigger="hover">
            <template #trigger>
              <span class="opgg-chip">
                <span
                  v-if="opggBadge.label"
                  class="opgg-chip-tier"
                  :style="{ color: opggBadge.color, backgroundColor: opggBadge.bg }"
                  >{{ opggBadge.label }}</span
                >
                <span class="opgg-chip-rate" :class="opggWinRateClass">{{
                  formatWinRate(opggMeta.winRate)
                }}</span>
              </span>
            </template>
            OP.GG：该英雄在当前模式的梯度与全球胜率（非玩家个人胜率）
          </n-tooltip>
          <n-tooltip v-if="mayhemTier" trigger="hover">
            <template #trigger>
              <span
                class="mayhem-tier"
                role="button"
                tabindex="0"
                @click.stop="openMayhemDetail(championId)"
                @keydown.enter.stop="openMayhemDetail(championId)"
              >
                T{{ mayhemTier }}
              </span>
            </template>
            海克斯大乱斗官方强度 T{{ mayhemTier }} · 点击查看强化推荐与出装
          </n-tooltip>
          <PatchNoteBadge :champion-id="championId" :mode="opggMode" />
        </n-flex>
      </div>

      <!-- 预组队 + 系统标签 -->
      <div class="tag-row">
        <n-tooltip v-if="preGroupName" trigger="hover">
          <template #trigger>
            <n-tag size="small" :type="preGroupTagType">{{ preGroupName }}</n-tag>
          </template>
          预组队：近期多次同队，大概率一起排的；编号仅区分不同组
        </n-tooltip>
        <UnifiedTagRow
          :tags="tags"
          :puuid="puuid"
          :game-name="gameName"
          :tag-line="tagLine"
          :max-visible="tagMaxVisible"
        />
      </div>
    </div>

    <!-- 右侧：近期表现（模式/KDA/胜率）+ 最近对局缩略条 -->
    <div v-if="density !== 'minimal'" class="roster-row__stats">
      <PlayerStatsCard :recent="recent" :is-dark="isDark" />
    </div>
    <div v-if="density === 'full'" class="roster-row__history">
      <PlayerHistoryGrid :games="member.recentGames" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTheme } from '@renderer/composables/useTheme'
import { assetPrefix } from '@renderer/services/http'
import { useCopy } from '@renderer/composables/useCopy'
import {
  getChampionMeta,
  opggRevision,
  type ChampionMeta,
  type OpggMode
} from '@renderer/services/opgg'
import { tierBadge, formatWinRate, rosterPickStateClass, tagVisibleCap } from './championIntel'
import type { RosterMember, RosterSide } from '@renderer/features/gaming/services/roster'
import type { RankTag } from '@renderer/types/domain/analysis'

import LazyImg from '@renderer/components/common/LazyImg.vue'
import PlayerNoteBadge from '@renderer/components/common/PlayerNoteBadge.vue'
import UnifiedTagRow from '@renderer/components/common/UnifiedTagRow.vue'
import PatchNoteBadge from './PatchNoteBadge.vue'
import CounterHover from './CounterHover.vue'
import PlayerStatsCard from './PlayerStatsCard.vue'
import PlayerHistoryGrid from './PlayerHistoryGrid.vue'
import { Check, CircleHelp, Copy } from 'lucide-vue-next'
import type { TagProps } from 'naive-ui'

/**
 * 行密度。
 *
 * - `full`：身份 + 近期表现 + 最近对局缩略条（大屏 / CLASSIC）
 * - `normal`：身份 + 近期表现（大乱斗、多队斗魂）
 * - `minimal`：仅身份行（窄窗 / 1064px 以下）
 */
type RosterDensity = 'full' | 'normal' | 'minimal'

interface Props {
  member: RosterMember
  /** 组内序号，用于 stagger 动画 */
  index: number
  side: RosterSide
  isSelf: boolean
  isLoading: boolean
  /** 是否选人期：决定渲染选人态修饰类与 CounterHover 是否启用 */
  champSelect: boolean
  density?: RosterDensity
  opggMode?: OpggMode
  /** OP.GG 段位分段，透传给 CounterHover */
  opggTier?: string
  /** 段位图标 URL（由父级 useSessionTiers 按 puuid 提供） */
  tierIconUrl?: string
  /** 段位中文短名 */
  tierCn?: string
  /** 队列 ID：大乱斗官方 T 级仅在 2400 拉取 */
  queueId?: number
  /** 该英雄同队队友英雄 id，供对位弹层算协同 */
  teammateChampionIds?: number[]
}

const props = withDefaults(defineProps<Props>(), {
  density: 'normal',
  opggMode: 'ranked',
  opggTier: 'emerald_plus',
  tierIconUrl: '',
  tierCn: '无段位',
  queueId: 0,
  teammateChampionIds: () => []
})

const router = useRouter()
const { isDark } = useTheme()
const { copy } = useCopy()

const nullImg = computed(() => `${assetPrefix}/champion/0`)
const championId = computed(() => props.member.championId ?? 0)
const puuid = computed(() => props.member.player.summoner.puuid ?? '')
const gameName = computed(() => props.member.player.summoner.gameName ?? '')
const tagLine = computed(() => props.member.player.summoner.tagLine ?? '')
const level = computed(() => props.member.player.summoner.summonerLevel ?? 0)
const fullName = computed(() => `${gameName.value}#${tagLine.value}`.trim())
/**
 * 选人期敌方是匿名的（puuid 与 gameName 都为空），此时给一个按序号的占位名，
 * 否则行首头像旁边会是一块空白，用户读不出「这一行是第几个敌方位」。
 */
const displayName = computed(() => {
  if (gameName.value) return gameName.value
  if (fullName.value !== '#') return fullName.value
  return `匿名 ${props.index + 1}`
})
const recent = computed(() => props.member.recent)
const tags = computed(() => (props.member.player.userTag?.tag ?? []) as RankTag[])
const pickState = computed(() => props.member.pickState ?? '')
const pickStateClass = computed(() => rosterPickStateClass(pickState.value))
const preGroupName = computed(() => props.member.preGroupName ?? '')
const meetTotal = computed(() => props.member.meetTotal ?? 0)

/** 常用位置：LCU 小写命名 → 中文短名；大乱斗等无分配模式为空。 */
const POSITION_CN: Record<string, string> = {
  top: '上单',
  jungle: '打野',
  middle: '中单',
  bottom: '射手',
  utility: '辅助'
}
const positionLabel = computed(() => {
  const pos = props.member.assignedPosition ?? ''
  return POSITION_CN[pos.toLowerCase()] ?? ''
})

const preGroupTagType = computed<NonNullable<TagProps['type']>>(() => {
  switch (props.member.preGroupType) {
    case 'success':
      return 'success'
    case 'warning':
      return 'warning'
    case 'error':
      return 'error'
    case 'info':
      return 'info'
    default:
      return 'default'
  }
})

/** 预组队/相遇标记存在时压缩系统标签可见数（与既有成员卡片同口径）。 */
const tagMaxVisible = computed(() => tagVisibleCap(!!preGroupName.value, meetTotal.value > 0))

/** OP.GG 英雄元数据（T 级/胜率/分路），驱动 chip 与 CounterHover 分路。 */
const opggMeta = ref<ChampionMeta | null>(null)
/**
 * 内容级请求守卫：key 未变则跳过，避免同局内每次会话事件重拉。
 * rev 必须进 key——段位切换时 championId 与 mode 都没变。
 */
let lastOpggRequestKey = ''
watch(
  () => [championId.value, props.opggMode, opggRevision.value] as const,
  async ([cid, mode, rev]) => {
    const requestKey = `${cid}|${mode ?? ''}|${rev}`
    if (requestKey === lastOpggRequestKey) return
    lastOpggRequestKey = requestKey
    if (!mode || !cid || cid <= 0) {
      opggMeta.value = null
      return
    }
    try {
      // 注意参数顺序是 (mode, championId)，与 Tauri command 的字段序一致
      opggMeta.value = await getChampionMeta(mode, cid)
    } catch {
      opggMeta.value = null
    }
  },
  { immediate: true }
)

const opggBadge = computed(() => tierBadge(opggMeta.value?.tier ?? 0))
/** 胜率语义色：>=52% 绿、<=48% 红，与既有卡片同一套规则。 */
const opggWinRateClass = computed(() => {
  const rate = opggMeta.value?.winRate
  if (rate === undefined || rate <= 0) return ''
  if (rate >= 0.52) return 'opgg-chip-rate-good'
  if (rate <= 0.48) return 'opgg-chip-rate-bad'
  return ''
})

/**
 * 大乱斗（queueId 2400）官方 T 级角标。
 *
 * 动态导入 mayhem 元数据助手：非大乱斗模式零开销，也不把该模块拉进常规包图。
 * 只在 2400 拉取，其余队列恒空。
 */
const mayhemTier = ref<number | null>(null)
watch(
  () => [props.queueId, championId.value] as const,
  async ([qid, cid]) => {
    if (qid !== 2400 || !cid) {
      mayhemTier.value = null
      return
    }
    try {
      const { ensureMayhemChampionMeta } =
        await import('@renderer/features/mayhem/services/mayhemData')
      mayhemTier.value = (await ensureMayhemChampionMeta()).get(cid)?.tier ?? null
    } catch {
      mayhemTier.value = null
    }
  },
  { immediate: true }
)

function openMayhemDetail(id: number): void {
  if (!id) return
  void router.push({ name: 'MayhemChampionDetail', params: { id: String(id) } })
}

function searchSummoner(name: string): void {
  if (!name || name === '#') return
  void router.push({ name: 'record-player', query: { search: name } })
}

const copied = ref(false)
async function onCopy(): Promise<void> {
  await copy(fullName.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1200)
}
</script>

<style scoped src="./RosterRow.styles.css"></style>
