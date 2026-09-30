import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useOverlayDebugStore } from '../stores/overlayDebugStore'

/**
 * 浮窗掉帧探针的读数计算。
 *
 * 探针本身很简单，但两个丢弃规则错了就会得出**反向**结论，所以必须钉住：
 *
 * 1. `deltaMs > 1000` 必须丢弃。浮窗最小化 / 游戏切前台会造出数秒的间隔，
 *    算进 fps 会把读数拉到个位数——而此时用户看到的游戏帧率其实没问题，
 *    于是探针会误导排查方向。
 * 2. `contentEmpty` 必须独立于 fps 存在，否则「空内容 vs 有内容」这一组
 *    A/B 做不出来——而这正是劈开「DWM 合成」与「前端渲染」的唯一依据。
 */
describe('overlayDebugStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useOverlayDebugStore().reset()
  })

  it('默认关闭，label 为空（不污染正式界面）', () => {
    const dbg = useOverlayDebugStore()
    expect(dbg.enabled).toBe(false)
    expect(dbg.label).toBe('')
  })

  it('enable 后才产出可读 label', () => {
    const dbg = useOverlayDebugStore()
    dbg.enable()
    dbg.sample(16)
    expect(dbg.label).not.toBe('')
  })

  it('sample 把 16ms 间隔折算成约 60fps', () => {
    const dbg = useOverlayDebugStore()
    for (let i = 0; i < 30; i++) dbg.sample(16)
    expect(dbg.fps).toBeGreaterThan(55)
    expect(dbg.fps).toBeLessThan(65)
  })

  it('低帧率读数会明显低于 60fps', () => {
    const dbg = useOverlayDebugStore()
    for (let i = 0; i < 30; i++) dbg.sample(50)
    expect(dbg.fps).toBeLessThan(25)
  })

  it('丢弃 >1000ms 的假帧，避免最小化污染读数', () => {
    const dbg = useOverlayDebugStore()
    for (let i = 0; i < 30; i++) dbg.sample(16)
    const before = dbg.fps

    // 模拟切前台 / 最小化产生的巨大间隔
    for (let i = 0; i < 5; i++) dbg.sample(5000)

    expect(dbg.fps).toBeCloseTo(before, 1)
  })

  it('丢弃 0 与负间隔（首帧无 delta）', () => {
    const dbg = useOverlayDebugStore()
    dbg.sample(0)
    dbg.sample(-16)
    expect(dbg.fps).toBe(0)
  })

  it('帧时间抖动：稳定序列趋近 0', () => {
    const dbg = useOverlayDebugStore()
    for (let i = 0; i < 60; i++) dbg.sample(16)
    expect(dbg.frameJitterMs).toBeLessThan(0.5)
  })

  it('帧时间抖动：大幅跳变序列显著大于稳定序列', () => {
    const dbg = useOverlayDebugStore()
    for (let i = 0; i < 60; i++) dbg.sample(i % 2 === 0 ? 8 : 40)
    expect(dbg.frameJitterMs).toBeGreaterThan(10)
  })

  it('contentEmpty 独立于 fps 记录，供「空内容」A/B 使用', () => {
    const dbg = useOverlayDebugStore()
    dbg.enable()

    for (let i = 0; i < 30; i++) dbg.sample(16)
    dbg.setContentEmpty(false)
    expect(dbg.contentEmpty).toBe(false)
    expect(dbg.label).toContain('有内容')

    dbg.setContentEmpty(true)
    expect(dbg.contentEmpty).toBe(true)
    expect(dbg.label).toContain('空内容')
  })

  it('面板推送次数累计，且不影响 fps（截屏嫌疑指标独立）', () => {
    const dbg = useOverlayDebugStore()
    dbg.enable()
    for (let i = 0; i < 30; i++) dbg.sample(16)
    const fpsBefore = dbg.fps

    dbg.notePanelPush()
    dbg.notePanelPush()
    dbg.notePanelPush()

    expect(dbg.panelPushCount).toBe(3)
    expect(dbg.label).toContain('面板3次')
    expect(dbg.fps).toBeCloseTo(fpsBefore, 5)
  })

  it('reset 清空所有读数与面板计数', () => {
    const dbg = useOverlayDebugStore()
    dbg.enable()
    for (let i = 0; i < 30; i++) dbg.sample(16)
    dbg.notePanelPush()
    dbg.setContentEmpty(false)

    dbg.reset()

    expect(dbg.fps).toBe(0)
    expect(dbg.frameJitterMs).toBe(0)
    expect(dbg.panelPushCount).toBe(0)
    expect(dbg.contentEmpty).toBe(true)
  })
})
