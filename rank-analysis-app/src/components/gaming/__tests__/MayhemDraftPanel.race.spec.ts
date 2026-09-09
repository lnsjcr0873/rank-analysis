/**
 * MayhemDraftPanel 详情竞态回归（R11）
 *
 * 快速切换英雄时，较早响应的晚回调不得覆盖当前选中英雄的详情；
 * 任意时刻渲染的详情 ID 必须等于当前选择 ID。
 *
 * @module components/gaming/__tests__/MayhemDraftPanel.race
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import MayhemDraftPanel from '../MayhemDraftPanel.vue'
import type { ChampionDetailEntry, MayhemChampion } from '@renderer/features/mayhem/services/mayhemData'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('naive-ui', () => ({
  useMessage: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() })
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@renderer/composables/useRecordAssets', () => ({
  useRecordAssets: () => ({ detailOf: () => undefined, preload: vi.fn() })
}))
vi.mock('@renderer/composables/useAramBalance', () => ({
  buildBalanceTags: () => []
}))
vi.mock('@renderer/features/mayhem/services/mayhemData', () => ({
  extractMayhemChampions: vi.fn(),
  getMayhemChampions: vi.fn(),
  getMyChampionStats: vi.fn(),
  getMayhemChampionDetail: vi.fn()
}))

import { invoke } from '@tauri-apps/api/core'
import {
  getMayhemChampions,
  getMyChampionStats,
  getMayhemChampionDetail,
  extractMayhemChampions
} from '@renderer/features/mayhem/services/mayhemData'

function champ(id: number, title: string): MayhemChampion {
  return {
    id,
    alias: title,
    name: `称号${id}`,
    title,
    roles: ['mage'],
    iconUrl: '',
    stats: { tier: 1, games: 100, wins: 55, winRate: 0.55, pickRate: 0.1 } as MayhemChampion['stats']
  }
}

function detail(id: number, title: string): ChampionDetailEntry {
  return {
    champion: champ(id, title),
    augments: [],
    augmentTrios: [],
    builds: []
  } as unknown as ChampionDetailEntry
}

describe('MayhemDraftPanel loadDetail 竞态（R11）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'mayhem_draft_context') {
        return { queueId: 2400, localCellId: 0, myTeam: [], bench: [1, 2] }
      }
      return null
    })
    vi.mocked(getMayhemChampions).mockResolvedValue({ data: [champ(1, '安妮'), champ(2, '阿狸')] } as unknown as Awaited<ReturnType<typeof getMayhemChampions>>)
    vi.mocked(getMyChampionStats).mockResolvedValue([])
    vi.mocked(extractMayhemChampions).mockReturnValue([champ(1, '安妮'), champ(2, '阿狸')])
  })

  it('先选 1 再选 2、响应 2 先到 1 后到：最终详情仍是 2', async () => {
    let resolve1!: (d: ChampionDetailEntry) => void
    let resolve2!: (d: ChampionDetailEntry) => void
    vi.mocked(getMayhemChampionDetail).mockImplementation(async (id: number) => {
      if (id === 1) return new Promise<ChampionDetailEntry>(r => (resolve1 = r))
      return new Promise<ChampionDetailEntry>(r => (resolve2 = r))
    })

    const wrapper = mount(MayhemDraftPanel, { props: { queueId: 2400 } })
    await flushPromises()

    const cards = wrapper.findAll('.mdp-card--bench')
    expect(cards.length).toBeGreaterThanOrEqual(2)

    // 先选英雄 1，再选英雄 2
    await cards[0].trigger('click')
    await cards[1].trigger('click')

    // 响应 2 先完成，响应 1 后完成（乱序）
    resolve2(detail(2, '阿狸'))
    await flushPromises()
    resolve1(detail(1, '安妮'))
    await flushPromises()

    const section = wrapper.find('.mdp-detail-section')
    expect(section.exists()).toBe(true)
    // 当前选中是 2，详情必须是 2，不能被晚到的 1 覆盖
    expect(section.text()).toContain('阿狸')
    expect(section.text()).not.toContain('安妮')
    wrapper.unmount()
  })
})
