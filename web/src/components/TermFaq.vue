<script setup>
/**
 * 术语 / FAQ / 规则速查弹层。
 *
 * 直接 fetch /skill/*.md 展示，不经过 LLM，零 token 消耗。
 *
 * Tab：
 *   - 术语表  → glossary.md
 *   - FAQ    → rules.md §七（前端简单解析）
 *   - 规则速查 → rules.md
 *   - 策略    → strategy.md（大，只展示章节索引 + 展开）
 */
import { ref, onMounted, computed } from 'vue';
import { renderMarkdown } from '../lib/md.js';

const emit = defineEmits(['close']);

const tab = ref('glossary');
const loading = ref(false);
const error = ref('');
const cache = ref({});

const BASE = import.meta.env.BASE_URL;

async function loadMd(name) {
  if (cache.value[name]) return cache.value[name];
  loading.value = true;
  error.value = '';
  try {
    const resp = await fetch(`${BASE}skill/${name}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const txt = await resp.text();
    cache.value = { ...cache.value, [name]: txt };
    return txt;
  } catch (e) {
    error.value = '加载失败：' + e.message + '（请先运行 npm run sync-skill）';
    return '';
  } finally {
    loading.value = false;
  }
}

const currentContent = computed(() => {
  if (tab.value === 'glossary') return cache.value['references/glossary.md'] || '';
  if (tab.value === 'rules') return cache.value['references/rules.md'] || '';
  if (tab.value === 'faq') {
    // 提取 rules.md §七
    const rules = cache.value['references/rules.md'] || '';
    const m = rules.match(/(##\s*§?\s*七[\s\S]*)/);
    return m ? m[1] : '（未找到 §七 FAQ 段）';
  }
  if (tab.value === 'strategy') return cache.value['references/strategy.md'] || '';
  return '';
});

const currentHtml = computed(() => renderMarkdown(currentContent.value));

onMounted(async () => {
  await loadMd('references/glossary.md');
});

async function switchTab(t) {
  tab.value = t;
  if (t === 'faq' || t === 'rules') await loadMd('references/rules.md');
  else if (t === 'strategy') await loadMd('references/strategy.md');
  else await loadMd('references/glossary.md');
}

const tabs = [
  { key: 'glossary', label: '术语' },
  { key: 'faq', label: 'FAQ' },
  { key: 'rules', label: '规则' },
  { key: 'strategy', label: '策略' },
];
</script>

<template>
  <div
    class="fixed inset-0 backdrop-blur z-50 flex items-end sm:items-center justify-center"
    style="background: rgba(5,8,17,0.78);"
    @click.self="emit('close')"
  >
    <div
      class="rounded-t-2xl sm:rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col"
      style="background: linear-gradient(180deg, rgba(17,24,39,0.95) 0%, rgba(5,8,17,0.98) 100%); border: 1px solid rgba(212,175,55,0.3); box-shadow: 0 0 40px -8px rgba(139,0,0,0.4);"
    >
      <div class="flex items-center justify-between p-3" style="border-bottom: 1px solid rgba(212,175,55,0.2);">
        <div class="flex gap-1">
          <button
            v-for="t in tabs"
            :key="t.key"
            :class="tab === t.key ? 'chip-on' : 'chip-off'"
            @click="switchTab(t.key)"
          >
            {{ t.label }}
          </button>
        </div>
        <button class="btn-ghost" @click="emit('close')">✕</button>
      </div>

      <div class="flex-1 overflow-y-auto p-4 no-scrollbar">
        <div v-if="loading" class="text-parchment-200/50 text-sm">加载中…</div>
        <div v-else-if="error" class="text-wolf-400 text-sm">{{ error }}</div>
        <div
          v-else
          class="text-sm prose-invert"
          v-html="currentHtml"
        />
      </div>
    </div>
  </div>
</template>
