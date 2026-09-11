/**
 * 非受信用户文本 → prompt 安全视图。
 *
 * 玩家名 / 标签 / 备注等来自对局或用户输入，可能被恶意构造为 prompt 指令
 * （换行夹带「忽略以上指令」、fenced 代码块、结构定界符等）。拼进 AI prompt
 * 前统一净化：控制字符压平、围栏与结构定界符剥离、压缩空白、超长截断。
 *
 * 正常召唤师名（CJK + ASCII 字母数字 + `#` `-` `_` 空格）完全不受影响。
 */

/** ASCII 控制符：换行/回车/制表等——指令注入的第一载体 */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/g
/** markdown 围栏与反引号 */
const FENCE_RE = /`/g
/** 结构化定界符：用于夹带系统提示词/JSON 结构 */
// eslint-disable-next-line no-useless-escape
const STRUCTURE_RE = /[{}\[\]()<>;'"\\]/g
/** 连续空白 */
const SPACES_RE = /\s{2,}/g

export function sanitizeUserText(
  raw: string | null | undefined,
  maxLen = 48
): string {
  if (!raw) return ''
  const cleaned = raw
    .replace(CONTROL_RE, ' ')
    .replace(FENCE_RE, ' ')
    .replace(STRUCTURE_RE, ' ')
    .replace(SPACES_RE, ' ')
    .trim()
  if (cleaned.length <= maxLen) return cleaned
  return `${cleaned.slice(0, maxLen)}…`
}