/**
 * errorMessage 单测：unknown 错误值 → 单行文案的各路径 + 自定义兜底。
 */
import { describe, it, expect } from 'vitest'
import { errorMessage } from '../error'

describe('errorMessage', () => {
  it('Error 取 message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })
  it('Error 空 message → 兜底', () => {
    expect(errorMessage(new Error(''))).toBe('未知错误')
    expect(errorMessage(new Error(''), '网络请求失败')).toBe('网络请求失败')
  })
  it('字符串透传', () => {
    expect(errorMessage('模型超时')).toBe('模型超时')
  })
  it('字符串 + 自定义兜底（字符串非空时兜底不生效）', () => {
    expect(errorMessage('x', '网络请求失败')).toBe('x')
  })
  it('null/undefined/对象/空串 → 兜底', () => {
    expect(errorMessage(null)).toBe('未知错误')
    expect(errorMessage(undefined)).toBe('未知错误')
    expect(errorMessage(42)).toBe('未知错误')
    expect(errorMessage({ message: 'x' })).toBe('未知错误')
    expect(errorMessage('')).toBe('未知错误')
  })
})
