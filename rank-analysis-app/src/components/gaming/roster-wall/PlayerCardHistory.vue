<script setup lang="ts">
/**
 * 名册墙卡片的最近对局列表（复刻 Akari `PlayerInfoCardMatchHistory`）。
 *
 * 行高 34px、胜负底色（蓝胜/红负/灰中立）、显示队列名 + 日期 + KDA。
 * **默认只渲染前 N 行**（Akari 用 NVirtualList 虚拟滚动，此处用「先渲染 N 行 +
 * 「展开其余」按钮」达到同等目的），避免 10 人 × 50 场 = 500 行 DOM 拖垮滚动
 * （设计文档风险 R4）。
 *
 * 底部渐隐遮罩让被裁掉的半行读作「下面还有」而非渲染 bug。
 */
import { computed } from 'vue'

import type { PreparedGame } from '@renderer/features/gaming/analysis/types'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'

const props = defineProps<{
  games: PreparedGame[]
  championName: (id: number) => string
  /** 折叠态展示行数；展开时展示全部 */
  collapsedRows?: number
  expanded?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-expand'): void
  (e: 'open-game', gameId: number): void
}>()

const { getChampionUrl } = useAssetUrl()

const collapsed = computed(() => props.collapsedRows ?? 5)
const visible = computed(() =>
  props.expanded ? props.games : props.games.slice(0, collapsed.value)
)
const overflow = computed(() => props.games.length - visible.value.length)

/** 队列中文名；后端未给时退回「对局」（不显示 undefined） */
function queueName(game: PreparedGame): string {
  return game.basic.queueName || '对局'
}

/** 胜负色：胜=蓝 负=红 中立（重赛/中止/练习）=灰 */
function resultTone(game: PreparedGame): 'win' | 'loss' | 'neutral' {
  // 斗魂局的名次已在 profile 里单独统计，此处只按胜负着色；
  // 名次为 0（数据未落定）按中立处理，避免误标成"负"
  if (game.basic.gameMode === 'CHERRY') {
    return game.self.subteamPlacement === null ? 'neutral' : game.self.win ? 'win' : 'loss'
  }
  return game.self.win ? 'win' : 'loss'
}

function resultText(game: PreparedGame): string {
  if (game.basic.gameMode === 'CHERRY' && game.self.subteamPlacement !== null) {
    return `第${game.self.subteamPlacement}`
  }
  const tone = resultTone(game)
  if (tone === 'win') return '胜'
  if (tone === 'loss') return '负'
  return '其他'
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}
</script>

<template>
  <div class="pcard-history">
    <button
      v-for="(g, i) in visible"
      :key="`${g.gameId}-${i}`"
      class="mh-row"
      :class="`mh-row--${resultTone(g)}`"
      type="button"
      @click="emit('open-game', g.gameId)"
    >
      <img class="mh-champ" :src="getChampionUrl(g.self.championId)" alt="" />
      <span class="mh-meta">
        <span class="mh-queue">{{ queueName(g) }}</span>
        <span class="mh-date">
          {{ fmtDate(g.basic.gameCreation) }}
          <span class="mh-result" :class="`mh-result--${resultTone(g)}`">{{ resultText(g) }}</span>
        </span>
      </span>
      <span class="mh-kda">{{ g.self.kills }} / {{ g.self.deaths }} / {{ g.self.assists }}</span>
    </button>

    <button v-if="overflow > 0" class="mh-more" type="button" @click="emit('toggle-expand')">
      其余 {{ overflow }} 场 ▾
    </button>
    <button
      v-else-if="expanded && games.length > collapsed"
      class="mh-more"
      type="button"
      @click="emit('toggle-expand')"
    >
      收起 ▴
    </button>
  </div>
</template>

<style scoped>
.pcard-history {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 底部渐隐：让被裁掉的半行读作「下面还有」 */
.pcard-history::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 14px;
  background: linear-gradient(180deg, transparent, var(--bg-raised));
  pointer-events: none;
}

.mh-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex: none;
  height: 34px;
  padding: 0 var(--space-4);
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
  transition: filter var(--dur-fast) var(--ease-expo);
}

.mh-row:hover {
  filter: brightness(1.2);
}

.mh-row--win {
  background: rgba(59, 130, 246, 0.22);
}

.mh-row--loss {
  background: rgba(224, 92, 92, 0.2);
}

.mh-row--neutral {
  background: rgba(255, 255, 255, 0.12);
}

.mh-champ {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 2px;
  object-fit: cover;
  background: var(--bg-sunken);
}

.mh-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.mh-queue {
  font-size: var(--font-size-2xs);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mh-date {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  font-family: var(--font-num);
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}

.mh-result--win {
  color: #93c5fd;
}
.mh-result--loss {
  color: #fca5a5;
}
.mh-result--neutral {
  color: var(--text-secondary);
}

.mh-kda {
  flex: none;
  font-family: var(--font-num);
  font-size: var(--font-size-2xs);
  color: var(--text-secondary);
}

.mh-more {
  flex: none;
  height: 20px;
  font: inherit;
  font-family: var(--font-num);
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 3px;
  cursor: pointer;
}

.mh-more:hover {
  color: var(--brand);
  border-color: var(--brand-border);
}
</style>
