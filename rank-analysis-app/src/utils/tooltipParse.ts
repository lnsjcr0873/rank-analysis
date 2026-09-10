/**
 * 描述文本 → 安全节点树解析器。
 *
 * 渲染侧只消费节点树（Vue 插值 + `:style` 对象，无 v-html / innerHTML），
 * 此处定义纯函数供组件与单测共用。
 */
export interface TooltipNode {
  type: 'text' | 'br'
  text?: string
  color?: string
}

/** 允许的颜色值：hex / rgb() / 已知颜色关键字，拒绝 url(/expression 等向量 */
const SAFE_COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^()]*\)|hsla?\([^()]*\)|[a-z]+)$/i

/** 将旧式 `<font color="...">` 预转为带 data-safe-color 的 span；`\n` → `<br>` */
function preprocess(rawHtml: string): string {
  return rawHtml
    .replace(
      /<font\b[^>]*\bcolor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi,
      (_match, c1, c2, c3) => {
        const color = (c1 ?? c2 ?? c3 ?? '').trim()
        return SAFE_COLOR_RE.test(color) ? `<span data-safe-color="${color}">` : '<span>'
      }
    )
    .replace(/<\/font>/gi, '</span>')
    .replace(/\n/g, '<br>')
}

/** 无 DOMParser 环境（SSR/非 DOM）的降级：剥标签为纯文本，保留换行 */
function fallbackNodes(preprocessed: string): TooltipNode[] {
  const parts = preprocessed.split(/<br\s*\/?>/i)
  const nodes: TooltipNode[] = []
  for (let i = 0; i < parts.length; i++) {
    const text = parts[i].replace(/<[^>]+>/g, '')
    if (text) nodes.push({ type: 'text', text })
    if (i < parts.length - 1) nodes.push({ type: 'br' })
  }
  return nodes
}

function walk(node: Node, out: TooltipNode[], inheritColor: string | null): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push({ type: 'text', text: node.textContent ?? '', color: inheritColor ?? undefined })
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const el = node as HTMLElement
  const tagName = el.tagName.toUpperCase()
  if (tagName === 'BR') {
    out.push({ type: 'br' })
    return
  }
  if (tagName === 'SPAN' || tagName === 'FONT') {
    let color = el.getAttribute('data-safe-color') || el.getAttribute('color')
    if (!color && el.getAttribute('style')) {
      const styleMatch = el.getAttribute('style')?.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)
      if (styleMatch) color = styleMatch[1].trim()
    }
    const safeColor = color && SAFE_COLOR_RE.test(color) ? color : inheritColor
    for (const child of Array.from(el.childNodes)) walk(child, out, safeColor)
    return
  }
  // 其余未知或不安全标签剥离外壳，仅保留其内部子节点内容
  for (const child of Array.from(el.childNodes)) walk(child, out, inheritColor)
}

/**
 * 解析描述为安全节点树（纯函数，供单测直接断言）。
 *
 * 渲染走 Vue 插值（`{{ }}` 自动转义）与 `:style` 对象绑定，完全移除 v-html：
 * 外部描述文本的任何内容都不会以 HTML 字符串进入 `innerHTML`，从而即使
 * DOMParser 在畸形输入（如 `<math><mtext><table>…` mXSS 载荷）下解析结果与
 * 预期不符，也不可能逃逸为可执行节点。保留的仅是：转义文本 / `<br>` /
 * 颜色经 {@link SAFE_COLOR_RE} 白名单校验的 `<span>`。
 */
export function parseTooltipNodes(rawHtml: string): TooltipNode[] {
  if (!rawHtml) return []
  const preprocessed = preprocess(rawHtml)
  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') {
    return fallbackNodes(preprocessed)
  }
  const doc = new DOMParser().parseFromString(preprocessed, 'text/html')
  const nodes: TooltipNode[] = []
  for (const child of Array.from(doc.body.childNodes)) walk(child, nodes, null)
  return nodes
}
