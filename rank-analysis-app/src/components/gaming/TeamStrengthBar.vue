<script setup lang="ts">
/**
 * 选人期双方阵容强度对比条（只读，纯展示）。
 *
 * 数据来自 useLineupScore：全局 OP.GG meta + 玩家近期画像加权后的确定性分数。
 * 只在双方都有有效分数（score != null）时渲染；无数据/数据不足时整块隐藏，
 * 绝不编造数字。playerAdjusted 时给「含玩家画像加权」提示。
 *
 * 明细：对比条下方常驻双方逐英雄列表（全局胜率 → 调整后胜率），调整过的英雄
 * 金色高亮并附理由（贝叶斯收缩后的近期胜率/绝活/补位等），让分数可解释。
 */
import { computed } from 'vue'
import { getChampionName } from '@renderer/services/ai/champion-names'
import type { LineupScore, LineupHeroDetail } from '@renderer/features/gaming/services/lineupScore'

const props = defineProps<{
  mine: LineupScore
  enemy: LineupScore
}>()

const visible = computed(() => props.mine.score !== null && props.enemy.score !== null)

/** 双方分数区间展示（40~60 是常态区间，超出后微调刻度避免对比条撑死） */
const SCORE_FLOOR = 40
const SCORE_CEIL = 60

/** 对比条两侧填充比例：分数落在 [40,60] 内按比例，越界收敛到边界 */
function fillOf(score: number): number {
  const clamped = Math.min(SCORE_CEIL, Math.max(SCORE_FLOOR, score))
  return (clamped - SCORE_FLOOR) / (SCORE_CEIL - SCORE_FLOOR)
}

const mineFill = computed(() => (props.mine.score === null ? 0 : fillOf(props.mine.score)))
const enemyFill = computed(() => (props.enemy.score === null ? 0 : fillOf(props.enemy.score)))

const delta = computed(() => {
  const m = props.mine.score
  const e = props.enemy.score
  if (m === null || e === null) return null
  return Math.round((m - e) * 10) / 10
})

const deltaLabel = computed(() => {
  const d = delta.value
  if (d === null) return ''
  if (d === 0) return '双方阵容接近'
  const abs = Math.abs(d).toFixed(1)
  return d > 0 ? `我方领先 ${abs}` : `敌方领先 ${abs}`
})

const deltaClass = computed(() => {
  const d = delta.value
  if (d === null || d === 0) return 'delta-even'
  return d > 0 ? 'delta-ahead' : 'delta-behind'
})

/** 分数文本（0-100 保留 1 位小数） */
function scoreText(s: LineupScore): string {
  return s.score === null ? '--' : s.score.toFixed(1)
}

/** 某英雄明细行主文本：全局 → 调整后（无画像时只有全局） */
function detailLabel(d: LineupHeroDetail): string {
  const base = d.baseWinRate === null ? '--' : d.baseWinRate.toFixed(1)
  if (d.playerWinRate === null && d.reasons.length === 0) {
    return `${getChampionName(d.championId)} ${base}`
  }
  return `${getChampionName(d.championId)} ${base} → ${d.adjustedWinRate.toFixed(1)}`
}

function detailHasChange(d: LineupHeroDetail): boolean {
  return d.reasons.length > 0 || d.adjustedWinRate !== d.baseWinRate
}
</script>

<template>
  <div v-if="visible" class="lineup-strength">
    <div class="ls-head">
      <span class="ls-label ls-label-mine">我方阵容</span>
      <span class="ls-value ls-value-mine">{{ scoreText(mine) }}</span>
      <span class="ls-delta" :class="deltaClass">{{ deltaLabel }}</span>
      <span class="ls-value ls-value-enemy">{{ scoreText(enemy) }}</span>
      <span class="ls-label ls-label-enemy">敌方阵容</span>
    </div>

    <div class="ls-bar">
      <div class="ls-bar-segment ls-bar-mine" :style="{ width: `${mineFill * 100}%` }"></div>
      <div class="ls-bar-segment ls-bar-enemy" :style="{ width: `${enemyFill * 100}%` }"></div>
    </div>

    <div class="ls-detail">
      <div class="ls-detail-col">
        <div class="ls-detail-col-title ls-detail-mine-title">我方</div>
        <div v-for="d in mine.breakdown" :key="`m-${d.championId}`">
          <div
            class="ls-detail-row"
            :class="{ 'ls-detail-changed': detailHasChange(d) }"
            :title="d.reasons.join(' · ')"
          >
            {{ detailLabel(d) }}
          </div>
        </div>
      </div>
      <div class="ls-detail-col">
        <div class="ls-detail-col-title ls-detail-enemy-title">敌方</div>
        <div v-for="d in enemy.breakdown" :key="`e-${d.championId}`">
          <div
            class="ls-detail-row"
            :class="{ 'ls-detail-changed': detailHasChange(d) }"
            :title="d.reasons.join(' · ')"
          >
            {{ detailLabel(d) }}
          </div>
        </div>
      </div>
    </div>

    <div class="ls-foot">
      <span class="ls-note">
        <template v-if="mine.playerAdjusted || enemy.playerAdjusted">
          已按玩家近期画像加权
        </template>
        <template v-else>OP.GG 全球 meta</template>
      </span>
      <span class="ls-covered">
        覆盖 {{ mine.covered }}/{{ mine.total }} 我方 · {{ enemy.covered }}/{{ enemy.total }} 敌方
      </span>
    </div>
  </div>
</template>

<style scoped>
.lineup-strength {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  margin-top: 8px;
  border-radius: 8px;
  background: rgba(18, 25, 38, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.ls-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.ls-label {
  font-size: 12px;
  font-weight: 600;
}

.ls-label-mine {
  color: #38bdf8;
}

.ls-label-enemy {
  color: #fb7185;
}

.ls-value {
  font-size: 16px;
  font-weight: 800;
}

.ls-value-mine {
  color: #38bdf8;
}

.ls-value-enemy {
  color: #fb7185;
}

.ls-delta {
  flex: 1;
  text-align: center;
  font-size: 12px;
  font-weight: 700;
}

.delta-even {
  color: #94a3b8;
}

.delta-ahead {
  color: #00d68f;
}

.delta-behind {
  color: #ff4655;
}

.ls-bar {
  display: flex;
  height: 7px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.1);
}

.ls-bar-segment {
  height: 100%;
  transition: width var(--dur-normal) var(--ease-expo);
}

.ls-bar-mine {
  background: linear-gradient(90deg, #0284c7, #38bdf8);
}

.ls-bar-enemy {
  background: linear-gradient(90deg, #e11d48, #fb7185);
}

.ls-detail {
  display: flex;
  gap: 28px;
  font-size: 12px;
  color: #e2e8f0;
}

.ls-detail-col {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 140px;
}

.ls-detail-col-title {
  font-weight: 700;
  margin-bottom: 2px;
}

.ls-detail-mine-title {
  color: #38bdf8;
}

.ls-detail-enemy-title {
  color: #fb7185;
}

.ls-detail-row {
  white-space: nowrap;
  color: #cbd5e1;
}

.ls-detail-changed {
  color: #fbbf24;
  font-weight: 600;
}

.ls-foot {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 11px;
  color: #94a3b8;
}

.ls-note {
  font-style: normal;
}

.ls-covered {
  font-size: 11px;
}
</style>
