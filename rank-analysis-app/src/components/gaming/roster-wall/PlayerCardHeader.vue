<script setup lang="ts">
/**
 * 名册墙卡片的头部：英雄头像 + 等级 + 昵称 + 段位。
 *
 * 昵称走遮罩（streamer mode 由上层决定是否传 `masked`），
 * 段位用 `useAssetUrl().getTierUrl` 取静态资源。
 */
import { computed } from 'vue'

import { useAssetUrl } from '@renderer/composables/useAssetUrl'

import PlayerTagChip from './PlayerTagChip.vue'
import type { PlayerTag } from '@renderer/features/gaming/roster-wall/playerTags'

const props = defineProps<{
  championId: number
  championName: string
  summonerLevel: number
  /** 已做遮罩处理的显示名 */
  displayName: string
  tagLine: string
  positionLabel: string
  /** 单双排段位文字（如「大师」）；null 表示无数据 */
  soloTierLabel: string | null
  /** 灵活组排段位文字 */
  flexTierLabel: string | null
  soloTierKey: string | null
  flexTierKey: string | null
  tags: PlayerTag[]
  /** streamer mode：隐藏可识别信息 */
  masked?: boolean
  privacy?: boolean
}>()

const { getChampionUrl, getTierUrl } = useAssetUrl()

const championUrl = computed(() => getChampionUrl(props.championId))
const soloTierUrl = computed(() => (props.soloTierKey ? getTierUrl(props.soloTierKey) : null))
const flexTierUrl = computed(() => (props.flexTierKey ? getTierUrl(props.flexTierKey) : null))

/** 只展示前若干个标签；Akari 是全部换行，此处限 4 个避免挤压战绩列表 */
const headTags = computed(() => props.tags.slice(0, 4))
</script>

<template>
  <div class="pcard-head">
    <span class="pcard-avatar">
      <img class="pcard-champ" :src="championUrl" :alt="championName" />
      <span class="pcard-level">{{ summonerLevel }}</span>
    </span>

    <div class="pcard-id">
      <div class="pcard-name" :title="masked ? '' : displayName">
        {{ displayName }}
        <span v-if="privacy" class="pcard-privacy" title="隐私模式">🔒</span>
      </div>
      <div class="pcard-sub">
        <span>#{{ tagLine }}</span>
        <span class="pcard-sub-sep">·</span>
        <span>{{ positionLabel }}</span>
      </div>
      <div class="pcard-tiers">
        <span v-if="soloTierUrl" class="pcard-tier" :title="`单双排 ${soloTierLabel}`">
          <img class="pcard-tier-icon" :src="soloTierUrl" :alt="soloTierLabel ?? ''" />
          <span class="pcard-tier-text">{{ soloTierLabel }}</span>
        </span>
        <span v-if="flexTierUrl" class="pcard-tier" :title="`灵活组排 ${flexTierLabel}`">
          <img class="pcard-tier-icon" :src="flexTierUrl" :alt="flexTierLabel ?? ''" />
          <span class="pcard-tier-text">{{ flexTierLabel }}</span>
        </span>
      </div>
    </div>
  </div>

  <div v-if="headTags.length" class="pcard-head-tags">
    <PlayerTagChip v-for="t in headTags" :key="t.id" :tag="t" />
  </div>
</template>

<style scoped>
.pcard-head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-6);
  min-width: 0;
}

.pcard-avatar {
  position: relative;
  flex-shrink: 0;
  width: 34px;
  height: 34px;
}

.pcard-champ {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 3px;
  object-fit: cover;
  background: var(--bg-sunken);
}

.pcard-level {
  position: absolute;
  bottom: -3px;
  left: -3px;
  min-width: 15px;
  height: 14px;
  padding: 0 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-num);
  font-size: var(--font-size-2xs);
  font-weight: 700;
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: 2px;
}

.pcard-id {
  flex: 1;
  min-width: 0;
}

.pcard-name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-sm);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pcard-privacy {
  font-size: var(--font-size-2xs);
  opacity: 0.8;
}

.pcard-sub {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pcard-sub-sep {
  opacity: 0.5;
}

.pcard-tiers {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-top: 2px;
}

.pcard-tier {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 3px;
  background: var(--bg-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: 2px;
}

.pcard-tier-icon {
  width: 9px;
  height: 9px;
}

.pcard-tier-text {
  font-family: var(--font-num);
  font-size: var(--font-size-2xs);
  color: var(--text-secondary);
}

/* 头部标签行：与主体标签区分，独立一行以免挤压 240px 卡宽 */
.pcard-head-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: var(--space-4);
}
</style>
