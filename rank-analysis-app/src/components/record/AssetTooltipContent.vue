<template>
  <div class="asset-tooltip" :class="rarityClass">
    <div class="asset-tooltip-header">
      <img :src="iconSrc" :alt="name" class="asset-tooltip-icon" loading="lazy" decoding="async" />
      <div class="asset-tooltip-title-wrap">
        <div class="asset-tooltip-title">{{ name }}</div>
        <div v-if="rarityLabel" class="asset-tooltip-rarity" :class="rarityClass">
          {{ rarityLabel }}
        </div>
      </div>
    </div>
    <div
      v-if="sanitizedDescription"
      class="asset-tooltip-description"
      v-html="sanitizedDescription"
    ></div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'

const props = defineProps<{
  iconSrc: string
  name: string
  description: string
  /** LCU 返回的海克斯强化稀有度，如 kPrismatic / kGold / kSilver / kBronze */
  rarity?: string
}>()

const rarityMeta: Record<string, { label: string; cls: string }> = {
  kPrismatic: { label: '棱彩', cls: 'asset-tooltip-prismatic' },
  kGold: { label: '黄金', cls: 'asset-tooltip-gold' },
  kSilver: { label: '白银', cls: 'asset-tooltip-silver' },
  kBronze: { label: '青铜', cls: 'asset-tooltip-bronze' }
}

const rarityClass = computed(() => (props.rarity ? (rarityMeta[props.rarity]?.cls ?? '') : ''))
const rarityLabel = computed(() => (props.rarity ? (rarityMeta[props.rarity]?.label ?? '') : ''))

/** 允许的颜色值：hex / rgb() / 已知颜色关键字，拒绝 url(/expression 等向量 */
const SAFE_COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^()]*\)|hsla?\([^()]*\)|[a-z]+)$/i

/**
 * 净化描述文本，使用 DOMParser 构建白名单 DOM 节点（只保留安全 <span> 颜色与 <br>）
 * 彻底消除基于正则清洗的 XSS 绕过隐患
 */
function sanitizeTooltipHtml(rawHtml: string): string {
  if (!rawHtml) return ''

  // 将旧式 <font color="..."> 预转为带 style="color:..." 的 span 标签
  const preprocessed = rawHtml
    .replace(
      /<font\b[^>]*\bcolor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi,
      (_match, c1, c2, c3) => {
        const color = (c1 ?? c2 ?? c3 ?? '').trim()
        return SAFE_COLOR_RE.test(color) ? `<span data-safe-color="${color}">` : '<span>'
      }
    )
    .replace(/<\/font>/gi, '</span>')
    .replace(/\n/g, '<br>')

  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') {
    return preprocessed.replace(/<[^>]+>/g, '')
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(preprocessed, 'text/html')

  function sanitizeNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      const div = document.createElement('div')
      div.textContent = node.textContent ?? ''
      return div.innerHTML
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      const tagName = el.tagName.toUpperCase()
      if (tagName === 'BR') {
        return '<br>'
      }
      let inner = ''
      for (const child of Array.from(el.childNodes)) {
        inner += sanitizeNode(child)
      }
      if (tagName === 'SPAN' || tagName === 'FONT') {
        let color = el.getAttribute('data-safe-color') || el.getAttribute('color')
        if (!color && el.getAttribute('style')) {
          const styleMatch = el.getAttribute('style')?.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)
          if (styleMatch) color = styleMatch[1].trim()
        }
        if (color && SAFE_COLOR_RE.test(color)) {
          return `<span style="color:${color}">${inner}</span>`
        }
        return inner ? `<span>${inner}</span>` : ''
      }
      // 其他未知或不安全标签剥离外壳，仅保留其内部子节点内容
      return inner
    }
    return ''
  }

  let result = ''
  for (const child of Array.from(doc.body.childNodes)) {
    result += sanitizeNode(child)
  }
  return result
}

const sanitizedDescription = computed(() => {
  return sanitizeTooltipHtml(props.description)
})
</script>

<style scoped>
.asset-tooltip {
  max-width: 320px;
  padding: var(--space-2) 0;
  position: relative;
}

/* 海克斯稀有度：tooltip 左侧一条色带 + 标题色 */
.asset-tooltip.asset-tooltip-prismatic {
  --rarity-color: #bb7dff;
}

.asset-tooltip.asset-tooltip-gold {
  --rarity-color: #f4c658;
}

.asset-tooltip.asset-tooltip-silver {
  --rarity-color: #bfcde3;
}

.asset-tooltip.asset-tooltip-bronze {
  --rarity-color: #c58459;
}

.asset-tooltip[class*='asset-tooltip-']::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--rarity-color);
  border-radius: var(--radius-xs);
  box-shadow: 0 0 6px var(--rarity-color);
}

.asset-tooltip-header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-8);
  margin-bottom: var(--space-6);
}

.asset-tooltip-icon {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  object-fit: cover;
}

.asset-tooltip[class*='asset-tooltip-'] .asset-tooltip-icon {
  border: 1px solid var(--rarity-color);
  box-shadow: 0 0 6px color-mix(in srgb, var(--rarity-color) 40%, transparent);
}

.asset-tooltip-title-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.asset-tooltip-title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  line-height: var(--line-height-tight);
}

.asset-tooltip[class*='asset-tooltip-'] .asset-tooltip-title {
  color: var(--rarity-color);
}

.asset-tooltip-rarity {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--rarity-color);
  letter-spacing: 0.04em;
}

.asset-tooltip-description {
  white-space: normal;
  line-height: var(--line-height-normal);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.asset-tooltip-description :deep(span) {
  /* 允许行内颜色标签生效 */
}

.asset-tooltip-description :deep(br) {
  display: block;
  content: '';
  margin-bottom: var(--space-4);
}
</style>
