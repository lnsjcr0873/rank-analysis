import { describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import LazyImg from '../LazyImg.vue'

describe('LazyImg', () => {
  it('renders an img with the given src and alt', () => {
    const wrapper = mount(LazyImg, { props: { src: '/x.png', alt: 'champion' } })
    const img = wrapper.find('img')
    expect(img.attributes('src')).toBe('/x.png')
    expect(img.attributes('alt')).toBe('champion')
  })

  it('shows loading class before load and removes it after load event', async () => {
    const wrapper = mount(LazyImg, { props: { src: '/x.png' } })
    expect(wrapper.classes()).toContain('lazy-img-loading')
    await wrapper.find('img').trigger('load')
    expect(wrapper.classes()).not.toContain('lazy-img-loading')
  })

  it('defers error with a bounded auto-retry, then falls to error class', async () => {
    vi.useFakeTimers()
    const wrapper = mount(LazyImg, { props: { src: '/x.png' } })

    // 首次 error：进入延迟重试（换 `_r=` 查询串强制重取），不直接落 error
    await wrapper.find('img').trigger('error')
    expect(wrapper.classes()).toContain('lazy-img-loading')
    expect(wrapper.classes()).not.toContain('lazy-img-error')

    vi.advanceTimersByTime(1500)
    await nextTick()
    expect(wrapper.find('img').attributes('src')).toBe('/x.png?_r=1')

    // 第二次 error：再重试一次
    await wrapper.find('img').trigger('error')
    vi.advanceTimersByTime(1500)
    await nextTick()
    expect(wrapper.find('img').attributes('src')).toBe('/x.png?_r=2')

    // 第三次 error：重试用尽 → 落 error 态
    await wrapper.find('img').trigger('error')
    expect(wrapper.classes()).toContain('lazy-img-error')

    vi.useRealTimers()
  })

  it('src change resets state to loading without retry nonce', async () => {
    const wrapper = mount(LazyImg, { props: { src: '/a.png' } })
    await wrapper.find('img').trigger('error')
    await wrapper.setProps({ src: '/b.png' })
    expect(wrapper.classes()).toContain('lazy-img-loading')
    expect(wrapper.find('img').attributes('src')).toBe('/b.png')
    vi.useRealTimers()
  })
})
