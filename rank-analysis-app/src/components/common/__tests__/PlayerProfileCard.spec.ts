import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PlayerProfileCard from '../PlayerProfileCard.vue'
import { fetchPlayerProfile } from '@renderer/services/ai/shared/recentProfile.batch'
import { queryMeetSummary } from '@renderer/features/settings/services/meet'
import type { RecentPlayerProfile } from '@renderer/services/ai/shared/types'
import type { MeetSummary } from '@renderer/types/domain/meet'

vi.mock('@renderer/services/ai/shared/recentProfile.batch', () => ({
  fetchPlayerProfile: vi.fn()
}))

vi.mock('@renderer/features/settings/services/meet', () => ({
  queryMeetSummary: vi.fn()
}))

const MEET: Awaited<ReturnType<typeof queryMeetSummary>> = {
  total: 7,
  myTeamMeets: 4,
  enemyMeets: 3,
  myTeamWins: 2,
  lastSeenAt: '2026-08-10',
  recent: []
}

const PROFILE: RecentPlayerProfile = {
  positionDistribution: [
    { pos: 'JUNGLE', ratio: 0.7, games: 14 },
    { pos: 'TOP', ratio: 0.3, games: 6 }
  ],
  mainPosition: 'JUNGLE',
  currentLanePlayedRatio: 0.7,
  championDistribution: [
    { championId: 64, name: '李青', games: 12, winRate: 0.66, avgKda: 3.1 },
    { championId: 86, name: '嘉文四世', games: 4, winRate: 0.5, avgKda: 2.2 }
  ],
  currentChampionMastery: {
    gamesInRecent: 12,
    winRate: 0.66,
    avgKda: 3.1,
    isOnetrick: true,
    isFirstTimeInRecent: false
  },
  recentWinRate: 0.6,
  recentKda: 3.2,
  streak: { kind: 'win', count: 3 },
  isOffRole: false,
  offRoleSeverity: 'none',
  positionChampionDistribution: [
    { championId: 64, name: '李青', games: 12, winRate: 0.66, avgKda: 3.1 },
    { championId: 86, name: '嘉文四世', games: 4, winRate: 0.5, avgKda: 2.2 }
  ]
}

describe('PlayerProfileCard', () => {
  beforeEach(() => {
    vi.mocked(fetchPlayerProfile).mockReset()
    vi.mocked(fetchPlayerProfile).mockResolvedValue(PROFILE)
    vi.mocked(queryMeetSummary).mockReset()
    vi.mocked(queryMeetSummary).mockResolvedValue(null)
  })

  it('渲染近期胜率 / KDA / 连胜', async () => {
    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'p1', name: '测试玩家' } })
    await flushPromises()
    expect(wrapper.text()).toContain('测试玩家')
    expect(wrapper.text()).toContain('60%')
    expect(wrapper.text()).toContain('3.20')
    expect(wrapper.text()).toContain('连胜3')
    expect(wrapper.text()).toContain('李青')
    expect(wrapper.text()).toContain('12场 66%')
  })

  it('主玩位置高亮 chip', async () => {
    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'p1' } })
    await flushPromises()
    const main = wrapper.find('.chip-main')
    expect(main.exists()).toBe(true)
    expect(main.text()).toContain('打野')
  })

  it('传 championId 时显示本局英雄熟练度', async () => {
    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'p1', championId: 64 } })
    await flushPromises()
    expect(wrapper.text()).toContain('绝活')
    expect(wrapper.text()).toContain('12 场')
  })

  it('不传 championId 时不渲染本局英雄小节', async () => {
    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'p1' } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('本局英雄')
    expect(wrapper.find('.profile-mastery').exists()).toBe(false)
  })

  it('数据为空时显示空态', async () => {
    vi.mocked(fetchPlayerProfile).mockResolvedValue(null)
    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'p1' } })
    await flushPromises()
    expect(wrapper.text()).toContain('暂无近期战绩数据')
  })

  it('拉取失败时显示空态而非崩溃', async () => {
    vi.mocked(fetchPlayerProfile).mockRejectedValue(new Error('boom'))
    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'p1' } })
    await flushPromises()
    expect(wrapper.text()).toContain('暂无近期战绩数据')
  })

  it('竞态：慢的旧请求不得覆盖新玩家画像（快速滑过两个玩家名）', async () => {
    let resolveA!: (v: RecentPlayerProfile | null) => void
    vi.mocked(fetchPlayerProfile)
      .mockImplementationOnce(() => new Promise<RecentPlayerProfile | null>(r => (resolveA = r)))
      .mockResolvedValueOnce({ ...PROFILE, recentWinRate: 0.4 })

    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'pA' } })
    // 立刻滑到下一个玩家：触发第二次请求
    await wrapper.setProps({ puuid: 'pB' })
    await flushPromises()
    // B 的快请求先返回（胜率 40%）
    expect(wrapper.text()).toContain('40%')

    // A 的慢请求迟到
    resolveA(PROFILE)
    await flushPromises()
    // 仍显示 B 的胜率，A 的过期结果被丢弃
    expect(wrapper.text()).toContain('40%')
    expect(wrapper.text()).not.toContain('60%')
    expect(vi.mocked(fetchPlayerProfile)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fetchPlayerProfile).mock.calls[1][0]).toMatchObject({ puuid: 'pB' })
  })

  it('竞态：puuid 清空后迟到的旧请求不得写入空卡', async () => {
    let resolveA!: (v: RecentPlayerProfile | null) => void
    vi.mocked(fetchPlayerProfile).mockImplementationOnce(
      () => new Promise<RecentPlayerProfile | null>(r => (resolveA = r))
    )

    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'pA' } })
    // 目标清空（组件被 v-for 复用移除玩家）：在途请求必须一并失效
    await wrapper.setProps({ puuid: '' })
    await flushPromises()
    expect(wrapper.text()).toContain('暂无近期战绩数据')

    // 旧请求迟到成功：不得把上一名玩家的数据写进空卡
    resolveA(PROFILE)
    await flushPromises()
    expect(wrapper.text()).toContain('暂无近期战绩数据')
    expect(wrapper.text()).not.toContain('李青')
    expect(wrapper.text()).not.toContain('60%')
  })

  it('竞态：同玩家重拉失败时保留上次成功画像不闪空态', async () => {
    vi.mocked(fetchPlayerProfile)
      .mockResolvedValueOnce(PROFILE)
      .mockRejectedValueOnce(new Error('boom'))

    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'p1' } })
    await flushPromises()
    expect(wrapper.text()).toContain('60%')

    // 同一玩家 championId 变化触发的重拉失败：保留上次画像
    await wrapper.setProps({ championId: 64 })
    await flushPromises()
    expect(wrapper.text()).toContain('60%')
    expect(wrapper.text()).not.toContain('暂无近期战绩数据')
  })

  it('竞态：换人后请求失败展示空态（不串玩家）', async () => {
    vi.mocked(fetchPlayerProfile)
      .mockResolvedValueOnce(PROFILE)
      .mockRejectedValueOnce(new Error('boom'))

    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'pA' } })
    await flushPromises()
    expect(wrapper.text()).toContain('60%')

    // 换人后新玩家失败：展示空态，不得残留上一玩家画像
    await wrapper.setProps({ puuid: 'pB' })
    await flushPromises()
    expect(wrapper.text()).toContain('暂无近期战绩数据')
    expect(wrapper.text()).not.toContain('60%')
  })

  it('竞态：慢的旧 meet 查询不得覆盖新玩家 meet', async () => {
    let resolveMeetA!: (v: MeetSummary | null) => void
    vi.mocked(queryMeetSummary)
      .mockImplementationOnce(() => new Promise<MeetSummary | null>(r => (resolveMeetA = r)))
      .mockResolvedValueOnce({ ...MEET, lastSeenAt: '2026-08-20' })

    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'pA' } })
    // 等 A 画像落定、meet 查询挂起（capture resolveMeetA）
    await flushPromises()
    expect(queryMeetSummary).toHaveBeenCalledWith('pA')

    await wrapper.setProps({ puuid: 'pB' })
    await flushPromises()
    // B 的 meet 先返回（最近 8-20）
    expect(wrapper.text().replace(/\s+/g, ' ')).toContain('2026-08-20')

    // A 的慢 meet 迟到：不得覆盖 B 的
    resolveMeetA({ ...MEET, lastSeenAt: '2026-08-01' })
    await flushPromises()
    expect(wrapper.text().replace(/\s+/g, ' ')).toContain('2026-08-20')
    expect(wrapper.text().replace(/\s+/g, ' ')).not.toContain('2026-08-01')
  })

  it('debug6：匿名（无puuid）但有name+region时走SGP回退（不再直接清空）', async () => {
    const wrapper = mount(PlayerProfileCard, {
      props: { puuid: '', name: 'Faker#KR1', region: 'KR' }
    })
    await flushPromises()
    expect(vi.mocked(fetchPlayerProfile)).toHaveBeenCalledWith(
      expect.objectContaining({ puuid: '', name: 'Faker#KR1', region: 'KR' })
    )
    expect(wrapper.text()).toContain('60%')
    // 匿名无 puuid：meet 查询跳过
    expect(vi.mocked(queryMeetSummary)).not.toHaveBeenCalled()
  })

  it('debug6：匿名缺name/region时仍清空（无解）', async () => {
    const wrapper = mount(PlayerProfileCard, { props: { puuid: '', name: '', region: '' } })
    await flushPromises()
    expect(vi.mocked(fetchPlayerProfile)).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('暂无近期战绩数据')
  })

  it('region + name 透传给 fetchPlayerProfile（SGP 兜底）', async () => {
    mount(PlayerProfileCard, {
      props: { puuid: 'p1', name: '跨区玩家#123', championId: 64, region: 'HN10' }
    })
    await flushPromises()
    expect(vi.mocked(fetchPlayerProfile).mock.calls[0][0]).toMatchObject({
      puuid: 'p1',
      name: '跨区玩家#123',
      championId: 64,
      region: 'HN10'
    })
  })

  it('遇见过：渲染累计相遇摘要', async () => {
    vi.mocked(queryMeetSummary).mockResolvedValue(MEET)
    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'p1' } })
    await flushPromises()
    // 模板编译会折叠插值边界的空白（「遇见过7 次」），断言用分段子串
    const text = wrapper.text().replace(/\s+/g, ' ')
    expect(text).toContain('遇见过')
    expect(text).toContain('7 次')
    expect(text).toContain('同队2/4胜')
    expect(text).toContain('2026-08-10')
    expect(vi.mocked(queryMeetSummary)).toHaveBeenCalledWith('p1')
  })

  it('遇见过：无记录（null）时不渲染该小节', async () => {
    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'p1' } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('遇见过')
  })

  it('遇见过：查询失败降级不阻塞画像卡', async () => {
    vi.mocked(queryMeetSummary).mockRejectedValue(new Error('meet.db down'))
    const wrapper = mount(PlayerProfileCard, { props: { puuid: 'p1', name: '测试玩家' } })
    await flushPromises()
    expect(wrapper.text()).toContain('测试玩家')
    expect(wrapper.text()).not.toContain('遇见过')
  })
})
