import { ref } from 'vue'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'

export function useAutomationSettings() {
  const autoAccept = ref(false)
  const autoPick = ref(false)
  const autoBan = ref(false)
  const autoStart = ref(false)
  const autoTradeConfirm = ref(false)
  const executeAtSecs = ref(5)
  const autoRune = ref(false)

  const myPickData = ref<number[]>([])
  const myBanData = ref<number[]>([])
  const configLoaded = ref(false)

  async function loadAutomationSettings() {
    autoAccept.value = (await getConfigByIpc<boolean>('settings.auto.acceptMatchSwitch')) ?? false
    autoPick.value = (await getConfigByIpc<boolean>('settings.auto.pickChampionSwitch')) ?? false
    autoBan.value = (await getConfigByIpc<boolean>('settings.auto.banChampionSwitch')) ?? false
    myPickData.value = (await getConfigByIpc<number[]>('settings.auto.pickChampionSlice')) ?? []
    myBanData.value = (await getConfigByIpc<number[]>('settings.auto.banChampionSlice')) ?? []
    autoStart.value = (await getConfigByIpc<boolean>('settings.auto.startMatchSwitch')) ?? false
    autoTradeConfirm.value =
      (await getConfigByIpc<boolean>('settings.auto.tradeConfirmSwitch')) ?? false
    executeAtSecs.value = (await getConfigByIpc<number>('settings.auto.executeAtSecs')) ?? 5
    autoRune.value = (await getConfigByIpc<boolean>('settings.auto.runeSwitch')) ?? false
  }

  const updateAcceptSwitch = async () => {
    await putConfigByIpc('settings.auto.acceptMatchSwitch', autoAccept.value)
  }

  const updateStartSwitch = async () => {
    await putConfigByIpc('settings.auto.startMatchSwitch', autoStart.value)
  }

  const updatePickSwitch = async () => {
    await putConfigByIpc('settings.auto.pickChampionSwitch', autoPick.value)
  }

  const updateBanSwitch = async () => {
    await putConfigByIpc('settings.auto.banChampionSwitch', autoBan.value)
  }

  const updateTradeConfirmSwitch = async () => {
    await putConfigByIpc('settings.auto.tradeConfirmSwitch', autoTradeConfirm.value)
  }

  const updateRuneSwitch = async () => {
    await putConfigByIpc('settings.auto.runeSwitch', autoRune.value)
  }

  const saveExecuteAtSecs = async () => {
    const v = executeAtSecs.value
    if (v == null) return
    await putConfigByIpc('settings.auto.executeAtSecs', Math.min(35, Math.max(3, v)))
  }

  const updatePickData = async () => {
    await putConfigByIpc('settings.auto.pickChampionSlice', myPickData.value)
  }

  const updateBanData = async () => {
    await putConfigByIpc('settings.auto.banChampionSlice', myBanData.value)
  }

  const addPickData = async (value: number) => {
    if (myPickData.value.includes(value) || value === 0) return
    myPickData.value.push(value)
    await updatePickData()
  }

  const deletePickData = async (value: number) => {
    myPickData.value = myPickData.value.filter(item => item !== value)
    await updatePickData()
  }

  const addBanData = async (value: number) => {
    if (value === 0 || myBanData.value.includes(value)) return
    myBanData.value.push(value)
    await updateBanData()
  }

  const deleteBanData = async (value: number) => {
    myBanData.value = myBanData.value.filter(item => item !== value)
    await updateBanData()
  }

  return {
    autoAccept,
    autoPick,
    autoBan,
    autoStart,
    autoTradeConfirm,
    executeAtSecs,
    autoRune,
    myPickData,
    myBanData,
    configLoaded,
    loadAutomationSettings,
    updateAcceptSwitch,
    updateStartSwitch,
    updatePickSwitch,
    updateBanSwitch,
    updateTradeConfirmSwitch,
    updateRuneSwitch,
    saveExecuteAtSecs,
    addPickData,
    deletePickData,
    addBanData,
    deleteBanData
  }
}
