<template>
  <div
    class="record-card"
    role="button"
    tabindex="0"
    ref="rootEl"
    :class="{
      'record-card-win': isWin,
      'record-card-loss': !isWin,
      'record-card--sel': selected,
      'rc-d-legacy': isLegacy,
      'rc-density-compact': !isLegacy && activeDensity === 'compact',
      'rc-density-medium': !isLegacy && activeDensity === 'medium',
      'rc-density-wide': !isLegacy && activeDensity === 'wide'
    }"
    @click="openDetail"
    @keyup.enter="openDetail"
    @keydown.space.prevent="openDetail"
    @mouseenter="emit('hover-champion', games.participants[0].championId)"
    @mouseleave="emit('leave-champion')"
  >
    <!-- 战绩 v2 关闭（aRecordV2=false）：回退旧 48px 单行网格，交互/密度契约不变 -->
    <template v-if="isLegacy">
      <div class="record-card-body">
        <div class="record-card-grid">
          <!-- 胜负标记 + 时长（hover 看日期/模式，斗魂补名次） -->
          <span
            class="record-card-result-badge record-card-result-label"
            :class="isWin ? 'is-win' : 'is-loss'"
          >
            {{ resultLabel }}
          </span>
          <!-- 时间/模式/日期 -->
          <span class="record-card-time">
            <span class="font-number record-card-duration">{{ durationText }}</span>
            <span class="record-card-mode"
              >{{ dateText }}<template v-if="modeShortText"> · {{ modeShortText }}</template></span
            >
          </span>

          <!-- 英雄头像 + 召唤师技能 + MVP/SVP 角标 -->
          <div class="record-card-champion record-card-champion--legacy">
            <LazyImg
              class="record-card-champion-img"
              :src="`${assetPrefix}/champion/${games.participants[0].championId}`"
              alt="champion"
            />
            <span
              v-if="spell1Id > 0"
              class="record-card-spell record-card-spell-1"
              :title="`召唤师技能 ${spell1Id}`"
            >
              <LazyImg
                :src="assets.srcOf('spell', spell1Id)"
                class="record-card-spell-img"
                alt="spell"
              />
            </span>
            <span
              v-if="spell2Id > 0"
              class="record-card-spell record-card-spell-2"
              :title="`召唤师技能 ${spell2Id}`"
            >
              <LazyImg
                :src="assets.srcOf('spell', spell2Id)"
                class="record-card-spell-img"
                alt="spell"
              />
            </span>
            <span
              v-if="games.mvp"
              class="record-card-mvp"
              :class="games.mvp === 'MVP' ? 'record-card-mvp-gold' : 'record-card-mvp-silver'"
            >
              {{ games.mvp }}
            </span>
          </div>

          <!-- 英雄名 -->
          <n-ellipsis class="record-card-champion-name">{{ championName }}</n-ellipsis>

          <!-- KDA + CS/分钟（含野怪） -->
          <span class="record-card-kda">
            <span class="record-card-kda-line">
              <span class="record-card-kda-kill">{{ games.participants[0].stats?.kills }}</span>
              <span class="record-card-kda-sep">/</span>
              <span class="record-card-kda-death">{{ games.participants[0].stats?.deaths }}</span>
              <span class="record-card-kda-sep">/</span>
              <span class="record-card-kda-assist">{{ games.participants[0].stats?.assists }}</span>
            </span>
            <span class="record-card-cs">{{ csText }}</span>
          </span>

          <!-- 伤害 mini 条（伤害/承伤/治疗三段占全队比例）+ 伤害数值 -->
          <div class="record-card-damage">
            <div class="record-card-minibar">
              <span
                class="record-card-minibar-seg record-card-minibar-dmg"
                :style="{ width: `${minibarSegWidth(rate('damageDealtToChampionsRate'))}%` }"
              />
              <span
                class="record-card-minibar-seg record-card-minibar-taken"
                :style="{ width: `${minibarSegWidth(rate('damageTakenRate'))}%` }"
              />
              <span
                class="record-card-minibar-seg record-card-minibar-heal"
                :style="{ width: `${minibarSegWidth(rate('healRate'))}%` }"
              />
            </div>
            <span class="font-number record-card-damage-value">
              {{
                formatCompactNumber(games.participants[0].stats?.totalDamageDealtToChampions ?? 0)
              }}
            </span>
          </div>

          <!-- 参团率 -->
          <span
            class="font-number record-card-group-rate"
            :style="{ color: groupRateColor(games.participants[0].stats?.groupRate ?? 0, isDark) }"
          >
            {{ Math.round(games.participants[0].stats?.groupRate ?? 0) }}%参团
          </span>

          <!-- 装备前 4 件（augment 局替换为海克斯强化图标） -->
          <div class="record-card-slots">
            <template v-if="usesAugments">
              <span
                v-for="(augmentId, index) in displayedAugmentIds"
                :key="`record-augment-${index}`"
                :class="[
                  'record-card-slot record-card-augment-shell',
                  augmentRarityClass(
                    assets.detailOf('perk', augmentId)?.rarity,
                    'record-card-augment'
                  )
                ]"
              >
                <LazyImg
                  :src="assets.srcOf('perk', augmentId)"
                  class="record-card-slot-img"
                  alt="augment"
                />
              </span>
              <span
                v-for="i in Math.max(0, 4 - displayedAugmentIds.length)"
                :key="`aug-empty-${i}`"
                class="record-card-slot record-card-slot-empty"
              />
            </template>
            <template v-else>
              <n-tooltip
                v-for="(itemId, index) in itemIds.slice(0, 4)"
                :key="`record-item-${index}`"
                trigger="hover"
                placement="top"
                :disabled="!assets.detailOf('item', itemId)"
              >
                <template #trigger>
                  <span v-if="itemId > 0" class="record-card-slot">
                    <LazyImg
                      :src="assets.srcOf('item', itemId)"
                      class="record-card-slot-img"
                      alt="item"
                    />
                  </span>
                  <span v-else class="record-card-slot record-card-slot-empty" />
                </template>
                <AssetTooltipContent
                  v-if="itemId > 0"
                  :icon-src="assets.srcOf('item', itemId)"
                  :name="assets.detailOf('item', itemId)?.name ?? ''"
                  :description="assets.detailOf('item', itemId)?.description ?? ''"
                />
              </n-tooltip>
            </template>
          </div>

          <!-- 展开箭头 -->
          <n-icon
            class="record-card-chevron"
            :class="{ 'record-card-chevron--expanded': expanded }"
          >
            <ChevronDown />
          </n-icon>
        </div>
      </div>
    </template>

    <!-- v2 Akari 折叠架构：116px 三区（主列 / 阵容列 / 展开箭头列） -->
    <template v-else>
      <div class="record-card-body record-card-body--v2">
        <!-- 主列：头像+符文/技能 → KDA/伤害/参团 → 胜负+装备 → 元信息行 -->
        <div class="record-card-main">
          <div class="record-card-top">
            <div class="record-card-avatar-cluster">
              <div class="record-card-champion">
                <LazyImg
                  class="record-card-champion-img"
                  :src="`${assetPrefix}/champion/${games.participants[0].championId}`"
                  alt="champion"
                />
                <span
                  v-if="games.mvp"
                  class="record-card-mvp"
                  :class="games.mvp === 'MVP' ? 'record-card-mvp-gold' : 'record-card-mvp-silver'"
                >
                  {{ games.mvp }}
                </span>
              </div>
              <div v-if="spell1Id > 0 || spell2Id > 0" class="record-card-spells">
                <span
                  v-if="spell1Id > 0"
                  class="record-card-spell"
                  :title="`召唤师技能 ${spell1Id}`"
                >
                  <LazyImg
                    :src="assets.srcOf('spell', spell1Id)"
                    class="record-card-spell-img"
                    alt="spell"
                  />
                </span>
                <span
                  v-if="spell2Id > 0"
                  class="record-card-spell"
                  :title="`召唤师技能 ${spell2Id}`"
                >
                  <LazyImg
                    :src="assets.srcOf('spell', spell2Id)"
                    class="record-card-spell-img"
                    alt="spell"
                  />
                </span>
              </div>
              <div v-if="rune1Id > 0 || rune2Id > 0" class="record-card-runes">
                <span v-if="rune1Id > 0" class="record-card-rune" :title="`主系符文 ${rune1Id}`">
                  <LazyImg
                    :src="assets.srcOf('perk', rune1Id)"
                    class="record-card-rune-img"
                    alt="rune"
                  />
                </span>
                <span v-if="rune2Id > 0" class="record-card-rune" :title="`副系符文 ${rune2Id}`">
                  <LazyImg
                    :src="assets.srcOf('perk', rune2Id)"
                    class="record-card-rune-img"
                    alt="rune"
                  />
                </span>
              </div>
            </div>

            <span class="record-card-kda">
              <span class="record-card-kda-line">
                <span class="record-card-kda-kill">{{ games.participants[0].stats?.kills }}</span>
                <span class="record-card-kda-sep">/</span>
                <span class="record-card-kda-death">{{ games.participants[0].stats?.deaths }}</span>
                <span class="record-card-kda-sep">/</span>
                <span class="record-card-kda-assist">{{
                  games.participants[0].stats?.assists
                }}</span>
              </span>
              <span class="record-card-cs">{{ csText }}</span>
            </span>

            <div class="record-card-damage">
              <div class="record-card-minibar">
                <span
                  class="record-card-minibar-seg record-card-minibar-dmg"
                  :style="{ width: `${minibarSegWidth(rate('damageDealtToChampionsRate'))}%` }"
                />
                <span
                  class="record-card-minibar-seg record-card-minibar-taken"
                  :style="{ width: `${minibarSegWidth(rate('damageTakenRate'))}%` }"
                />
                <span
                  class="record-card-minibar-seg record-card-minibar-heal"
                  :style="{ width: `${minibarSegWidth(rate('healRate'))}%` }"
                />
              </div>
              <span class="font-number record-card-damage-value">
                {{
                  formatCompactNumber(games.participants[0].stats?.totalDamageDealtToChampions ?? 0)
                }}
              </span>
            </div>

            <span
              class="font-number record-card-group-rate"
              :style="{
                color: groupRateColor(games.participants[0].stats?.groupRate ?? 0, isDark)
              }"
            >
              {{ Math.round(games.participants[0].stats?.groupRate ?? 0) }}%参团
            </span>

            <!-- 展开头部唯一内容并入收起卡右侧空白（与卡上已有 KDA/输出/日期/队列去重后）：
                 昵称 · KDA 比值 · 金币 · 补兵 · 承伤 · 推塔 -->
            <div class="record-card-extra-stats">
              <span v-if="playerNameText" class="record-card-extra-name">{{ playerNameText }}</span>
              <span class="record-card-extra-item font-number">{{ kdaRatioText }}</span>
              <span class="record-card-extra-item"
                ><span class="font-number">{{ goldText }}</span> 金币</span
              >
              <span class="record-card-extra-item"
                ><span class="font-number">{{ csCountText }}</span> 补兵</span
              >
              <span class="record-card-extra-item"
                >承伤 <span class="font-number">{{ takenText }}</span></span
              >
              <span class="record-card-extra-item"
                >推塔 <span class="font-number">{{ turretsText }}</span></span
              >
            </div>
          </div>

          <div class="record-card-bottom">
            <span
              class="record-card-result-badge record-card-result-label"
              :class="isWin ? 'is-win' : 'is-loss'"
            >
              {{ resultLabel }}
            </span>
            <div class="record-card-slots">
              <template v-if="usesAugments">
                <span
                  v-for="(augmentId, index) in displayedAugmentIds"
                  :key="`record-augment-${index}`"
                  :class="[
                    'record-card-slot record-card-augment-shell',
                    augmentRarityClass(
                      assets.detailOf('perk', augmentId)?.rarity,
                      'record-card-augment'
                    )
                  ]"
                >
                  <LazyImg
                    :src="assets.srcOf('perk', augmentId)"
                    class="record-card-slot-img"
                    alt="augment"
                  />
                </span>
                <span
                  v-for="i in Math.max(0, 4 - displayedAugmentIds.length)"
                  :key="`aug-empty-${i}`"
                  class="record-card-slot record-card-slot-empty"
                />
              </template>
              <template v-else>
                <n-tooltip
                  v-for="(itemId, index) in itemIds"
                  :key="`record-item-${index}`"
                  trigger="hover"
                  placement="top"
                  :disabled="!assets.detailOf('item', itemId)"
                >
                  <template #trigger>
                    <span v-if="itemId > 0" class="record-card-slot">
                      <LazyImg
                        :src="assets.srcOf('item', itemId)"
                        class="record-card-slot-img"
                        alt="item"
                      />
                    </span>
                    <span v-else class="record-card-slot record-card-slot-empty" />
                  </template>
                  <AssetTooltipContent
                    v-if="itemId > 0"
                    :icon-src="assets.srcOf('item', itemId)"
                    :name="assets.detailOf('item', itemId)?.name ?? ''"
                    :description="assets.detailOf('item', itemId)?.description ?? ''"
                  />
                </n-tooltip>
              </template>
            </div>
          </div>

          <div class="record-card-meta">
            <span class="record-card-mode"
              >{{ dateText }}<template v-if="modeShortText"> · {{ modeShortText }}</template></span
            >
            <span class="record-card-meta-sep">·</span>
            <span class="font-number record-card-duration">{{ durationText }}</span>
            <span class="record-card-meta-sep">·</span>
            <span v-if="relativeTimeText" class="record-card-relative">{{ relativeTimeText }}</span>
            <span class="record-card-meta-sep">·</span>
            <span class="record-card-map">{{ mapNameText }}</span>
          </div>
        </div>

        <!-- 阵容列：双方各 5（斗魂 4）行迷你行，wide 常显 / medium hover 揭示 -->
        <div v-if="activeDensity !== 'compact'" class="record-card-lineup">
          <div
            v-for="team in lineupTeams"
            :key="team.key"
            class="record-card-lineup-team"
            :class="{ 'is-own': team.isOwn }"
          >
            <div
              v-for="row in team.players"
              :key="row.participantId"
              class="record-card-lineup-row"
              :class="{ 'is-self': row.isSelf }"
              :title="row.summonerName ?? row.championName"
            >
              <LazyImg
                class="record-card-lineup-ava"
                :src="`${assetPrefix}/champion/${row.championId}`"
                alt="champion"
              />
              <span class="record-card-lineup-name">{{ row.championName }}</span>
              <span class="font-number record-card-lineup-kda"
                ><b class="rc-k">{{ row.kills }}</b
                >/<i class="rc-d">{{ row.deaths }}</i
                >/<b class="rc-a">{{ row.assists }}</b></span
              >
            </div>
          </div>
        </div>

        <!-- 展开箭头列：最右 w-8 竖分隔线 -->
        <div class="record-card-chevron-rail">
          <n-icon
            class="record-card-chevron"
            :class="{ 'record-card-chevron--expanded': expanded }"
          >
            <ChevronDown />
          </n-icon>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { ChevronDown } from 'lucide-vue-next'
import { computed, inject, onMounted, ref } from 'vue'
import { NEllipsis, NIcon, NTooltip } from 'naive-ui'
import { formatCompactNumber, formatGameDate } from '@renderer/utils/format'
import { formatRelativeTime } from '@renderer/composables/useDateFormat'
import { useTheme } from '@renderer/composables/useTheme'
import { groupRateColor } from '@renderer/utils/colors'
import { assetPrefix } from '@renderer/services/http'
import { augmentRarityClass } from '@renderer/utils/augment'
import { useRecordV2 } from '@renderer/composables/useRecordV2'
import type { Game } from '@renderer/types/domain/match'
import type { championOption } from '@renderer/types/domain/champion'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import { recordAssetsKey } from '@renderer/composables/recordAssetsKey'
import {
  getRecordCardDensity,
  useRecordCardWidth,
  type RecordCardDensity
} from './useRecordCardDensity'
import AssetTooltipContent from './AssetTooltipContent.vue'
import LazyImg from '@renderer/components/common/LazyImg.vue'

const props = withDefaults(
  defineProps<{
    recordType?: boolean
    games: Game
    championOptions?: championOption[]
    expanded?: boolean
    /** v3 宽屏详情栏：当前行被选中（右侧栏正展示该对局） */
    selected?: boolean
    /**
     * v2 阵容列密度档。`auto`（默认）按卡片自身宽度自适应
     * （>=900 wide / 720–900 medium hover 揭示 / <720 compact）；
     * 测试或需要固定档位时可直接传入。
     */
    density?: 'auto' | RecordCardDensity
  }>(),
  { championOptions: () => [], expanded: false, selected: false, density: 'auto' }
)

const emit = defineEmits<{
  'open-detail': []
  'hover-champion': [championId: number]
  'leave-champion': []
}>()

/** 优先使用父级（MatchHistory）批量预加载的资源；独立使用时退回自己的 preload */
const injected = inject(recordAssetsKey, null)
const assets = injected ?? useRecordAssets()

/* === 战绩 v2 灰度：关闭时整卡回退旧交互 & 旧 48px 单行密度 === */
const isLegacy = computed(() => !(useRecordV2().value ?? true))

const rootEl = ref<HTMLElement | null>(null)
const { width: measuredWidth, start: startWidthWatch } = useRecordCardWidth(rootEl)
onMounted(() => startWidthWatch())

/** 实测档位；显式 density prop 可覆盖（测试/固定布局用） */
const activeDensity = computed<RecordCardDensity>(() => {
  if (props.density !== 'auto') return props.density
  return getRecordCardDensity(measuredWidth.value)
})

/** LCU mapId → 地图中文名（覆盖率按当前主环境：峡谷/极地/斗魂） */
const MAP_NAMES: Record<number, string> = {
  1: '召唤师峡谷',
  2: '召唤师峡谷',
  11: '召唤师峡谷',
  12: '嚎哭深渊',
  14: '嚎哭深渊',
  21: '嚎哭深渊',
  22: '嚎哭深渊',
  30: '斗魂竞技场',
  31: '斗魂竞技场',
  32: '斗魂竞技场',
  33: '斗魂竞技场'
}

/**
 * 对局时间戳归一化（与 formatGameDate 同规则：10 位秒 / 13~14 位毫秒 / 16 位微秒 /
 * ISO 字符串），为相对时间提供数值时间戳；解析不了返回 null。
 */
function parseGameTs(raw: string): number | null {
  if (!raw) return null
  const ts = Number(raw)
  let date: Date | null = null
  if (Number.isFinite(ts) && ts > 0) {
    const ms = ts < 1_000_000_000_000 ? ts * 1000 : ts >= 1_000_000_000_000_000 ? ts / 1000 : ts
    const d = new Date(ms)
    if (!Number.isNaN(d.getTime()) && d.getUTCFullYear() <= 2100) date = d
  }
  if (!date) {
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime()) && d.getUTCFullYear() <= 2100) date = d
  }
  return date ? date.getTime() : null
}

interface LineupRow {
  participantId: number
  championId: number
  championName: string
  summonerName?: string
  kills: number
  deaths: number
  assists: number
  isSelf: boolean
}

interface LineupTeam {
  key: number
  isOwn: boolean
  players: LineupRow[]
}

const champNameMap = computed(() => new Map(props.championOptions.map(o => [o.value, o.label])))

/** LCU participants 阵型：按 teamId 分组，我方（含 participants[0]）排前 */
const lineupTeams = computed<LineupTeam[]>(() => {
  const participants = props.games.participants
  const self = participants[0]
  if (!self) return []
  const identityAt = (participantId: number) =>
    props.games.participantIdentities[participantId - 1]?.player?.summonerName
  const byTeam = new Map<number, LineupTeam>()
  for (const p of participants) {
    const row: LineupRow = {
      participantId: p.participantId,
      championId: p.championId,
      championName: champNameMap.value.get(p.championId) ?? `英雄 ${p.championId}`,
      summonerName: identityAt(p.participantId),
      kills: p.stats?.kills ?? 0,
      deaths: p.stats?.deaths ?? 0,
      assists: p.stats?.assists ?? 0,
      isSelf: p.participantId === self.participantId
    }
    const team = byTeam.get(p.teamId) ?? {
      key: p.teamId,
      isOwn: p.teamId === self.teamId,
      players: []
    }
    team.players.push(row)
    byTeam.set(p.teamId, team)
  }
  const teams = [...byTeam.values()]
  teams.forEach(t => t.players.sort((a, b) => a.participantId - b.participantId))
  teams.sort((a, b) => Number(b.isOwn) - Number(a.isOwn))
  return teams
})

const isWin = computed(() => props.games.participants[0].stats.win)

const isCherry = computed(() => props.games.gameMode === 'CHERRY')
const usesAugments = computed(() => isCherry.value || props.games.queueId === 2400)
const placement = computed(() => props.games.participants[0]?.stats?.subteamPlacement ?? 0)

/** 主系/副系符文图标 id（LCU：perk0=基石符文，perkSubStyle=副系风格） */
const rune1Id = computed(() => props.games.participants[0]?.stats?.perk0 ?? 0)
const rune2Id = computed(() => props.games.participants[0]?.stats?.perkSubStyle ?? 0)

const mapNameText = computed(() => MAP_NAMES[props.games.mapId] ?? `地图 ${props.games.mapId}`)

/** 相对时间（刚刚/N 分钟前/N 小时前/N 天前），解析不了为空则整段隐藏 */
const relativeTimeText = computed(() => {
  const ts = parseGameTs(props.games.gameCreationDate)
  return ts == null ? '' : formatRelativeTime(ts)
})

/* 模式短名：斗魂/极地/单双/灵活/匹配/人机，未知 queueId 时退回 queueName 前 4 字 */
const MODE_SHORT: Record<number, string> = {
  400: '匹配',
  420: '单双',
  430: '单双',
  440: '灵活',
  450: '极地',
  460: '极地',
  490: '斗魂',
  700: '斗魂',
  720: '斗魂',
  1010: '斗魂',
  1700: '斗魂',
  1710: '斗魂',
  830: '人机',
  840: '人机',
  850: '人机'
}
const modeShortText = computed(() => {
  const known = MODE_SHORT[props.games.queueId]
  if (known) return known
  const fallback = (props.games.queueName || '').slice(0, 4)
  return fallback || '对局'
})

/**
 * 对局日期（hover 时长列）：MM-DD HH:mm，本地时区。
 * LCU 下发数值毫秒戳（"1755200000000"），SGP 跨区下发 ISO 字符串（"…Z"）——
 * 两种统一走 formatGameDate 按本地时区格式化；都解析不了的值才显示原样。
 */
const dateText = computed(() => formatGameDate(props.games.gameCreationDate))

const spell1Id = computed(() => props.games.participants[0]?.spell1Id ?? 0)
const spell2Id = computed(() => props.games.participants[0]?.spell2Id ?? 0)

/** 补刀/分钟（含野怪），对局时长异常时显示 0 */
const csText = computed(() => {
  const s = props.games.participants[0]?.stats
  const minutes = props.games.gameDuration / 60
  if (!s || minutes <= 0) return '0.0 CS/分'
  const cs = (s.totalMinionsKilled ?? 0) + (s.neutralMinionsKilled ?? 0)
  return `${(cs / minutes).toFixed(1)} CS/分`
})

const resultLabel = computed(() => {
  if (isCherry.value && placement.value > 0) {
    return `第 ${placement.value} 名`
  }
  return isWin.value ? '胜' : '负'
})

const durationText = computed(() => {
  const totalSeconds = Math.round(props.games.gameDuration)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})

const championName = computed(() => {
  const id = props.games.participants[0].championId
  return props.championOptions.find(option => option.value === id)?.label ?? `英雄 ${id}`
})

const augmentIds = computed(() => {
  const s = props.games.participants[0].stats
  return [
    s.playerAugment1,
    s.playerAugment2,
    s.playerAugment3,
    s.playerAugment4,
    s.playerAugment5,
    s.playerAugment6
  ].filter(id => id > 0)
})

const displayedAugmentIds = computed(() => {
  const ids = augmentIds.value
  // 折叠卡最多展示 4 个强化槽（与旧版一致），多余只参与详情
  return ids.length <= 4 ? ids : ids.slice(0, 4)
})

const itemIds = computed(() => {
  const s = props.games.participants[0].stats
  return [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6]
})

/** mini 条宽度：按全队比例 0-100 归一，直接映射为条内段宽 */
const rate = (key: 'damageDealtToChampionsRate' | 'damageTakenRate' | 'healRate') =>
  Math.max(0, Math.min(100, props.games.participants[0].stats?.[key] ?? 0))

const minibarSegWidth = (value: number) => (value >= 1 ? value : 0)

/** 本局玩家昵称（gameName#tagLine，缺 tag 时退 summonerName；无身份数据为空串隐藏） */
const playerNameText = computed(() => {
  const self = props.games.participants[0]
  if (!self) return ''
  // participantIdentities 按 participantId 顺序排列（与 lineup identityAt 同口径）
  const player = props.games.participantIdentities[self.participantId - 1]?.player
  if (!player) return ''
  if (player.gameName) {
    return player.tagLine ? `${player.gameName}#${player.tagLine}` : player.gameName
  }
  return player.summonerName ?? ''
})

/** KDA 比值 (K+A)/D，死亡 0 时按 1 计——与展开详情头部同口径 */
const kdaRatioText = computed(() => {
  const s = props.games.participants[0]?.stats
  if (!s) return ''
  return `${((s.kills + s.assists) / Math.max(1, s.deaths)).toFixed(1)} KDA`
})

const goldText = computed(() =>
  formatCompactNumber(props.games.participants[0]?.stats?.goldEarned ?? 0)
)

/** 总补刀（含野怪），与 csText（每分钟速率）互补不重复 */
const csCountText = computed(() => {
  const s = props.games.participants[0]?.stats
  if (!s) return '0'
  return String((s.totalMinionsKilled ?? 0) + (s.neutralMinionsKilled ?? 0))
})

const takenText = computed(() =>
  formatCompactNumber(props.games.participants[0]?.stats?.totalDamageTaken ?? 0)
)

const turretsText = computed(() =>
  formatCompactNumber(props.games.participants[0]?.stats?.damageDealtToTurrets ?? 0)
)

const { isDark } = useTheme()

function openDetail() {
  emit('open-detail')
}
</script>

<style scoped>
/* === 奥术金工 Hextech Forge 战绩行卡 === */
.record-card {
  position: relative;
  cursor: pointer;
  height: 116px;
  background: linear-gradient(180deg, rgba(21, 29, 41, 0.75), rgba(12, 16, 24, 0.85));
  border: 1px solid var(--border-subtle);
  clip-path: var(--clip-corner-sm);
  transition: all var(--dur-fast) var(--ease-expo);
}

/* 战绩 v2 关闭时回退旧 48px 单行密度 */
.rc-d-legacy {
  height: 48px;
}

.rc-d-legacy .record-card-body {
  display: block;
}

.theme-light .record-card {
  background: linear-gradient(180deg, #f7f4ed 0%, #ebe5d8 100%);
  border: 1px solid rgba(168, 146, 112, 0.35);
  box-shadow: 0 1px 3px rgba(60, 50, 30, 0.08);
}

/* 键盘可达性（R22-3）：焦点环仅键盘触发时出现，不干扰鼠标点击 */
.record-card:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

.record-card:hover {
  border-color: rgba(212, 165, 72, 0.45);
  transform: translateX(2px);
  background: linear-gradient(180deg, rgba(28, 38, 54, 0.85), rgba(16, 22, 32, 0.95));
}

.theme-light .record-card:hover {
  background: linear-gradient(180deg, #fffdf8 0%, #f0ebd9 100%);
  border-color: var(--brand-border);
}

.record-card:active {
  transform: scale(0.998);
  transition-duration: var(--dur-instant);
}

/* 胜负左侧微镶嵌光晕 */
.record-card-win {
  border-left: 2px solid var(--win);
}
.record-card-loss {
  border-left: 2px solid var(--loss);
}
.record-card-win:hover {
  border-left-color: var(--win-bright);
}
.record-card-loss:hover {
  border-left-color: var(--loss-bright);
}

/* v3 宽屏详情栏选中态：品牌金描边高亮当前行 */
.record-card--sel {
  border-color: var(--brand) !important;
  box-shadow: 0 0 12px var(--glow-brand);
  outline: 1px solid var(--brand-border);
  background: var(--bg-raised);
}

/* === v2 关闭回退：旧 48px 单行网格 === */
.record-card-grid {
  display: grid;
  grid-template-columns:
    36px
    54px
    36px
    minmax(56px, 1fr)
    minmax(60px, 80px)
    minmax(72px, 118px)
    minmax(48px, 64px)
    minmax(56px, 92px)
    20px;
  align-items: center;
  justify-content: start;
  gap: var(--space-8);
  height: 100%;
  padding: 0 var(--space-10);
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
}

/* === v2 Akari 折叠架构（116px 三区） === */
.record-card-body--v2 {
  display: flex;
  align-items: stretch;
  height: 100%;
  min-width: 0;
}

.record-card-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 6px var(--space-10);
  overflow: hidden;
}

/* 首行：头像簇 → KDA → 伤害 → 参团 */
.record-card-top {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  min-width: 0;
}

.record-card-avatar-cluster {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

/* 44px 头像 + 胜/败描边（奥术金工，非蓝/红） */
.record-card-body--v2 .record-card-champion {
  position: relative;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
}

.record-card-body--v2 .record-card-champion-img {
  display: block;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  border: 2px solid transparent;
  box-sizing: border-box;
}

.record-card-win .record-card-body--v2 .record-card-champion-img {
  border-color: color-mix(in srgb, var(--semantic-win) 65%, transparent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--semantic-win) 30%, transparent);
}

.record-card-loss .record-card-body--v2 .record-card-champion-img {
  border-color: color-mix(in srgb, var(--semantic-loss) 60%, transparent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--semantic-loss) 25%, transparent);
}

/* 技能/符文竖列：20px 图标 ×2 */
.record-card-spells,
.record-card-runes {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
}

.record-card-body--v2 .record-card-spell,
.record-card-rune {
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.55);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  background: var(--glass-bg-low);
  overflow: hidden;
}

.record-card-spell-img,
.record-card-rune-img {
  display: block;
  width: 100%;
  height: 100%;
}

/* 次行：胜负印章 + 装备 6 件 + 饰品 */
.record-card-bottom {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  min-width: 0;
}

/* 元信息行：日期·模式 · 时长 · 相对时间 · 地图 */
.record-card-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-2xs);
  font-weight: 600;
  color: var(--text-tertiary);
  white-space: nowrap;
  line-height: 1;
}

.record-card-meta-sep {
  color: var(--text-quaternary);
}

.record-card-relative {
  color: var(--text-quaternary);
}

/* 阵容列：宽档常显 / 中档 hover 揭示，宽 168px 对齐 Akari w-42 */
.record-card-lineup {
  display: none;
  align-items: stretch;
  gap: var(--space-10);
  padding: 10px var(--space-10);
  flex-shrink: 0;
  height: 100%;
  box-sizing: border-box;
}

.rc-density-wide .record-card-lineup,
.rc-density-medium:hover .record-card-lineup {
  display: flex;
  width: 168px;
}

.record-card-lineup-team {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 1px;
  min-width: 0;
  flex: 1 1 0;
}

.record-card-lineup-team:first-child {
  border-right: 1px solid var(--border-subtle);
  padding-right: var(--space-8);
}

.record-card-lineup-team.is-own:first-child {
  border-right-color: color-mix(in srgb, var(--brand) 45%, transparent);
}

.record-card-lineup-row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 16px;
  min-width: 0;
}

.record-card-lineup-ava {
  width: 16px;
  height: 16px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border-subtle);
  flex-shrink: 0;
  box-sizing: border-box;
}

.record-card-lineup-row.is-self .record-card-lineup-ava {
  border-color: var(--brand);
  box-shadow: 0 0 4px var(--glow-brand);
}

.record-card-lineup-name {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1 1 auto;
}

/* 720–900 hover 档：只亮头像 + 迷你 KDA，省出基行宽度 */
.rc-density-medium .record-card-lineup-name {
  display: none;
}

.record-card-lineup-kda {
  font-size: var(--font-size-2xs);
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

.record-card-lineup-kda .rc-k {
  color: var(--semantic-win);
}

.record-card-lineup-kda .rc-d {
  color: var(--semantic-loss);
  font-style: normal;
}

.record-card-lineup-kda .rc-a {
  color: var(--accent-gold-deep);
}

/* 展开箭头列：w-8 竖分隔线 */
.record-card-chevron-rail {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-subtle);
}

.record-card-chevron {
  color: var(--text-tertiary);
  font-size: var(--font-size-md);
  transition: transform var(--dur-fast) var(--ease-expo);
}

.record-card:hover .record-card-chevron {
  color: var(--text-secondary);
}

/* 就地展开：箭头翻转朝上，与展开状态呼应 */
.record-card-chevron--expanded {
  transform: rotate(180deg) !important;
  color: var(--text-primary);
}

/* === 共用：胜负印章 / KDA / 伤害 / 参团 / 装备 / 时分 ===== */
/* 胜负切角印章（Hextech Notched Badge） */
.record-card-result-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 26px;
  clip-path: var(--clip-notch);
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  font-size: var(--font-size-base);
  font-weight: 800;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.record-card-result-badge.is-win {
  color: var(--win-bright);
  background: linear-gradient(135deg, rgba(63, 191, 143, 0.28), rgba(20, 80, 55, 0.5));
  border: 1px solid rgba(63, 191, 143, 0.6);
  box-shadow: inset 0 0 6px rgba(63, 191, 143, 0.3);
  text-shadow: 0 0 8px rgba(92, 217, 171, 0.4);
}

.record-card-result-badge.is-loss {
  color: var(--loss-bright);
  background: linear-gradient(135deg, rgba(224, 92, 92, 0.22), rgba(100, 30, 30, 0.45));
  border: 1px solid rgba(224, 92, 92, 0.55);
  box-shadow: inset 0 0 6px rgba(224, 92, 92, 0.25);
}

.theme-light .record-card-result-badge.is-win {
  color: #1f6e52;
  background: linear-gradient(135deg, rgba(46, 143, 108, 0.18), rgba(46, 143, 108, 0.3));
  border: 1px solid rgba(46, 143, 108, 0.55);
  text-shadow: none;
}

.theme-light .record-card-result-badge.is-loss {
  color: #9c2e2e;
  background: linear-gradient(135deg, rgba(192, 68, 68, 0.16), rgba(192, 68, 68, 0.28));
  border: 1px solid rgba(192, 68, 68, 0.5);
  text-shadow: none;
}

/* 时长 + 日期/模式（日期常显：R5 回溯不用悬停；仅在 legacy 网格内竖排，v2 走 meta 行） */
.rc-d-legacy .record-card-time {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  line-height: 1;
}

.record-card-duration {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  font-weight: 600;
}

.record-card-mode {
  font-size: var(--font-size-2xs);
  font-weight: 700;
  color: var(--text-tertiary);
}

/* 英雄头像基础（legacy 36px 覆盖页） + MVP */
.record-card-champion--legacy {
  position: relative;
  width: 36px;
  height: 36px;
}

.record-card-champion--legacy .record-card-champion-img {
  display: block;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  box-sizing: border-box;
}

.record-card-win .record-card-champion--legacy .record-card-champion-img {
  border-color: color-mix(in srgb, var(--semantic-win) 45%, transparent);
}

.record-card-loss .record-card-champion--legacy .record-card-champion-img {
  border-color: color-mix(in srgb, var(--semantic-loss) 40%, transparent);
}

/* legacy 召唤师技能：头像左上角竖排两枚小图标 */
.record-card-champion--legacy .record-card-spell {
  position: absolute;
  left: -3px;
  width: 13px;
  height: 13px;
  border-radius: 3px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.55);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  background: var(--glass-bg-low);
  z-index: 1;
}

.record-card-champion--legacy .record-card-spell-1 {
  top: -2px;
}

.record-card-champion--legacy .record-card-spell-2 {
  top: 11px;
}

.record-card-mvp {
  position: absolute;
  left: -2px;
  bottom: -3px;
  display: inline-block;
  padding: 0 3px;
  height: 11px;
  font-weight: 800;
  font-size: var(--font-size-2xs);
  line-height: 11px;
  border-radius: var(--radius-pill);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
}

.record-card-mvp-gold {
  color: #fbbf24;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.35), rgba(180, 83, 9, 0.6));
  border: 1px solid rgba(245, 158, 11, 0.7);
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.4);
}

.record-card-mvp-silver {
  color: #cbd5e1;
  background: linear-gradient(135deg, rgba(148, 163, 184, 0.3), rgba(71, 85, 105, 0.5));
  border: 1px solid rgba(148, 163, 184, 0.6);
  box-shadow: 0 0 4px rgba(148, 163, 184, 0.25);
}

/* 英雄名（legacy 网格用） */
.record-card-champion-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

/* KDA + CS/分钟 */
.record-card-kda {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  line-height: 1;
  white-space: nowrap;
  flex-shrink: 0;
}

.record-card-kda-line {
  font-weight: 650;
  font-size: var(--font-size-base);
  white-space: nowrap;
}

.record-card-cs {
  font-size: var(--font-size-2xs);
  font-weight: 650;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.record-card-kda-kill {
  color: var(--semantic-win);
}

.record-card-kda-death {
  color: var(--semantic-loss);
}

.record-card-kda-assist {
  color: var(--accent-gold-deep);
}

.record-card-kda-sep {
  color: var(--text-tertiary);
}

/* 伤害 mini 条 + 数值 */
.record-card-damage {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
  flex-shrink: 0;
}

.record-card-minibar {
  display: flex;
  gap: 1px;
  width: 64px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--glass-bg-low);
  border: 1px solid var(--glass-border);
  overflow: hidden;
  flex-shrink: 0;
}

.record-card-minibar-seg {
  height: 100%;
}

.record-card-minibar-dmg {
  background: linear-gradient(90deg, #f59e0b, #f97316);
}

.record-card-minibar-taken {
  background: linear-gradient(90deg, #60a5fa, #3b82f6);
}

.record-card-minibar-heal {
  background: linear-gradient(90deg, #4ade80, #22c55e);
}

.record-card-damage-value {
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
}

/* 参团率 */
.record-card-group-rate {
  font-size: var(--font-size-xs);
  font-weight: 650;
  white-space: nowrap;
  flex-shrink: 0;
}

.record-card-group-rate.good {
  color: var(--semantic-win);
}

.record-card-group-rate.bad {
  color: var(--semantic-loss);
}

/* 展开头部并入的统计簇：顶行右侧空白，常显（昵称/KDA 比值/金币/补兵/承伤/推塔） */
.record-card-extra-stats {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  margin-left: auto;
  min-width: 0;
  flex-shrink: 1;
  overflow: hidden;
  font-size: var(--font-size-2xs);
  font-weight: 600;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.record-card-extra-name {
  color: var(--text-secondary);
  font-weight: 650;
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.record-card-extra-item {
  flex-shrink: 0;
}

.record-card-extra-item .font-number {
  color: var(--text-secondary);
}

/* 装备 / augment 槽（v2 卡内 22px 槽 + 空槽补齐至 7） */
.record-card-slots {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
}

.record-card-body--v2 .record-card-slot {
  width: 22px;
  height: 22px;
}

.record-card-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--glass-border);
  background: var(--bg-elevated);
  box-sizing: border-box;
  overflow: hidden;
  flex-shrink: 0;
}

.record-card-slot-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.record-card-slot-empty {
  border-color: color-mix(in srgb, var(--glass-border) 55%, transparent);
  background: color-mix(in srgb, var(--bg-elevated) 45%, transparent);
}

/* augment 稀有度边框：复用既有外壳变量的四档渐变 + 反色滤镜 */
.record-card-augment-shell {
  --augment-border: rgba(172, 185, 201, 0.42);
  --augment-background: linear-gradient(180deg, rgba(56, 65, 78, 0.92), rgba(27, 32, 41, 0.96));
  --augment-filter: none;
  border: 1px solid var(--augment-border);
  background: var(--augment-background);
}

.record-card-augment-prismatic {
  --augment-border: rgba(187, 125, 255, 0.92);
  --augment-background: linear-gradient(180deg, rgba(123, 82, 214, 0.9), rgba(55, 34, 110, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(79%) sepia(31%) saturate(2173%)
    hue-rotate(225deg) brightness(102%) contrast(101%);
}

.record-card-augment-gold {
  --augment-border: rgba(244, 198, 88, 0.92);
  --augment-background: linear-gradient(180deg, rgba(121, 90, 18, 0.9), rgba(62, 46, 8, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(82%) sepia(51%) saturate(590%)
    hue-rotate(354deg) brightness(103%) contrast(104%);
}

.record-card-augment-silver {
  --augment-border: rgba(191, 205, 227, 0.88);
  --augment-background: linear-gradient(180deg, rgba(86, 103, 126, 0.9), rgba(39, 48, 61, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(93%) sepia(10%) saturate(418%)
    hue-rotate(176deg) brightness(103%) contrast(99%);
}

.record-card-augment-bronze {
  --augment-border: rgba(197, 132, 89, 0.9);
  --augment-background: linear-gradient(180deg, rgba(118, 67, 35, 0.9), rgba(59, 33, 17, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(76%) sepia(31%) saturate(740%)
    hue-rotate(338deg) brightness(98%) contrast(94%);
}

.record-card-augment-default {
  --augment-border: rgba(172, 185, 201, 0.42);
  --augment-background: linear-gradient(180deg, rgba(56, 65, 78, 0.92), rgba(27, 32, 41, 0.96));
  --augment-filter: none;
}

.record-card-slot :deep(.record-card-slot-img) {
  filter: var(--augment-filter);
}
</style>
