/**
 * AssetTooltipContent 净化回归（R04）
 *
 * 外部物品/符文描述经结构化节点树 + Vue 插值渲染（**无 v-html**）：事件属性、
 * 危险 URL、畸形标签一律不得进入可执行 DOM；正常颜色与换行仍正确展示。
 *
 * @module components/record/__tests__/AssetTooltipContent
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AssetTooltipContent from './AssetTooltipContent.vue'
import { parseTooltipNodes } from '../../utils/tooltipParse'

function htmlOf(description: string): string {
  const w = mount(AssetTooltipContent, {
    props: { iconSrc: 'x.png', name: 't', description }
  })
  return w.find('.asset-tooltip-description').html()
}

describe('AssetTooltipContent sanitize (R04)', () => {
  it('剥离 span 上的事件属性，只留文本', () => {
    const html = htmlOf('<span onclick="window.__reviewMarker=1">probe</span>')
    expect(html).not.toContain('onclick')
    expect(html).toContain('probe')
  })

  it('保留合法 font 颜色，拒绝危险 style 载荷', () => {
    const w = mount(AssetTooltipContent, {
      props: { iconSrc: 'x.png', name: 't', description: '<font color="#f0c96b">金</font>' }
    })
    const span = w.find('.asset-tooltip-description span')
    expect(span.exists()).toBe(true)
    expect(span.text()).toBe('金')
    expect(span.attributes('style')).toMatch(/color\s*:\s*(rgb\(240,\s*201,\s*107\)|#f0c96b)/i)

    const evil = htmlOf('<span style="color:red;background:url(javascript:alert(1))">x</span>')
    expect(evil).not.toContain('url(')
    expect(evil).not.toContain('javascript:')
    expect(evil).toContain('x')
  })

  it('剥离 br/畸形标签属性，换行仍生效', () => {
    expect(htmlOf('a<br onclick="alert(1)">b')).not.toContain('onclick')
    expect(htmlOf('a\nb')).toContain('<br')
    expect(htmlOf('<img src=x onerror=alert(1)>hi')).not.toContain('onerror')
    expect(htmlOf('<img src=x onerror=alert(1)>hi')).toContain('hi')
  })
})

describe('parseTooltipNodes（节点树级）', () => {
  it('剥离 script/svg/iframe，内容保留为转义文本', () => {
    const nodes = parseTooltipNodes(
      '<script>alert(1)</script><svg onload=alert(2)></svg><iframe src=x></iframe>body'
    )
    expect(nodes.map(n => (n.type === 'text' ? n.text : '<br>')).join('')).toContain('body')
    expect(JSON.stringify(nodes)).not.toContain('<script')
    expect(JSON.stringify(nodes)).not.toContain('<svg')
    expect(JSON.stringify(nodes)).not.toContain('<iframe')
  })

  it('mXSS 畸形载荷不产出可执行节点（math/mtext/table/mglyph/style 换插入模式）', () => {
    const payload = '<math><mtext><table><mglyph><style><!--</style><img src=x onerror=x>'
    const html = htmlOf(payload)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('<math>')
    expect(html).not.toContain('javascript:')
  })

  it('span 伪造 style 无法注入多个声明（只读 color，且过白名单）', () => {
    const nodes = parseTooltipNodes(
      '<span style="color:red;background:url(javascript:alert(1))">x</span>'
    )
    expect(JSON.stringify(nodes)).not.toContain('url(')
    const n = nodes.find(n => n.type === 'text' && n.text === 'x')
    expect(n && n.color === 'red').toBe(true)
  })

  it('继承色：内层 span 无合法色时沿用外层颜色', () => {
    const nodes = parseTooltipNodes('<span style="color:red"><span>内</span></span>')
    const inner = nodes.find(n => n.type === 'text' && n.text === '内')
    expect(inner?.color).toBe('red')
  })

  it('空描述返回空数组', () => {
    expect(parseTooltipNodes('')).toEqual([])
  })
})
