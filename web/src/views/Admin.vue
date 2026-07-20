<script setup>
/**
 * 管理员页面：维护"共享 Key 池"配置。
 *
 * Q14 决策 A：CF Access 保护 /admin/* 路由，Worker 端校验 Cf-Access-Jwt-Assertion 头。
 *
 * 本页面：
 *   - 读取 GET /admin/api/config
 *   - 写入 PUT /admin/api/config
 *
 * 如果访问时未通过 CF Access，会被重定向到 CF 登录页（CF 边缘处理）。
 * 如果 Worker 不带 JWT 头请求，Worker 返回 401。
 */
import { onMounted, ref } from 'vue';
import { workerBase } from '../stores/settings.js';

const loading = ref(false);
const error = ref('');
const saved = ref(false);

const form = ref({
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  reasoning: 'medium',
  apiKey: '', // 留空 = 不修改
});

const sttForm = ref({
  baseUrl: 'https://api.groq.com/openai/v1',
  model: 'whisper-large-v3',
  apiKey: '',
});

const current = ref(null); // 当前激活 LLM 配置（脱敏）
const currentSTT = ref(null); // 当前激活 STT 配置（脱敏）

const BASE = workerBase();

async function loadCurrent() {
  loading.value = true;
  error.value = '';
  try {
    const [llmResp, sttResp] = await Promise.all([
      fetch(`${BASE}/admin/api/config`),
      fetch(`${BASE}/admin/api/stt`),
    ]);
    if (llmResp.status === 401 || sttResp.status === 401) {
      error.value = '需要通过 Cloudflare Access 登录。如果你是管理员，请配置 CF Access 应用保护 /admin/* 路由。';
      return;
    }
    if (llmResp.ok) {
      const data = await llmResp.json();
      current.value = data.active;
      if (data.active) {
        form.value.baseUrl = data.active.baseUrl;
        form.value.model = data.active.model;
        form.value.reasoning = data.active.reasoning;
      }
    }
    if (sttResp.ok) {
      const data = await sttResp.json();
      currentSTT.value = data.active;
      if (data.active) {
        sttForm.value.baseUrl = data.active.baseUrl;
        sttForm.value.model = data.active.model;
      }
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function save() {
  loading.value = true;
  error.value = '';
  saved.value = false;
  try {
    const resp = await fetch(`${BASE}/admin/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form.value),
    });
    if (resp.status === 401) {
      error.value = '未通过 CF Access 校验';
      return;
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    saved.value = true;
    form.value.apiKey = ''; // 清空表单中的 key，避免误改
    await loadCurrent();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function saveSTT() {
  loading.value = true;
  error.value = '';
  saved.value = false;
  try {
    const resp = await fetch(`${BASE}/admin/api/stt`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sttForm.value),
    });
    if (resp.status === 401) {
      error.value = '未通过 CF Access 校验';
      return;
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    saved.value = true;
    sttForm.value.apiKey = '';
    await loadCurrent();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(loadCurrent);
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-bold">管理员</h1>

    <div class="card bg-zinc-900/50">
      <div class="text-sm text-zinc-400">
        此页面用于维护"共享 Key 池"——用户选择【管理员共享】模式时使用这里的配置。
      </div>
      <div class="text-xs text-zinc-500 mt-2">
        访问控制由 Cloudflare Access 在边缘处理；Worker 二次校验 JWT。
      </div>
    </div>

    <!-- 当前激活 -->
    <div v-if="current" class="card">
      <div class="text-sm font-semibold mb-2">当前激活</div>
      <div class="text-xs text-zinc-400 space-y-1">
        <div>Base URL: <code>{{ current.baseUrl }}</code></div>
        <div>Model: <code>{{ current.model }}</code></div>
        <div>Reasoning: <code>{{ current.reasoning }}</code></div>
        <div>Key: <code>{{ current.apiKeyMasked || '(未配置)' }}</code></div>
        <div v-if="current.updatedAt">
          更新时间: {{ new Date(current.updatedAt).toLocaleString() }}
        </div>
      </div>
    </div>

    <div v-if="error" class="text-wolf-400 text-sm bg-wolf-900/30 rounded p-3">
      ⚠️ {{ error }}
    </div>

    <!-- 编辑表单 -->
    <div class="card space-y-3">
      <div class="font-semibold">更新共享配置</div>

      <label class="block">
        <div class="text-sm text-zinc-400 mb-1">Base URL</div>
        <input
          v-model="form.baseUrl"
          type="text"
          class="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-sm focus:outline-none focus:border-wolf-500"
        />
      </label>

      <label class="block">
        <div class="text-sm text-zinc-400 mb-1">Model</div>
        <input
          v-model="form.model"
          type="text"
          class="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-sm focus:outline-none focus:border-wolf-500"
        />
      </label>

      <label class="block">
        <div class="text-sm text-zinc-400 mb-1">Reasoning</div>
        <select
          v-model="form.reasoning"
          class="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-sm focus:outline-none focus:border-wolf-500"
        >
          <option value="disabled">disabled</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </label>

      <label class="block">
        <div class="text-sm text-zinc-400 mb-1">
          API Key <span class="text-zinc-600">（留空 = 保持不变）</span>
        </div>
        <input
          v-model="form.apiKey"
          type="password"
          class="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-sm focus:outline-none focus:border-wolf-500"
          placeholder="sk-..."
          autocomplete="off"
        />
      </label>

      <button
        class="btn-primary w-full"
        :disabled="loading"
        @click="save"
      >
        {{ loading ? '保存中…' : saved ? '✓ 已保存' : '保存 LLM 配置' }}
      </button>
    </div>

    <!-- STT 共享池 -->
    <div v-if="currentSTT" class="card">
      <div class="text-sm font-semibold mb-2">当前 STT 配置</div>
      <div class="text-xs text-zinc-400 space-y-1">
        <div>Base URL: <code>{{ currentSTT.baseUrl }}</code></div>
        <div>Model: <code>{{ currentSTT.model }}</code></div>
        <div>Key: <code>{{ currentSTT.apiKeyMasked || '(未配置)' }}</code></div>
      </div>
    </div>

    <div class="card space-y-3">
      <div class="font-semibold">更新 STT 配置（Groq Whisper）</div>

      <label class="block">
        <div class="text-sm text-zinc-400 mb-1">Base URL</div>
        <input
          v-model="sttForm.baseUrl"
          type="text"
          class="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-sm focus:outline-none focus:border-wolf-500"
        />
      </label>

      <label class="block">
        <div class="text-sm text-zinc-400 mb-1">Model</div>
        <input
          v-model="sttForm.model"
          type="text"
          class="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-sm focus:outline-none focus:border-wolf-500"
        />
      </label>

      <label class="block">
        <div class="text-sm text-zinc-400 mb-1">
          Groq API Key <span class="text-zinc-600">（留空 = 保持不变）</span>
        </div>
        <input
          v-model="sttForm.apiKey"
          type="password"
          class="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-sm focus:outline-none focus:border-wolf-500"
          placeholder="gsk_..."
          autocomplete="off"
        />
      </label>

      <button
        class="btn-primary w-full"
        :disabled="loading"
        @click="saveSTT"
      >
        {{ loading ? '保存中…' : saved ? '✓ 已保存' : '保存 STT 配置' }}
      </button>
    </div>

    <RouterLink to="/" class="block text-center text-xs text-zinc-500">
      ← 返回对局
    </RouterLink>
  </div>
</template>
