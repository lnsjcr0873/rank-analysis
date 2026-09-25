<template>
  <!-- 符文 tab：每人一张卡片——完整符文页（主系 3 符文 + 副系 2 符文 + 属性碎片）。
     数据源 = LCU match-details `participants[].perks`（跨区 SGP match-v5 同构透传）；
     旧缓存无 perks 数组时用 LCU 平铺 `stats.perk0..5` 重建完整符文页；两者皆缺才提示缺失 -->
  <div class="match-detail-runes-tab">
    <div v-if="ctx.usesAugments.value" class="match-detail-runes-hint">
      本局为海克斯/斗魂模式，无传统符文页（以海克斯强化代替）。
    </div>

    <section
      v-for="team in ctx.players.teamSections.value"
      :key="team.teamId"
      class="match-detail-runes-team"
    >
      <div class="match-detail-runes-team-title">{{ team.title }}</div>
      <div class="match-detail-runes-grid">
        <div
          v-for="player in team.players"
          :key="player.participantId"
          class="match-detail-runes-card"
          :class="{ 'match-detail-runes-card--me': player.isMe }"
        >
          <div class="match-detail-runes-card-head">
            <LazyImg
              class="match-detail-runes-avatar"
              :src="assetPrefix + '/champion/' + player.championId"
              alt="champion"
            />
            <span
              v-if="player.gameName"
              class="match-detail-runes-name match-detail-runes-name--link"
              role="link"
              tabindex="0"
              @click="searchSummoner(`${player.gameName}#${player.tagLine}`)"
              @keydown.enter="searchSummoner(`${player.gameName}#${player.tagLine}`)"
              >{{ player.displayName }}</span
            >
            <span v-else class="match-detail-runes-name">{{ player.displayName }}</span>
            <n-tag v-if="player.isMe" size="small" :bordered="false" type="success">我</n-tag>
          </div>

          <div class="match-detail-runes-body">
            <template v-if="perksOf(player).primary">
              <!-- 主系：基石 + 3 符文 + 风格 -->
              <div class="match-detail-runes-slot">
                <span class="match-detail-runes-slot-label">主系</span>
                <n-tooltip trigger="hover" placement="top">
                  <template #trigger>
                    <img
                      v-if="perkSrc(perksOf(player).primary!.selections[0]?.perk)"
                      :src="perkSrc(perksOf(player).primary!.selections[0]!.perk)"
                      class="match-detail-runes-keystone"
                      alt="perk"
                      loading="lazy"
                      decoding="async"
                    />
                  </template>
                  <div class="match-detail-runes-perk-pop">
                    <span class="match-detail-runes-perk-pop-name">{{
                      perkName(perksOf(player).primary!.selections[0]?.perk ?? 0)
                    }}</span>
                    <span
                      v-if="
                        perkDesc(
                          perksOf(player).primary!.selections[0]?.perk ?? 0,
                          perksOf(player).primary!.selections[0]
                        )
                      "
                      class="match-detail-runes-perk-pop-desc"
                      >{{
                        perkDesc(
                          perksOf(player).primary!.selections[0]?.perk ?? 0,
                          perksOf(player).primary!.selections[0]
                        )
                      }}</span
                    >
                  </div>
                </n-tooltip>
                <span class="match-detail-runes-style">
                  {{ styleName(perksOf(player).primary!.style) }}
                </span>
                <div class="match-detail-runes-perk-list">
                  <n-tooltip
                    v-for="sel in perksOf(player).primary!.selections.slice(1)"
                    :key="sel.perk"
                    trigger="hover"
                    placement="top"
                  >
                    <template #trigger>
                      <img v-if="sel.perk > 0" v-bind="perkImgAttrs(sel.perk)" />
                      <span v-else class="match-detail-runes-perk match-detail-runes-perk--empty" />
                    </template>
                    <div class="match-detail-runes-perk-pop">
                      <span class="match-detail-runes-perk-pop-name">{{ perkName(sel.perk) }}</span>
                      <span
                        v-if="perkDesc(sel.perk, sel)"
                        class="match-detail-runes-perk-pop-desc"
                        >{{ perkDesc(sel.perk, sel) }}</span
                      >
                    </div>
                  </n-tooltip>
                </div>
              </div>

              <!-- 副系：2 符文 + 风格 -->
              <div class="match-detail-runes-slot" v-if="perksOf(player).sub">
                <span class="match-detail-runes-slot-label">副系</span>
                <span class="match-detail-runes-style">
                  {{ styleName(perksOf(player).sub!.style) }}
                </span>
                <div class="match-detail-runes-perk-list">
                  <n-tooltip
                    v-for="sel in perksOf(player).sub!.selections"
                    :key="sel.perk"
                    trigger="hover"
                    placement="top"
                  >
                    <template #trigger>
                      <img v-if="sel.perk > 0" v-bind="perkImgAttrs(sel.perk)" />
                      <span v-else class="match-detail-runes-perk match-detail-runes-perk--empty" />
                    </template>
                    <div class="match-detail-runes-perk-pop">
                      <span class="match-detail-runes-perk-pop-name">{{ perkName(sel.perk) }}</span>
                      <span
                        v-if="perkDesc(sel.perk, sel)"
                        class="match-detail-runes-perk-pop-desc"
                        >{{ perkDesc(sel.perk, sel) }}</span
                      >
                    </div>
                  </n-tooltip>
                </div>
              </div>

              <!-- 属性碎片 -->
              <div class="match-detail-runes-slot" v-if="perksOf(player).statIds.length">
                <span class="match-detail-runes-slot-label">属性</span>
                <div class="match-detail-runes-perk-list">
                  <n-tooltip
                    v-for="id in perksOf(player).statIds"
                    :key="id"
                    trigger="hover"
                    placement="top"
                  >
                    <template #trigger>
                      <img v-if="id > 0" v-bind="perkImgAttrs(id)" />
                      <span v-else class="match-detail-runes-perk match-detail-runes-perk--empty" />
                    </template>
                    <div class="match-detail-runes-perk-pop">
                      <span class="match-detail-runes-perk-pop-name">{{ perkName(id) }}</span>
                      <span v-if="perkDesc(id)" class="match-detail-runes-perk-pop-desc">{{
                        perkDesc(id)
                      }}</span>
                    </div>
                  </n-tooltip>
                </div>
              </div>
            </template>

            <!-- 回退：无 perks 数组且无 LCU 平铺符文数据（异常/残缺）时提示缺失 -->
            <template v-else>
              <div class="match-detail-runes-slot">
                <span class="match-detail-runes-slot-label">主系</span>
                <span class="match-detail-runes-more">符文页数据缺失</span>
                <n-tooltip trigger="hover" placement="top">
                  <template #trigger>
                    <span class="match-detail-runes-question">?</span>
                  </template>
                  对局数据未携带完整符文页（无 perks 数组亦无 LCU 平铺符文字段），无法展示
                </n-tooltip>
              </div>
            </template>
          </div>
        </div>
      </div>
    </section>

    <div v-if="!ctx.players.teamSections.value.length" class="match-detail-runes-empty">
      本局无符文数据
    </div>
  </div>
</template>

<script lang="ts" setup>
import { inject } from 'vue'
import { NTag, NTooltip } from 'naive-ui'
import { searchSummoner } from '@renderer/utils/navigation'
import { assetPrefix } from '@renderer/services/http'
import LazyImg from '@renderer/components/common/LazyImg.vue'
import type { GamePerks, GamePerkSelection, ParticipantStats } from '@renderer/types/domain/match'
import { matchDetailContextKey } from '../matchDetailContext'
import { fillPerkDescription } from './runesTable'

const injected = inject(matchDetailContextKey)
if (!injected) throw new Error('MatchDetailRunesTab 必须在 MatchDetailInline 容器内使用')
/** 注入非空：上方守卫保证容器内使用 */
const ctx = injected as NonNullable<typeof injected>

/** 基石符文图标（无 id 时返回空串，模板不渲染） */
function perkSrc(perkId: number) {
  if (perkId <= 0) return ''
  return ctx.assets.srcOf('perk', perkId)
}

/** 基石符文名（缓存未就绪时回退编号） */
function perkName(perkId: number) {
  if (perkId <= 0) return ''
  return ctx.assets.detailOf('perk', perkId)?.name ?? `符文 #${perkId}`
}

/** 符文描述：资源长描述 + @eogvarN@ → 对局终局数值（无描述/无数据返回 ''，不渲染） */
function perkDesc(perkId: number, selection?: GamePerkSelection) {
  if (perkId <= 0) return ''
  return fillPerkDescription(ctx.assets.detailOf('perk', perkId)?.description, selection)
}

/** 主/副系风格名（风格 id 也在 perk 缓存中，未命中回退编号） */
const styleName = (styleId: number) =>
  styleId <= 0 ? '未选择' : (ctx.assets.detailOf('perk', styleId)?.name ?? `风格 #${styleId}`)

/** 完整符文页切分：主系（styles[0]，基石在 selections[0]）/ 副系（styles[1]）/ 属性碎片。
 *  无 `perks` 数组时回退用 LCU 平铺字段重建（对照 Akari mapLcuDataToPerks：perk0=基石、
 *  perk1..3=主系小符文、perk4..5=副系小符文），旧缓存因此也能出完整符文页（仅缺属性碎片）。 */
function perksOf(player: { perks?: GamePerks; stats: ParticipantStats }) {
  const p = player.perks
  const page = p ?? rebuildFromFlat(player.stats)
  const primary = page?.styles?.[0]
  const sub = page?.styles?.[1]
  return {
    primary,
    sub,
    statIds: page?.statPerks
      ? [page.statPerks.offense, page.statPerks.flex, page.statPerks.defense]
      : []
  }
}

/** 从 LCU 平铺 `stats.perk0..5` + 主/副系风格重建符文页结构；无任何符文数据时返回 undefined */
function rebuildFromFlat(stats: ParticipantStats): GamePerks | undefined {
  const flat = [stats.perk0, stats.perk1, stats.perk2, stats.perk3, stats.perk4, stats.perk5]
  if (flat.every(id => (id ?? 0) <= 0)) return undefined
  const sel = (id?: number): GamePerkSelection => ({ perk: id ?? 0, var1: 0, var2: 0, var3: 0 })
  return {
    styles: [
      {
        style: stats.perkPrimaryStyle,
        selections: [sel(stats.perk0), sel(stats.perk1), sel(stats.perk2), sel(stats.perk3)]
      },
      { style: stats.perkSubStyle, selections: [sel(stats.perk4), sel(stats.perk5)] }
    ]
  }
}

/** 普通符文小图标（20px 槽位）属性；无 id 不渲染 */
function perkImgAttrs(perkId: number) {
  return perkId > 0
    ? {
        src: ctx.assets.srcOf('perk', perkId),
        class: 'match-detail-runes-perk',
        alt: 'perk',
        loading: 'lazy' as const,
        decoding: 'async' as const
      }
    : { class: 'match-detail-runes-perk match-detail-runes-perk--empty' }
}
</script>

<style scoped>
.match-detail-runes-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  padding: var(--space-8) var(--space-12) var(--space-10);
}

.match-detail-runes-hint {
  padding: var(--space-8) var(--space-12);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
  background: var(--glass-bg-low);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.match-detail-runes-team {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.match-detail-runes-team-title {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.02em;
  padding: 0 var(--space-4);
}

.match-detail-runes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-8);
}

.match-detail-runes-card {
  border: 1px solid color-mix(in srgb, var(--border-subtle) 90%, transparent);
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  backdrop-filter: blur(10px);
  box-shadow: var(--shadow-2);
  padding: var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  transition: all var(--dur-fast) var(--ease-expo);
}

.match-detail-runes-card:hover {
  background: var(--glass-bg-mid);
  transform: translateY(-1px);
  box-shadow: var(--shadow-3);
}

.theme-light .match-detail-runes-card {
  background: var(--bg-elevated);
}

.match-detail-runes-card--me {
  border-color: color-mix(in srgb, var(--semantic-win) 50%, transparent);
  box-shadow:
    inset 3px 0 0 0 var(--semantic-win),
    0 4px 16px var(--win-soft);
}

.match-detail-runes-card-head {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
}

.match-detail-runes-avatar {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  flex-shrink: 0;
  display: block;
}

.match-detail-runes-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.match-detail-runes-name--link {
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-expo);
}

.match-detail-runes-name--link:hover,
.match-detail-runes-name--link:focus-visible {
  color: var(--accent-blue);
  outline: none;
}

.match-detail-runes-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.match-detail-runes-slot {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.match-detail-runes-slot-label {
  width: 28px;
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  letter-spacing: 0.06em;
}

.match-detail-runes-keystone {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-control);
  border: 1px solid var(--brand-border);
  box-shadow: 0 0 8px var(--glow-brand);
  background: var(--bg-elevated);
  object-fit: cover;
  flex-shrink: 0;
}

.match-detail-runes-style {
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.match-detail-runes-perk-list {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
}

.match-detail-runes-perk {
  width: 20px;
  height: 20px;
  border-radius: var(--radius-control);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  object-fit: cover;
  flex-shrink: 0;
}

.match-detail-runes-perk--empty {
  opacity: 0.25;
  border-style: dashed;
}

.match-detail-runes-more {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  cursor: help;
  margin-left: auto;
}

.match-detail-runes-question {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid var(--border-subtle);
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
  cursor: help;
  flex-shrink: 0;
}

.match-detail-runes-empty {
  padding: var(--space-16);
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.match-detail-runes-perk-pop {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 320px;
}

.match-detail-runes-perk-pop-name {
  font-weight: 700;
  color: var(--text-primary);
}

.match-detail-runes-perk-pop-desc {
  color: var(--text-secondary);
  line-height: 1.6;
  white-space: pre-line;
}
</style>
