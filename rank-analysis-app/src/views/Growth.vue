<template>
  <div class="flex h-full flex-col gap-5 p-5 select-none overflow-y-auto max-w-5xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-white/10 pb-4">
      <div class="flex flex-col">
        <div class="flex items-center gap-2">
          <Target class="h-5 w-5 text-[#c8aa6e]" />
          <h2 class="text-lg font-bold text-white tracking-wide">选手成长与短板改错</h2>
        </div>
        <p class="mt-1 text-xs text-white/50">
          基于本机收集对局聚合的重复性短板诊断与跨局改错追踪清单
        </p>
      </div>

      <button
        type="button"
        :disabled="refreshingTags || loading"
        class="flex items-center gap-1.5 rounded-lg border border-[#c8aa6e]/40 bg-[#c8aa6e]/15 px-3 py-1.5 text-xs font-semibold text-[#f0e6d2] shadow-sm hover:bg-[#c8aa6e]/25 disabled:opacity-50 transition-all cursor-pointer"
        @click="refreshAll"
      >
        <RotateCw class="h-3.5 w-3.5" :class="{ 'animate-spin': refreshingTags }" />
        <span>重新分析</span>
      </button>
    </div>

    <!-- Status / Loading Hint -->
    <div v-if="loading" class="flex items-center justify-center py-12 text-sm text-white/40">
      <RotateCw class="mr-2 h-4 w-4 animate-spin text-[#c8aa6e]" />
      正在聚合本机对局数据...
    </div>

    <div
      v-else-if="tagsMsg"
      class="rounded-lg border border-white/10 bg-white/5 p-4 text-center text-xs text-white/60"
    >
      {{ tagsMsg }}
    </div>

    <!-- Habit Tags Grid -->
    <div v-else-if="tags.length" class="flex flex-col gap-2.5">
      <div class="flex items-center gap-1.5 text-xs font-bold text-white/80 uppercase tracking-wider">
        <TrendingDown class="h-4 w-4 text-rose-400" />
        <span>需重点关注的习惯短板</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <div
          v-for="t in tags"
          :key="t.dimension"
          class="flex flex-col justify-between rounded-xl border p-3.5 backdrop-blur-md transition-all duration-200"
          :class="[
            t.streak >= 3
              ? 'border-rose-500/40 bg-rose-500/10 shadow-[0_0_12px_rgba(244,63,94,0.15)]'
              : 'border-amber-500/30 bg-amber-500/5'
          ]"
        >
          <div>
            <div class="flex items-center justify-between">
              <span class="text-sm font-bold text-white">
                {{ DIMENSION_LABELS[t.dimension] ?? t.dimension }}
              </span>
              <span class="font-mono text-xs font-bold text-rose-400">
                {{ formatDelta(t.avgVsPeer) }}
              </span>
            </div>

            <div class="mt-2 flex items-center justify-between text-[11px] text-white/50 font-mono">
              <span>持续落后 <b class="text-rose-300 font-bold">{{ t.streak }}</b> 局</span>
              <span>检出 {{ shortDate(t.lastSeen) }}</span>
            </div>
          </div>

          <p class="mt-3 rounded bg-black/40 p-2 text-[11px] leading-relaxed text-white/80 border border-white/5">
            💡 {{ DIMENSION_FIX_HINTS[t.dimension] ?? '对局中主动复盘该维度' }}
          </p>
        </div>
      </div>
    </div>

    <div
      v-else
      class="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-xs text-white/40"
    >
      暂无短板标签 —— 收集满 5 局有效对战后将自动产出深度诊断
    </div>

    <!-- Mistake & Goals Checklist -->
    <div class="flex flex-col gap-3 rounded-xl border border-white/10 bg-[rgba(14,20,33,0.7)] p-4 backdrop-blur-xl shadow-lg">
      <!-- Goals Head & Add Form -->
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div class="flex items-center gap-2">
          <CheckCircle2 class="h-4 w-4 text-[#0ac8b9]" />
          <span class="text-sm font-bold text-white">改错目标清单</span>
        </div>

        <div class="flex items-center gap-2">
          <n-select
            v-model:value="newGoalDimension"
            size="small"
            class="w-28"
            :options="dimensionOptions"
            placeholder="维度"
          />

          <input
            v-model="newGoalTitle"
            type="text"
            placeholder="目标（例如：15分钟前插眼数≥8）"
            class="h-7 w-60 rounded-md border border-white/10 bg-white/5 px-2.5 text-xs text-white/90 placeholder:text-white/40 focus:border-[#c8aa6e]/60 focus:outline-none"
            @keyup.enter="submitGoal"
          />

          <button
            type="button"
            :disabled="!newGoalTitle.trim()"
            class="flex items-center gap-1 h-7 rounded-md bg-[#0ac8b9]/20 px-3 text-xs font-semibold text-[#a3f7f0] border border-[#0ac8b9]/40 hover:bg-[#0ac8b9]/30 disabled:opacity-40 cursor-pointer transition-all"
            @click="submitGoal"
          >
            <Plus class="h-3 w-3" />
            <span>添加</span>
          </button>
        </div>
      </div>

      <!-- Goals List -->
      <ul v-if="goals.length" class="flex flex-col gap-2">
        <li
          v-for="g in goals"
          :key="g.id"
          class="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-2.5 hover:bg-white/5 transition-colors"
        >
          <n-checkbox
            :checked="g.done"
            :label="g.title"
            class="text-xs"
            @update:checked="() => toggleGoal(g)"
          />
          <span class="rounded bg-white/10 px-2 py-0.5 text-[10px] font-mono text-white/60">
            {{ DIMENSION_LABELS[g.dimension] ?? g.dimension }}
          </span>
        </li>
      </ul>

      <div v-else class="py-6 text-center text-xs text-white/40">
        暂无活跃目标 —— 将上方诊断出的短板转化为一条可执行的微目标吧！
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Target,
  TrendingDown,
  RotateCw,
  CheckCircle2,
  Plus
} from 'lucide-vue-next'
import { NCheckbox, NSelect } from 'naive-ui'
import {
  addHabitGoal,
  DIMENSION_FIX_HINTS,
  DIMENSION_LABELS,
  getHabitTags,
  listHabitGoals,
  toggleHabitGoal,
  type HabitGoal,
  type HabitTag
} from '@renderer/services/insight'

const loading = ref(false)
const refreshingTags = ref(false)
const tags = ref<HabitTag[]>([])
const goals = ref<HabitGoal[]>([])
const tagsMsg = ref('')
const newGoalTitle = ref('')
const newGoalDimension = ref('vision')

const dimensionOptions = computed(() =>
  Object.entries(DIMENSION_LABELS).map(([value, label]) => ({ value, label }))
)

function formatDelta(v: number): string {
  const sign = v < 0 ? '' : '+'
  return `${sign}${v.toFixed(1)} vs 对手`
}

function shortDate(iso: string): string {
  return iso.slice(0, 10)
}

async function loadGoals(): Promise<void> {
  try {
    goals.value = await listHabitGoals()
  } catch {
    goals.value = []
  }
}

async function refreshAll(): Promise<void> {
  refreshingTags.value = true
  tagsMsg.value = ''
  try {
    const result = await getHabitTags()
    tags.value = result
    if (!result.length) {
      tagsMsg.value = '已分析本机对局，暂未发现持续落后的维度'
    }
  } catch (err) {
    tagsMsg.value = String(err)
  } finally {
    refreshingTags.value = false
  }
}

async function submitGoal(): Promise<void> {
  const title = newGoalTitle.value.trim()
  if (!title) return
  try {
    await addHabitGoal(newGoalDimension.value, title)
    newGoalTitle.value = ''
    await loadGoals()
  } catch {
    // ignore
  }
}

async function toggleGoal(goal: HabitGoal): Promise<void> {
  try {
    await toggleHabitGoal(goal.id)
    await loadGoals()
  } catch {
    // ignore
  }
}

onMounted(async () => {
  loading.value = true
  await Promise.all([refreshAll(), loadGoals()])
  loading.value = false
})
</script>
