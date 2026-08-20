import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import naive from 'naive-ui'
import { createPinia } from 'pinia'
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query'
import { useSettingsStore } from './features/settings/stores/setting'
import { usePlayerNotesStore } from './features/settings/stores/playerNotes'
import { useCloudSyncStore } from './features/settings/stores/cloudSync'
import { initAssetPrefix } from './services/http'
import { initPlatform } from './services/platform'
import './global.css'
import './styles/ai-report.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 1000 * 60 * 5
    }
  }
})

async function bootstrap() {
  // mount 前先拿到平台相关的两项：asset 协议前缀（决定图片 src 是否正确）与平台标识
  // （决定 Windows 专属入口是否渲染）。两者互不依赖，并发取，不叠加启动延迟。
  await Promise.all([initAssetPrefix(), initPlatform()])

  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  app.use(VueQueryPlugin, { queryClient })
  app.use(router)
  app.use(naive)

  // 显式初始化主题，避免 store 定义时的隐式副作用
  useSettingsStore().initTheme()
  // 载入本地玩家备注（issue #67）
  usePlayerNotesStore().init()
  // 云同步：开关已开启时后台自动同步一次（issue 云同步）
  useCloudSyncStore().init()

  app.mount('#app')
}

bootstrap()
