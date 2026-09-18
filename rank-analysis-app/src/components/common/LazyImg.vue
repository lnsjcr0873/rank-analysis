<template>
  <span
    ref="containerRef"
    class="lazy-img"
    :class="{
      'lazy-img-loading': state === 'loading',
      'lazy-img-error': state === 'error'
    }"
  >
    <img
      v-if="isVisible"
      :src="renderSrc"
      :alt="alt"
      loading="lazy"
      @load="onLoad"
      @error="onError"
    />
  </span>
</template>

<script setup lang="ts">
/**
 * 懒加载图片组件
 *
 * 结合 IntersectionObserver 严格实现前台视窗可见性校验：
 * 只有人眼真正看得见的 DOM 才发起请求，未进入视口的 DOM 绝对不发网络与 asset:// IPC 请求，
 * 杜绝批量渲染时的跨进程内存拷贝风暴与主事件循环阻塞。
 * 在图片加载完成前显示 shimmer 占位动画，加载失败时降低透明度作为错误回退。
 *
 * 失败重试：LCU 静态资源端点在客户端刚启动的 1~2s 内常返回一次 404/连接重置，
 * 若捕获一次错误即永久锁定 error 态，图会一直是半透明残图直到手动刷新。这里做
 * 有界延迟重试（换 `_r=` 查询串强制浏览器重取），用尽后仍失败才落 error。
 *
 * @example
 * ```vue
 * <LazyImg src="/champion/1.png" alt="champion" />
 * ```
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  /** 图片地址 */
  src: string
  /** 替代文本 */
  alt?: string
}>()

/** 最大重试次数（2 次重试 = 最多 3 次请求） */
const MAX_RETRY = 2
/** 重试延迟：给 LCU 资源端点恢复窗口 */
const RETRY_DELAY_MS = 1500

const state = ref<'loading' | 'loaded' | 'error'>('loading')
const nonce = ref(0)
let retryTimer: ReturnType<typeof setTimeout> | undefined

/** 带重试序号的 src：nonce 变化 → 查询串变化 → 浏览器重新请求（协议处理端忽略 query） */
const renderSrc = computed(() => {
  if (nonce.value === 0) return props.src
  const sep = props.src.includes('?') ? '&' : '?'
  return `${props.src}${sep}_r=${nonce.value}`
})

// src 变化时重置回 loading, 否则列表复用同一实例切图时新图片不显示 shimmer / 残留 error 态
watch(
  () => props.src,
  () => {
    nonce.value = 0
    state.value = 'loading'
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
  }
)

function onLoad() {
  state.value = 'loaded'
}

function onError() {
  if (nonce.value >= MAX_RETRY) {
    state.value = 'error'
    return
  }
  // 延迟重试：换 nonce 触发重新请求
  state.value = 'loading'
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    nonce.value += 1
  }, RETRY_DELAY_MS)
}

const containerRef = ref<HTMLElement | null>(null)
const isVisible = ref(typeof IntersectionObserver === 'undefined')
let observer: IntersectionObserver | null = null

onMounted(() => {
  if (typeof IntersectionObserver !== 'undefined' && containerRef.value) {
    observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            isVisible.value = true
            observer?.disconnect()
            observer = null
            break
          }
        }
      },
      { rootMargin: '60px' }
    )
    observer.observe(containerRef.value)
  } else {
    isVisible.value = true
  }
})

onUnmounted(() => {
  if (retryTimer) clearTimeout(retryTimer)
  observer?.disconnect()
  observer = null
})
</script>

<style scoped>
.lazy-img {
  display: inline-block;
  position: relative;
  line-height: 0;
}
.lazy-img img {
  display: block;
  width: 100%;
  height: 100%;
  /* contain: 保留图标的透明 halo / 留白，不裁切（适合图标类用例 — 项目里 LazyImg 全用在图标） */
  object-fit: contain;
  transition: opacity var(--dur-fast) var(--ease-expo);
}
.lazy-img-loading img {
  opacity: 0;
}
.lazy-img-loading::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    var(--bg-elevated) 0%,
    var(--glass-bg-mid) 50%,
    var(--bg-elevated) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s linear infinite;
  border-radius: inherit;
}
.lazy-img-error img {
  opacity: 0.3;
}
</style>
