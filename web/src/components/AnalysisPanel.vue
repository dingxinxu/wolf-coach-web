<script setup>
/**
 * 教练分析展示面板。
 * - 增量渲染流式 markdown
 * - 显示当前 Key 来源（user / admin-pool / fallback）
 * - "继续追问"按钮：把用户输入追加到对话历史，再次调用 Worker
 */
import { computed, ref, watch } from 'vue';
import { renderMarkdown } from '../lib/md.js';

const props = defineProps({
  /** 分析文本（流式累积） */
  content: { type: String, default: '' },
  /** 是否正在加载 */
  loading: { type: Boolean, default: false },
  /** Key 来源 */
  keySource: { type: String, default: '' },
  /** 错误信息 */
  error: { type: String, default: '' },
});

const html = computed(() => renderMarkdown(props.content));

const sourceLabel = computed(() => {
  switch (props.keySource) {
    case 'user':
      return { text: '🔑 你的 Key', cls: 'text-good-500' };
    case 'admin-pool':
      return { text: '🏛 共享池', cls: 'text-gold-400' };
    case 'fallback':
      return { text: '🛡 兜底', cls: 'text-zinc-400' };
    default:
      return null;
  }
});
</script>

<template>
  <div class="card min-h-[200px]">
    <div class="flex items-center justify-between mb-2">
      <div class="font-semibold">教练分析</div>
      <div v-if="sourceLabel" :class="['text-xs', sourceLabel.cls]">
        {{ sourceLabel.text }}
      </div>
    </div>

    <div v-if="error" class="text-wolf-400 text-sm bg-wolf-900/30 rounded p-3">
      ⚠️ {{ error }}
    </div>

    <div
      v-else-if="content"
      class="text-sm leading-relaxed prose-invert"
      v-html="html"
    />

    <div
      v-else-if="loading"
      class="text-zinc-500 text-sm flex items-center gap-2"
    >
      <span class="animate-pulse">思考中…</span>
    </div>

    <div v-else class="text-zinc-500 text-sm">
      填完上方信息后点击「让教练分析」。
    </div>
  </div>
</template>
