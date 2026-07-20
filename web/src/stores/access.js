/**
 * 访问码 + admin 密码 store。
 *
 * - accessCode: 用户访问码（持久化 localStorage），持码用户可用 admin-pool 共享池
 * - adminKey:   admin 密码（session 级，不持久化），用于 /admin 页面调 /admin/api/*
 *
 * 游客无 accessCode -> 只能用 user-key 模式（自带 Key）。
 * 持码用户有 accessCode -> 可用 admin-pool 模式（共享池）。
 *
 * 注：本文件不 import settings.js，避免循环依赖。verifyAccessCode 的 base 由调用方传入。
 */
import { reactive } from 'vue';

const ACCESS_KEY = 'wolf-coach-access-code';

const state = reactive({
  accessCode: localStorage.getItem(ACCESS_KEY) || '',
  adminKey: '', // 不持久化，每次会话重新输入
});

export const access = state;

/** 是否已解锁共享池（持有效访问码） */
export function isAuthorized() {
  return !!state.accessCode;
}

export function setAccessCode(code) {
  state.accessCode = code;
  if (code) localStorage.setItem(ACCESS_KEY, code);
  else localStorage.removeItem(ACCESS_KEY);
}

export function clearAccess() {
  state.accessCode = '';
  localStorage.removeItem(ACCESS_KEY);
}

/**
 * 验证访问码是否有效（调 Worker /api/verify-code）。
 * @param {string} code 访问码
 * @param {string} base Worker base URL（由调用方从 settings.workerBase() 传入，避免循环依赖）
 */
export async function verifyAccessCode(code, base) {
  try {
    const resp = await fetch(`${base}/api/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessCode: code }),
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return !!data.valid;
  } catch {
    return false;
  }
}

/** admin 密码（session 级） */
export function adminKey() {
  return state.adminKey;
}

export function setAdminKey(key) {
  state.adminKey = key;
}

export function clearAdminKey() {
  state.adminKey = '';
}
