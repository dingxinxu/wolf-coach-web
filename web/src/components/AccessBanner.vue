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
  <!-- 未解锁：输码 -->
  <div
    v-if="!isAuthorized()"
    class="bg-wolf-900/50 border-b border-wolf-700/40 px-4 py-2 text-sm flex items-center gap-2"
  >
    <span class="text-wolf-300 shrink-0">🔒 访问码</span>
    <input
      v-model="code"
      type="text"
      placeholder="输入访问码解锁共享池"
      class="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-wolf-500"
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
    <span v-if="error" class="text-red-400 text-xs shrink-0">{{ error }}</span>
  </div>
  <!-- 已解锁：状态 + 退出 -->
  <div
    v-else
    class="bg-good-900/20 border-b border-good-700/30 px-4 py-1.5 text-xs flex items-center justify-between"
  >
    <span class="text-good-400">✓ 已解锁共享池</span>
    <button class="text-zinc-500 hover:text-zinc-300" @click="logout">退出</button>
  </div>
</template>
