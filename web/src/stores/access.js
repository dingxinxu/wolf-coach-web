/**
 * 访问码 + admin 密码 store。
 *
 * - accessCode: 用户访问码
 *   - sessionStorage 存当前会话副本（关浏览器即失效）
 *   - localStorage 存 7 天 TTL 的长期副本（跨 session 保持，到期自动清）
 *   - Worker 端另有 admin 设的 expiresAt（独立层，管理员可撤销/过期）
 * - adminKey:   admin 密码（session 级，不持久化），用于 /admin 页面调 /admin/api/*
 *
 * 游客无 accessCode -> 只能用 user-key 模式（自带 Key）。
 * 持码用户有 accessCode -> 可用 admin-pool 模式（共享池）。
 *
 * 注：依赖 ./worker.js 的 workerBase() 拿 Worker URL，无循环依赖。
 */
import { reactive } from 'vue';
import { workerBase } from './worker.js';

const SESSION_KEY = 'wolf-coach-access-code-session';
const LOCAL_KEY = 'wolf-coach-access-code-local';
const LEGACY_KEY = 'wolf-coach-access-code'; // 老版本明文永久存储，强制清掉
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

// 一次性清理：老版本明文永久 localStorage 存访问码，安全性差
// 新版本不读它，直接删（用户需重输一次访问码，换取 TTL + session 保护）
try {
  if (localStorage.getItem(LEGACY_KEY)) {
    localStorage.removeItem(LEGACY_KEY);
  }
} catch {}

function loadAccessCode() {
  // 优先读 sessionStorage（当前会话）
  try {
    const session = sessionStorage.getItem(SESSION_KEY);
    if (session) return session;
  } catch {}
  // 再读 localStorage（带 TTL）
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return '';
    const { code, verifiedAt } = JSON.parse(raw);
    if (!code || typeof verifiedAt !== 'number') return '';
    if (Date.now() - verifiedAt > TTL_MS) {
      localStorage.removeItem(LOCAL_KEY);
      return '';
    }
    return code;
  } catch {
    return '';
  }
}

function saveAccessCode(code) {
  if (!code) return;
  try {
    sessionStorage.setItem(SESSION_KEY, code);
  } catch {}
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ code, verifiedAt: Date.now() }));
}

function clearAccessCode() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
  localStorage.removeItem(LOCAL_KEY);
}

const state = reactive({
  accessCode: loadAccessCode(),
  adminKey: '', // 不持久化，每次会话重新输入
});

export const access = state;

/** 是否已解锁共享池（持有效访问码） */
export function isAuthorized() {
  return !!state.accessCode;
}

export function setAccessCode(code) {
  state.accessCode = code;
  if (code) saveAccessCode(code);
  else clearAccessCode();
}

export function clearAccess() {
  state.accessCode = '';
  clearAccessCode();
}

/**
 * 验证访问码是否有效（调 Worker /api/verify-code）。
 * @param {string} code 访问码
 */
export async function verifyAccessCode(code) {
  try {
    const resp = await fetch(`${workerBase()}/api/verify-code`, {
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
export function setAdminKey(key) {
  state.adminKey = key;
}

export function clearAdminKey() {
  state.adminKey = '';
}
