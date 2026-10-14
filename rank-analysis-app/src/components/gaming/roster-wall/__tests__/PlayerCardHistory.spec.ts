/**
 * PlayerCardHistory 对局详情弹窗测试（P6 收口）。
 *
 * 背景：名册墙展示的是**任意玩家**（我方 + 敌方）的对局，这些 gameId 大多不在
 * 自己的战绩列表里，因此不能走 record 页的就地展开（`openGameId` 只驱动
 * MatchHistory 自己那份列表）。最终选择是按 gameId 直接取详情弹窗，复用
 * `getGameById`（带 LRU）+ `MatchDetailInline`，不新增任何后端 command。
 *
 * 本文件锁三件事：
 * 1. 点击行确实按 gameId 取数并把游戏对象交给 MatchDetailInline；
 * 2. 取不到时**显式报错**，而不是静默无响应（这正是当初留空实现的病根）；
 * 3. 死掉的 `open-game` 事件链不再残留（避免后人以为还能从上层接管）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { NModal } from 'naive-ui'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const getGameByIdMock = vi.hoisted(() => vi.fn())
vi.mock('@renderer/features/record/services/gameById', () => ({
  getGameById: getGameByIdMock
}))

import PlayerCardHistory from '../PlayerCardHistory.vue'
import MatchDetailInline from '@renderer/components/record/MatchDetailInline.vue'
import type { PreparedGame } from '@renderer/features/gaming/analysis/types'

/**
 * 只造 PlayerCardHistory 真正读取的字段（其余用断言收口，不整份抄 PreparedGame）。
 * 该组件是纯展示层，不参与 `single`/`everyone` 的计算，故 cast 是安全的。
 */
function game(gameId: number, win = true): PreparedGame {
  return {
    gameId,
    basic: {
      gameId,
      gameCreation: 1_700_000_000_000,
      gameDuration: 1800,
      gameType: 'MATCHED_GAME',
      queueId: 420,
      queueName: '单双排',
      gameMode: 'CLASSIC',
      mapId: 11,
      isCherrySubteam: false
    },
    self: {
      puuid: 'p1',
      championId: 64,
      kills: 5,
      deaths: 2,
      assists: 9,
      win,
      teamId: 100,
      subteamPlacement: null
    }
  } as unknown as PreparedGame
}

function mountHistory(games: PreparedGame[]) {
  return mount(PlayerCardHistory, {
    props: { games, championName: (id: number) => `#${id}` },
    global: { stubs: { MatchDetailInline: true } }
  })
}

const RW = resolve(__dirname, '..')

describe('PlayerCardHistory · 对局详情弹窗', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('点击行：按 gameId 取详情并交给 MatchDetailInline 渲染', async () => {
    const fetched = { gameId: 1001, queueName: '单双排' }
    getGameByIdMock.mockResolvedValue(fetched)

    const w = mountHistory([game(1001), game(1002)])
    await w.findAll('.mh-row')[0].trigger('click')
    await flushPromises()

    expect(getGameByIdMock).toHaveBeenCalledWith(1001)
    expect(w.findComponent(NModal).props('show')).toBe(true)
    expect(w.findComponent(MatchDetailInline).props('game')).toEqual(fetched)
  })

  it('取不到详情：显示失败提示且不开弹窗（不静默无响应）', async () => {
    getGameByIdMock.mockResolvedValue(null)

    const w = mountHistory([game(1001)])
    await w.find('.mh-row').trigger('click')
    await flushPromises()

    expect(getGameByIdMock).toHaveBeenCalledWith(1001)
    expect(w.findComponent(NModal).props('show')).toBe(false)
    const err = w.find('.mh-load-error')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('加载失败')
  })

  it('关闭弹窗：清空已选对局', async () => {
    getGameByIdMock.mockResolvedValue({ gameId: 1001 })
    const w = mountHistory([game(1001)])
    await w.find('.mh-row').trigger('click')
    await flushPromises()
    expect(w.findComponent(MatchDetailInline).props('game')).not.toBeNull()

    await w.findComponent(NModal).vm.$emit('update:show', false)
    await flushPromises()

    expect(w.findComponent(MatchDetailInline).props('game')).toBeNull()
  })

  it('展开/收起仍走 toggle-expand，不再上抛 open-game', async () => {
    const games = Array.from({ length: 8 }, (_, i) => game(2000 + i))
    const w = mountHistory(games)
    expect(w.findAll('.mh-row').length).toBe(5)

    await w.find('.mh-more').trigger('click')
    expect(w.emitted('toggle-expand')).toHaveLength(1)
    expect(w.emitted('open-game')).toBeUndefined()
  })

  it('死事件链已摘除：roster-wall 组件里不再有 open-game 透传', () => {
    for (const f of [
      'PlayerCardHistory.vue',
      'PlayerCard.vue',
      'TeamBlock.vue',
      'RosterWall.vue'
    ]) {
      const src = readFileSync(resolve(RW, f), 'utf8')
      expect(src, `${f} 仍残留 open-game`).not.toContain('open-game')
    }
  })

  it('PlayerCardHistory 样式不含硬编码色（胜负色须走 --win-* / --loss-* token）', () => {
    const src = readFileSync(resolve(RW, 'PlayerCardHistory.vue'), 'utf8')
    const styleBlock = src.slice(src.indexOf('<style'))
    const hexes = styleBlock.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    const rgba = styleBlock.match(/rgba\(/g) ?? []
    expect(hexes, `含硬编码 hex：${hexes.join(', ')}`).toHaveLength(0)
    expect(rgba, `含硬编码 rgba：${rgba.join(', ')}`).toHaveLength(0)
    expect(styleBlock).toContain('--win-soft')
    expect(styleBlock).toContain('--loss-soft')
  })
})
