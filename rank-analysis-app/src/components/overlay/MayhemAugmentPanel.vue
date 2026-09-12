<script setup lang="ts">
/**
 * 三选一强化浮窗面板（A3.4 UI 前置）
 *
 * 数据由主窗口经 pushOverlayPanel('mayhem-augments') 推送；
 * 卡片顺序严格映射屏幕左/中/右卡位（aramgg_client 的空槽原则：
 * 某位置识别失败保留空槽，不用其他结果顶替）。
 * 最佳候选呼吸高亮；理由全文进 title。
 */
import { computed } from 'vue'

import { isMayhemAugmentsPayload, type MayhemAugmentCandidate } from '../../features/overlay/panels'

const props = defineProps<{ payload: unknown }>()

const SLOTS: Array<{ slot: 0 | 1 | 2; label: string }> = [
  { slot: 0, label: '左' },
  { slot: 1, label: '中' },
  { slot: 2, label: '右' }
]

const candidates = computed<MayhemAugmentCandidate[]>(() => {
  if (!isMayhemAugmentsPayload(props.payload)) return []
  return [...props.payload.candidates].sort((a, b) => a.slot - b.slot)
})

function bySlot(slot: 0 | 1 | 2): MayhemAugmentCandidate | null {
  return candidates.value.find(c => c.slot === slot) ?? null
}

function titleOf(c: MayhemAugmentCandidate | null): string {
  if (!c) return ''
  return (c.reasons ?? []).join('\n')
}

function scoreText(c: MayhemAugmentCandidate | null): string {
  if (!c || c.score == null) return '--'
  return String(Math.round(c.score))
}
</script>

<template>
  <div class="m3p">
    <div class="m3p__head">
      海克斯三选一<span
        v-if="isMayhemAugmentsPayload(payload) && payload.championScope === 'global'"
        class="m3p__scope"
        title="未能确定当前英雄，按全局胜率给出通用建议"
      >
        全局建议 </span
      ><span
        v-if="isMayhemAugmentsPayload(payload) && payload.rerollsLeft != null"
        class="m3p__reroll"
      >
        重随 ×{{ payload.rerollsLeft }}
      </span>
    </div>
    <div class="m3p__cards">
      <div
        v-for="s in SLOTS"
        :key="s.slot"
        class="m3c"
        :class="{ 'm3c--best': bySlot(s.slot)?.best, 'm3c--empty': !bySlot(s.slot) }"
        :title="titleOf(bySlot(s.slot))"
      >
        <span class="m3c__slot">{{ s.label }}</span>
        <template v-if="bySlot(s.slot)">
          <span class="m3c__name">{{ bySlot(s.slot)!.name ?? '?' }}</span>
          <span class="m3c__meta">
            <i
              v-if="bySlot(s.slot)!.rarityName"
              class="m3c__rar"
              :class="`rr-${bySlot(s.slot)!.rarityName}`"
              >{{ bySlot(s.slot)!.rarityName }}</i
            >
            <b class="m3c__score">{{ scoreText(bySlot(s.slot)) }}</b>
            <em v-if="bySlot(s.slot)!.grade" class="m3c__grade">{{ bySlot(s.slot)!.grade }}</em>
          </span>
          <span v-if="(bySlot(s.slot)!.reasons ?? []).length" class="m3c__reason">
            {{ bySlot(s.slot)!.reasons![0] }}
          </span>
        </template>
        <template v-else>
          <span class="m3c__name m3c__unknown">未识别</span>
          <span class="m3c__meta">F1 手动重试</span>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.m3p {
  width: 100%;
}
.m3p__head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--brand);
  margin-bottom: 8px;
}
.m3p__head::before {
  content: '';
  width: 6px;
  height: 6px;
  transform: rotate(45deg);
  background: var(--brand);
}
.m3p__reroll {
  margin-left: auto;
  color: var(--text-tertiary);
}
.m3p__scope {
  padding: 0 4px;
  border: 1px solid var(--border-strong);
  color: var(--text-secondary);
}
.m3p__cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.m3c {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 6px;
  border: 1px solid var(--border-strong);
  background: rgba(128, 128, 128, 0.08);
  min-height: 74px;
}
.m3c--best {
  border-color: color-mix(in srgb, var(--accent-gold) 60%, transparent);
  box-shadow: 0 0 8px 1px color-mix(in srgb, var(--accent-gold) 27%, transparent) inset;
}
/* 对局机 GPU 降温：呼吸动画只在用户未要求减少动态时播放；
   v-if 卸载后动画随 DOM 一起销毁，不会后台空转。 */
@media (prefers-reduced-motion: no-preference) {
  .m3c--best {
    animation: m3-best 1.6s ease-in-out 3 alternate;
  }
}
@keyframes m3-best {
  from {
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-gold) 13%, transparent) inset;
  }
  to {
    box-shadow: 0 0 8px 1px color-mix(in srgb, var(--accent-gold) 27%, transparent) inset;
  }
}
.m3c--empty {
  opacity: 0.55;
}
.m3c__slot {
  font-size: var(--font-size-2xs); /* debug6:禁9px，10px起步 */
  color: var(--text-tertiary);
  letter-spacing: 0.08em;
}
.m3c__name {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m3c__unknown {
  font-weight: var(--font-weight-semibold);
}
.m3c__meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-2xs);
  color: var(--text-secondary);
}
.m3c__rar {
  font-style: normal;
  padding: 0 4px;
  border: 1px solid var(--border-strong);
}
/* 稀有度配色复用全局语义 token（棱彩=品牌金/黄金=深金/白银=次级文本），不用 hex 直写 */
.rr-prismatic {
  color: var(--accent-gold);
  border-color: color-mix(in srgb, var(--accent-gold) 53%, transparent);
}
.rr-gold {
  color: var(--accent-gold-deep);
  border-color: color-mix(in srgb, var(--accent-gold-deep) 40%, transparent);
}
.rr-silver {
  color: var(--text-secondary);
  border-color: var(--border-strong);
}
.m3c__score {
  margin-left: auto;
  color: var(--semantic-win-bright, var(--semantic-win));
}
.m3c__grade {
  font-style: normal;
  color: var(--info);
}
.m3c__reason {
  font-size: var(--font-size-2xs);
  line-height: 1.35;
  color: var(--text-tertiary);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
