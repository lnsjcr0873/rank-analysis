/**
 * 玩家备注合并(云同步 / 手动导入共用)
 *
 * 纯函数:同 puuid 按 `updatedAt` 新者赢,相等保留本地;非法条目跳过。
 *
 * @module utils/mergePlayerNotes
 */
import type { PlayerNote, PlayerNotesMap } from '@renderer/types/domain/playerNote'

/**
 * 墓碑保留时长：30 天。
 *
 * 墓碑（`deleted: true` 条目）的唯一使命是把"删除"随合并传播到云端与其他
 * 设备，之后就是死重——不清理的话 map 只增不减。30 天窗口的取值权衡：
 * 太短则长期离线的设备错过删除传播（回线后其旧活备注会复活该条目）；
 * 太长则墓碑堆积。30 天足以覆盖绝大多数设备的回线周期。
 *
 * 过期裁决放在 {@link mergeNotesMaps}（所有外部数据的必经信任边界）：
 * 若只在加载时过滤内存，云端行里的老墓碑每次 pull 都会被当"新增"并入、
 * 落盘再推回云端，GC 永远无法收敛。
 */
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 合并统计,供导入/同步完成后的 UI 反馈 */
export interface MergeStats {
  /** 本地原本没有、新增的条数 */
  added: number
  /** 传入更新、覆盖本地的条数 */
  replaced: number
  /** 本地更新(或同龄)、保持不变的条数 */
  kept: number
  /** 结构非法或键不安全、被跳过的条数 */
  invalid: number
  /** 过期墓碑(删除标记超过 {@link TOMBSTONE_TTL_MS})、被跳过的条数 */
  expired: number
}

/**
 * 云端行任何人可写(见 S1)：单条备注的字段上限，防毒行用超长字符串撑爆内存/注入 AI prompt。
 * 本地编辑框上限是 100 字，这里留 10 倍余量，只拦明显异常，不误伤老数据。
 */
export const MAX_NOTE_TEXT_LEN = 1000
/** gameName/tagLine 冗余展示字段上限(Riot 名最长 16 字，留余量) */
export const MAX_NAME_FIELD_LEN = 100
/** 备注 key(puuid)上限：UUID 36 字，留余量，防超长 key 撑内存 */
export const MAX_NOTE_KEY_LEN = 128
/** 单条备注最多携带的遇见记录数(与 playerNotes store 的 MAX_ENCOUNTERS 对齐) */
export const MAX_ENCOUNTERS_PER_NOTE = 20
/** 合并结果总条数上限：防毒行一次塞几十万条把内存打爆 */
export const MAX_MERGED_NOTES = 10_000
/**
 * updatedAt 允许的未来漂移：本地时钟 + 云端 LWW 都可能有小时级偏差，
 * 超过 24h 的未来时间戳视为投毒(一旦并入，任何正常写入都因"新者赢"再也覆盖不掉它)。
 */
export const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000

/** 合法的颜色档位白名单：未知档位说明 payload 被手改/污染，直接拒收 */
const VALID_LABELS: ReadonlySet<string> = new Set(['friendly', 'normal', 'careful', 'blacklist'])

/**
 * 最低限度的结构校验:对象 + 有限数值 updatedAt + 字符串 label(防导入损坏文件)。
 * 用 `Number.isFinite` 而非 `typeof === 'number'`:NaN 与任何数比较恒 false,
 * 一旦并入就永远无法被更新的时间戳替换。
 *
 * S1 加固(云端行不可信)：白名单 label、各字符串字段限长、遇见记录限条、
 * updatedAt 限在 [0, now + 24h] 内(防未来时间戳永久投毒)。
 */
function isValidNote(v: unknown, now: number): v is PlayerNote {
  if (!v || typeof v !== 'object') return false
  const n = v as Partial<PlayerNote>
  if (!Number.isFinite(n.updatedAt)) return false
  const ts = n.updatedAt as number
  if (ts < 0 || ts > now + MAX_FUTURE_SKEW_MS) return false
  if (typeof n.label !== 'string' || !VALID_LABELS.has(n.label)) return false
  if (typeof n.note !== 'string' || n.note.length > MAX_NOTE_TEXT_LEN) return false
  if (typeof n.gameName !== 'string' || n.gameName.length > MAX_NAME_FIELD_LEN) return false
  if (typeof n.tagLine !== 'string' || n.tagLine.length > MAX_NAME_FIELD_LEN) return false
  if (n.encounters !== undefined) {
    if (!Array.isArray(n.encounters) || n.encounters.length > MAX_ENCOUNTERS_PER_NOTE) return false
  }
  return true
}

/**
 * 解包 Rust `config::Value` 外部标签（旧备份兼容，debug3-C6）。
 *
 * 历史 bug：`config::Value` 曾未标记 `#[serde(untagged)]`，`build_backup_json`
 * 导出的备份里备注是 `{"Map": {…}}`、`{"String": "…"}` 形态，且标签是**嵌套**
 * 的（note 字段本身又是 `{"String": …}`，encounters 数组又是 `{"List": […]}`）。
 * 新备份已是扁平 JSON，此函数只为兼容用户手里的旧备份文件。
 *
 * 递归解包：单键且键名命中 7 种变体时解开继续；数组逐元素解；其他原样返回。
 * 误伤分析：合法 PlayerNote 顶层有 5+ 键，encounters 元素有多键，不会被当成
 * 标签；即便极端单键对象命中标签名，解包结果仍要过 `isValidNote` 全套校验。
 */
const TAGGED_VARIANTS: ReadonlySet<string> = new Set([
  'Null',
  'String',
  'Integer',
  'Float',
  'Boolean',
  'List',
  'Map'
])

export function unwrapTaggedValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(unwrapTaggedValue)
  if (!v || typeof v !== 'object') return v
  const entries = Object.entries(v as Record<string, unknown>)
  if (entries.length !== 1) {
    const out: Record<string, unknown> = {}
    for (const [k, inner] of entries) out[k] = unwrapTaggedValue(inner)
    return out
  }
  const [tag, inner] = entries[0]
  if (!TAGGED_VARIANTS.has(tag)) return { [tag]: unwrapTaggedValue(inner) }
  if (tag === 'Null') return null
  return unwrapTaggedValue(inner)
}

/**
 * 合并两张备注表,不修改入参。
 * @param base - 本地表(冲突时的"守方")
 * @param incoming - 传入表(导入文件 / 云端拉取)
 * @param now - 当前时刻(毫秒),墓碑过期判定用;默认 `Date.now()`,测试可注入
 * @returns 合并结果与统计
 */
export function mergeNotesMaps(
  base: PlayerNotesMap,
  incoming: PlayerNotesMap,
  now: number = Date.now()
): { merged: PlayerNotesMap; stats: MergeStats } {
  const merged: PlayerNotesMap = { ...base }
  const stats: MergeStats = { added: 0, replaced: 0, kept: 0, invalid: 0, expired: 0 }
  const expireBefore = now - TOMBSTONE_TTL_MS
  // S1 加固：合并上限熔断的计数器——不能在循环里调 Object.keys(merged).length
  // (每次 O(n)，毒行几十万条会退化成 O(n²))，这里维护 O(1) 计数。
  let mergedSize = Object.keys(merged).length
  for (const [puuid, note] of Object.entries(incoming)) {
    // `__proto__` 是保留键:普通对象字面量上 `merged['__proto__'] = note` 走原型
    // setter,不会成为自有属性,直接拒绝(不可信输入不该有这种 puuid)。
    // 放循环最前:无意义的 key 不值得再做字段校验。
    if (puuid === '__proto__') {
      stats.invalid++
      continue
    }
    // S1 加固：超长 key(非 puuid 的垃圾)直接拒收，防毒行用巨 key 撑内存。
    if (puuid.length > MAX_NOTE_KEY_LEN) {
      stats.invalid++
      continue
    }
    // 旧备份兼容：带 {"Map"/"String"/…} 外部标签的备注先解包再校验
    //（新备份已扁平，此分支对新数据是无操作旁路）。
    const rawNote = unwrapTaggedValue(note)
    if (!isValidNote(rawNote, now)) {
      stats.invalid++
      continue
    }
    const clean = rawNote
    // 过期墓碑不参与合并:它的"删除传播"使命早已完成,并入只会让加载时
    // 的 GC 白做(复活→落盘→推回云端的循环)。跳过即保持本地现状。
    if (clean.deleted && clean.updatedAt < expireBefore) {
      stats.expired++
      continue
    }
    // 用 hasOwnProperty 判断存在性:`toString` 等键会命中原型链继承属性,
    // 直接真值判断会把新条目误判为已存在而静默丢弃。
    // (不用 Object.hasOwn:那是 ES2022 API,项目 tsconfig target/lib 是 ES2020。)
    // S1 加固：合并上限熔断——毒行一次塞几十万条时，超限部分按 invalid 丢弃，
    // 保证内存有界（之前不截断会把整张毒表并入内存再落盘推回云端）。
    const existing = Object.prototype.hasOwnProperty.call(merged, puuid) ? merged[puuid] : undefined
    if (!existing) {
      if (mergedSize >= MAX_MERGED_NOTES) {
        stats.invalid++
        continue
      }
      merged[puuid] = clean
      mergedSize++
      stats.added++
    } else if (clean.updatedAt > existing.updatedAt) {
      merged[puuid] = clean
      stats.replaced++
    } else {
      stats.kept++
    }
  }
  return { merged, stats }
}
