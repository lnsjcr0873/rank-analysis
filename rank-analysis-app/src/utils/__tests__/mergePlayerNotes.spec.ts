import { describe, it, expect } from 'vitest'
import {
  mergeNotesMaps,
  unwrapTaggedValue,
  TOMBSTONE_TTL_MS,
  MAX_ENCOUNTERS_PER_NOTE,
  MAX_MERGED_NOTES,
  MAX_NAME_FIELD_LEN,
  MAX_NOTE_KEY_LEN,
  MAX_NOTE_TEXT_LEN
} from '../mergePlayerNotes'
import type { PlayerNotesMap } from '@renderer/types/domain/playerNote'

function note(updatedAt: number, text = 'x'): PlayerNotesMap[string] {
  return { note: text, label: 'normal', gameName: 'A', tagLine: '1', updatedAt }
}

describe('mergeNotesMaps', () => {
  it('新 puuid 直接加入,计入 added', () => {
    const { merged, stats } = mergeNotesMaps({}, { p1: note(100) })
    expect(merged.p1.updatedAt).toBe(100)
    expect(stats).toEqual({ added: 1, replaced: 0, kept: 0, invalid: 0, expired: 0 })
  })

  it('同 puuid 时间戳新者赢', () => {
    const { merged, stats } = mergeNotesMaps({ p1: note(100, 'old') }, { p1: note(200, 'new') })
    expect(merged.p1.note).toBe('new')
    expect(stats.replaced).toBe(1)
  })

  it('同 puuid 传入更旧则保留本地,计入 kept', () => {
    const { merged, stats } = mergeNotesMaps({ p1: note(200, 'local') }, { p1: note(100, 'stale') })
    expect(merged.p1.note).toBe('local')
    expect(stats.kept).toBe(1)
  })

  it('时间戳相等保留本地(避免无谓覆盖)', () => {
    const { stats } = mergeNotesMaps({ p1: note(100, 'local') }, { p1: note(100, 'remote') })
    expect(stats.kept).toBe(1)
  })

  it('非法条目跳过并计入 invalid,不污染结果', () => {
    const bad = {
      p2: null,
      p3: 'str',
      p4: { note: 'no-ts', label: 'normal' }
    } as unknown as PlayerNotesMap
    const { merged, stats } = mergeNotesMaps({}, bad)
    expect(Object.keys(merged)).toHaveLength(0)
    expect(stats.invalid).toBe(3)
  })

  it('NaN updatedAt 计入 invalid(非有限时间戳一旦并入将永远无法被替换)', () => {
    const { merged, stats } = mergeNotesMaps({}, { p1: note(NaN) })
    expect(Object.keys(merged)).toHaveLength(0)
    expect(stats.invalid).toBe(1)
  })

  it('toString 等原型链键的合法 note 正常 added', () => {
    const { merged, stats } = mergeNotesMaps({}, { toString: note(100, 'proto-key') })
    expect(stats).toEqual({ added: 1, replaced: 0, kept: 0, invalid: 0, expired: 0 })
    expect(merged.toString).toEqual(note(100, 'proto-key'))
  })

  it('__proto__ 键计入 invalid 且不污染 Object.prototype', () => {
    const incoming = JSON.parse(`{"__proto__": ${JSON.stringify(note(100))}}`) as PlayerNotesMap
    const { merged, stats } = mergeNotesMaps({}, incoming)
    expect(stats.invalid).toBe(1)
    expect(Object.keys(merged)).toHaveLength(0)
    expect(({} as Record<string, unknown>).note).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('note')
  })

  it('混合合法+非法条目,invalid 不影响 added/replaced 计数', () => {
    const incoming = {
      p1: note(200, 'newer'),
      p2: note(100, 'fresh'),
      p3: null,
      p4: note(NaN)
    } as unknown as PlayerNotesMap
    const { merged, stats } = mergeNotesMaps({ p1: note(100, 'old') }, incoming)
    expect(stats).toEqual({ added: 1, replaced: 1, kept: 0, invalid: 2, expired: 0 })
    expect(merged.p1.note).toBe('newer')
    expect(merged.p2.note).toBe('fresh')
  })

  it('不修改入参(纯函数)', () => {
    const base = { p1: note(100) }
    mergeNotesMaps(base, { p2: note(50) })
    expect(Object.keys(base)).toEqual(['p1'])
  })

  describe('S1 毒行加固(云端行不可信)', () => {
    const NOW = 1_800_000_000_000

    it('未来时间戳投毒被拒(超 24h)，一旦并入将永远无法被"新者赢"覆盖', () => {
      const poison = note(NOW + 25 * 60 * 60 * 1000, 'poison')
      const { merged, stats } = mergeNotesMaps({}, { p1: poison }, NOW)
      expect(merged.p1).toBeUndefined()
      expect(stats.invalid).toBe(1)
    })

    it('24h 内时钟漂移放行(本地时钟小时级偏差不受影响)', () => {
      const drifted = note(NOW + 60 * 60 * 1000, 'drifted')
      const { merged, stats } = mergeNotesMaps({}, { p1: drifted }, NOW)
      expect(merged.p1.note).toBe('drifted')
      expect(stats.added).toBe(1)
    })

    it('非法 label 被拒(白名单外档位说明 payload 被手改)', () => {
      const bad = { ...note(100), label: 'admin' } as unknown as PlayerNotesMap[string]
      const { merged, stats } = mergeNotesMaps({}, { p1: bad }, NOW)
      expect(merged.p1).toBeUndefined()
      expect(stats.invalid).toBe(1)
    })

    it('缺 note/gameName/tagLine 字段被拒(云端脏行不再靠"类型断言"混入)', () => {
      const missing = { label: 'normal', updatedAt: 100 } as unknown as PlayerNotesMap[string]
      const { merged, stats } = mergeNotesMaps({}, { p1: missing }, NOW)
      expect(merged.p1).toBeUndefined()
      expect(stats.invalid).toBe(1)
    })

    it('超长 note 文本被拒(防毒行撑爆内存/注入 AI prompt)', () => {
      const fat = { ...note(100), note: 'x'.repeat(MAX_NOTE_TEXT_LEN + 1) }
      const { merged, stats } = mergeNotesMaps({}, { p1: fat }, NOW)
      expect(merged.p1).toBeUndefined()
      expect(stats.invalid).toBe(1)
    })

    it('超长 gameName/tagLine 被拒', () => {
      const fat = { ...note(100), gameName: 'x'.repeat(MAX_NAME_FIELD_LEN + 1) }
      const { merged, stats } = mergeNotesMaps({}, { p1: fat }, NOW)
      expect(merged.p1).toBeUndefined()
      expect(stats.invalid).toBe(1)
    })

    it('超长 key 被拒(防巨 key 撑内存)', () => {
      const fatKey = 'k'.repeat(MAX_NOTE_KEY_LEN + 1)
      const { merged, stats } = mergeNotesMaps({}, { [fatKey]: note(100) }, NOW)
      expect(Object.keys(merged)).toHaveLength(0)
      expect(stats.invalid).toBe(1)
    })

    it('超量 encounters 被拒(防单条备注塞巨数组)', () => {
      const fat = { ...note(100), encounters: new Array(MAX_ENCOUNTERS_PER_NOTE + 1).fill({}) }
      const { merged, stats } = mergeNotesMaps({}, { p1: fat } as unknown as PlayerNotesMap, NOW)
      expect(merged.p1).toBeUndefined()
      expect(stats.invalid).toBe(1)
    })

    it('合并上限熔断:超限部分按 invalid 丢弃，内存有界', () => {
      const base: PlayerNotesMap = {}
      for (let i = 0; i < MAX_MERGED_NOTES; i++) base[`base-${i}`] = note(100)
      const { merged, stats } = mergeNotesMaps(base, { fresh: note(200) }, NOW)
      expect(merged['fresh']).toBeUndefined()
      expect(stats.invalid).toBe(1)
      expect(Object.keys(merged)).toHaveLength(MAX_MERGED_NOTES)
    })
  })

  describe('墓碑 TTL(过期删除标记不随合并复活)', () => {
    const NOW = 1_800_000_000_000

    function tombstone(updatedAt: number): PlayerNotesMap[string] {
      return { note: '', label: 'normal', gameName: 'A', tagLine: '1', updatedAt, deleted: true }
    }

    it('过期墓碑(超过 TTL)被跳过,计入 expired,不并入结果', () => {
      const dead = tombstone(NOW - TOMBSTONE_TTL_MS - 1)
      const { merged, stats } = mergeNotesMaps({}, { p1: dead }, NOW)
      expect(merged.p1).toBeUndefined()
      expect(stats.expired).toBe(1)
      expect(stats.added).toBe(0)
    })

    it('未过期墓碑正常参与新者赢(删除传播不受影响)', () => {
      const fresh = tombstone(NOW - 1000)
      const { merged, stats } = mergeNotesMaps(
        { p1: note(NOW - 2000, 'alive') },
        { p1: fresh },
        NOW
      )
      expect(merged.p1.deleted).toBe(true)
      expect(stats.replaced).toBe(1)
      expect(stats.expired).toBe(0)
    })

    it('活备注不受 TTL 影响(再老也照常合并)', () => {
      const ancient = note(NOW - TOMBSTONE_TTL_MS * 10, 'old-but-alive')
      const { merged, stats } = mergeNotesMaps({}, { p1: ancient }, NOW)
      expect(merged.p1.note).toBe('old-but-alive')
      expect(stats.added).toBe(1)
      expect(stats.expired).toBe(0)
    })

    it('过期墓碑不能压过本地条目(跳过即保持本地)', () => {
      const dead = tombstone(NOW - TOMBSTONE_TTL_MS - 1)
      const { merged, stats } = mergeNotesMaps({ p1: note(1, 'local') }, { p1: dead }, NOW)
      expect(merged.p1.note).toBe('local')
      expect(merged.p1.deleted).toBeUndefined()
      expect(stats.expired).toBe(1)
    })
  })
})

describe('旧备份外部标签兼容（debug3-C6）', () => {
  it('unwrapTaggedValue 递归解包 7 种变体', () => {
    expect(unwrapTaggedValue({ String: '备注' })).toBe('备注')
    expect(unwrapTaggedValue({ Integer: 42 })).toBe(42)
    expect(unwrapTaggedValue({ Float: 1.5 })).toBe(1.5)
    expect(unwrapTaggedValue({ Boolean: true })).toBe(true)
    expect(unwrapTaggedValue({ List: [1, 2] })).toEqual([1, 2])
    expect(unwrapTaggedValue({ Map: { a: 1 } })).toEqual({ a: 1 })
    expect(unwrapTaggedValue({ Null: null })).toBeNull()
    // 嵌套标签递归解
    expect(unwrapTaggedValue({ Map: { note: { String: 'x' } } })).toEqual({ note: 'x' })
  })

  it('unwrapTaggedValue 非标签原样返回（键保留，值递归解）', () => {
    expect(unwrapTaggedValue('plain')).toBe('plain')
    expect(unwrapTaggedValue(42)).toBe(42)
    expect(unwrapTaggedValue(null)).toBeNull()
    expect(unwrapTaggedValue([1])).toEqual([1])
    expect(unwrapTaggedValue({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
    expect(unwrapTaggedValue({ Unknown: 1 })).toEqual({ Unknown: 1 })
    // 单键非标签：键保留、值递归解
    expect(unwrapTaggedValue({ note: { String: 'x' } })).toEqual({ note: 'x' })
  })

  it('旧备份整条备注解包后正常并入（不再全判损坏）', () => {
    const tagged = {
      Map: {
        note: { String: '老备注' },
        label: { String: 'normal' },
        gameName: { String: 'A' },
        tagLine: { String: '1' },
        updatedAt: { Integer: 100 }
      }
    }
    const { merged, stats } = mergeNotesMaps({}, { p1: tagged as never })
    expect(stats.invalid).toBe(0)
    expect(stats.added).toBe(1)
    expect(merged.p1.note).toBe('老备注')
  })

  it('解包后仍非法（缺字段）照样判 invalid，不降低门槛', () => {
    const tagged = { Map: { note: { String: 'x' } } }
    const { stats } = mergeNotesMaps({}, { p1: tagged as never })
    expect(stats.invalid).toBe(1)
  })
})
