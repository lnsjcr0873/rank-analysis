import { ref, watch, onBeforeUnmount, type ComputedRef } from 'vue'
import { pushOverlayData, showOverlayWindow, hideOverlayWindow } from '@renderer/services/overlay'
import { getNextActions, type NextAction } from '@renderer/services/nextAction'
import type { SessionData, Subteam } from '@renderer/types/domain/gaming'

export function useGamingOverlay(
  sessionData: SessionData,
  orderedSubteams: ComputedRef<Subteam[]>,
  mySummonerPuuid: ComputedRef<string>
) {
  const nextActions = ref<NextAction[]>([])
  let nextActionTimer: ReturnType<typeof setInterval> | null = null

  async function updateNextActionsAndPushOverlay() {
    if (sessionData.phase !== 'InProgress') return
    const myPlayer = orderedSubteams.value
      .find(s => s.subteamId === sessionData.mySubteamId)
      ?.players.find(p => p.summoner.puuid === mySummonerPuuid.value)
    const myChampionId = myPlayer?.championId ?? 0
    const myGameName = myPlayer?.summoner?.gameName ?? ''
    const actions = await getNextActions(
      myChampionId,
      myGameName,
      mySummonerPuuid.value,
      sessionData.queueId
    )
    nextActions.value = actions
    if (actions && actions.length > 0) {
      await pushOverlayData(actions).catch(() => {})
    }
  }

  watch(
    () => sessionData.phase,
    async phase => {
      if (nextActionTimer) {
        clearInterval(nextActionTimer)
        nextActionTimer = null
      }

      if (phase === 'InProgress') {
        await showOverlayWindow().catch(() => {})
        await updateNextActionsAndPushOverlay()
        nextActionTimer = setInterval(updateNextActionsAndPushOverlay, 2000)
      } else {
        await hideOverlayWindow().catch(() => {})
        nextActions.value = []
      }
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    if (nextActionTimer) {
      clearInterval(nextActionTimer)
      nextActionTimer = null
    }
  })

  return {
    nextActions,
    updateNextActionsAndPushOverlay
  }
}
