import { describe, expect, it, vi } from 'vitest'
import {
  createAssistScheduler,
  isPanelPresent,
  MAYHEM_AUGMENT_TARGET_LEVELS,
  REQUIRED_SLOTS,
  type BandStatsDto,
  type LivePlayerStateDto
} from '../trigger'

/** 后端判定为「卡片在画面上」的三带 */
function presentStats(): BandStatsDto[] {
  return [
    {
      slot: 0,
      rect: { x: 0, y: 0, w: 100, h: 20 },
      stddev: 88,
      mean: 232,
      white: 0.14,
      active: true,
      score: 4.2,
      baseline: 80,
      ready: true
    },
    {
      slot: 1,
      rect: { x: 100, y: 0, w: 100, h: 20 },
      stddev: 94,
      mean: 235,
      white: 0.15,
      active: true,
      score: 5.1,
      baseline: 60,
      ready: true
    },
    {
      slot: 2,
      rect: { x: 200, y: 0, w: 100, h: 20 },
      stddev: 93,
      mean: 233,
      white: 0.13,
      active: true,
      score: 4.8,
      baseline: 50,
      ready: true
    }
  ]
}

/**
 * 关键回归夹具：普通游戏画面。stddev 高达 88/57/42——旧的「stddev ≥ 18 且 ≥2 带」
 * 口径在这里必然误判为三选一出现，正是功能完全不可用的根因。
 * 新口径下后端会给出 active=false，调度器必须据此继续等待。
 */
function gameplayStats(): BandStatsDto[] {
  return [
    {
      slot: 0,
      rect: { x: 0, y: 0, w: 100, h: 20 },
      stddev: 88.2,
      mean: 194,
      white: 0.011,
      active: false,
      score: 0.4,
      baseline: 86,
      ready: true
    },
    {
      slot: 1,
      rect: { x: 100, y: 0, w: 100, h: 20 },
      stddev: 57.3,
      mean: 234,
      white: 0.013,
      active: false,
      score: 0.2,
      baseline: 59,
      ready: true
    },
    {
      slot: 2,
      rect: { x: 200, y: 0, w: 100, h: 20 },
      stddev: 42.3,
      mean: 244,
      white: 0.008,
      active: false,
      score: 0.3,
      baseline: 43,
      ready: true
    }
  ]
}

/** 基线尚未积累到可判定 */
function warmingStats(): BandStatsDto[] {
  return [
    {
      slot: 0,
      rect: { x: 0, y: 0, w: 100, h: 20 },
      stddev: 88,
      active: false,
      score: 0,
      baseline: null,
      ready: false
    },
    {
      slot: 1,
      rect: { x: 100, y: 0, w: 100, h: 20 },
      stddev: 57,
      active: false,
      score: 0,
      baseline: null,
      ready: false
    },
    {
      slot: 2,
      rect: { x: 200, y: 0, w: 100, h: 20 },
      stddev: 42,
      active: false,
      score: 0,
      baseline: null,
      ready: false
    }
  ]
}

describe('isPanelPresent - 后端判定消费', () => {
  it('requires all three slots active', () => {
    expect(isPanelPresent(presentStats())).toBe(true)
    const twoOfThree = presentStats()
    twoOfThree[2].active = false
    expect(isPanelPresent(twoOfThree)).toBe(false)
    expect(REQUIRED_SLOTS).toBe(3)
  })

  it('treats high-stddev gameplay frame as NOT the panel', () => {
    // 旧口径在这里会返回 true（88/57/42 全部 ≥ 18，且 ≥2 带）
    const stats = gameplayStats()
    expect(stats.filter(s => s.stddev >= 18).length).toBe(3)
    expect(isPanelPresent(stats)).toBe(false)
  })

  it('refuses to judge while baseline is immature', () => {
    const stats = warmingStats()
    expect(isPanelPresent(stats)).toBe(false)
  })

  it('is false for empty or short input', () => {
    expect(isPanelPresent([])).toBe(false)
    expect(isPanelPresent(null)).toBe(false)
    expect(isPanelPresent(presentStats().slice(0, 2))).toBe(false)
  })
})

describe('AssistScheduler - 自校准基线差分 + 不丢轮次', () => {
  it('has correct 4 augment target levels', () => {
    expect(MAYHEM_AUGMENT_TARGET_LEVELS).toEqual([3, 7, 11, 15])
  })

  it('stays in idle_sleep without recommending when level is below target', async () => {
    const getBandStats = vi.fn().mockResolvedValue([])
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const getLivePlayer = vi
      .fn()
      .mockResolvedValue({ inGame: true, level: 2 } as LivePlayerStateDto)
    const onDetected = vi.fn()

    const scheduler = createAssistScheduler({ getPhase, getLivePlayer, getBandStats, onDetected })
    const tick = await scheduler.tick()

    expect(tick.mode).toBe('idle_sleep')
    expect(tick.currentRound).toBe(1)
    expect(tick.level).toBe(2)
    expect(tick.detected).toBe(false)
    // 低于目标等级不得触发推荐（基线预热只喂帧，不做识别）
    expect(onDetected).not.toHaveBeenCalled()
  })

  it('does NOT fire onDetected on an ordinary gameplay frame at level 3', async () => {
    // 这是修复的核心回归：旧口径在这里会立刻误判并烧掉第 1 轮
    const getBandStats = vi.fn().mockResolvedValue(gameplayStats())
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const getLivePlayer = vi
      .fn()
      .mockResolvedValue({ inGame: true, level: 3 } as LivePlayerStateDto)
    const onDetected = vi.fn().mockResolvedValue({ pushed: false, reason: 'no-augment-ui' })

    const scheduler = createAssistScheduler({ getPhase, getLivePlayer, getBandStats, onDetected })
    const tick = await scheduler.tick()

    expect(onDetected).not.toHaveBeenCalled()
    expect(tick.detected).toBe(false)
    expect(tick.mode).toBe('burst_detecting')
    expect(tick.currentRound).toBe(1)
    expect(tick.activeSlots).toBe(0)
  })

  it('does NOT burn round 1 when OCR yields no text (ocr-empty)', async () => {
    const getBandStats = vi.fn().mockResolvedValue(presentStats())
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const getLivePlayer = vi
      .fn()
      .mockResolvedValue({ inGame: true, level: 3 } as LivePlayerStateDto)
    const onDetected = vi.fn().mockResolvedValue({ pushed: false, reason: 'ocr-empty' })

    const scheduler = createAssistScheduler({ getPhase, getLivePlayer, getBandStats, onDetected })
    const tick = await scheduler.tick()

    expect(tick.detected).toBe(true)
    // 关键：轮次没被推进，reason 如实透出
    expect(tick.currentRound).toBe(1)
    expect(tick.reason).toBe('ocr-empty')
    expect(tick.note).toContain('第 1 轮仍在等待')
  })

  it('retries OCR while the panel stays up, then pushes and completes the round', async () => {
    // 面板从出现到消失期间一直 present：验证「上一拍 ocr-empty」不会把调度器
    // 卡死在 pushed_waiting_choice，而是冷却到期后继续重试。
    const getBandStats = vi.fn().mockResolvedValue(presentStats())
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const getLivePlayer = vi
      .fn()
      .mockResolvedValue({ inGame: true, level: 3 } as LivePlayerStateDto)
    const onRoundDone = vi.fn().mockResolvedValue(undefined)
    // 冷却 0：每帧都可重试。前两拍 OCR 空，第三拍成功。
    const onDetected = vi
      .fn()
      .mockResolvedValueOnce({ pushed: false, reason: 'ocr-empty' })
      .mockResolvedValueOnce({ pushed: false, reason: 'ocr-warming-up' })
      .mockResolvedValue({ pushed: true, reason: null })

    const scheduler = createAssistScheduler({
      getPhase,
      getLivePlayer,
      getBandStats,
      onDetected,
      onRoundDone,
      detectCooldownMs: 0
    })

    const t1 = await scheduler.tick()
    expect(t1.currentRound).toBe(1)
    expect(t1.reason).toBe('ocr-empty')
    expect(onDetected).toHaveBeenCalledTimes(1)

    // 面板仍在 → 必须重试，而不是「等待玩家选定」就结束
    const t2 = await scheduler.tick()
    expect(onDetected).toHaveBeenCalledTimes(2)
    expect(t2.currentRound).toBe(1)
    expect(t2.reason).toBe('ocr-warming-up')

    // 第三拍成功推送
    const t3 = await scheduler.tick()
    expect(onDetected).toHaveBeenCalledTimes(3)
    expect(t3.currentRound).toBe(1)
    expect(t3.note).toContain('已推送第 1 轮')

    // 推送成功后同面板不再重复推送
    await scheduler.tick()
    expect(onDetected).toHaveBeenCalledTimes(3)

    // 玩家选完 → 面板消失 → 本轮才完成
    getBandStats.mockResolvedValue(gameplayStats())
    const t5 = await scheduler.tick()
    expect(onRoundDone).toHaveBeenCalled()
    expect(t5.currentRound).toBe(2)
  })

  it('keeps the same round across many failed attempts, then succeeds', async () => {
    let stats = gameplayStats()
    const getBandStats = vi.fn().mockImplementation(() => Promise.resolve(stats))
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const getLivePlayer = vi
      .fn()
      .mockResolvedValue({ inGame: true, level: 3 } as LivePlayerStateDto)
    // 冷却 0：每帧都尝试，模拟持续误判/持续识别失败
    const onDetected = vi.fn().mockResolvedValue({ pushed: false, reason: 'ocr-empty' })

    const scheduler = createAssistScheduler({
      getPhase,
      getLivePlayer,
      getBandStats,
      onDetected,
      detectCooldownMs: 0
    })

    for (let i = 0; i < 30; i++) {
      const t = await scheduler.tick()
      expect(t.currentRound).toBe(1)
      expect(t.mode).not.toBe('all_completed')
    }

    // 面板真的出现并推送成功
    stats = presentStats()
    onDetected.mockResolvedValue({ pushed: true, reason: null })
    const ok = await scheduler.tick()
    expect(ok.note).toContain('已推送第 1 轮')
  })

  it('advances to round 2 only after a successful push followed by cards disappearing', async () => {
    let stats = presentStats()
    const getBandStats = vi.fn().mockImplementation(() => Promise.resolve(stats))
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const getLivePlayer = vi
      .fn()
      .mockResolvedValue({ inGame: true, level: 3 } as LivePlayerStateDto)
    const onDetected = vi.fn().mockResolvedValue({ pushed: true, reason: null })
    const onRoundDone = vi.fn().mockResolvedValue(undefined)
    const resetDetector = vi.fn().mockResolvedValue(undefined)

    const scheduler = createAssistScheduler({
      getPhase,
      getLivePlayer,
      getBandStats,
      onDetected,
      onRoundDone,
      resetDetector
    })

    const t1 = await scheduler.tick()
    expect(t1.mode).toBe('pushed_waiting_choice')
    expect(t1.currentRound).toBe(1)
    expect(onDetected).toHaveBeenCalledTimes(1)

    // 玩家选完 → 卡片消失
    stats = gameplayStats()
    const t2 = await scheduler.tick()
    expect(t2.mode).toBe('idle_sleep')
    expect(t2.currentRound).toBe(2)
    expect(t2.note).toContain('第 1 轮选择完毕')
    expect(onRoundDone).toHaveBeenCalledTimes(1)
    // 轮次推进必须连带重置后端滚动基线
    expect(resetDetector).toHaveBeenCalled()

    // 5 级仍不到第 2 轮门槛（7 级）→ 不进突发态，只低频预热基线
    getLivePlayer.mockResolvedValue({ inGame: true, level: 5 } as LivePlayerStateDto)
    getBandStats.mockClear()
    const t3 = await scheduler.tick()
    expect(t3.mode).toBe('idle_sleep')
    expect(t3.currentRound).toBe(2)
    expect(onDetected).toHaveBeenCalledTimes(1)
  })

  it('does NOT advance round when detection falls back without a successful push', async () => {
    let stats = presentStats()
    const getBandStats = vi.fn().mockImplementation(() => Promise.resolve(stats))
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const getLivePlayer = vi
      .fn()
      .mockResolvedValue({ inGame: true, level: 3 } as LivePlayerStateDto)
    const onDetected = vi.fn().mockResolvedValue({ pushed: false, reason: 'ocr-empty' })
    const onRoundDone = vi.fn().mockResolvedValue(undefined)

    const scheduler = createAssistScheduler({
      getPhase,
      getLivePlayer,
      getBandStats,
      onDetected,
      onRoundDone
    })

    await scheduler.tick()
    // 画面回落（误判消失），但本轮从未推送成功
    stats = gameplayStats()
    const t2 = await scheduler.tick()
    expect(t2.currentRound).toBe(1)
    expect(t2.mode).toBe('burst_detecting')
    expect(onRoundDone).not.toHaveBeenCalled()
  })

  it('force-advances when the player level passes the next gate without detection', async () => {
    const getBandStats = vi.fn().mockResolvedValue(gameplayStats())
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    // 玩家已 8 级：第 1 轮（3 级）判定始终失败，说明确实被跳过
    const getLivePlayer = vi
      .fn()
      .mockResolvedValue({ inGame: true, level: 8 } as LivePlayerStateDto)
    const onDetected = vi.fn().mockResolvedValue({ pushed: false, reason: 'no-augment-ui' })
    const resetDetector = vi.fn().mockResolvedValue(undefined)

    const scheduler = createAssistScheduler({
      getPhase,
      getLivePlayer,
      getBandStats,
      onDetected,
      resetDetector
    })

    const t1 = await scheduler.tick()
    expect(t1.currentRound).toBe(2)
    expect(t1.note).toContain('第 1 轮始终未识别到三选一')
    expect(t1.note).toContain('推进到第 2 轮')
    expect(resetDetector).toHaveBeenCalled()
  })

  it('surfaces detector-baseline-warming instead of pretending no-augment-ui', async () => {
    const getBandStats = vi.fn().mockResolvedValue(warmingStats())
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const getLivePlayer = vi
      .fn()
      .mockResolvedValue({ inGame: true, level: 3 } as LivePlayerStateDto)

    const scheduler = createAssistScheduler({ getPhase, getLivePlayer, getBandStats })
    const tick = await scheduler.tick()

    expect(tick.ready).toBe(false)
    expect(tick.reason).toBe('detector-baseline-warming')
  })

  it('warms the baseline before the target level, in idle_sleep', async () => {
    // 关键回归：目标等级之前也必须喂帧，否则首轮基线只能从「面板已弹出」开始学。
    const getBandStats = vi.fn().mockResolvedValue(gameplayStats())
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const getLivePlayer = vi
      .fn()
      .mockResolvedValue({ inGame: true, level: 1 } as LivePlayerStateDto)
    const onDetected = vi.fn()

    const scheduler = createAssistScheduler({
      getPhase,
      getLivePlayer,
      getBandStats,
      onDetected,
      baselineProbeIntervalMs: 0
    })

    const t1 = await scheduler.tick()
    expect(t1.mode).toBe('idle_sleep')
    expect(t1.currentRound).toBe(1)
    // 低于目标等级就已经在采样喂基线
    expect(getBandStats).toHaveBeenCalled()
    expect(t1.ready).toBe(true)
    expect(t1.note).toContain('基线就绪')
    // 休眠期绝不能误触发推荐
    expect(onDetected).not.toHaveBeenCalled()
  })

  it('throttles baseline probes to the configured interval', async () => {
    const getBandStats = vi.fn().mockResolvedValue(gameplayStats())
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const getLivePlayer = vi
      .fn()
      .mockResolvedValue({ inGame: true, level: 1 } as LivePlayerStateDto)

    const scheduler = createAssistScheduler({
      getPhase,
      getLivePlayer,
      getBandStats,
      // 5 分钟：连续多拍都应被节流掉
      baselineProbeIntervalMs: 300_000
    })

    await scheduler.tick()
    expect(getBandStats).toHaveBeenCalledTimes(1)
    await scheduler.tick()
    await scheduler.tick()
    expect(getBandStats).toHaveBeenCalledTimes(1)
  })

  it('does not probe the baseline while the panel is being pushed', async () => {
    const getBandStats = vi.fn().mockResolvedValue(presentStats())
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const getLivePlayer = vi
      .fn()
      .mockResolvedValue({ inGame: true, level: 3 } as LivePlayerStateDto)
    const onDetected = vi.fn().mockResolvedValue({ pushed: true, reason: null })

    const scheduler = createAssistScheduler({
      getPhase,
      getLivePlayer,
      getBandStats,
      onDetected
    })
    await scheduler.tick()
    // burst 态只采样一次（来自突发检测本身），不再叠加休眠预热
    expect(getBandStats).toHaveBeenCalledTimes(1)
  })

  it('resets state machine to round 1 when leaving InProgress', async () => {
    let phase = 'InProgress'
    const getPhase = vi.fn().mockImplementation(() => Promise.resolve(phase))
    const getLivePlayer = vi
      .fn()
      .mockResolvedValue({ inGame: true, level: 12 } as LivePlayerStateDto)
    const getBandStats = vi.fn().mockResolvedValue([])
    const resetDetector = vi.fn().mockResolvedValue(undefined)

    const scheduler = createAssistScheduler({
      getPhase,
      getLivePlayer,
      getBandStats,
      resetDetector
    })
    await scheduler.tick()

    phase = 'EndOfGame'
    const tickEnd = await scheduler.tick()
    expect(tickEnd.mode).toBe('idle_sleep')
    expect(tickEnd.currentRound).toBe(1)
    expect(tickEnd.note).toContain('非对局中')
    // 换局必须清掉后端滚动基线，否则上一局的画面成为下一局的「正常」参照
    expect(resetDetector).toHaveBeenCalled()
  })

  it('skips screen capture when isCaptureEnabled returns false even if level reached', async () => {
    const getBandStats = vi.fn().mockResolvedValue([])
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const getLivePlayer = vi
      .fn()
      .mockResolvedValue({ inGame: true, level: 3 } as LivePlayerStateDto)

    const scheduler = createAssistScheduler({
      getPhase,
      getLivePlayer,
      getBandStats,
      isCaptureEnabled: () => false
    })

    const tick = await scheduler.tick()
    expect(tick.mode).toBe('burst_detecting')
    expect(tick.detected).toBe(false)
    expect(getBandStats).not.toHaveBeenCalled()
  })

  it('never declares all_completed on detection failure alone', async () => {
    // 18 级却始终识别不到：1~3 轮可凭「越过下一道门」强制推进，
    // 但第 4 轮（最后一道门 15 级）之后没有下一道门可依，只能继续等——
    // 绝不能因为「一直失败」就把本局谎报成四轮已选完。
    const getBandStats = vi.fn().mockResolvedValue(gameplayStats())
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const getLivePlayer = vi
      .fn()
      .mockResolvedValue({ inGame: true, level: 18 } as LivePlayerStateDto)
    const onDetected = vi.fn().mockResolvedValue({ pushed: false, reason: 'no-augment-ui' })

    const scheduler = createAssistScheduler({ getPhase, getLivePlayer, getBandStats, onDetected })

    let tick = await scheduler.tick()
    for (let i = 0; i < 20; i++) {
      tick = await scheduler.tick()
      expect(tick.mode).not.toBe('all_completed')
    }
    expect(tick.currentRound).toBe(MAYHEM_AUGMENT_TARGET_LEVELS.length)
    expect(tick.mode).toBe('burst_detecting')
  })

  it('reaches all_completed only after all 4 rounds genuinely complete', async () => {
    let stats = gameplayStats()
    const getBandStats = vi.fn().mockImplementation(() => Promise.resolve(stats))
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const getLivePlayer = vi
      .fn()
      .mockResolvedValue({ inGame: true, level: 18 } as LivePlayerStateDto)
    const onDetected = vi.fn().mockResolvedValue({ pushed: true, reason: null })

    const scheduler = createAssistScheduler({ getPhase, getLivePlayer, getBandStats, onDetected })

    for (let round = 1; round <= MAYHEM_AUGMENT_TARGET_LEVELS.length; round++) {
      // 面板出现 → 推送成功
      stats = presentStats()
      const on = await scheduler.tick()
      expect(on.note).toContain(`已推送第 ${round} 轮`)

      // 玩家选完 → 卡片消失 → 本轮完成
      stats = gameplayStats()
      const off = await scheduler.tick()
      expect(off.currentRound).toBe(round + 1)
    }

    const done = await scheduler.tick()
    expect(done.mode).toBe('all_completed')
    expect(done.currentRound).toBe(MAYHEM_AUGMENT_TARGET_LEVELS.length)
    expect(done.note).toContain('4 轮强化已全部选毕')
  })
})
