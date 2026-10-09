<script setup lang="ts">
/**
 * 名册墙单个玩家 Tag 徽章。
 *
 * 颜色走 `--tag-*` 语义 token 的 8 个色调族（见 tokens.css），
 * **组件内不出现任何硬编码色**；主要信息载体是 `label` 文字。
 * 有 `detail` 时挂 n-popover 补充口径说明（例如「16 场 14 胜」）。
 */
import { NPopover } from 'naive-ui'

import type { PlayerTag } from '@renderer/features/gaming/roster-wall/playerTags'

defineProps<{
  tag: PlayerTag
}>()
</script>

<template>
  <n-popover v-if="tag.detail" :delay="80" trigger="hover" placement="top">
    <template #trigger>
      <span class="tag-chip" :class="`tag-chip--${tag.tone}`">{{ tag.label }}</span>
    </template>
    <div class="tag-detail">{{ tag.detail }}</div>
  </n-popover>

  <span v-else class="tag-chip" :class="`tag-chip--${tag.tone}`">{{ tag.label }}</span>
</template>

<style scoped>
/* Tag 徽章：实心底 + 近白字；字号下限 10px（CODE_QUALITY 硬约束） */
.tag-chip {
  display: inline-flex;
  align-items: center;
  font-size: var(--font-size-2xs);
  font-weight: 700;
  line-height: 14px;
  padding: 0 var(--space-4);
  border-radius: 2px;
  white-space: nowrap;
  cursor: default;
  transition: filter var(--dur-fast) var(--ease-expo);
}

.tag-chip:hover {
  filter: brightness(1.18);
}

.tag-chip--neutral {
  background: var(--tag-neutral);
  color: var(--tag-on-neutral);
}
.tag-chip--info {
  background: var(--tag-info);
  color: var(--tag-on-info);
}
.tag-chip--win {
  background: var(--tag-win);
  color: var(--tag-on-win);
}
.tag-chip--loss {
  background: var(--tag-loss);
  color: var(--tag-on-loss);
}
.tag-chip--brand {
  background: var(--tag-brand);
  color: var(--tag-on-brand);
}
.tag-chip--warn {
  background: var(--tag-warn);
  color: var(--tag-on-warn);
}
.tag-chip--danger {
  background: var(--tag-danger);
  color: var(--tag-on-danger);
}
.tag-chip--muted {
  background: var(--tag-muted);
  color: var(--tag-on-muted);
}

.tag-detail {
  max-width: 240px;
  font-size: var(--font-size-2xs);
  line-height: 1.6;
  color: var(--text-secondary);
}
</style>
