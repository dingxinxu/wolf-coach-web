<script setup>
/**
 * 管理员页面：维护共享 Key 池 + 访问码。
 *
 * 鉴权：X-Admin-Key 头比对 Worker secret ADMIN_PASSWORD。
 * 密码存 session（access.js 的 adminKey），不持久化，刷新需重新输入。
 *
 * 本页面：
 *   - LLM/STT 共享池配置（GET/PUT /admin/api/config, /admin/api/stt）
 *   - 访问码管理（POST/GET/DELETE /admin/api/codes）
 */
import { ref } from 'vue';
import { workerBase } from '../stores/settings.js';
import { access, setAdminKey, clearAdminKey } from '../stores/access.js';

const BASE = workerBase();
const adminKeyInput = ref('');
const loginError = ref('');
function isAdmin() {
  return !!access.adminKey;
}

function login() {
  setAdminKey(adminKeyInput.value.trim());
  adminKeyInput.value = '';
  loadCurrent();
}

function logout() {
  clearAdminKey();
  current.value = null;
  currentSTT.value = null;
  codes.value = [];
}

function adminHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', 'X-Admin-Key': access.adminKey, ...extra };
}

// ========== LLM / STT 配置 ==========

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

const current = ref(null);
const currentSTT = ref(null);

async function loadCurrent() {
  loading.value = true;
  error.value = '';
  try {
    const [llmResp, sttResp] = await Promise.all([
      fetch(`${BASE}/admin/api/config`, { headers: adminHeaders() }),
      fetch(`${BASE}/admin/api/stt`, { headers: adminHeaders() }),
    ]);
    if (llmResp.status === 401 || sttResp.status === 401) {
      loginError.value = '管理员密码错误';
      clearAdminKey();
      return;
    }
    loginError.value = '';
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
    await loadCodes();
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
      headers: adminHeaders(),
      body: JSON.stringify(form.value),
    });
    if (resp.status === 401) {
      loginError.value = '未授权';
      clearAdminKey();
      return;
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    saved.value = true;
    form.value.apiKey = '';
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
      headers: adminHeaders(),
      body: JSON.stringify(sttForm.value),
    });
    if (resp.status === 401) {
      loginError.value = '未授权';
      clearAdminKey();
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

// ========== 访问码管理 ==========

const codes = ref([]);
const newCodeCount = ref(5);
const newCodeNote = ref('');
const newCodeDailyLimit = ref(100); // 每访问码每日调用上限（防滥用）
const newCodeExpiresInDays = ref(30); // 有效期天数（0=永久）
const generatedCodes = ref([]); // 刚生成的码（原码只显示一次）

async function loadCodes() {
  try {
    const resp = await fetch(`${BASE}/admin/api/codes`, { headers: adminHeaders() });
    if (resp.ok) {
      const data = await resp.json();
      codes.value = data.codes || [];
    }
  } catch {}
}

async function generateCodes() {
  const resp = await fetch(`${BASE}/admin/api/codes`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      count: newCodeCount.value,
      note: newCodeNote.value,
      dailyLimit: Number(newCodeDailyLimit.value) || 100,
      expiresInDays: Number(newCodeExpiresInDays.value) ?? 30,
    }),
  });
  if (resp.ok) {
    const data = await resp.json();
    generatedCodes.value = data.codes || [];
    newCodeNote.value = '';
    await loadCodes();
  }
}

async function revokeCode(hash) {
  if (!confirm('确定撤销此访问码？撤销后持码用户将无法使用共享池。')) return;
  const resp = await fetch(`${BASE}/admin/api/codes/${hash}`, {
    method: 'DELETE',
    headers: adminHeaders(),
  });
  if (resp.ok) await loadCodes();
}

/** 用量占比，用于列表颜色提示（>=0.9 标红） */
function usageRatio(c) {
  const limit = c.dailyLimit || 100;
  const used = c.usage?.count ?? 0;
  return used / limit;
}

/** 访问码是否已过期 */
function isExpired(c) {
  return !!c.expiresAt && Date.now() > c.expiresAt;
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="font-serif text-2xl font-bold text-parchment">管理员</h1>

    <!-- 未登录：密码输入 -->
    <div v-if="!isAdmin()" class="card space-y-3">
      <div class="font-serif font-semibold text-parchment">管理员登录</div>
      <div class="text-xs text-parchment-200/50">输入管理员密码（Worker ADMIN_PASSWORD）</div>
      <input
        v-model="adminKeyInput"
        type="password"
        class="w-full rounded-lg p-2 text-sm text-parchment focus:outline-none placeholder:text-parchment-200/30"
        style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
        placeholder="管理员密码"
        @keyup.enter="login"
      />
      <button class="btn-primary w-full" @click="login">登录</button>
      <div
        v-if="loginError"
        class="text-wolf-400 text-xs rounded p-2"
        style="background: rgba(74,2,2,0.35);"
      >
        ⚠️ {{ loginError }}
      </div>
    </div>

    <!-- 已登录：配置管理 -->
    <div v-else>
      <div class="card flex items-center justify-between" style="background: rgba(17,24,39,0.5);">
        <div class="text-sm text-steel-500">✓ 已登录</div>
        <button class="text-xs text-wolf-400 hover:text-wolf-300" @click="logout">退出</button>
      </div>

      <div
        v-if="error"
        class="text-wolf-400 text-sm rounded p-3"
        style="background: rgba(74,2,2,0.3);"
      >
        ⚠️ {{ error }}
      </div>

      <!-- 当前激活 LLM -->
      <div v-if="current" class="card">
        <div class="text-sm font-serif font-semibold mb-2 text-parchment">当前 LLM 配置</div>
        <div class="text-xs text-parchment-200/60 space-y-1">
          <div>Base URL: <code style="background: rgba(212,175,55,0.12); color:#e8c87a; padding:0.1em 0.35em; border-radius:4px;">{{ current.baseUrl }}</code></div>
          <div>Model: <code style="background: rgba(212,175,55,0.12); color:#e8c87a; padding:0.1em 0.35em; border-radius:4px;">{{ current.model }}</code></div>
          <div>Reasoning: <code style="background: rgba(212,175,55,0.12); color:#e8c87a; padding:0.1em 0.35em; border-radius:4px;">{{ current.reasoning }}</code></div>
          <div>Key: <code style="background: rgba(212,175,55,0.12); color:#e8c87a; padding:0.1em 0.35em; border-radius:4px;">{{ current.apiKeyMasked || '(未配置)' }}</code></div>
          <div v-if="current.updatedAt">
            更新时间: {{ new Date(current.updatedAt).toLocaleString() }}
          </div>
        </div>
      </div>

      <!-- 更新 LLM 配置 -->
      <div class="card space-y-3">
        <div class="font-serif font-semibold text-parchment">更新 LLM 配置</div>
        <label class="block">
          <div class="eyebrow text-gold-400/80 mb-1">Base URL</div>
          <input
            v-model="form.baseUrl"
            type="text"
            class="w-full rounded-lg p-2 text-sm text-parchment focus:outline-none"
            style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
          />
        </label>
        <label class="block">
          <div class="eyebrow text-gold-400/80 mb-1">Model</div>
          <input
            v-model="form.model"
            type="text"
            class="w-full rounded-lg p-2 text-sm text-parchment focus:outline-none"
            style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
          />
        </label>
        <label class="block">
          <div class="eyebrow text-gold-400/80 mb-1">Reasoning</div>
          <select
            v-model="form.reasoning"
            class="w-full rounded-lg p-2 text-sm text-parchment focus:outline-none"
            style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
          >
            <option value="disabled">disabled</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <label class="block">
          <div class="eyebrow text-gold-400/80 mb-1">
            API Key <span class="text-parchment-200/30">（留空 = 保持不变）</span>
          </div>
          <input
            v-model="form.apiKey"
            type="password"
            class="w-full rounded-lg p-2 text-sm text-parchment focus:outline-none placeholder:text-parchment-200/30"
            style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
            placeholder="sk-..."
            autocomplete="off"
          />
        </label>
        <button class="btn-primary w-full" :disabled="loading" @click="save">
          {{ loading ? '保存中…' : saved ? '✓ 已保存' : '保存 LLM 配置' }}
        </button>
      </div>

      <!-- 当前 STT 配置 -->
      <div v-if="currentSTT" class="card">
        <div class="text-sm font-serif font-semibold mb-2 text-parchment">当前 STT 配置</div>
        <div class="text-xs text-parchment-200/60 space-y-1">
          <div>Base URL: <code style="background: rgba(212,175,55,0.12); color:#e8c87a; padding:0.1em 0.35em; border-radius:4px;">{{ currentSTT.baseUrl }}</code></div>
          <div>Model: <code style="background: rgba(212,175,55,0.12); color:#e8c87a; padding:0.1em 0.35em; border-radius:4px;">{{ currentSTT.model }}</code></div>
          <div>Key: <code style="background: rgba(212,175,55,0.12); color:#e8c87a; padding:0.1em 0.35em; border-radius:4px;">{{ currentSTT.apiKeyMasked || '(未配置)' }}</code></div>
        </div>
      </div>

      <!-- 更新 STT 配置 -->
      <div class="card space-y-3">
        <div class="font-serif font-semibold text-parchment">更新 STT 配置（Groq Whisper）</div>
        <label class="block">
          <div class="eyebrow text-gold-400/80 mb-1">Base URL</div>
          <input
            v-model="sttForm.baseUrl"
            type="text"
            class="w-full rounded-lg p-2 text-sm text-parchment focus:outline-none"
            style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
          />
        </label>
        <label class="block">
          <div class="eyebrow text-gold-400/80 mb-1">Model</div>
          <input
            v-model="sttForm.model"
            type="text"
            class="w-full rounded-lg p-2 text-sm text-parchment focus:outline-none"
            style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
          />
        </label>
        <label class="block">
          <div class="eyebrow text-gold-400/80 mb-1">
            Groq API Key <span class="text-parchment-200/30">（留空 = 保持不变）</span>
          </div>
          <input
            v-model="sttForm.apiKey"
            type="password"
            class="w-full rounded-lg p-2 text-sm text-parchment focus:outline-none placeholder:text-parchment-200/30"
            style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
            placeholder="gsk_..."
            autocomplete="off"
          />
        </label>
        <button class="btn-primary w-full" :disabled="loading" @click="saveSTT">
          {{ loading ? '保存中…' : saved ? '✓ 已保存' : '保存 STT 配置' }}
        </button>
      </div>

      <!-- 访问码管理 -->
      <div class="card space-y-3">
        <div class="font-serif font-semibold text-parchment">🎟 访问码管理</div>
        <div class="text-xs text-parchment-200/50">
          生成访问码分发给用户，持码用户可使用共享池。原码只显示一次，之后只存哈希。
        </div>

        <!-- 生成 -->
        <div class="flex gap-2 flex-wrap items-end">
          <label class="block">
            <div class="eyebrow text-gold-400/80 mb-1">数量</div>
            <input
              v-model.number="newCodeCount"
              type="number"
              min="1"
              max="50"
              class="w-20 rounded p-1 text-sm text-parchment focus:outline-none"
              style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
            />
          </label>
          <label class="block">
            <div class="eyebrow text-gold-400/80 mb-1">每日上限</div>
            <input
              v-model.number="newCodeDailyLimit"
              type="number"
              min="1"
              max="1000"
              class="w-20 rounded p-1 text-sm text-parchment focus:outline-none"
              style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
              title="每个访问码每日可调用 LLM/STT 的次数上限（防滥用）"
            />
          </label>
          <label class="block">
            <div class="eyebrow text-gold-400/80 mb-1">有效期(天)</div>
            <input
              v-model.number="newCodeExpiresInDays"
              type="number"
              min="0"
              max="365"
              class="w-20 rounded p-1 text-sm text-parchment focus:outline-none"
              style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
              title="0 = 永久有效；默认 30 天（防码长期泄漏）"
            />
          </label>
          <label class="block flex-1 min-w-[120px]">
            <div class="eyebrow text-gold-400/80 mb-1">备注</div>
            <input
              v-model="newCodeNote"
              type="text"
              class="w-full rounded p-1 text-sm text-parchment focus:outline-none placeholder:text-parchment-200/30"
              style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
              placeholder="如：老王"
            />
          </label>
          <button class="btn-primary text-xs" @click="generateCodes">生成</button>
        </div>

        <!-- 刚生成的码（原码只此一次） -->
        <div v-if="generatedCodes.length" class="rounded p-2 space-y-1" style="background: rgba(5,8,17,0.6);">
          <div class="text-xs text-good-400">✓ 新生成（请复制保存，关闭后不再显示）：</div>
          <div
            v-for="c in generatedCodes"
            :key="c.hash"
            class="text-sm font-mono text-good-300 break-all"
          >
            {{ c.code }}<span class="text-parchment-200/30" v-if="c.note"> ({{ c.note }})</span>
          </div>
        </div>

        <!-- 现有码列表 -->
        <div class="eyebrow text-gold-400/70 mt-2">现有访问码（{{ codes.length }}）</div>
        <div v-if="codes.length === 0" class="text-xs text-parchment-200/30">暂无</div>
        <div v-else class="space-y-1">
          <div
            v-for="c in codes"
            :key="c.hash"
            class="flex items-center justify-between rounded p-2 text-xs"
            style="background: rgba(5,8,17,0.6);"
          >
            <div class="min-w-0 flex-1">
              <span class="font-mono text-parchment-200/40">{{ c.hash.slice(0, 12) }}…</span>
              <span v-if="c.note" class="text-parchment-200/60 ml-2">{{ c.note }}</span>
              <span v-if="!c.enabled" class="text-red-400 ml-2">已撤销</span>
              <span
                class="ml-2"
                :class="usageRatio(c) >= 0.9 ? 'text-wolf-400' : 'text-gold-400/60'"
                :title="`每日上限 ${c.dailyLimit || 100}`"
              >
                {{ c.usage?.count ?? 0 }}/{{ c.dailyLimit || 100 }}
              </span>
              <span
                v-if="c.expiresAt"
                class="ml-2"
                :class="isExpired(c) ? 'text-wolf-400' : 'text-parchment-200/40'"
              >
                {{ isExpired(c) ? '已过期' : `至 ${new Date(c.expiresAt).toLocaleDateString()}` }}
              </span>
              <span v-else class="ml-2 text-parchment-200/30">永久</span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-parchment-200/30">{{
                new Date(c.createdAt).toLocaleDateString()
              }}</span>
              <button
                v-if="c.enabled"
                class="text-wolf-400 hover:text-wolf-300"
                @click="revokeCode(c.hash)"
              >
                撤销
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <RouterLink to="/" class="block text-center text-xs text-parchment-200/40">
      ← 返回对局
    </RouterLink>
  </div>
</template>
