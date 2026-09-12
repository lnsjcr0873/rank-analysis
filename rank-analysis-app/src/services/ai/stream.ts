/**
 * 经 Rust 命令 stream_ai_analysis 直连 OpenAI 兼容端点的流式 AI 请求
 * 以及基于 sessionStorage 的结果缓存包装。
 *
 * D-P4 平台化：服务商（DashScope / OpenAI 兼容 / Ollama）由设置页配置，
 * 每次请求前经 {@link getAiProviderConfig} 读取并透传给 Rust 侧。
 */

import { invoke, Channel } from '@tauri-apps/api/core'
import { getConfigByIpc } from '../ipc'
import { CONFIG_KEYS } from '../configKeys'
import type { AIAnalysisResult, AiUsage, StreamCallbacks } from './types'

export const DEFAULT_SYSTEM_PROMPT =
  '你是一个LOL游戏分析师，擅长分析玩家战绩和给出游戏建议。请用简洁、专业、直接的中文回复。所有结论都必须绑定数据证据，避免空泛。若材料中出现【版本情报】/【本版本英雄改动】等版本数据块，一律以块内数据为准，禁止使用训练记忆里的版本认知。'

/**
 * 默认模型（DashScope 兼容 OpenAI 协议）。各 stage 调用方按 use case 覆盖。
 * qwen-flash：基准实测（tests/bench-ai-models.mjs）速度+有效率最优，故作兜底默认。
 */
export const DEFAULT_MODEL = 'qwen-flash'

/** 支持的服务商（与 Rust `command/ai.rs` 的 AiProviderKind 一一对应） */
export type AiProviderKind = 'dashscope' | 'openai' | 'ollama'

/**
 * 设置页配置的 AI 服务商参数（D-P4）。
 *
 * `provider` 非法值一律归一为 `dashscope`（与 Rust 侧解析规则一致）；
 * `apiKey` 按服务商取对应配置键：dashscope 用 `dashscopeApiKey`（历史键名），
 * openai 用 `aiApiKey`；ollama 本地免密钥恒为空串。
 */
export interface AiProviderConfig {
  provider: AiProviderKind
  /** 自定义端点：openai（如 https://api.deepseek.com/v1）/ ollama（如 http://127.0.0.1:11434） */
  baseUrl: string
  apiKey: string
  /** 模型名；空串表示用各调用方默认模型 */
  model: string
}

/**
 * 规范化用户填写的 AI 端点（R35-1：防误填导致请求失败）。
 *
 * 规则（幂等，可反复调用）：
 * - 空白输入 → 空串（= 用后端默认端点，不动）。
 * - 缺 scheme 时自动补：回环/局域网/单标签主机名补 `http://`（Ollama 本地场景），
 *   其余补 `https://`。
 * - scheme/host 小写化，path 保持原大小写；去掉多余尾斜杠（保留 `/v1` 这类路径）。
 * - 非 http(s) scheme（如误填 `ftp://`）原样透传，由后端 SSRF 端点策略拒绝，
 *   前端不越权拦截。
 * - 无 host（如只输了 `http://`）→ 空串，避免存垃圾。
 */
export function normalizeAiBaseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/\s/.test(trimmed)) return trimmed
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `${looksLocalHost(trimmed) ? 'http' : 'https'}://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return trimmed
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return trimmed
  if (!url.hostname) return ''
  const path = url.pathname.replace(/\/+$/, '')
  const normalized = `${url.protocol}//${url.host}${path}${url.search}${url.hash}`
  // URL 会把裸 host 补成 `https://host/`，尾斜杠已由 path 去掉；端口默认化
  //（如 :443）由 URL 自行处理，保持即可。
  return normalized
}

/** 粗判本地地址：回环 / RFC1918 / .local / 无点单标签主机名 → 默认 http。 */
function looksLocalHost(raw: string): boolean {
  const host = raw.split('/')[0].replace(/^\[/, '').split(']')[0].split(':')[0].toLowerCase()
  if (!host || host === 'localhost' || host === '::1') return true
  if (/^127\./.test(host)) return true
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true
  const m172 = /^172\.(\d+)\./.exec(host)
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true
  if (host.endsWith('.local')) return true
  if (!host.includes('.')) return true
  return false
}

/** 从持久化配置读取 AI 服务商参数（键缺失一律空值，不抛错）。 */
export async function getAiProviderConfig(): Promise<AiProviderConfig> {
  const [provider, baseUrl, model, aiKey, dashscopeKey] = await Promise.all([
    getConfigByIpc<string>(CONFIG_KEYS.aiProvider),
    getConfigByIpc<string>(CONFIG_KEYS.aiBaseUrl),
    getConfigByIpc<string>(CONFIG_KEYS.aiModel),
    getConfigByIpc<string>(CONFIG_KEYS.aiApiKey),
    getConfigByIpc<string>(CONFIG_KEYS.dashscopeApiKey)
  ])
  const kind: AiProviderKind =
    provider === 'openai' || provider === 'ollama' ? provider : 'dashscope'
  return {
    provider: kind,
    // 读侧也规范一次：兼容规范化上线前已落盘的脏值（写侧见 General.vue）。
    baseUrl: normalizeAiBaseUrl(baseUrl || ''),
    apiKey: kind === 'dashscope' ? dashscopeKey || '' : aiKey || '',
    model: model || ''
  }
}

/** Rust stream_ai_analysis 命令经 Channel 回传的事件 */
export interface AiStreamEvent {
  event: 'chunk' | 'done' | 'error' | 'usage'
  data?: string | null
}

/** 把 Channel 事件映射到 StreamCallbacks（纯函数，便于测试） */
export function mapStreamEvent(evt: AiStreamEvent, callbacks: StreamCallbacks): void {
  switch (evt.event) {
    case 'chunk':
      if (evt.data) callbacks.onChunk(evt.data)
      break
    case 'done':
      callbacks.onDone()
      break
    case 'usage':
      if (evt.data && callbacks.onUsage) {
        try {
          callbacks.onUsage(JSON.parse(evt.data) as AiUsage)
        } catch {
          // 非法 usage 载荷直接丢弃，不给用户看错账
        }
      }
      break
    case 'error':
      callbacks.onError(evt.data || 'AI 请求失败')
      break
  }
}

/** AI 请求可选项 */
export interface AiRequestOptions {
  /** true 时启用 DashScope JSON mode（response_format=json_object），强制模型输出合法 JSON */
  jsonMode?: boolean
  /** D-P1：流末 token 用量回调（非流式聚合场景也转发给调用方） */
  onUsage?: (usage: AiUsage) => void
  /**
   * 写缓存前的结构校验门：返回 false 则本次产物不持久化。
   *
   * 背景（debug3 带毒缓存）：流式结束即写缓存时尚未做结构验证；若模型输出
   * 残缺 JSON（Token 截断），坏产物被固化，重试命中同一缓存瞬间返回坏数据，
   * 重试链路被锁死。调用方（如 twoStage）把 stage parse 传进来，
   * 只有解析通过的产物才进缓存；失败的不写，下轮重试才是真网络请求。
   * 不传则保持原行为（成功即写）。
   */
  shouldCache?: (content: string) => boolean
}

export async function requestAIContentStream(
  prompt: string,
  callbacks: StreamCallbacks,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  model: string = DEFAULT_MODEL,
  opts: AiRequestOptions = {}
): Promise<void> {
  let settled = false
  const settle = (fn: () => void) => {
    if (settled) return
    settled = true
    fn()
  }
  try {
    // D-P4：服务商配置（provider/baseUrl/模型/密钥）来自设置页；键缺失时用后端默认
    const cfg = await getAiProviderConfig()
    // R07:设置页模型优先；调用方默认值 DEFAULT_MODEL 仅在 dashscope 下有意义——
    // openai/ollama 用户留空模型时透传 undefined,由后端按 provider 兜底
    // (deepseek-chat/llama3.1),避免把 qwen-flash 发往 DeepSeek/Ollama 报模型不存在。
    // 调用方显式传了非默认模型时仍优先使用。
    const callerModel = model === DEFAULT_MODEL ? undefined : model
    const finalModel = cfg.model || callerModel

    // 终态回调（onDone/onError）经 settle 包裹，保证恰好触发一次；分发统一走
    // mapStreamEvent，避免 done/error 逻辑与兜底文案在两处重复。
    const channel = new Channel<AiStreamEvent>()
    channel.onmessage = evt =>
      mapStreamEvent(evt, {
        onChunk: callbacks.onChunk,
        onDone: () => settle(callbacks.onDone),
        onError: e => settle(() => callbacks.onError(e)),
        onUsage: callbacks.onUsage
      })

    await invoke('stream_ai_analysis', {
      request: {
        prompt,
        systemPrompt,
        model: finalModel || undefined,
        // dashscope 无自定义端点概念，不发 baseUrl；密钥按服务商已归一到 cfg.apiKey
        provider: cfg.provider === 'dashscope' ? undefined : cfg.provider,
        baseUrl: cfg.baseUrl || undefined,
        apiKey: cfg.apiKey || undefined,
        responseFormat: opts.jsonMode ? 'json_object' : undefined
      },
      onEvent: channel
    })
  } catch (error) {
    settle(() =>
      callbacks.onError((error as { message?: string })?.message || String(error) || '流式请求失败')
    )
  }
}

/**
 * 带 sessionStorage 缓存的非流式请求（内部实际仍用流式 API 聚合）
 */
/**
 * 安全读缓存：存储不可用（隐私模式/禁用）按 miss 处理，不抛错。
 * R12：缓存可用性不能成为网络成功的前提。
 */
function readCacheSafe(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

/** Rust 磁盘缓存读（失败/未命中返回 null，调用方回退 session） */
async function readDiskCache(key: string): Promise<string | null> {
  try {
    // patch=None：通用文本缓存不做版本分片，仅 14 天 TTL（ai_cache.rs 语义）
    const value = await invoke<string | null>('ai_cache_get', { key, patch: null })
    return value ?? null
  } catch {
    return null
  }
}

/** 安全写缓存：QuotaExceeded 等写入失败不得阻断成功响应。 */
function writeCacheSafe(key: string, content: string): void {
  // debug6：磁盘优先（Rust ai_cache，14天TTL+400条上限），sessionStorage 只作
  // 同步兜底——大文本不再长期占用浏览器配额，playerNotes 等同域键不受冲垮。
  void invoke('ai_cache_put', { key, patch: 'generic', value: content }).catch(() => {})
  try {
    sessionStorage.setItem(key, content)
  } catch {
    // 配额满时清掉体积最大的几条缓存再试一次；仍失败则放弃（不阻断响应）。
    // debug5：此前无上限，单会话大量复盘可撑爆 sessionStorage 配额。
    try {
      evictLargestCacheEntries()
      sessionStorage.setItem(key, content)
    } catch {
      // 忽略：磁盘已有一份，无缓存只是下次重算，不能让本次成功变挂起
    }
  }
}

/** AI 缓存条数上限（sessionStorage 会话级，关窗口即清；防单会话撑爆配额）。 */
const AI_CACHE_MAX_ENTRIES = 50

/**
 * 配额满时的自救：删掉体积最大的几条 AI 缓存再试。
 * key 无统一前缀，按 value 长度降序删（AI 战报 3~10KB，天然排前面）；
 * 删一半仍写不下就放弃——不阻断本次成功响应。
 */
function evictLargestCacheEntries(): void {
  const entries: Array<{ k: string; len: number }> = []
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i)
    if (!k) continue
    try {
      entries.push({ k, len: (sessionStorage.getItem(k) ?? '').length })
    } catch {
      // 读失败跳过
    }
  }
  if (entries.length < AI_CACHE_MAX_ENTRIES) return
  entries.sort((a, b) => b.len - a.len)
  for (const e of entries.slice(0, Math.ceil(entries.length / 2))) {
    try {
      sessionStorage.removeItem(e.k)
    } catch {
      // 删失败继续删下一条
    }
  }
}

export async function requestAIContent(
  prompt: string,
  cacheKey: string,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  model: string = DEFAULT_MODEL,
  opts: AiRequestOptions = {}
): Promise<AIAnalysisResult> {
  // debug6：磁盘优先（跨会话、14天TTL），未命中回退 session（会话级）。
  const disk = await readDiskCache(cacheKey)
  if (disk) return { success: true, content: disk }
  const cached = readCacheSafe(cacheKey)
  if (cached) {
    return { success: true, content: cached }
  }

  return new Promise(resolve => {
    let fullContent = ''
    requestAIContentStream(
      prompt,
      {
        onChunk: chunk => {
          fullContent += chunk
        },
        onDone: () => {
          // 先验证再持久化：结构不过的残缺产物不进缓存，否则重试被同一份
          // 坏数据锁死（debug3）。校验抛错按不通过处理，绝不让坏产物固化。
          if (fullContent) {
            let cacheable = true
            if (opts.shouldCache) {
              try {
                cacheable = opts.shouldCache(fullContent)
              } catch {
                cacheable = false
              }
            }
            if (cacheable) {
              writeCacheSafe(cacheKey, fullContent)
            }
          }
          resolve({ success: true, content: fullContent })
        },
        onError: error => resolve({ success: false, error }),
        onUsage: opts.onUsage
      },
      systemPrompt,
      model,
      opts
    )
  })
}
