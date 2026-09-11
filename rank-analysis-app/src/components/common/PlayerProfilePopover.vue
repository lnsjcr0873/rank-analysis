<template>
  <n-popover
    v-if="active"
    trigger="hover"
    placement="right"
    :delay="250"
    :flip="true"
    :style="{ padding: '0', background: 'var(--bg-elevated)' }"
    @update:show="onShowChange"
  >
    <template #trigger>
      <slot />
    </template>
    <!-- debug5：画像卡只在弹层真正打开后挂载。Naive 的默认插槽会 eager 预挂载，
      战绩列表上百个头像会瞬间并发上百次画像查询；v-if 保证不 hover 零请求。 -->
    <PlayerProfileCard
      v-if="opened"
      :puuid="puuid"
      :name="name"
      :champion-id="championId"
      :region="region"
    />
  </n-popover>
  <slot v-else />
</template>

<script setup lang="ts">
/**
 * 玩家画像 hover 弹层：把任意触发器（玩家名等）包上 NPopover，
 * 内容是 PlayerProfileCard。用于战绩详情/对局内各挂载点。
 *
 * - active=false（无 puuid / 隐藏战绩）时原样渲染 trigger，不包弹层
 * - 走 fetchPlayerProfile（LRU 缓存），hover 才触发查询
 * - region 非空（跨区战绩页等 SGP 来源场景）时画像卡启用 SGP 战绩兜底
 */
import PlayerProfileCard from '@renderer/components/common/PlayerProfileCard.vue'
import { NPopover } from 'naive-ui'
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    puuid?: string
    /** 展示名（缺省时画像卡用 puuid 前 8 位） */
    name?: string
    /** 本局英雄 id（有则画像卡显示熟练度小节） */
    championId?: number
    /** 跨区大区 platformId（SGP 战绩兜底用） */
    region?: string
  }>(),
  { puuid: '', name: '', championId: 0, region: '' }
)

const active = computed(() => props.puuid.length > 0)
/** 弹层是否打开过（打开后保持挂载，避免二次 hover 闪烁重查，LRU 缓存兜底） */
const opened = ref(false)

function onShowChange(show: boolean): void {
  if (show) opened.value = true
}
</script>
