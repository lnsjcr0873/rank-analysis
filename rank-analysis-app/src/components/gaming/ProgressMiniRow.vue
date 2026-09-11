<template>
  <div class="stats-row">
    <span class="label">{{ label }}</span>
    <div class="progress-wrapper">
      <n-progress
        type="line"
        :percentage="safePercent"
        :height="6"
        :show-indicator="false"
        :color="color"
        processing
      />
      <span class="progress-text" :style="{ color }">{{ safePercent }}%</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NProgress } from 'naive-ui'

const props = defineProps<{
  label: string
  percent: number
  color: string
}>()

/** 纵深钳制：上游脏数据（负数/超 100）不再喂给 NProgress，避免 SVG 渲染错乱 */
const safePercent = computed(() =>
  Number.isFinite(props.percent) ? Math.min(100, Math.max(0, props.percent)) : 0
)
</script>

<style scoped>
.stats-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-size-sm);
}

.label {
  color: var(--n-text-color-3);
}

.progress-wrapper {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  flex: 1;
  justify-content: flex-end;
  margin-left: var(--space-8);
}

.progress-wrapper .n-progress {
  flex: 1;
  max-width: 120px;
}

.progress-text {
  font-size: var(--font-size-xs);
  min-width: 35px;
  text-align: right;
}
</style>
