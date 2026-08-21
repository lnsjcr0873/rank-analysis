<template>
  <n-space vertical>
    <!-- Basic settings card -->
    <n-card>
      <n-text tag="div" class="setting-title">基本设置</n-text>
      <n-space vertical>
        <div class="setting-item">
          <span class="setting-label">
            <n-icon size="20" class="setting-item-icon setting-item-icon-accept">
              <FlashOutline />
            </n-icon>
            自动接受对局
          </span>
          <n-switch v-model:value="autoAccept" @update:value="updateAcceptSwitch" />
        </div>

        <div class="setting-item">
          <span class="setting-label">
            <n-icon size="20" class="setting-item-icon setting-item-icon-start">
              <PlayCircleOutline />
            </n-icon>
            自动开始匹配
          </span>
          <n-switch v-model:value="autoStart" @update:value="updateStartSwitch" />
        </div>

        <div class="setting-item">
          <span class="setting-label">
            <n-icon size="20" class="setting-item-icon setting-item-icon-start">
              <BulbOutline />
            </n-icon>
            智能推荐（英雄池 / Ban 池）
          </span>
          <n-space align="center">
            <n-select
              :value="opggTier"
              :options="TIER_OPTIONS"
              :loading="opggTierLoading"
              :disabled="opggTierLoading"
              size="small"
              style="width: 130px"
              @update:value="updateOpggTier"
            />
            <n-button size="small" type="primary" ghost @click="suggestModalShow = true">
              智能推荐
            </n-button>
          </n-space>
        </div>
      </n-space>
    </n-card>

    <!-- Pick group card -->
    <n-card>
      <template #header>
        <span class="setting-label">
          <n-icon size="20" class="setting-item-icon setting-item-icon-pick">
            <CheckmarkCircleOutline />
          </n-icon>
          自动选择英雄
        </span>
      </template>
      <template #header-extra>
        <n-switch v-model:value="autoPick" @update:value="updatePickSwitch" />
      </template>

      <!-- 开关关闭时整体降透明度：规则仍可编辑，但一眼能看出当前不生效 -->
      <div :class="{ 'rules-inactive': !autoPick }">
        <div class="rules-section">
          <div class="section-title">
            规则（按顺序匹配，第一条命中即用）
            <n-button size="small" type="primary" ghost @click="openPickEdit()"
              >+ 添加规则</n-button
            >
          </div>
          <DraggableRuleList
            :rules="pickRules"
            :asset-prefix="assetPrefix"
            :champion-options="options"
            @update:rules="(next: any) => savePickRules(next)"
            @toggle="togglePickRule"
            @edit="(r: PickRule) => openPickEdit(r)"
            @delete="deletePickRule"
          />
        </div>

        <div class="section-title">兜底（规则都没命中时按顺序选）</div>
        <div v-if="pickHasNoTarget" class="no-target-hint">
          已开启，但没有可执行目标：规则和兜底池都是空的，本局不会自动选择英雄
        </div>
        <n-flex>
          <VueDraggable ref="el" v-model="myPickData">
            <n-tag
              v-for="item in myPickData"
              :key="item"
              round
              closable
              :bordered="false"
              @close="deletePickData(item)"
              style="margin-right: var(--space-16)"
            >
              {{ options.filter(option => option.value === item)?.[0]?.label || `英雄 ${item}` }}
              <template #avatar>
                <n-avatar
                  :src="assetPrefix + '/champion/' + item"
                  :fallback-src="`${assetPrefix}/champion/-1`"
                />
              </template>
            </n-tag>
          </VueDraggable>
          <n-select
            v-model:value="selectPickChampionId"
            filterable
            :filter="filterChampionFunc"
            placeholder="添加英雄"
            :render-tag="renderSingleSelectTag"
            :render-label="renderLabel"
            :options="options"
            size="small"
            @update:value="addPickData"
            style="width: 170px"
          />
        </n-flex>
        <n-text depth="3" style="font-size: var(--font-size-sm)"
          >拖动可以改变选择英雄的优先级</n-text
        >
      </div>

      <RuleEditModal
        v-model:show="pickModalShow"
        mode="pick"
        :initial="pickEditing"
        :champion-options="options"
        @save="onPickSave"
      />
    </n-card>

    <!-- Ban group card -->
    <n-card>
      <template #header>
        <span class="setting-label">
          <n-icon size="20" color="#d03050">
            <Close />
          </n-icon>
          自动禁止英雄
        </span>
      </template>
      <template #header-extra>
        <n-switch v-model:value="autoBan" @update:value="updateBanSwitch" />
      </template>

      <div :class="{ 'rules-inactive': !autoBan }">
        <div class="rules-section">
          <div class="section-title">
            规则（按顺序匹配，第一条命中即用）
            <n-button size="small" type="primary" ghost @click="openBanEdit()">+ 添加规则</n-button>
          </div>
          <DraggableRuleList
            :rules="banRules"
            :asset-prefix="assetPrefix"
            :champion-options="options"
            @update:rules="(next: any) => saveBanRules(next)"
            @toggle="toggleBanRule"
            @edit="(r: BanRule) => openBanEdit(r)"
            @delete="deleteBanRule"
          />
        </div>

        <div class="section-title">兜底（规则都没命中时按顺序选）</div>
        <div v-if="banHasNoTarget" class="no-target-hint">
          已开启，但没有可执行目标：规则和兜底池都是空的，本局不会自动 Ban
        </div>
        <n-flex>
          <VueDraggable ref="el" v-model="myBanData">
            <n-tag
              v-for="item in myBanData"
              :key="item"
              round
              closable
              @close="deleteBanData(item)"
              :bordered="false"
              style="margin-right: var(--space-16)"
            >
              {{ options.filter(option => option.value === item)?.[0]?.label || `英雄 ${item}` }}
              <template #avatar>
                <n-avatar
                  :src="assetPrefix + '/champion/' + item"
                  :fallback-src="`${assetPrefix}/champion/-1`"
                />
              </template>
            </n-tag>
          </VueDraggable>
          <n-select
            v-model:value="selectBanChampionId"
            filterable
            :filter="filterChampionFunc"
            placeholder="添加英雄"
            :render-tag="renderSingleSelectTag"
            :render-label="renderLabel"
            :options="options"
            size="small"
            @update:value="addBanData"
            style="width: 170px"
          />
        </n-flex>
        <n-text depth="3" style="font-size: var(--font-size-sm)"
          >拖动可以改变禁用英雄的优先级</n-text
        >
      </div>

      <RuleEditModal
        v-model:show="banModalShow"
        mode="ban"
        :initial="banEditing"
        :champion-options="options"
        @save="onBanSave"
      />
    </n-card>

    <BpSuggestModal
      v-model:show="suggestModalShow"
      :champion-options="options"
      @adopted="onSuggestAdopted"
    />

    <!-- 选人执行偏好（P1-2） -->
    <n-card>
      <template #header>
        <span class="setting-label">
          <n-icon size="20" color="#18a058">
            <FlashOutline />
          </n-icon>
          选人执行偏好
        </span>
      </template>
      <n-space vertical>
        <n-flex align="center" justify="space-between">
          <n-text>自动确认换人请求（队友发起时自动接受）</n-text>
          <n-switch v-model:value="autoTradeConfirm" @update:value="updateTradeConfirmSwitch" />
        </n-flex>
        <n-flex align="center" justify="space-between">
          <n-text>锁定执行时刻（剩余秒数 3~35，越小越贴倒计时）</n-text>
          <n-input-number
            v-model:value="executeAtSecs"
            :min="3"
            :max="35"
            :step="0.5"
            size="small"
            style="width: 110px"
            @update:value="saveExecuteAtSecs"
          />
        </n-flex>
        <n-text depth="3" style="font-size: var(--font-size-sm)">
          已锁定后若推荐变化（含队友锁定引发的双维变化）且新目标在可换池中， 将自动 bench 换入（30s
          冷却防震荡）。
        </n-text>
      </n-space>
    </n-card>

    <!-- 自动符文（P1-3） -->
    <n-card>
      <template #header>
        <span class="setting-label">
          <n-icon size="20" color="#f0a020">
            <ColorWandOutline />
          </n-icon>
          自动符文
        </span>
      </template>
      <template #header-extra>
        <n-switch v-model:value="autoRune" @update:value="updateRuneSwitch" />
      </template>

      <div :class="{ 'rules-inactive': !autoRune }">
        <div class="section-title">
          英雄 → 符文页映射（选人锁定该英雄后自动切换 LCU 当前页）
          <n-button size="small" type="primary" ghost @click="addRuneRule()">+ 添加映射</n-button>
        </div>
        <div v-if="runeRules.length === 0" class="no-target-hint">
          未配置映射：开启后也不会自动切换符文页
        </div>
        <div v-for="(rule, idx) in runeRules" :key="idx" class="rule-row">
          <n-select
            v-model:value="rule.championId"
            filterable
            :filter="filterChampionFunc"
            placeholder="选择英雄"
            :options="options"
            size="small"
            style="width: 170px"
          />
          <n-input
            v-model:value="rule.pageName"
            placeholder="符文页名称（与客户端一致）"
            size="small"
            style="flex: 1"
          />
          <n-button quaternary type="error" size="small" @click="deleteRuneRule(idx)"
            >删除</n-button
          >
        </div>
        <n-text depth="3" style="font-size: var(--font-size-sm)">
          符文页名称需与客户端「收藏」里的页名完全一致（不含首尾空格）；切换在选人阶段自动执行。
        </n-text>
      </div>
    </n-card>
  </n-space>
</template>
<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus'
import { computed, onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { renderSingleSelectTag, renderLabel, filterChampionFunc } from '@renderer/utils/champion'
import {
  CheckmarkCircleOutline,
  FlashOutline,
  Close,
  PlayCircleOutline,
  BulbOutline,
  ColorWandOutline
} from '@vicons/ionicons5'
import { getConfigByIpc } from '@renderer/services/ipc'
import { assetPrefix } from '@renderer/services/http'
import type { championOption } from '@renderer/types/domain/champion'
import { getChampionOptions } from '@renderer/services/config'
import {
  usePickRules,
  useBanRules,
  useRuneRules,
  type RuneRule
} from '@renderer/composables/useRules'
import { useOpggTier } from '@renderer/composables/useOpggTier'
import { useAutomationSettings } from '@renderer/features/settings/composables/useAutomationSettings'
import type { OpggTier } from '@renderer/services/opgg'
import DraggableRuleList from '@renderer/components/automation/DraggableRuleList.vue'
import RuleEditModal from '@renderer/components/automation/RuleEditModal.vue'
import BpSuggestModal from '@renderer/components/automation/BpSuggestModal.vue'
import { hasNoExecutableTarget } from '@renderer/components/automation/autoBpHint'
import type { PickRule, BanRule } from '@renderer/types/rules'

const message = useMessage()
const { rules: pickRules, reload: reloadPickRules, save: savePickRules } = usePickRules()
const { rules: banRules, reload: reloadBanRules, save: saveBanRules } = useBanRules()
const { rules: runeRules, reload: reloadRuneRules, save: saveRuneRules } = useRuneRules()

const pickModalShow = ref(false)
const pickEditing = ref<PickRule | undefined>(undefined)
const banModalShow = ref(false)
const banEditing = ref<BanRule | undefined>(undefined)

const suggestModalShow = ref(false)

const {
  tier: opggTier,
  loading: opggTierLoading,
  options: TIER_OPTIONS,
  loadTier: loadOpggTier,
  switchTier
} = useOpggTier()

/** 段位变更。失败时 composable 会回滚显示值，这里补一条用户可见的反馈。 */
const updateOpggTier = async (next: OpggTier) => {
  const ok = await switchTier(next)
  if (!ok) message.error('段位数据拉取失败，已保持原段位显示')
}

/** 采纳后重读对应池，保持页面上的兜底池列表同步 */
const onSuggestAdopted = async (pool: 'pick' | 'ban') => {
  if (pool === 'pick') {
    myPickData.value = (await getConfigByIpc<number[]>('settings.auto.pickChampionSlice')) ?? []
  } else {
    myBanData.value = (await getConfigByIpc<number[]>('settings.auto.banChampionSlice')) ?? []
  }
}

const {
  autoAccept,
  autoPick,
  autoBan,
  autoStart,
  autoTradeConfirm,
  executeAtSecs,
  autoRune,
  myPickData,
  myBanData,
  configLoaded,
  loadAutomationSettings,
  updateAcceptSwitch,
  updateStartSwitch,
  updatePickSwitch,
  updateBanSwitch,
  updateTradeConfirmSwitch,
  updateRuneSwitch,
  saveExecuteAtSecs,
  addPickData,
  deletePickData,
  addBanData,
  deleteBanData
} = useAutomationSettings()

const options = ref<championOption[]>([])
const selectPickChampionId = ref(null)
const selectBanChampionId = ref(null)

onMounted(async () => {
  const opts = await getChampionOptions()
  options.value = opts.filter(opt => opt.value > 0)
  await loadAutomationSettings()
  await loadOpggTier()
  await reloadPickRules()
  await reloadBanRules()
  await reloadRuneRules()
  configLoaded.value = true
})

/** 新映射行：championId 占位让列表非空，待用户选择后即保存 */
async function addRuneRule() {
  const next: RuneRule[] = [...runeRules.value, { championId: 0, pageName: '' }]
  await saveRuneRules(next)
}

async function deleteRuneRule(idx: number) {
  const next = runeRules.value.filter((_, i) => i !== idx)
  await saveRuneRules(next)
}

function openPickEdit(rule?: PickRule) {
  pickEditing.value = rule ? JSON.parse(JSON.stringify(rule)) : undefined
  pickModalShow.value = true
}
async function onPickSave(rule: PickRule | BanRule) {
  const r = rule as PickRule
  const existingIdx = pickRules.value.findIndex(x => x.id === r.id)
  const next = [...pickRules.value]
  if (existingIdx >= 0) next[existingIdx] = r
  else next.push(r)
  await savePickRules(next)
}
async function deletePickRule(id: string) {
  await savePickRules(pickRules.value.filter(r => r.id !== id))
}
async function togglePickRule(id: string, enabled: boolean) {
  await savePickRules(pickRules.value.map(r => (r.id === id ? { ...r, enabled } : r)))
}

function openBanEdit(rule?: BanRule) {
  banEditing.value = rule ? JSON.parse(JSON.stringify(rule)) : undefined
  banModalShow.value = true
}
async function onBanSave(rule: PickRule | BanRule) {
  const r = rule as BanRule
  const existingIdx = banRules.value.findIndex(x => x.id === r.id)
  const next = [...banRules.value]
  if (existingIdx >= 0) next[existingIdx] = r
  else next.push(r)
  await saveBanRules(next)
}
async function deleteBanRule(id: string) {
  await saveBanRules(banRules.value.filter(r => r.id !== id))
}
async function toggleBanRule(id: string, enabled: boolean) {
  await saveBanRules(banRules.value.map(r => (r.id === id ? { ...r, enabled } : r)))
}

/** 自动选择开着但规则与兜底池皆空——本局不会有任何动作 */
const pickHasNoTarget = computed(
  () =>
    configLoaded.value && hasNoExecutableTarget(autoPick.value, pickRules.value, myPickData.value)
)
/** 自动禁用开着但规则与兜底池皆空——本局不会有任何动作 */
const banHasNoTarget = computed(
  () => configLoaded.value && hasNoExecutableTarget(autoBan.value, banRules.value, myBanData.value)
)
</script>

<style scoped>
.setting-title {
  font-size: var(--font-size-lg);
  font-weight: 700;
  margin-bottom: var(--space-16);
  color: var(--text-primary);
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-8) 0;
}

.setting-label {
  font-size: var(--font-size-md);
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--text-primary);
}

.radio-label {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.setting-item-icon {
  flex-shrink: 0;
}
.setting-item-icon-accept {
  color: var(--accent-blue);
}
.setting-item-icon-pick {
  color: var(--semantic-win);
}
.setting-item-icon-start {
  color: var(--accent-blue);
}

.icon {
  font-style: normal;
}

.rules-section {
  margin-bottom: var(--space-12);
}

/* 功能开关关闭时的规则区：可编辑但视觉降权，避免被误读成正在生效 */
.rules-inactive {
  opacity: 0.45;
  transition: opacity var(--dur-normal, 0.2s) ease;
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  margin: var(--space-12) 0 var(--space-8);
}

.rule-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-6) 0;
  border-bottom: 1px solid var(--n-border-color);
}

.rule-name {
  min-width: 120px;
  font-weight: 500;
}

.rule-summary {
  flex: 1;
  color: var(--n-text-color-disabled);
  font-size: var(--font-size-sm);
}

/* 配置未完成的提示：用 warn 而非 error——这不是错误，是还没配完 */
.no-target-hint {
  margin-bottom: var(--space-8);
  padding: var(--space-6) var(--space-8);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--semantic-warn);
  background: color-mix(in srgb, var(--semantic-warn) 12%, transparent);
}
</style>
