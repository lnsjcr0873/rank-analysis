<template>
  <div v-if="actions.length > 0" class="next-action-card">
    <div
      v-for="(action, i) in actions"
      :key="i"
      class="next-action-item"
      :class="`next-action-${action.urgency}`"
    >
      <div class="na-left">
        <span class="na-kind">{{ labelOf(action.kind) }}</span>
        <span class="na-urgency" :style="{ color: URGENCY_COLORS[action.urgency] }">
          {{ urgencyLabel(action.urgency) }}
        </span>
      </div>
      <div class="na-reason">{{ action.reason }}</div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { NEXT_ACTION_LABELS, URGENCY_COLORS, type NextAction } from '@renderer/services/nextAction'

defineProps<{
  actions: NextAction[]
}>()

function labelOf(kind: string): string {
  return NEXT_ACTION_LABELS[kind] ?? kind
}

function urgencyLabel(u: string): string {
  return u === 'high' ? '立即' : u === 'medium' ? '建议' : '参考'
}
</script>

<style scoped>
.next-action-card {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.next-action-item {
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(18, 25, 38, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-left: 3px solid transparent;
  font-size: 12px;
}

.next-action-high {
  border-left-color: #ff4655;
}

.next-action-medium {
  border-left-color: #f59e0b;
}

.next-action-low {
  border-left-color: #38bdf8;
}

.na-left {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.na-kind {
  font-weight: 700;
  color: #f8fafc;
}

.na-urgency {
  font-size: 11px;
  font-weight: 600;
}

.na-reason {
  color: #cbd5e1;
  line-height: 1.5;
}
</style>
