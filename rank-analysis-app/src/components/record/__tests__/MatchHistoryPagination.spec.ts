import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import MatchHistoryPagination from '../MatchHistoryPagination.vue'
import {
  resetRecordPagination,
  bindRecordPagination,
  unbindRecordPagination,
  syncRecordPagination,
  recordPagination
} from '../recordPagination'

describe('MatchHistoryPagination（读分页桥接，无真实分页库依赖）', () => {
  beforeEach(() => {
    resetRecordPagination()
  })

  it('初始占位：1/1；上一页禁用（第 1 页），下一页可点（未到末页，命令 no-op）', () => {
    const wrapper = mount(MatchHistoryPagination)
    expect(wrapper.text()).toContain('1 / 1')
    const [prev, next] = wrapper.findAll('.mhp-btn')
    expect(prev.attributes('disabled')).toBeDefined()
    expect(next.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('桥接绑定后：标签渲染 page/pageCount，翻页按钮联动启用', async () => {
    const next = vi.fn()
    const prev = vi.fn()
    bindRecordPagination({ next, prev })
    syncRecordPagination({ page: 2, pageCount: 5, noMoreMatches: false, perPage: 10, total: 50 })
    const wrapper = mount(MatchHistoryPagination)
    await flushPromises()
    expect(wrapper.text()).toContain('2 / 5')
    const [prevBtn, nextBtn] = wrapper.findAll('.mhp-btn')
    expect(prevBtn.attributes('disabled')).toBeUndefined()
    expect(nextBtn.attributes('disabled')).toBeUndefined()
    await nextBtn.trigger('click')
    expect(next).toHaveBeenCalledTimes(1)
    await prevBtn.trigger('click')
    expect(prev).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    unbindRecordPagination()
  })

  it('末页且无更多对局：下一页禁用并停止追加', () => {
    bindRecordPagination({ next: () => {}, prev: () => {} })
    syncRecordPagination({ page: 5, pageCount: 5, noMoreMatches: true, perPage: 10, total: 50 })
    const wrapper = mount(MatchHistoryPagination)
    const nextBtn = wrapper.findAll('.mhp-btn').at(-1)!
    expect(nextBtn.attributes('disabled')).toBeDefined()
    wrapper.unmount()
    unbindRecordPagination()
  })

  it('readonly 状态同步（外部写不生效，运行期读到的一直是桥接真相）', () => {
    bindRecordPagination({ next: () => {}, prev: () => {} })
    syncRecordPagination({ page: 3, pageCount: 7, noMoreMatches: false, perPage: 10, total: 70 })
    const before = recordPagination.page
    // readonly 仅编译期拦截；运行期对外部写是静默 no-op（不抛，防生产环境 JS 报错中断）
    ;(recordPagination as { page: number }).page = 99
    expect(recordPagination.page).toBe(before)
    unbindRecordPagination()
  })
})
