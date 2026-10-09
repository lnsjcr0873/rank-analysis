<script setup lang="ts">
/**
 * 打野路径卡（P5）。
 *
 * ## 为什么是「序列」而不是地图缩略图
 *
 * 原设计是 74px 峡谷底图 + 帧热力格，底图走 `assetPrefix + '/map/11'`。
 * 但 `asset` 协议的分发（`lcu/api/asset.rs`）只支持
 * `champion / item / perk / spell / profile`，**没有 map**——地图图也不在
 * LCU 图标清单里（那套由 `ensure_caches_ready()` 预热），补它等于另写一条
 * 资产管道，代价远超本卡价值。
 *
 * 因此改为**纯序列呈现**：把后端算出的营地顺序直接排成一条链。
 * 数据完全来自既有帧级分析，零新增后端依赖；代价是失去空间感，
 * 这是取舍而非缺陷，故在此写明，避免后人误以为「地图底图漏做了」。
 *
 * ## 降级纪律
 *
 * 无帧数据时显式显示「无数据」并给出原因，**不空白、不编造路径**。
 */
import { computed } from 'vue'

import type { PlayerTimelineSummary } from '@renderer/features/gaming/services/playerTimeline'
import {
  campMeta,
  CAMP_META,
  formatClock,
  formatRate,
  UNKNOWN_CAMP_WARN_RATIO
} from '@renderer/features/gaming/roster-wall/camps'

const props = defineProps<{
  /** 帧级汇总；null 或不可用时走空态 */
  timeline?: PlayerTimelineSummary | null
  /** slim 档压缩纵向信息（卡片高度不足时只留序列） */
  dense?: boolean
}>()

/** 是否可用：没有帧级样本 ⇒ 无数据 */
const usable = computed(() => (props.timeline?.gamesAnalyzed ?? 0) > 0)

/** 已知营地集合（用于判定未知占比） */
const KNOWN_CAMPS = new Set(Object.keys(CAMP_META))

/** 路径序列：每步带上展示名与语义分组 */
const steps = computed(() =>
  (props.timeline?.topJunglePath ?? []).map((key, i) => ({
    key,
    order: i + 1,
    known: KNOWN_CAMPS.has(key),
    ...campMeta(key)
  }))
)

/** 未知营地占比过高时提示口径可能不一致（而非静默渲染错东西） */
const unknownRatio = computed(() => {
  const s = steps.value
  if (s.length === 0) return 0
  return s.filter(x => !x.known).length / s.length
})

const showUnknownHint = computed(() => unknownRatio.value > UNKNOWN_CAMP_WARN_RATIO)

const firstCamp = computed(() => {
  const ms = props.timeline?.medianFirstCampAtMs ?? null
  return ms === null ? '—' : formatClock(ms)
})

const invaded = computed(() => formatRate(props.timeline?.invadedEarlyRate ?? null))
</script>

<template>
  <div class="pjungle" :class="{ 'pjungle--dense': dense }">
    <header class="pjungle-head">
      <span class="pjungle-title">打野路径</span>
      <span v-if="usable" class="pjungle-samples">{{ timeline?.gamesAnalyzed }} 场样本</span>
    </header>

    <!-- 降级：显式空态，绝不留白 -->
    <div v-if="!usable" class="pjungle-empty">
      <span class="pjungle-empty-title">无数据</span>
      <span class="pjungle-empty-reason">需 SGP 帧数据（LCU 路径不提供）</span>
    </div>

    <template v-else>
      <ol v-if="steps.length > 0" class="pjungle-path">
        <li
          v-for="s in steps"
          :key="`${s.key}-${s.order}`"
          class="pjungle-step"
          :class="`pjungle-step--${s.group}`"
          :title="`${s.order}. ${s.title}`"
        >
          <span class="pjungle-step-label">{{ s.label }}</span>
        </li>
      </ol>
      <p v-else class="pjungle-empty">
        <span class="pjungle-empty-title">未观察到清野</span>
      </p>

      <p v-if="showUnknownHint" class="pjungle-hint">含未知营地，前端词典可能落后于后端</p>

      <dl v-if="!dense" class="pjungle-meta">
        <div class="pjungle-meta-row">
          <dt>首刷</dt>
          <dd>{{ firstCamp }}</dd>
        </div>
        <div class="pjungle-meta-row">
          <dt>3 分钟内开野</dt>
          <dd>{{ invaded }}</dd>
        </div>
      </dl>
    </template>
  </div>
</template>

<style scoped src="./PlayerCardJungle.styles.css"></style>
