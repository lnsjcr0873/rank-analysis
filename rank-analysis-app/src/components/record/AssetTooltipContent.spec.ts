/**
 * AssetTooltipContent 净化回归（R04）
 *
 * 外部物品/符文描述经 v-html 渲染：事件属性、危险 URL、畸形标签一律不得
 * 进入可执行 DOM；正常颜色与换行仍正确展示。
 *
 * @module components/record/__tests__/AssetTooltipContent
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AssetTooltipContent from './AssetTooltipContent.vue'

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
    expect(htmlOf('<font color="#f0c96b">金</font>')).toContain('color:#f0c96b')
    const evil = htmlOf('<span style="color:red;background:url(javascript:alert(1))">x</span>')
    expect(evil).not.toContain('url(')
    expect(evil).toContain('color:red')
  })

  it('剥离 br/畸形标签属性，换行仍生效', () => {
    expect(htmlOf('a<br onclick="alert(1)">b')).not.toContain('onclick')
    expect(htmlOf('a\nb')).toContain('<br>')
    expect(htmlOf('<img src=x onerror=alert(1)>hi')).not.toContain('onerror')
  })
})
