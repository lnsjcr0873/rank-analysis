/**
 * 复制到剪贴板并提示
 *
 * Windows 剪贴板是独占互斥资源：其他程序（剪贴板历史、输入法、查词软件）
 * 占用时会抛 DOMException（Document is not focused / Clipboard locked）。
 * 这里做轻量重试（最多 3 次、指数微退避），避免用户快速连点时被一次瞬时
 * 锁竞争直接判失败——界面弹「复制失败」给用户软件不稳定的错觉。
 */

import { useMessage } from 'naive-ui'

/** 最大重试次数（首次尝试不计入） */
const MAX_RETRIES = 2
/** 基础退避（毫秒），每次翻倍：0 → 80 → 160 */
const BASE_RETRY_DELAY_MS = 80

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

async function writeWithRetry(text: string): Promise<void> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (err) {
      lastErr = err
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_RETRY_DELAY_MS * 2 ** attempt)
      }
    }
  }
  throw lastErr
}

export const useCopy = () => {
  const message = useMessage()

  const copy = async (nameId: string) => {
    try {
      await writeWithRetry(nameId)
      message.success('复制成功')
    } catch {
      message.error('复制失败')
    }
  }

  return { copy }
}
