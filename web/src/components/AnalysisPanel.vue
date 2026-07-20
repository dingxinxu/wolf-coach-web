<script setup>
/**
 * 教练分析展示面板。
 * - 增量渲染流式 markdown（loading 时显示流式光标）
 * - 显示当前 Key 来源（user / admin-pool / fallback）
 * - 玩家情绪表的标签自动着色（紧张/说谎嫌疑/自信/冷静等）
 */
import { computed } from 'vue';
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

// 情绪标签 -> CSS class 映射（用于玩家情绪表着色）
const EMOTION_MAP = {
  '紧张': 'emo-tense',
  '回避': 'emo-tense',
  '说谎嫌疑': 'emo-suspect',
  '自信': 'emo-confident',
  '饱满': 'emo-confident',
  '焦虑': 'emo-anxious',
  '急躁': 'emo-anxious',
  '冷静': 'emo-calm',
  '深水': 'emo-calm',
  '愤怒': 'emo-angry',
  '对抗': 'emo-angry',
  '模糊': 'emo-vague',
  '观望': 'emo-vague',
};

/**
 * 后处理 markdown html：给玩家情绪表的"情绪"列加颜色 class
 * 表格行格式：<tr>...<td>3</td><td>紧张/回避</td><td>依据</td></tr>
 */
function postProcess(html) {
  // 匹配 <td>情绪标签</td>（包含 / 分隔符也染色第一个）
  return html.replace(/<td class="[^"]*">([^<]+)<\/td>/g, (match, text) => {
    // 提取第一个情绪词
    const firstWord = text.split(/[\/·]/)[0].trim();
    const cls = EMOTION_MAP[firstWord];
    if (cls) {
      return match.replace(text, `<span class="${cls}">${text}</span>`);
    }
    return match;
  });
}

const html = computed(() => postProcess(renderMarkdown(props.content)));

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
    <div class="flex items-center justify-between mb-3">
      <div class="font-semibold flex items-center gap-2">
        <span class="text-wolf-400">🐺</span>
        <span>教练分析</span>
      </div>
      <div v-if="sourceLabel" :class="['text-xs px-2 py-0.5 rounded-full bg-zinc-800/50', sourceLabel.cls]">
        {{ sourceLabel.text }}
      </div>
    </div>

    <div v-if="error" class="text-wolf-300 text-sm bg-wolf-900/40 border border-wolf-800/50 rounded-lg p-3">
      ⚠️ {{ error }}
    </div>

    <div
      v-else-if="content"
      class="text-sm leading-relaxed prose-invert"
      :class="{ 'stream-cursor': loading }"
      v-html="html"
    />

    <div
      v-else-if="loading"
      class="text-zinc-500 text-sm flex items-center gap-2 py-4 justify-center"
    >
      <span class="text-wolf-400 animate-pulse text-lg">🐺</span>
      <span class="animate-pulse">教练正在思考…</span>
    </div>

    <div v-else class="text-zinc-500 text-sm text-center py-4">
      填完上方信息后点击「让教练分析」
    </div>
  </div>
</template>
