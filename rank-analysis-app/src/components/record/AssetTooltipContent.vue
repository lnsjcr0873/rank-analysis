<template>
  <div class="asset-tooltip" :class="rarityClass">
    <div class="asset-tooltip-header">
      <img :src="iconSrc" :alt="name" class="asset-tooltip-icon" loading="lazy" decoding="async" />
      <div class="asset-tooltip-title-wrap">
        <div class="asset-tooltip-title">{{ name }}</div>
        <div v-if="rarityLabel" class="asset-tooltip-rarity" :class="rarityClass">
          {{ rarityLabel }}
        </div>
      </div>
    </div>
    <div v-if="descriptionNodes.length" class="asset-tooltip-description">
      <template v-for="(n, i) in descriptionNodes" :key="i">
        <br v-if="n.type === 'br'" />
        <span v-else-if="n.color" :style="{ color: n.color }">{{ n.text }}</span>
        <template v-else>{{ n.text }}</template>
      </template>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { parseTooltipNodes } from '../../utils/tooltipParse'

const props = defineProps<{
  iconSrc: string
  name: string
  description: string
  /** LCU 返回的海克斯强化稀有度，如 kPrismatic / kGold / kSilver / kBronze */
  rarity?: string
}>()

const rarityMeta: Record<string, { label: string; cls: string }> = {
  kPrismatic: { label: '棱彩', cls: 'asset-tooltip-prismatic' },
  kGold: { label: '黄金', cls: 'asset-tooltip-gold' },
  kSilver: { label: '白银', cls: 'asset-tooltip-silver' },
  kBronze: { label: '青铜', cls: 'asset-tooltip-bronze' }
}

const rarityClass = computed(() => (props.rarity ? (rarityMeta[props.rarity]?.cls ?? '') : ''))
const rarityLabel = computed(() => (props.rarity ? (rarityMeta[props.rarity]?.label ?? '') : ''))

const descriptionNodes = computed(() => parseTooltipNodes(props.description))
</script>

<style scoped>
.asset-tooltip {
  max-width: 320px;
  padding: var(--space-2) 0;
  position: relative;
}

/* 海克斯稀有度：tooltip 左侧一条色带 + 标题色 */
.asset-tooltip.asset-tooltip-prismatic {
  --rarity-color: #bb7dff;
}

.asset-tooltip.asset-tooltip-gold {
  --rarity-color: #f4c658;
}

.asset-tooltip.asset-tooltip-silver {
  --rarity-color: #bfcde3;
}

.asset-tooltip.asset-tooltip-bronze {
  --rarity-color: #c58459;
}

.asset-tooltip[class*='asset-tooltip-']::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--rarity-color);
  border-radius: var(--radius-xs);
  box-shadow: 0 0 6px var(--rarity-color);
}

.asset-tooltip-header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-8);
  margin-bottom: var(--space-6);
}

.asset-tooltip-icon {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  object-fit: cover;
}

.asset-tooltip[class*='asset-tooltip-'] .asset-tooltip-icon {
  border: 1px solid var(--rarity-color);
  box-shadow: 0 0 6px color-mix(in srgb, var(--rarity-color) 40%, transparent);
}

.asset-tooltip-title-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.asset-tooltip-title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  line-height: var(--line-height-tight);
}

.asset-tooltip[class*='asset-tooltip-'] .asset-tooltip-title {
  color: var(--rarity-color);
}

.asset-tooltip-rarity {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--rarity-color);
  letter-spacing: 0.04em;
}

.asset-tooltip-description {
  white-space: normal;
  line-height: var(--line-height-normal);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.asset-tooltip-description :deep(span) {
  /* 允许行内颜色标签生效 */
}

.asset-tooltip-description :deep(br) {
  display: block;
  content: '';
  margin-bottom: var(--space-4);
}
</style>
