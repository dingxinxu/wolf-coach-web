<script setup>
/**
 * 访问码 Banner：未解锁时顶部输入访问码；已解锁时显示状态 + 退出。
 *
 * 挂在 App.vue 顶部，所有页面可见。
 */
import { ref } from 'vue';
import { workerBase } from '../stores/settings.js';
import {
  isAuthorized,
  setAccessCode,
  clearAccess,
  verifyAccessCode,
} from '../stores/access.js';

const code = ref('');
const checking = ref(false);
const error = ref('');

async function submit() {
  const c = code.value.trim();
  if (!c) return;
  checking.value = true;
  error.value = '';
  const ok = await verifyAccessCode(c, workerBase());
  checking.value = false;
  if (ok) {
    setAccessCode(c);
    code.value = '';
  } else {
    error.value = '访问码无效或已撤销';
  }
}

function logout() {
  clearAccess();
}
</script>

<template>
  <!-- 未解锁：输码（血色条） -->
  <div
    v-if="!isAuthorized()"
    class="px-4 py-2 text-sm flex items-center gap-2"
    style="background: linear-gradient(90deg, rgba(74,2,2,0.5) 0%, rgba(5,8,17,0.9) 100%); border-bottom: 1px solid rgba(139,0,0,0.5);"
  >
    <span class="text-wolf-300 shrink-0">🔒 访问码</span>
    <input
      v-model="code"
      type="text"
      placeholder="输入访问码解锁共享池"
      class="flex-1 min-w-0 bg-night-900 border rounded px-2 py-1 text-xs text-parchment focus:outline-none placeholder:text-parchment-200/30"
      style="border-color: rgba(212,175,55,0.25);"
      :disabled="checking"
      @keyup.enter="submit"
    />
    <button
      class="btn-primary !text-xs !py-1 !px-3 shrink-0"
      :disabled="checking || !code.trim()"
      @click="submit"
    >
      {{ checking ? '...' : '解锁' }}
    </button>
    <span v-if="error" class="text-wolf-400 text-xs shrink-0">{{ error }}</span>
  </div>
  <!-- 已解锁：状态 + 退出（钢蓝条） -->
  <div
    v-else
    class="px-4 py-1.5 text-xs flex items-center justify-between"
    style="background: linear-gradient(90deg, rgba(74,111,165,0.18) 0%, rgba(5,8,17,0.9) 100%); border-bottom: 1px solid rgba(74,111,165,0.35);"
  >
    <span class="text-steel-500">✓ 已解锁共享池</span>
    <button class="text-parchment-200/50 hover:text-parchment" @click="logout">退出</button>
  </div>
</template>
