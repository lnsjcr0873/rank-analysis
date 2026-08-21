<template>
  <VueDraggable
    :model-value="rules"
    @update:model-value="(next: T[]) => $emit('update:rules', next)"
  >
    <div v-for="rule in rules" :key="rule.id" class="rule-row">
      <n-checkbox
        :checked="rule.enabled"
        @update:checked="(v: boolean) => $emit('toggle', rule.id, v)"
      />
      <span class="rule-name">{{ rule.name }}</span>
      <n-avatar
        :src="assetPrefix + '/champion/' + rule.action.champion_id"
        :fallback-src="`${assetPrefix}/champion/-1`"
        :size="24"
        style="flex-shrink: 0"
      />
      <span class="rule-summary">{{ summarize(rule) }}</span>
      <n-button quaternary size="small" @click="$emit('edit', rule)">编辑</n-button>
      <n-button quaternary type="error" size="small" @click="$emit('delete', rule.id)">删除</n-button>
    </div>
  </VueDraggable>
</template>

<script setup lang="ts" generic="T extends PickRule | BanRule">
import { VueDraggable } from 'vue-draggable-plus'
import type { PickRule, BanRule, PickAction } from '@renderer/types/rules'
import type { championOption } from '@renderer/types/domain/champion'

const props = defineProps<{
  rules: T[]
  assetPrefix: string
  championOptions: championOption[]
}>()

defineEmits<{
  (e: 'update:rules', rules: T[]): void
  (e: 'toggle', id: string, enabled: boolean): void
  (e: 'edit', rule: T): void
  (e: 'delete', id: string): void
}>()

function summarize(rule: PickRule | BanRule): string {
  const positionLabel = (p: string) =>
    ({ top: '上路', jungle: '打野', middle: '中路', bottom: '下路', utility: '辅助' })[p] ?? p
  const parts: string[] = []
  for (const c of rule.conditions) {
    switch (c.type) {
      case 'Position':
        parts.push(positionLabel(c.value))
        break
      case 'AllyChampionsContains':
        parts.push(`自家含 ${c.ids.length} 个`)
        break
      case 'AllyChampionsNotContains':
        parts.push(`自家无 ${c.ids.length} 个`)
        break
      case 'EnemyChampionsContains':
        parts.push(`对面含 ${c.ids.length} 个`)
        break
      case 'EnemyChampionsNotContains':
        parts.push(`对面无 ${c.ids.length} 个`)
        break
    }
  }
  const target =
    props.championOptions.find(c => c.value === rule.action.champion_id)?.label ??
    `#${rule.action.champion_id}`
  const isPick = 'lock' in rule.action
  const lockTag = isPick && (rule.action as PickAction).lock ? ' [锁]' : ''
  return `${parts.join(' + ')} → ${isPick ? '选' : 'Ban'} ${target}${lockTag}`
}
</script>

<style scoped>
.rule-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-6) var(--space-8);
  margin-bottom: var(--space-4);
  background: var(--bg-hover, rgba(255, 255, 255, 0.04));
  border-radius: var(--radius-sm, 4px);
  cursor: grab;
}
.rule-name {
  font-weight: 500;
  min-width: 100px;
}
.rule-summary {
  flex: 1;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
