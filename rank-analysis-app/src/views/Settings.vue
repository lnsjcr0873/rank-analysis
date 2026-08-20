<template>
  <div class="flex h-full w-full select-none overflow-hidden">
    <!-- Left Settings Menu Sider -->
    <aside
      class="flex flex-col border-r border-white/10 bg-[rgba(11,15,25,0.85)] backdrop-blur-xl transition-all duration-200"
      :class="collapsed ? 'w-16' : 'w-56'"
    >
      <div class="flex flex-col gap-1 p-2">
        <button
          v-for="item in menuItems"
          :key="item.key"
          type="button"
          class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all cursor-pointer"
          :class="[
            route.name === item.key
              ? 'bg-gradient-to-r from-[#c8aa6e]/20 to-[#c8aa6e]/5 text-[#f0e6d2] border border-[#c8aa6e]/35 shadow-[0_0_10px_rgba(200,170,110,0.15)] font-bold'
              : 'text-white/60 hover:bg-white/5 hover:text-white/90 border border-transparent'
          ]"
          :title="item.label"
          @click="handleMenuSelect(item.key)"
        >
          <component :is="item.icon" class="h-4 w-4 shrink-0" />
          <span class="truncate flex items-center gap-1.5 flex-1" :class="{ hidden: collapsed }">
            <span>{{ item.label }}</span>
          </span>
          <span
            v-if="item.key === 'DataSync' && cloudStore.pendingCloudConfig !== null"
            class="pending-badge-dot h-2 w-2 rounded-full bg-amber-400 animate-pulse ml-auto"
          />
        </button>
      </div>
    </aside>

    <!-- Right Settings Subview Content Canvas -->
    <main class="flex-1 overflow-y-auto p-6 bg-[#0e1422]/60">
      <router-view v-slot="{ Component }">
        <Transition name="settings-content" mode="out-in">
          <component :is="Component" :key="route.name" />
        </Transition>
      </router-view>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Sliders, Zap, Tag, BookmarkCheck, Cloud, Info } from 'lucide-vue-next'
import { useBreakpoint } from '@renderer/composables/useBreakpoint'
import { useCloudSyncStore } from '@renderer/features/settings/stores/cloudSync'

const collapsed = ref(false)
const router = useRouter()
const route = useRoute()
const cloudStore = useCloudSyncStore()

const { isCompact } = useBreakpoint()
watch(
  isCompact,
  compact => {
    if (compact) collapsed.value = true
  },
  { immediate: true }
)

const menuItems = [
  {
    label: '常规设置',
    key: 'General',
    icon: Sliders
  },
  {
    label: '自动化',
    key: 'Automation',
    icon: Zap
  },
  {
    label: '标签管理',
    key: 'Tags',
    icon: Tag
  },
  {
    label: '我标记过的人',
    key: 'PlayerNotes',
    icon: BookmarkCheck
  },
  {
    label: '数据与同步',
    key: 'DataSync',
    icon: Cloud
  },
  {
    label: '关于我们',
    key: 'About',
    icon: Info
  }
]

function handleMenuSelect(key: string) {
  router.push({ name: key })
}
</script>

<style scoped>
.settings-content-enter-active,
.settings-content-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

.settings-content-enter-from {
  opacity: 0;
  transform: translateX(6px);
}

.settings-content-leave-to {
  opacity: 0;
  transform: translateX(-4px);
}
</style>
