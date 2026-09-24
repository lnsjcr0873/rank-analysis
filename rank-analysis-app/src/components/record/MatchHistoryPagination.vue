<template>
  <div
    class="match-history-pagination"
    :class="{ 'match-history-pagination--floating': props.floating }"
  >
    <button
      class="btn gho sm mhp-btn"
      :disabled="recordPagination.page <= 1"
      :title="'上一页'"
      :aria-label="'上一页'"
      @click="recordPaginationPrev()"
    >
      <ArrowLeft class="btn-arrow-glyph" />
    </button>
    <span class="mhp-label num" role="status" aria-live="polite">
      {{ recordPagination.page }} / {{ recordPagination.pageCount }}
    </span>
    <button
      class="btn gho sm mhp-btn"
      :disabled="
        recordPagination.page >= recordPagination.pageCount && recordPagination.noMoreMatches
      "
      :title="'下一页'"
      :aria-label="'下一页'"
      @click="recordPaginationNext()"
    >
      <ArrowRight class="btn-arrow-glyph" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ArrowLeft, ArrowRight } from 'lucide-vue-next'
import { recordPagination, recordPaginationNext, recordPaginationPrev } from './recordPagination'

const props = withDefaults(defineProps<{ floating?: boolean }>(), { floating: false })
</script>

<style scoped>
.match-history-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-6);
}

.match-history-pagination--floating {
  justify-content: flex-end;
}

.mhp-btn {
  padding: var(--space-2) var(--space-6);
  color: var(--text-secondary);
  border-color: var(--border-strong);
}

.mhp-btn:hover:not(:disabled) {
  color: var(--brand);
  border-color: var(--brand-border);
}

.mhp-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mhp-label {
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}
</style>
