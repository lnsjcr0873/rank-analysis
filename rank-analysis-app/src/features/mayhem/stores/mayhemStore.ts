import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { mayhemAssistBlockedReason } from '../assistState'
import {
  getMayhemChampions,
  getMayhemAugments,
  getMayhemChampionDetail,
  getMayhemStatus,
  syncMayhemData,
  getMyChampionStats,
  getMyAugmentStats,
  extractMayhemChampions,
  type MayhemChampion,
  type MayhemAugment,
  type MayhemStatus,
  type MyChampionStat,
  type MyAugmentStat,
  type ChampionDetailEntry
} from '../services/mayhemData'
import { getSharedAssistScheduler, onSharedAssistTick, type AssistTick } from '../trigger'
import { prewarmMayhemOcr } from '../services/mayhemOcr'
import { setOverlayClickThrough } from '@renderer/features/overlay/panels'
import { putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'

export const useMayhemStore = defineStore('mayhem', () => {
  const champions = ref<MayhemChampion[]>([])
  const augments = ref<MayhemAugment[]>([])
  const myChamps = ref<MyChampionStat[]>([])
  const myAugs = ref<MyAugmentStat[]>([])
  const status = ref<MayhemStatus | null>(null)

  const loading = ref(false)
  const augsLoading = ref(false)
  const syncing = ref(false)
  const error = ref('')
  const selectedChampionId = ref<number | null>(null)

  const isDataReady = computed(() => champions.value.length > 0)

  /**
   * 加载英雄榜数据。内存中已有数据时直接秒开，后台可静默刷新。
   */
  async function loadChampions(force = false): Promise<void> {
    if (champions.value.length && !force) return
    loading.value = true
    error.value = ''
    try {
      const res = await getMayhemChampions()
      const list = extractMayhemChampions(res)
      if (list.length) {
        champions.value = list
        if (!selectedChampionId.value) {
          selectedChampionId.value = list[0].id
        }
      }
    } catch (e) {
      if (!champions.value.length) {
        error.value = `读取本地数据失败：${String(e)}`
      }
    } finally {
      loading.value = false
    }
  }

  /**
   * 加载强化榜数据。
   */
  async function loadAugments(force = false): Promise<void> {
    if (augments.value.length && !force) return
    augsLoading.value = true
    try {
      const res = await getMayhemAugments()
      if (res.data?.length) {
        augments.value = res.data
      }
    } catch (e) {
      console.warn('[mayhemStore] loadAugments failed:', e)
    } finally {
      augsLoading.value = false
    }
  }

  /**
   * 加载本地自采数据。
   */
  async function loadMine(force = false): Promise<void> {
    if (myChamps.value.length && !force) return
    try {
      const [c, a] = await Promise.all([getMyChampionStats(), getMyAugmentStats()])
      myChamps.value = c
      myAugs.value = a
    } catch (e) {
      console.warn('[mayhemStore] loadMine failed:', e)
    }
  }

  /**
   * 页面挂载时初始化：确保数据立即可用，避免因切页导致的空白或闪烁。
   */
  async function init(): Promise<void> {
    // 无论 status 状态为何，优先读取本地现存缓存，保证页面秒开不白屏
    await loadChampions()
    void loadMine()

    try {
      status.value = await getMayhemStatus()
      if (!champions.value.length && !syncing.value) {
        await sync(false)
      } else if (!status.value?.ready && !syncing.value) {
        // 本地已有数据时后台静默同步，绝不阻塞首屏与详情渲染
        void sync(false).catch(err => console.warn('[mayhemStore] background sync error:', err))
      }
    } catch (e) {
      console.warn('[mayhemStore] getMayhemStatus failed:', e)
      if (!champions.value.length && !syncing.value) {
        void sync(false).catch(() => {})
      }
    }
  }

  const detailCache = new Map<number, ChampionDetailEntry>()

  /**
   * 获取单英雄详情（内存缓存优先，带 120ms 并发容错重试）
   */
  async function getChampionDetail(id: number, force = false): Promise<ChampionDetailEntry | null> {
    if (!id) return null
    if (!force && detailCache.has(id)) {
      return detailCache.get(id)!
    }
    try {
      const d = await getMayhemChampionDetail(id)
      if (d) {
        detailCache.set(id, d)
        return d
      }
    } catch (e) {
      console.warn(`[mayhemStore] getChampionDetail(${id}) first attempt failed:`, e)
    }

    // 容错重试：如果第一次读取因后台同步切换目录或文件锁短暂返回失败，延迟 120ms 重试
    await new Promise(r => setTimeout(r, 120))
    try {
      const retry = await getMayhemChampionDetail(id)
      if (retry) {
        detailCache.set(id, retry)
        return retry
      }
    } catch (e) {
      console.error(`[mayhemStore] getChampionDetail(${id}) retry failed:`, e)
    }
    return null
  }

  /**
   * 执行数据同步。
   *
   * R16:返回明确结果，调用方必须据实反馈——此前内部吞错返回 void，
   * 诊断台在断网/下载失败后仍显示"校验完成"。
   */
  async function sync(force = false): Promise<{ ok: boolean; busy?: boolean; error?: string }> {
    if (syncing.value) return { ok: false, busy: true }
    syncing.value = true
    error.value = ''
    try {
      const report = await syncMayhemData(force)
      if (report || force) {
        detailCache.clear()
      }
      await Promise.all([loadChampions(true), loadAugments(true)])
      status.value = await getMayhemStatus()
      return { ok: true }
    } catch (e) {
      error.value = `同步失败：${String(e)}`
      return { ok: false, error: error.value }
    } finally {
      syncing.value = false
    }
  }

  // -------------------------------------------------------------------------
  // 对局监听单例调度器（全局唯一，避免 Gaming 与 Mayhem 跨页双重轮询截屏）
  // -------------------------------------------------------------------------
  const assistRunning = ref(false)
  const lastAssistTick = ref<AssistTick | null>(null)
  /**
   * 助手未启动的**具体原因**，供 UI 直接展示。写入方是全局常驻服务
   * `useInGameServices`，故用共享模块 ref 而非 store 私有 state，详见
   * `features/mayhem/assistState.ts`。
   */
  const assistBlockedReason = mayhemAssistBlockedReason

  /**
   * 把共享调度器的每轮状态写进 store。
   *
   * 此前 `lastAssistTick` 只有声明、没有任何写入点，诊断台恒为「未开始」——
   * 三选一不弹时用户拿不到任何原因（note / reason / 各带 z 分数）。订阅后
   * Mayhem 页能实时显示判定依据，标定不再靠猜。
   */
  onSharedAssistTick(tick => {
    lastAssistTick.value = tick
  })

  /** OCR 模型预热中（下载 rec 模型 + 建 session）。assist_tick 快路径永不下载，预热必须提前。 */
  const ocrWarmingUp = ref(false)

  function startAssist(): void {
    const s = getSharedAssistScheduler()
    if (!s.running) {
      void setOverlayClickThrough(true).catch(() => {})
      s.start()
      // OCR 预热提前到监听启动时：后台下载，不阻塞首轮 tick。
      // fire-and-forget：失败由 tick 的 ocr-warming-up 兜底展示。
      void prewarmOcr()
    }
    // 全局自动启动路径（useInGameServices）可能已经把它跑起来了，
    // 按钮状态必须以调度器真实状态为准，否则会出现「已在监听却显示未开启」。
    assistRunning.value = true
    assistBlockedReason.value = ''
  }

  /**
   * 记录「为什么不跑」，并同步停掉调度器。
   *
   * @param reason 空字符串表示正常停止（非阻塞）；非空时界面据此提示。
   */
  function stopAssist(reason = ''): void {
    const s = getSharedAssistScheduler()
    if (s.running) {
      s.stop()
    }
    assistRunning.value = false
    assistBlockedReason.value = reason
  }

  /**
   * OCR 模型预热（幂等）。后端引擎就绪后直接返回，未编译 OCR 的构建直接跳过。
   */
  async function prewarmOcr(): Promise<void> {
    if (ocrWarmingUp.value) return
    await prewarmMayhemOcr(w => {
      ocrWarmingUp.value = w
    })
  }

  function toggleAssist(): boolean {
    const s = getSharedAssistScheduler()
    if (s.running) {
      stopAssist()
      void putConfigByIpc(CONFIG_KEYS.mayhemAssistEnabled, false).catch(() => {})
      return false
    } else {
      startAssist()
      void putConfigByIpc(CONFIG_KEYS.mayhemAssistEnabled, true).catch(() => {})
      return true
    }
  }

  /**
   * 同步调度器的真实状态到 store，供跨页（全局自动启动）读取。
   *
   * 全局路径 `useInGameServices` 直接操作 `getSharedAssistScheduler()`，此前
   * 完全不写 `assistRunning`，导致「全局已自动开启」时按钮仍显示未开启、
   * 「全局已停」时按钮仍显示已开启。此处由全局路径单向写回，store 的
   * toggle 仍是唯一的「用户主动」入口。
   *
   * @param running 调度器真实运行态
   * @param blockedReason 非空表示因设置/构建等原因无法运行
   */
  function syncAssistState(running: boolean, blockedReason = ''): void {
    assistRunning.value = running
    assistBlockedReason.value = running ? '' : blockedReason
  }

  return {
    champions,
    augments,
    myChamps,
    myAugs,
    status,
    loading,
    augsLoading,
    syncing,
    error,
    selectedChampionId,
    isDataReady,
    assistRunning,
    assistBlockedReason,
    ocrWarmingUp,
    prewarmOcr,
    lastAssistTick,
    syncAssistState,
    init,
    loadChampions,
    loadAugments,
    loadMine,
    getChampionDetail,
    sync,
    startAssist,
    stopAssist,
    toggleAssist
  }
})
