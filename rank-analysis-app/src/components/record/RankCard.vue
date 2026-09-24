<template>
  <div class="rank-card">
    <div class="rank-card-content">
      <div class="rank-card-icon-wrapper">
        <span class="rank-card-type-label">{{ label }}</span>
        <img :src="tierImage(queueInfo.tier)" class="rank-card-img" alt="tier" />
        <div class="rank-card-tier-text">
          {{ formatTierText(queueInfo) }}
        </div>
      </div>
      <div class="rank-card-stats">
        <div class="rank-card-win-badge" :class="badgeClass">
          {{ hasGames ? `胜率 ${recent.winRate}%` : '暂无对局' }}
        </div>
        <div class="rank-card-stats-row">
          <span class="rank-card-stat-text font-number">胜场: {{ recent.wins }}</span>
          <span class="rank-card-stat-text font-number">负场: {{ recent.losses }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { QueueInfo } from '@renderer/types/domain/player'
import type { RecentWinRate } from '@renderer/types/domain/player'
import { formatTierText } from '@renderer/utils/rank'
import { tierImage } from '@renderer/utils/tier-image'

const props = defineProps<{
  label: string
  queueInfo: QueueInfo
  recent: RecentWinRate
}>()

/** 0 胜 0 负说明该队列没打过，红色「胜率 0%」会被误读成连败 */
const hasGames = computed(() => props.recent.wins + props.recent.losses > 0)

const badgeClass = computed(() => {
  if (!hasGames.value) return 'normal'
  if (props.recent.winRate >= 58) return 'good'
  if (props.recent.winRate <= 49) return 'bad'
  return 'normal'
})
</script>

<style scoped>
.rank-card {
  padding: var(--space-10) var(--space-12);
  background: linear-gradient(180deg, var(--bg-raised), var(--bg-sunken));
  border: 1px solid var(--border-strong);
  clip-path: var(--clip-corner-sm);
  transition: all var(--dur-fast) var(--ease-expo);
}

.theme-light .rank-card {
  background: linear-gradient(180deg, var(--bg-raised), var(--bg-sunken));
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-1);
}

.rank-card-content {
  display: flex;
  align-items: center;
  gap: var(--space-12);
}

.rank-card-icon-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 70px;
}

.rank-card-type-label {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  position: absolute;
  top: calc(var(--space-8) * -1);
  left: 0;
}

.rank-card-img {
  width: 56px;
  height: 56px;
  object-fit: contain;
}

.rank-card-tier-text {
  font-size: var(--font-size-sm);
  white-space: nowrap;
  font-weight: bold;
  text-align: center;
  line-height: var(--line-height-tight);
  margin-top: calc(var(--space-4) * -1);
}

.rank-card-stats {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.rank-card-stats-row {
  width: 100%;
  margin-top: var(--space-4);
  display: flex;
  justify-content: space-between;
}

.rank-card-stat-text {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.rank-card-win-badge {
  padding: 2px 8px;
  clip-path: var(--clip-notch);
  font-size: var(--font-size-xs);
  font-weight: 800;
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  background: var(--glass-bg-low);
  border: 1px solid var(--border-subtle);
}

.rank-card-win-badge.good {
  color: var(--win-bright);
  background: var(--win-soft);
  border-color: var(--win-border);
}

.rank-card-win-badge.bad {
  color: var(--loss-bright);
  background: var(--loss-soft);
  border-color: var(--loss-border);
}

.rank-card-win-badge.normal {
  color: var(--text-secondary);
}

.theme-light .rank-card-win-badge.good {
  color: color-mix(in srgb, var(--win) 75%, black);
  background: var(--win-soft);
  border-color: var(--win-border);
}

.theme-light .rank-card-win-badge.bad {
  color: color-mix(in srgb, var(--loss) 75%, black);
  background: var(--loss-soft);
  border-color: var(--loss-border);
}
</style>
