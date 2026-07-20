/**
 * 设置 store：管理 LLM 配置（用户自带 Key 模式）+ Worker URL。
 *
 * Key 模式（Q13/14 决策）：
 *   - 'user'      用户自带 Key（存 localStorage，每次请求透传给 Worker）
 *   - 'admin-pool' 用户没 Key，使用管理员维护的共享池（Worker KV）
 *
 * MVP 不暴露"Worker 兜底"模式给用户选——它是隐式兜底。
 */
import { reactive, watch } from 'vue';
import { isAuthorized } from './access.js';

const STORAGE_KEY = 'wolf-coach-settings-v1';

const DEFAULT = {
  // 用户自带 Key 模式的配置
  userLLM: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    reasoning: 'medium', // disabled / low / medium / high
  },
  // Key 模式：'user' | 'admin-pool'
  keyMode: 'admin-pool',
  // Worker 后端地址（默认同 origin；本地开发用 Vite proxy 走 /api）
  workerUrl: '',

  // === STT (Whisper) 配置 ===
  // 与 LLM Key 独立，因为 Groq 和 LLM 通常是不同提供商
  userSTT: {
    apiKey: '',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3',
  },
  // STT Key 模式：'user' | 'admin-pool'
  sttKeyMode: 'admin-pool',
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT };
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT };
  }
}

export const settings = reactive(load());

/** 持久化 */
watch(
  settings,
  (v) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  },
  { deep: true }
);

/**
 * 是否已经可以发请求。
 * - admin-pool 模式：需持有效访问码（isAuthorized）
 * - user 模式：必须有 apiKey
 */
export function isLLMReady() {
  if (settings.keyMode === 'admin-pool') return isAuthorized();
  return settings.keyMode === 'user' && settings.userLLM.apiKey.trim().length > 0;
}

/** STT 是否就绪（同 LLM 逻辑） */
export function isSTTReady() {
  if (settings.sttKeyMode === 'admin-pool') return isAuthorized();
  return settings.sttKeyMode === 'user' && settings.userSTT.apiKey.trim().length > 0;
}

/**
 * 构造请求时给 Worker 的 llm 字段。
 * - keyMode = 'user' → 把用户配置全传过去（Worker 透传到 LLM）
 * - keyMode = 'admin-pool' → 不传，让 Worker 走 KV/兜底
 */
export function buildLLMForRequest() {
  if (settings.keyMode === 'user') {
    return { ...settings.userLLM };
  }
  return null; // 让 Worker 走 admin-pool / fallback
}

/** 同上，构造 stt 字段 */
export function buildSTTForRequest() {
  if (settings.sttKeyMode === 'user') {
    return { ...settings.userSTT };
  }
  return null;
}

/** Worker 基础 URL 优先级：settings.workerUrl -> 构建时 VITE_WORKER_URL -> '' (同 origin) */
export function workerBase() {
  return settings.workerUrl?.trim() || import.meta.env.VITE_WORKER_URL || '';
}
