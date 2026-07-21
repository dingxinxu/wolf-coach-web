<script setup>
/**
 * 设置页：配置 LLM Key 模式 + 4 个参数（baseUrl/model/reasoning/apiKey）
 *
 * Q12 决策：OpenAI 兼容接口，4 参数可改。
 * Q13/14：双模式 —— "用自己的 Key" 或 "用管理员共享池"。
 */
import { ref } from 'vue';
import { settings, isLLMReady, isSTTReady } from '../stores/settings.js';
import { worker } from '../stores/worker.js';
import { isAuthorized } from '../stores/access.js';
import { roster } from '../stores/players-roster.js';

function exportRoster() {
  const blob = new Blob([JSON.stringify(roster, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wolf-coach-roster-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

const rosterInput = ref(null);
function importRoster(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.players)) throw new Error('格式不对（缺 players 数组）');
      // P2-12：白名单字段过滤，防 __proto__ 等污染
      const safeFields = ['id', 'name', 'avatar', 'styleTags', 'note', 'createdAt', 'updatedAt'];
      // 合并：按 id 去重
      const existIds = new Set(roster.players.map((p) => p.id));
      let imported = 0;
      for (const raw of data.players) {
        if (!raw || typeof raw !== 'object' || !raw.id || existIds.has(raw.id)) continue;
        const safe = {};
        for (const k of safeFields) {
          if (k in raw) safe[k] = raw[k];
        }
        // styleTags 必须是数组
        if (!Array.isArray(safe.styleTags)) safe.styleTags = [];
        roster.players.push(safe);
        existIds.add(safe.id);
        imported++;
      }
      alert(`已导入 ${imported} 位玩家`);
    } catch (err) {
      alert('导入失败：' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function clearRoster() {
  if (!confirm(`确定清空 ${roster.players.length} 位玩家档案？此操作不可撤销。`)) return;
  roster.players.splice(0, roster.players.length);
}

const showKey = ref(false);
const showSttKey = ref(false);
const saved = ref(false);

const REASONING_OPTIONS = [
  { value: 'disabled', label: '关闭' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中（推荐）' },
  { value: 'high', label: '高' },
];

function save() {
  // settings 是 reactive + watch 自动持久化，这里只是给个反馈
  saved.value = true;
  setTimeout(() => (saved.value = false), 1500);
}

const PRESETS = [
  {
    name: 'DeepSeek（推荐·国内）',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    name: 'Anthropic Claude（需代理）',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-5-20250929',
  },
  {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
  },
];

function applyPreset(p) {
  settings.userLLM.baseUrl = p.baseUrl;
  settings.userLLM.model = p.model;
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="font-serif text-2xl font-bold text-parchment">设置</h1>

    <!-- Key 模式 -->
    <div class="card">
      <div class="font-serif font-semibold mb-3 text-parchment">API Key 来源</div>
      <div class="grid grid-cols-2 gap-2">
        <button
          :class="settings.keyMode === 'user' ? 'chip-on' : 'chip-off'"
          class="!rounded-lg !py-3 flex flex-col items-start"
          @click="settings.keyMode = 'user'"
        >
          <div class="font-bold">🔑 我自己的 Key</div>
          <div class="text-xs opacity-80 mt-1 text-left">
            自费、可控、隐私好
          </div>
        </button>
        <button
          :class="settings.keyMode === 'admin-pool' ? 'chip-on' : 'chip-off'"
          class="!rounded-lg !py-3 flex flex-col items-start"
          :disabled="!isAuthorized()"
          @click="isAuthorized() && (settings.keyMode = 'admin-pool')"
        >
          <div class="font-bold">🏛 管理员共享</div>
          <div class="text-xs opacity-80 mt-1 text-left">
            {{ isAuthorized() ? '无感使用、由部署者付费' : '需访问码（顶部输入）' }}
          </div>
        </button>
      </div>
      <div
        v-if="settings.keyMode === 'user'"
        class="mt-3 text-xs text-parchment-200/50 rounded p-2"
        style="background: rgba(5,8,17,0.6);"
      >
        💡 你的 Key 只存在本机 localStorage，每次请求透传到 Worker，Worker 不存储。
      </div>
      <div
        v-else
        class="mt-3 text-xs text-parchment-200/50 rounded p-2"
        style="background: rgba(5,8,17,0.6);"
      >
        💡 走管理员在 <code style="background: rgba(212,175,55,0.12); color:#e8c87a; padding:0.1em 0.35em; border-radius:4px;">/admin</code> 维护的共享池。
      </div>
    </div>

    <!-- 用户自带 Key 的详细配置 -->
    <div v-if="settings.keyMode === 'user'" class="space-y-3">
      <div class="card">
        <div class="font-serif font-semibold mb-3 text-parchment">LLM 配置（OpenAI 兼容格式）</div>

        <!-- 快速预设 -->
        <div class="mb-3">
          <div class="eyebrow text-gold-400/70 mb-2">快速预设</div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="p in PRESETS"
              :key="p.name"
              class="chip-off text-xs"
              @click="applyPreset(p)"
            >
              {{ p.name }}
            </button>
          </div>
        </div>

        <label class="block mt-3">
          <div class="eyebrow text-gold-400/80 mb-1">API Base URL</div>
          <input
            v-model="settings.userLLM.baseUrl"
            type="text"
            class="w-full rounded-lg p-2 text-sm text-parchment focus:outline-none placeholder:text-parchment-200/30"
            style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
            placeholder="https://api.deepseek.com/v1"
          />
        </label>

        <label class="block mt-3">
          <div class="eyebrow text-gold-400/80 mb-1">模型 ID</div>
          <input
            v-model="settings.userLLM.model"
            type="text"
            class="w-full rounded-lg p-2 text-sm text-parchment focus:outline-none placeholder:text-parchment-200/30"
            style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
            placeholder="deepseek-chat"
          />
        </label>

        <div class="mt-3">
          <div class="eyebrow text-gold-400/80 mb-1">思考强度</div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="opt in REASONING_OPTIONS"
              :key="opt.value"
              :class="settings.userLLM.reasoning === opt.value ? 'chip-on' : 'chip-off'"
              @click="settings.userLLM.reasoning = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
          <div class="text-xs text-parchment-200/40 mt-1">
            仅对支持 reasoning_effort 的模型生效（DeepSeek-R1 / OpenAI o 系列）
          </div>
        </div>

        <label class="block mt-3">
          <div class="eyebrow text-gold-400/80 mb-1">API Key</div>
          <div class="flex gap-2">
            <input
              v-model="settings.userLLM.apiKey"
              :type="showKey ? 'text' : 'password'"
              class="flex-1 rounded-lg p-2 text-sm text-parchment focus:outline-none placeholder:text-parchment-200/30"
              style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
              placeholder="sk-..."
              autocomplete="off"
            />
            <button class="btn-secondary text-xs" @click="showKey = !showKey">
              {{ showKey ? '🙈 隐藏' : '👁 显示' }}
            </button>
          </div>
        </label>
      </div>
    </div>

    <!-- STT 配置 -->
    <div class="card">
      <div class="font-serif font-semibold mb-1 text-parchment">🎙 语音转写（Groq Whisper）</div>
      <div class="text-xs text-parchment-200/50 mb-3">
        发言录音后自动转写到文本框。Key 与 LLM 独立（Groq 和 LLM 通常不同提供商）。
      </div>

      <div class="grid grid-cols-2 gap-2 mb-3">
        <button
          :class="settings.sttKeyMode === 'user' ? 'chip-on' : 'chip-off'"
          class="!rounded-lg !py-3 flex flex-col items-start"
          @click="settings.sttKeyMode = 'user'"
        >
          <div class="font-bold">🔑 我自己的 Key</div>
          <div class="text-xs opacity-80 mt-1 text-left">
            Groq 免费额度大
          </div>
        </button>
        <button
          :class="settings.sttKeyMode === 'admin-pool' ? 'chip-on' : 'chip-off'"
          class="!rounded-lg !py-3 flex flex-col items-start"
          :disabled="!isAuthorized()"
          @click="isAuthorized() && (settings.sttKeyMode = 'admin-pool')"
        >
          <div class="font-bold">🏛 管理员共享</div>
          <div class="text-xs opacity-80 mt-1 text-left">
            {{ isAuthorized() ? '无感使用' : '需访问码（顶部输入）' }}
          </div>
        </button>
      </div>

      <div v-if="settings.sttKeyMode === 'user'" class="space-y-3">
        <label class="block">
          <div class="eyebrow text-gold-400/80 mb-1">Base URL</div>
          <input
            v-model="settings.userSTT.baseUrl"
            type="text"
            class="w-full rounded-lg p-2 text-sm text-parchment focus:outline-none placeholder:text-parchment-200/30"
            style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
            placeholder="https://api.groq.com/openai/v1"
          />
        </label>
        <label class="block">
          <div class="eyebrow text-gold-400/80 mb-1">Model</div>
          <input
            v-model="settings.userSTT.model"
            type="text"
            class="w-full rounded-lg p-2 text-sm text-parchment focus:outline-none placeholder:text-parchment-200/30"
            style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
            placeholder="whisper-large-v3"
          />
        </label>
        <label class="block">
          <div class="eyebrow text-gold-400/80 mb-1">Groq API Key</div>
          <div class="flex gap-2">
            <input
              v-model="settings.userSTT.apiKey"
              :type="showSttKey ? 'text' : 'password'"
              class="flex-1 rounded-lg p-2 text-sm text-parchment focus:outline-none placeholder:text-parchment-200/30"
              style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
              placeholder="gsk_..."
              autocomplete="off"
            />
            <button class="btn-secondary text-xs" @click="showSttKey = !showSttKey">
              {{ showSttKey ? '🙈' : '👁' }}
            </button>
          </div>
          <div class="text-xs text-parchment-200/40 mt-1">
            申请：console.groq.com → API Keys（免费）
          </div>
        </label>
      </div>

      <div
        v-if="settings.sttKeyMode === 'admin-pool'"
        class="text-xs text-parchment-200/50 rounded p-2"
        style="background: rgba(5,8,17,0.6);"
      >
        💡 走管理员在 <code style="background: rgba(212,175,55,0.12); color:#e8c87a; padding:0.1em 0.35em; border-radius:4px;">/admin</code> 维护的 STT 共享池。
      </div>
    </div>

    <!-- Worker URL（保留旧块） -->
    <div class="card">
      <label class="block">
        <div class="eyebrow text-gold-400/80 mb-1">Worker URL（可选）</div>
          <input
            v-model="worker.workerUrl"
            type="text"
            class="w-full rounded-lg p-2 text-sm text-parchment focus:outline-none placeholder:text-parchment-200/30"
            style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
            placeholder="留空 = 同 origin（默认）；自部署可填 https://xxx.workers.dev"
          />
        <div class="text-xs text-parchment-200/40 mt-1">
          默认前端和 Worker 同 origin 部署，留空即可。
        </div>
      </label>
    </div>

    <button class="btn-primary w-full" @click="save">
      {{ saved ? '✓ 已保存' : '保存设置' }}
    </button>

    <div class="text-center text-xs space-y-1">
      <div :class="isLLMReady() ? 'text-good-500' : 'text-wolf-400'">
        {{ isLLMReady() ? '✓ LLM 已就绪' : '⚠ LLM 未就绪' }} ·
        {{ isSTTReady() ? '✓ 录音已就绪' : '○ 录音未配置（不影响教练分析）' }}
      </div>
    </div>

    <!-- 玩家档案库管理 -->
    <div class="card">
      <div class="flex items-center justify-between mb-2">
        <div class="font-serif font-semibold text-parchment">👥 玩家档案库</div>
        <div class="text-xs text-gold-400/60">共 {{ roster.players.length }} 位</div>
      </div>
      <div class="text-xs text-parchment-200/50 mb-3">
        跨局保留熟人玩家头像与风格标签。开新局时可在 SETUP 关联到座位。
      </div>
      <div class="flex gap-2 flex-wrap">
        <button class="btn-secondary text-xs" @click="exportRoster">📤 导出</button>
        <button class="btn-secondary text-xs" @click="rosterInput?.click()">📥 导入</button>
        <input
          ref="rosterInput"
          type="file"
          accept=".json"
          class="hidden"
          @change="importRoster"
        />
        <button class="btn-ghost text-xs text-wolf-400" @click="clearRoster">
          🗑 清空
        </button>
      </div>
    </div>
  </div>
</template>
