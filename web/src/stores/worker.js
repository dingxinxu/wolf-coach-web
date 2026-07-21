/**
 * Worker 端点配置 store。
 *
 * 从 settings.js 抽出，作为 access.js / settings.js 共同依赖的底层模块，
 * 打破原来的循环依赖规避补丁（verifyAccessCode 让调用方传 base 的丑设计）。
 *
 * 依赖图：access  -> worker <- settings（无环）
 *
 * 一次性迁移：老版本把 workerUrl 存在 wolf-coach-settings-v1 里，
 * 首次加载时若新 key 为空且老 key 含 workerUrl，迁移过来。
 */
import { reactive, watch } from 'vue';

const STORAGE_KEY = 'wolf-coach-worker-v1';
const OLD_SETTINGS_KEY = 'wolf-coach-settings-v1';

const DEFAULT = {
  workerUrl: '',
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT, ...JSON.parse(raw) };
    }
    // 一次性迁移：从老 settings key 抢救 workerUrl
    const oldSettings = localStorage.getItem(OLD_SETTINGS_KEY);
    if (oldSettings) {
      const parsed = JSON.parse(oldSettings);
      if (parsed && typeof parsed.workerUrl === 'string' && parsed.workerUrl) {
        return { ...DEFAULT, workerUrl: parsed.workerUrl };
      }
    }
    return { ...DEFAULT };
  } catch {
    return { ...DEFAULT };
  }
}

export const worker = reactive(load());

watch(
  worker,
  (v) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  },
  { deep: true }
);

/**
 * Worker 基础 URL 优先级：
 *   worker.workerUrl -> 构建时 VITE_WORKER_URL -> '' (同 origin)
 */
export function workerBase() {
  return worker.workerUrl?.trim() || import.meta.env.VITE_WORKER_URL || '';
}
