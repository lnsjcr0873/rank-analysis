/**
 * 大乱斗助手触发调度器（触发时机层 v3 - 自校准基线差分 + 不丢轮次）。
 *
 * ## 与 v2 的根本差异
 *
 * v2 用「标题带亮度标准差 ≥ 18、且至少 2 带成立」判断三选一是否出现。该口径已
 * 被实测证伪：1920×1080、**屏幕上没有任何三选一面板**时，三带 stddev 就有
 * 88.2 / 57.3 / 42.3，等于恒真。后果是调度器在 3 级就把第 1 轮判掉、反复对
 * 战场画面跑 OCR、拿不到卡名后静默失败——功能表现为「完全用不了」。
 *
 * v3 的两条规则：
 *
 * 1. **判定权交给后端**：三选一是否出现由 `mayhem::detector`（滚动基线差分 +
 *    稳健 z 分数 + 三带同时成立 + 连续帧去抖）给出，前端只消费 `active` / `ready`，
 *    不再自己比数值。跨帧基线只能在后端维护。
 * 2. **轮次不因误判丢失**：只有「真的推送成功过、随后卡片消失」才算本轮完成；
 *    单纯超时或画面回落都不推进轮次。玩家等级越过下一道门时才强制推进
 *    （说明该轮被跳过）。误判最多浪费几秒算力，不会吞掉一整轮强化。
 *
 * ## 休眠策略
 *
 * 1. 💤 静默休眠（95%+ 时间）：0 截屏、0 渲染，仅 1s 轮询一次等级。
 * 2. ⚡ 目标等级唤醒：达到 3/7/11/15 级进入高频探测；超时后放慢轮询省钱。
 * 3. 🎯 推送浮窗推荐；卡片消失且本轮确实推过 → 推进下一轮并重回休眠。
 */

export interface BandStatsDto {
  slot: number
  rect: { x: number; y: number; w: number; h: number }
  /** 亮度标准差（观测值，不再是判据） */
  stddev: number
  /** 平均亮度（观测值） */
  mean?: number
  /** 近白像素占比（观测值） */
  white?: number
  /** 后端基线差分判定：该卡位当前是否判为「卡片在画面上」 */
  active: boolean
  /** 该卡位的最大稳健 z 分数（>= 3 即 active） */
  score?: number
  /** stddev 自身的滚动中位数基线，未成熟为 null */
  baseline?: number | null
  /** 基线是否成熟到可以下判定 */
  ready: boolean
}

/** 校准截图（BMP base64） */
export interface BandDumpDto {
  slot: number
  bmpBase64: string
}

/** 局内玩家轻量状态（Live Client API） */
export interface LivePlayerStateDto {
  inGame: boolean
  level?: number | null
  gameTime?: number | null
  currentGold?: number | null
  championName?: string | null
}

/** 三选一恒为 3 张卡：三带必须同时成立。 */
export const REQUIRED_SLOTS = 3

/** 海克斯大乱斗强化解锁目标等级（4 轮） */
export const MAYHEM_AUGMENT_TARGET_LEVELS = [3, 7, 11, 15] as const

/** 后端未推送原因 → 人类可读文案。 */
export const REASON_NOTES: Record<string, string> = {
  'not-in-game': '未进入对局',
  'assist-disabled': '三选一助手已关闭',
  'capture-disabled': '截图识别已关闭',
  'ocr-warming-up': '⏳ OCR 模型准备中（后台加载 rec 模型，完成后自动识别）',
  'detector-baseline-warming': '⏳ 正在学习当前对局画面基线（数秒内完成）',
  'no-augment-ui': '画面上还没有三选一卡片',
  'ocr-empty': '判为三选一但三张卡都没识别出卡名（截取几何可能需要重新校准）',
  'ocr-not-configured': '当前构建未编译 OCR（需 --features ocr-rapid）'
}

export type AssistSchedulerMode =
  'idle_sleep' | 'burst_detecting' | 'pushed_waiting_choice' | 'all_completed'

/** 检测沿回调的结论：是否真的把推荐推上浮窗。 */
export interface AssistOutcome {
  pushed: boolean
  reason?: string | null
}

export interface AssistDeps {
  getPhase(): Promise<string>
  getLivePlayer?(): Promise<LivePlayerStateDto | null>
  getBandStats(): Promise<BandStatsDto[] | null>
  /** 是否允许截图轮询识别（默认 true 以保持向后兼容；缺省或返回 false 时不截屏） */
  isCaptureEnabled?(): Promise<boolean> | boolean
  /** 清空后端自校准基线（换局 / 每轮推进时调用） */
  resetDetector?(): Promise<void>
  /** 选卡完成 / 轮次推进时调用：清空 overlay 残留面板，不等 30s TTL */
  onRoundDone?(): Promise<void>
  /** 每轮 tick 完成后的回调（UI 状态展示用；异常不影响调度） */
  onTick?(tick: AssistTick): void
  /**
   * 检测沿触发：detected 由 false→true（或离开冷却期再次成立）时触发一次。
   * 返回是否真的推送成功——**只有推送成功才允许把本轮标记为已完成**。
   */
  onDetected?(tick: AssistTick): Promise<AssistOutcome | void>
  /** 检测沿触发冷却（毫秒），默认 8s——三选一停留期间不重复推面板 */
  detectCooldownMs?: number
  /** 单轮高频突发窗口时长（毫秒），默认 25s；超时后放慢轮询但不推进轮次 */
  burstTimeoutMs?: number
  /**
   * 休眠期基线预热采样间隔（毫秒），默认 5s。
   * 目标等级之前也低频喂普通游戏画面，让后端滚动基线在面板弹出**之前**就成熟。
   */
  baselineProbeIntervalMs?: number
}

export interface AssistTick {
  phase: string
  /** 后端判为「卡片在画面上」的卡位数 */
  activeSlots: number
  maxStddev: number | null
  /** 各卡位最大稳健 z 分数的最大值，供诊断台看判定依据 */
  maxScore: number | null
  /** 后端基线是否成熟 */
  ready: boolean
  /** 后端未推送原因（机器可读），无则 null */
  reason: string | null
  note: string
  /** 三选一画面已确认出现 */
  detected: boolean
  /** 当前状态机模式 */
  mode: AssistSchedulerMode
  /** 当前强化轮次（1..=4，5 为全部完成） */
  currentRound: number
  /** 当前玩家等级（null 为未能读取到） */
  level: number | null
}

export interface AssistScheduler {
  start(): void
  stop(): void
  tick(): Promise<AssistTick>
  readonly running: boolean
  lastTick(): AssistTick | null
  /** 重置对局状态机到第 1 轮 */
  reset(): void
}

/** 三带是否全部被判为「卡片在画面上」（基线未成熟时恒为 false）。 */
export function isPanelPresent(stats: BandStatsDto[] | null | undefined): boolean {
  if (!stats || stats.length < REQUIRED_SLOTS) return false
  if (!stats.every(s => s.ready !== false)) return false
  const active = stats.filter(s => s.active).length
  return active >= REQUIRED_SLOTS
}

export function createAssistScheduler(deps: AssistDeps, idleIntervalMs = 1_000): AssistScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null
  let isRunning = false
  let last: AssistTick | null = null
  let lastDetectedAt = -Infinity

  let currentRound = 1
  let mode: AssistSchedulerMode = 'idle_sleep'
  let burstStartTime = 0
  /** 已放慢轮询（超过突发窗口但本轮仍未完成） */
  let slow = false
  /** 本轮是否真的推送成功过——只有它为 true 才允许因卡片消失而完成轮次 */
  let pushedThisRound = false
  /** 休眠期基线预热的节流时间戳（ms） */
  let lastBaselineProbeAt = -Infinity
  /** 后端基线是否已成熟（跨 tick 保持，便于休眠期也能展示） */
  let baselineReady = false
  /** 上一拍是否在局内（用于只在「离开对局」那一拍做全量复位） */
  let wasInGame = true

  const cooldown = deps.detectCooldownMs ?? 8_000
  const burstTimeout = deps.burstTimeoutMs ?? 25_000
  /** 放慢后的轮询间隔：仍未检测到时省 GPU，但保持随时可命中 */
  const slowIntervalMs = 2_000
  /** 休眠期基线预热间隔：够密（8 样本能快速成熟），又不至于每 tick 都截屏 */
  const baselineProbeIntervalMs = deps.baselineProbeIntervalMs ?? 5_000

  function reset() {
    currentRound = 1
    mode = 'idle_sleep'
    burstStartTime = 0
    lastDetectedAt = -Infinity
    slow = false
    pushedThisRound = false
    lastBaselineProbeAt = -Infinity
    baselineReady = false
  }

  /** 推进到下一轮；返回推进后的状态机模式。 */
  async function advanceRound(): Promise<AssistSchedulerMode> {
    currentRound += 1
    mode = currentRound > MAYHEM_AUGMENT_TARGET_LEVELS.length ? 'all_completed' : 'idle_sleep'
    burstStartTime = 0
    lastDetectedAt = -Infinity
    slow = false
    pushedThisRound = false
    // 下一轮的面板还没出现，先把基线学习任务交还给休眠期预热
    lastBaselineProbeAt = -Infinity
    baselineReady = false
    // 基线必须跟着轮次重置，否则上一轮卡片画面会留在滚动窗口里
    if (deps.resetDetector) {
      try {
        await deps.resetDetector()
      } catch (e) {
        console.warn('[assist] 重置自校准基线失败:', e)
      }
    }
    return mode
  }

  function baseTick(phase: string, level: number | null, patch: Partial<AssistTick>): AssistTick {
    last = {
      phase,
      activeSlots: 0,
      maxStddev: null,
      maxScore: null,
      ready: true,
      reason: null,
      detected: false,
      mode,
      currentRound,
      level,
      note: '',
      ...patch
    }
    deps.onTick?.(last)
    return last
  }

  /** 汇总一次带统计的读数（供 note 与诊断字段复用）。 */
  function summarize(stats: BandStatsDto[] | null) {
    const valid = (stats ?? []).filter(s => Number.isFinite(s.stddev))
    const active = valid.filter(s => s.active).length
    const scores = valid.map(s => (Number.isFinite(s.score ?? NaN) ? (s.score as number) : 0))
    return {
      activeSlots: active,
      maxStddev: valid.length ? Math.max(...valid.map(s => s.stddev)) : null,
      maxScore: scores.length ? Math.max(...scores) : null,
      ready: (stats ?? []).length > 0 && (stats ?? []).every(s => s.ready !== false)
    }
  }

  /** 玩家等级是否已越过下一道门（= 本轮被跳过，可安全推进）。 */
  function levelPassedNextGate(level: number | null): boolean {
    const nextIdx = currentRound // 0-based：下一轮的下标
    if (nextIdx >= MAYHEM_AUGMENT_TARGET_LEVELS.length) return false
    const nextLevel = MAYHEM_AUGMENT_TARGET_LEVELS[nextIdx]
    return level != null && level >= nextLevel
  }

  /**
   * 休眠期基线预热：低频喂一帧**普通游戏画面**给后端自校准检测器。
   *
   * 必须存在的原因：目标等级之前若完全不截图，首轮的基线只能从「面板已经弹出」
   * 的帧开始学，面板帧会污染滚动窗口，检测器可能永远不触发。
   *
   * @returns 本次是否真的截了图；`ready` 为跨 tick 保持的基线成熟状态
   */
  async function probeBaseline(): Promise<{ sampled: boolean; ready: boolean }> {
    if (Date.now() - lastBaselineProbeAt < baselineProbeIntervalMs) {
      return { sampled: false, ready: baselineReady }
    }
    lastBaselineProbeAt = Date.now()
    if (deps.isCaptureEnabled) {
      try {
        if (!(await deps.isCaptureEnabled())) return { sampled: false, ready: baselineReady }
      } catch {
        return { sampled: false, ready: baselineReady }
      }
    }
    try {
      baselineReady = summarize(await deps.getBandStats()).ready
    } catch (e) {
      // 采样失败不影响主流程：下一拍还会再试
      console.warn('[assist] 基线预热采样失败:', e)
    }
    return { sampled: true, ready: baselineReady }
  }

  /**
   * 真正调用 `onDetected` 并把结论落成一个 tick。
   *
   * 由 `burst_detecting`（首次命中）与 `pushed_waiting_choice`（上一拍推送失败后的
   * 重试）共用——后者保证「面板还在、但上次 OCR 空结果」时能继续重试，
   * 而不会卡在「等待玩家选定」直到面板消失。
   */
  async function attemptPush(
    phase: string,
    level: number | null,
    sum: ReturnType<typeof summarize>
  ): Promise<AssistTick> {
    const targetLevel = MAYHEM_AUGMENT_TARGET_LEVELS[currentRound - 1]
    const diag = {
      activeSlots: sum.activeSlots,
      maxStddev: sum.maxStddev,
      maxScore: sum.maxScore,
      ready: sum.ready
    }
    lastDetectedAt = Date.now()

    if (!deps.onDetected) {
      return baseTick(phase, level, {
        ...diag,
        detected: true,
        mode: 'pushed_waiting_choice',
        currentRound,
        note: `等待玩家选定第 ${currentRound} 轮强化…`
      })
    }

    let outcome: AssistOutcome | void
    try {
      outcome = await deps.onDetected(
        baseTick(phase, level, {
          ...diag,
          detected: true,
          mode: 'pushed_waiting_choice',
          currentRound,
          note: `🎯 触发第 ${currentRound} 轮三选一强化推荐 (目标 ${targetLevel} 级)`
        })
      )
    } catch (e) {
      // 抛异常不算推送成功 → 保持 pushedThisRound=false，下一拍继续重试
      return baseTick(phase, level, {
        ...diag,
        detected: true,
        mode: 'pushed_waiting_choice',
        currentRound,
        reason: 'push-failed',
        note: `推送推荐失败：${String(e)}`
      })
    }

    const pushed = outcome === undefined ? true : outcome.pushed
    const reason = outcome === undefined ? null : (outcome.reason ?? null)
    if (pushed) {
      pushedThisRound = true
      return baseTick(phase, level, {
        ...diag,
        detected: true,
        mode: 'pushed_waiting_choice',
        currentRound,
        note: `🎯 已推送第 ${currentRound} 轮强化推荐，等你选定`
      })
    }
    // 推送失败：**不推进轮次**，留在本轮继续等（下一拍冷却到期后重试）
    const note = reason ? (REASON_NOTES[reason] ?? `未推送：${reason}`) : '未推送：后端未给出原因'
    return baseTick(phase, level, {
      ...diag,
      detected: true,
      mode: 'pushed_waiting_choice',
      currentRound,
      reason,
      note: `⚠️ ${note}（第 ${currentRound} 轮仍在等待，不会跳过）`
    })
  }

  async function tick(): Promise<AssistTick> {
    try {
      const phase = await deps.getPhase()
      if (phase !== 'InProgress') {
        // 只在「真正离开对局」的那一拍复位：局外每秒一次 resetDetector 纯属
        // 白白多一次 IPC + 磁盘操作。初始为 true，保证新开调度器时也能清掉
        // 上一次运行残留的基线。
        if (wasInGame) {
          reset()
          if (deps.resetDetector) {
            try {
              await deps.resetDetector()
            } catch (e) {
              console.warn('[assist] 重置自校准基线失败:', e)
            }
          }
        }
        wasInGame = false
        return baseTick(phase, null, {
          mode: 'idle_sleep',
          currentRound: 1,
          note: '非对局中（等待进入对局）'
        })
      }
      wasInGame = true

      // 获取当前实时玩家状态
      let playerState: LivePlayerStateDto | null = null
      if (deps.getLivePlayer) {
        try {
          playerState = await deps.getLivePlayer()
        } catch {
          /* 局内 API 偶发超时不阻塞 */
        }
      }
      const level = playerState?.level ?? null

      // 1. 全部 4 轮已选完 → 深度休眠
      if (currentRound > MAYHEM_AUGMENT_TARGET_LEVELS.length) {
        return baseTick(phase, level, {
          mode: 'all_completed',
          currentRound: MAYHEM_AUGMENT_TARGET_LEVELS.length,
          note: `🎉 本局 4 轮强化已全部选毕 (当前 ${level ?? '--'} 级)`
        })
      }

      const targetLevel = MAYHEM_AUGMENT_TARGET_LEVELS[currentRound - 1]

      // 2. 静默休眠态：监听是否达到目标等级
      if (mode === 'idle_sleep') {
        if (level != null && level >= targetLevel) {
          mode = 'burst_detecting'
          burstStartTime = Date.now()
          slow = false
        } else {
          // 目标等级之前也低频喂一帧普通画面，让基线在面板弹出**之前**成熟
          const probe = await probeBaseline()
          const levelText = level != null ? `${level} 级` : '连接中'
          return baseTick(phase, level, {
            mode: 'idle_sleep',
            currentRound,
            ready: probe.ready,
            reason: probe.ready ? null : 'detector-baseline-warming',
            note: `💤 静默休眠中 (当前 ${levelText} / 等待目标 ${targetLevel} 级)${
              probe.ready ? ' · 基线就绪' : ' · 基线学习中'
            }`
          })
        }
      }

      // 3. 突发探测态
      if (mode === 'burst_detecting') {
        const captureAllowed = deps.isCaptureEnabled ? await deps.isCaptureEnabled() : true
        if (!captureAllowed) {
          return baseTick(phase, level, {
            mode: 'burst_detecting',
            currentRound,
            reason: 'capture-disabled',
            note: '⚡ 突发检测中 (截图识别已关闭，可通过快捷键或手动推荐触发)'
          })
        }

        const stats = await deps.getBandStats()
        const sum = summarize(stats)
        const present = isPanelPresent(stats)

        if (present) {
          mode = 'pushed_waiting_choice'
          slow = false
          // 冷却期外才真正推送；冷却期内落到下面「等待玩家选定」
          if (Date.now() - lastDetectedAt >= cooldown) {
            return await attemptPush(phase, level, sum)
          }
          return baseTick(phase, level, {
            activeSlots: sum.activeSlots,
            maxStddev: sum.maxStddev,
            maxScore: sum.maxScore,
            ready: sum.ready,
            detected: true,
            mode: 'pushed_waiting_choice',
            currentRound,
            note: `等待玩家选定第 ${currentRound} 轮强化…`
          })
        }

        // 没检测到卡片
        if (levelPassedNextGate(level)) {
          // 玩家已越过下一道门 → 本轮确实被跳过，安全推进
          const done = currentRound
          const nextMode = await advanceRound()
          if (nextMode === 'all_completed') {
            return baseTick(phase, level, {
              mode: nextMode,
              currentRound,
              note: `🎉 本局 4 轮强化已全部选毕 (当前 ${level ?? '--'} 级)`
            })
          }
          return baseTick(phase, level, {
            mode: nextMode,
            currentRound,
            note: `⏭ 第 ${done} 轮始终未识别到三选一，已推进到第 ${currentRound} 轮`
          })
        }

        if (Date.now() - burstStartTime >= burstTimeout) {
          // 超时**不推进轮次**：只放慢轮询。三选一在目标等级必定弹出，
          // 玩家没法跳过，漏掉的唯一原因是检测/OCR 没成功，必须继续等。
          slow = true
          return baseTick(phase, level, {
            activeSlots: sum.activeSlots,
            maxStddev: sum.maxStddev,
            maxScore: sum.maxScore,
            ready: sum.ready,
            mode: 'burst_detecting',
            currentRound,
            note: `⏳ 持续等待第 ${currentRound} 轮三选一（已放慢轮询；玩家等级越过 ${
              MAYHEM_AUGMENT_TARGET_LEVELS[currentRound] ?? '--'
            } 级才推进）`
          })
        }

        const readyHint = sum.ready ? '' : ' · 基线学习中'
        return baseTick(phase, level, {
          activeSlots: sum.activeSlots,
          maxStddev: sum.maxStddev,
          maxScore: sum.maxScore,
          ready: sum.ready,
          mode: 'burst_detecting',
          currentRound,
          reason: sum.ready ? 'no-augment-ui' : 'detector-baseline-warming',
          note: `⚡ 突发检测中 (第 ${currentRound} 轮 / 目标 ${targetLevel} 级)${readyHint}`
        })
      }

      // 4. 已检测到画面，等待玩家选卡
      if (mode === 'pushed_waiting_choice') {
        const captureAllowed = deps.isCaptureEnabled ? await deps.isCaptureEnabled() : true
        const stats = captureAllowed ? await deps.getBandStats() : null
        const sum = summarize(stats)
        const present = isPanelPresent(stats)

        if (!present) {
          if (pushedThisRound) {
            // 真的推过 + 卡片消失 = 玩家选完了，本轮完成
            const done = currentRound
            if (deps.onRoundDone) {
              try {
                await deps.onRoundDone()
              } catch (e) {
                console.warn('[assist] 清空残留面板失败:', e)
              }
            }
            const nextMode = await advanceRound()
            return baseTick(phase, level, {
              mode: nextMode,
              currentRound,
              note: `✅ 第 ${done} 轮选择完毕，重回休眠`
            })
          }
          // 从未推送成功 → 只是误判/画面回落，**不消耗轮次**
          mode = 'burst_detecting'
          return baseTick(phase, level, {
            activeSlots: sum.activeSlots,
            maxStddev: sum.maxStddev,
            maxScore: sum.maxScore,
            ready: sum.ready,
            mode: 'burst_detecting',
            currentRound,
            note: `⚠️ 画面判定回落且本轮未推送成功，继续等待第 ${currentRound} 轮三选一`
          })
        }

        // 面板仍在，但**还没推送成功过** → 冷却到期后重试推送。
        // 否则 OCR 空结果会让它一直卡在「等待玩家选定」直到面板消失。
        if (!pushedThisRound && Date.now() - lastDetectedAt >= cooldown) {
          return await attemptPush(phase, level, sum)
        }

        return baseTick(phase, level, {
          activeSlots: sum.activeSlots,
          maxStddev: sum.maxStddev,
          maxScore: sum.maxScore,
          ready: sum.ready,
          detected: true,
          mode: 'pushed_waiting_choice',
          currentRound,
          note: `等待玩家选定第 ${currentRound} 轮强化…`
        })
      }

      return baseTick(phase, level, { note: '（无操作）' })
    } catch (e) {
      last = {
        phase: 'unknown',
        activeSlots: 0,
        maxStddev: null,
        maxScore: null,
        ready: false,
        reason: 'tick-exception',
        detected: false,
        mode,
        currentRound,
        level: null,
        note: `tick 异常：${String(e)}`
      }
    }

    deps.onTick?.(last!)
    return last!
  }

  function scheduleNext() {
    if (!isRunning) return
    // 动态间隔：突发态 350ms；超过突发窗口仍未命中则放慢到 2s 省资源
    const delay =
      slow && (mode === 'burst_detecting' || mode === 'pushed_waiting_choice')
        ? slowIntervalMs
        : mode === 'burst_detecting' || mode === 'pushed_waiting_choice'
          ? 350
          : idleIntervalMs
    timer = setTimeout(async () => {
      if (!isRunning) return
      await tick()
      scheduleNext()
    }, delay)
  }

  return {
    start() {
      if (isRunning) return
      isRunning = true
      void tick().then(() => scheduleNext())
    },
    stop() {
      isRunning = false
      if (timer != null) {
        clearTimeout(timer)
        timer = null
      }
    },
    tick,
    get running() {
      return isRunning
    },
    lastTick: () => last,
    reset
  }
}

let sharedAssistScheduler: AssistScheduler | null = null

/** 共享调度器的状态订阅者（Pinia store 等）。 */
const tickListeners = new Set<(tick: AssistTick) => void>()

/**
 * 订阅共享调度器的每轮状态。
 *
 * 此前 `lastAssistTick` 从未被写入（共享调度器没传 `onTick`），诊断台永远显示
 * 「未开始」——三选一失败时用户看不到任何原因。订阅后 UI 才有可观测性。
 * @returns 退订函数
 */
export function onSharedAssistTick(listener: (tick: AssistTick) => void): () => void {
  tickListeners.add(listener)
  return () => tickListeners.delete(listener)
}

export function getSharedAssistScheduler(): AssistScheduler {
  if (!sharedAssistScheduler) {
    // 延迟动态引入，避免在无 Tauri 环境单测中顶层执行 invoke 抛错
    sharedAssistScheduler = createAssistScheduler({
      getPhase: async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        return (await invoke('mayhem_gameflow_phase')) as string
      },
      getLivePlayer: async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        return (await invoke('mayhem_get_live_player')) as LivePlayerStateDto
      },
      getBandStats: async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        return (await invoke('mayhem_capture_band_stats')) as BandStatsDto[]
      },
      isCaptureEnabled: async () => {
        const { getConfigByIpc } = await import('@renderer/services/ipc')
        const { CONFIG_KEYS } = await import('@renderer/services/configKeys')
        return (
          (await getConfigByIpc<boolean>(CONFIG_KEYS.mayhemCaptureEnabled).catch(() => false)) ===
          true
        )
      },
      resetDetector: async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('mayhem_detector_reset')
      },
      onRoundDone: async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('clear_overlay_panel')
      },
      onTick: tick => {
        for (const l of tickListeners) {
          try {
            l(tick)
          } catch (e) {
            console.warn('[assist] tick 订阅者异常:', e)
          }
        }
      },
      onDetected: async tick => {
        const { invoke } = await import('@tauri-apps/api/core')
        const { setOverlayLayout, pushOverlayPanel } =
          await import('@renderer/features/overlay/panels')
        // R09:传 null 由后端从局内实时状态反查真实英雄（反查不到走标注的全局口径，
        // 不再回落样例英雄）。前端 LivePlayerStateDto 只有 championName 无数字 id，
        // 故不在此侧解析。
        const outcome = (await invoke('mayhem_assist_tick', { championId: null })) as {
          pushed?: boolean
          payload?: unknown
          reason?: string
        }
        // 后端 reason 必须如实回传：调度器据此决定本轮能否标记为已完成，
        // 也据此给出可读文案。旧实现在此静默 return，是「完全用不了」且无提示的
        // 直接原因之一。
        if (!outcome.pushed || !outcome.payload) {
          tick.reason = outcome.reason ?? null
          return { pushed: false, reason: outcome.reason ?? null }
        }
        await pushOverlayPanel('mayhem-augments', outcome.payload)
        await setOverlayLayout(560, 240, 'top-center')
        await invoke('show_overlay_window')
        return { pushed: true, reason: null }
      }
    })
  }
  return sharedAssistScheduler
}
