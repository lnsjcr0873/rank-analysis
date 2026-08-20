<template>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-[#0b0f19] text-white select-none">
    <!-- Startup Consent Dialog -->
    <ErrorReportingConsentDialog
      :show="active === 'errorReportingConsent'"
      @decide="onConsentDecide"
    />

    <!-- Top Window Header -->
    <Header />

    <!-- Main Workspace: Side Navigation + Center View Canvas -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Left Side Navigation -->
      <SideNavigation />

      <!-- Center Main Content -->
      <main class="relative flex-1 overflow-hidden bg-[#0e1422]/60">
        <router-view v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" :key="$route.fullPath" />
          </Transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMessage } from 'naive-ui'
import Header from './Header.vue'
import SideNavigation from './SideNavigation.vue'
import ErrorReportingConsentDialog from '@renderer/components/common/ErrorReportingConsentDialog.vue'
import { useGameState } from '@renderer/composables/useGameState'
import { useWindowShortcuts } from '@renderer/composables/useWindowShortcuts'
import { useZoom } from '@renderer/composables/useZoom'
import { useStartupDialogs } from '@renderer/composables/useStartupDialogs'

/** 初始化游戏状态监听 */
useGameState()

/** 浏览器式缩放 (Ctrl+滚轮 / Ctrl±0) */
useZoom()

/** 多窗口快捷键 (Ctrl+W 关子窗 / Ctrl+Tab 切窗) */
useWindowShortcuts()

const message = useMessage()

/** 启动弹窗队列 */
const { active, resolveErrorReportingConsent } = useStartupDialogs()

async function onConsentDecide(enabled: boolean): Promise<void> {
  try {
    await resolveErrorReportingConsent(enabled)
    if (enabled) message.success('已开启，重启后生效')
  } catch {
    message.error('保存失败')
  }
}
</script>

<style scoped>
.page-enter-active,
.page-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
