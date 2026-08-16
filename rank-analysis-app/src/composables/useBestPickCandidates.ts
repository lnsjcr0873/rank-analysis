import { computed, ref, watch, type ComputedRef } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { normalizeLcuPosition } from '@renderer/services/counterIntel'
import type { OpggMode } from '@renderer/services/opgg'
import type { ChampSelect, SessionData, Subteam } from '@renderer/types/domain/gaming'
import type { championOption } from '@renderer/types/domain/champion'
import type { Position } from '@renderer/types/rules'

/** useBestPickCandidates 的依赖注入（全部由 Gaming.vue 会话上下文派生） */
export interface BestPickDeps {
  /** useSessionSync 的 reactive 会话数据（subteams/phase/queueId/mySubteamId/champSelect...） */
  sessionData: SessionData
  /** 自己的 puuid（来自 useGameState 的召唤师），排除「我」本人 */
  mySummonerPuuid: ComputedRef<string>
  /** OP.GG 数据模式（ranked/aram），驱动推荐条显示条件 */
  opggMode: ComputedRef<OpggMode>
}

/**
 * 选人期「最优应对推荐条」的候选计算（自 Gaming.vue 抽出，行为等价）。
 *
 * 职责边界：排序（我方置首）→ 占用集合（ban/我方已亮/敌方已锁）→
 * 候选池懒加载（get_champion_options）→ 落列规则（panelForColumn）。
 * 纯输入→输出，无隐式全局状态；组件只负责装配。
 *
 * @param deps - 会话上下文与派生输入（见 BestPickDeps）
 * @returns 推荐条渲染所需的全部 derived 值 + 落列判定函数
 */
export function useBestPickCandidates(deps: BestPickDeps) {
  const { sessionData, mySummonerPuuid, opggMode } = deps

  /**
   * 最后一次选人期快照。
   *
   * 离开选人期后后端不再下发 champSelect，sessionData.champSelect 会被 undefined 覆盖，
   * 但 ban 条与阶段条要留着供对局中/赛后回看，故前端自留一份。
   */
  const lastChampSelect = ref<ChampSelect | undefined>(undefined)

  // 新一局进入选人期时，新的 champSelect 数据还没到达——这个窗口里若不清掉快照，
  // 横幅会误显示上一局的 ban（比什么都不显示更糟：用户会以为那是本局的）。
  // phase 一变成 ChampSelect 立即清空，等新数据到达后由下面的 watch 重新填入。
  watch(
    () => sessionData.phase,
    (newVal, oldVal) => {
      if (newVal === 'ChampSelect' && oldVal !== 'ChampSelect') {
        lastChampSelect.value = undefined
      }
    }
  )

  watch(
    () => sessionData.champSelect,
    cs => {
      if (cs !== undefined) lastChampSelect.value = cs
    }
  )

  /** 展示用 champSelect：实时数据优先，选人期结束后回退到最后一次快照，供离开选人期后继续展示阶段/ban 条 */
  const displayChampSelect = computed(() => sessionData.champSelect ?? lastChampSelect.value)

  const expectedSubteamSize = computed(() => (sessionData.isMultiTeam ? 2 : 5))

  const orderedSubteams = computed(() => {
    // 我方排第一格；其它按 subteamId 升序
    const my = sessionData.subteams.find(s => s.subteamId === sessionData.mySubteamId)
    const others = sessionData.subteams
      .filter(s => s.subteamId !== sessionData.mySubteamId)
      .sort((a, b) => a.subteamId - b.subteamId)
    return my ? [my, ...others] : others
  })

  /** 我的分路，取自会话里标着「我」的那名玩家；ARAM 等无分路模式为 null */
  const myPosition = computed<Position | null>(() => {
    const me = orderedSubteams.value
      .flatMap(s => s.players)
      .find(p => p.summoner.puuid === mySummonerPuuid.value)
    const p = me?.assignedPosition?.toLowerCase()
    return p === 'top' || p === 'jungle' || p === 'middle' || p === 'bottom' || p === 'utility'
      ? p
      : null
  })

  /** 我方 / 敌方已 ban 英雄 id 列表，非选人期或无 ban 数据时为空数组 */
  const myBans = computed(() => displayChampSelect.value?.myBans ?? [])
  const theirBans = computed(() => displayChampSelect.value?.theirBans ?? [])

  /**
   * 我方已亮队友英雄 id（含 intent/picking/locked，排除 ban 态与我自己）：
   * 协同推荐以「队友预选/锁定」为锚（场景：辅助预选 X → 推荐协同最优 AD）。
   */
  const teammatePickedIds = computed(() => {
    const my = orderedSubteams.value.find(s => s.subteamId === sessionData.mySubteamId)
    return (
      my?.players
        .filter(
          p =>
            p.championId > 0 &&
            p.pickState !== 'banning' &&
            p.summoner.puuid !== mySummonerPuuid.value
        )
        .map(p => p.championId) ?? []
    )
  })

  /** 我本局分路（LCU 命名 top/jungle/...；空 = 位置未知，不过滤候选池） */
  const teammatesMyPosition = computed(() => {
    const pos = myPosition.value
    // 大小写不敏感校验：LCU 下发的是小写，直接 positionToOpgg 会漏判
    return pos && normalizeLcuPosition(pos) ? pos : ''
  })

  /** 我方已亮出的英雄 id 列表（用于敌方情报卡的克制提示，过滤未选中的 0/负值） */
  const myChampionIds = computed(
    () =>
      orderedSubteams.value
        .find(s => s.subteamId === sessionData.mySubteamId)
        ?.players.map(p => p.championId)
        .filter(id => id > 0) ?? []
  )

  /**
   * P2 候选池：全量英雄列表（get_champion_options 一次性拉取，懒加载）。
   * 只依赖后端命令，与 loadChampionNames 各自独立、无冲突。
   */
  const allChampionIds = ref<number[]>([])
  let championOptionsLoaded = false

  /** 候选池懒加载：仅 ranked && ChampSelect 且敌方锁定 ≥1 时才首次拉取 */
  async function ensureChampionOptions(): Promise<void> {
    if (championOptionsLoaded) return
    try {
      const options = await invoke<championOption[]>('get_champion_options')
      allChampionIds.value = options.map(o => o.value)
      championOptionsLoaded = true
    } catch (e) {
      console.warn('[gaming] 候选池拉取失败:', e)
    }
  }

  /** 敌方已锁英雄 id（>0 即已锁定；敌方 intent 恒 0 无需区分 pickState） */
  const enemyLockedIds = computed(
    () =>
      orderedSubteams.value
        .filter(s => s.subteamId !== sessionData.mySubteamId)
        .flatMap(s => s.players.map(p => p.championId))
        .filter(id => id > 0) ?? []
  )

  /** 推荐隐藏规则：ranked 队列 && 选人阶段 && 候选池已就绪 */
  const showBestPicks = computed(
    () =>
      opggMode.value === 'ranked' &&
      sessionData.phase === 'ChampSelect' &&
      allChampionIds.value.length > 0
  )

  /**
   * 候选集：全量池排除 双方 ban / 我方已亮（含 intent、picking、locked）/
   * 敌方已锁——被占用或被禁的英雄不参与「最优应对」推荐。
   */
  const bestPickCandidates = computed(() => {
    if (allChampionIds.value.length === 0) return []
    const taken = new Set<number>([
      ...myBans.value,
      ...theirBans.value,
      ...myChampionIds.value,
      ...enemyLockedIds.value
    ])
    return allChampionIds.value.filter(id => !taken.has(id))
  })

  // 选人阶段敌方锁定后触发候选池懒加载（数据源就绪后 watch 重算推荐）
  watch(
    () => [sessionData.phase, enemyLockedIds.value.length] as const,
    ([phase, n]) => {
      if (phase === 'ChampSelect' && n > 0) void ensureChampionOptions()
    },
    { immediate: true }
  )

  /**
   * 推荐条落列规则：敌方已锁 ≥2 → 显示在敌方列（对位视角）；敌方未锁/不足但
   * 我方队友已亮 ≥1 → 显示在我方列（纯协同视角）。两态互斥，避免面板重复。
   */
  const panelForColumn = (st: Subteam): boolean => {
    if (st.subteamId === sessionData.mySubteamId) {
      return enemyLockedIds.value.length < 2 && teammatePickedIds.value.length >= 1
    }
    return enemyLockedIds.value.length >= 2
  }

  return {
    displayChampSelect,
    expectedSubteamSize,
    orderedSubteams,
    myPosition,
    myBans,
    theirBans,
    teammatePickedIds,
    teammatesMyPosition,
    myChampionIds,
    enemyLockedIds,
    showBestPicks,
    bestPickCandidates,
    panelForColumn
  }
}
