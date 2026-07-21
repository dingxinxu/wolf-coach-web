/**
 * worker.js 测试。
 *
 * 重点验证 P2-15 的一次性迁移逻辑：
 *   - 新 key 有值 -> 直接用
 *   - 新 key 空 + 老 settings key 含 workerUrl -> 迁移
 *   - 两者都空 -> 默认空串
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ===== mock localStorage =====
const store = {};
const localStorageMock = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => {
    store[k] = String(v);
  },
  removeItem: (k) => {
    delete store[k];
  },
  clear: () => {
    Object.keys(store).forEach((k) => delete store[k]);
  },
};
vi.stubGlobal('localStorage', localStorageMock);

// stub import.meta.env.BASE_URL
vi.stubGlobal('import', { meta: { env: { BASE_URL: '/' } } });

describe('worker.js - 一次性迁移逻辑', () => {
  beforeEach(() => {
    localStorageMock.clear();
    // 重置模块缓存，让 worker.js 重新执行 load()
    vi.resetModules();
  });

  it('无任何存档 -> workerUrl 为空', async () => {
    const { worker } = await import('./worker.js');
    expect(worker.workerUrl).toBe('');
  });

  it('新 key 有值 -> 直接用', async () => {
    localStorageMock.setItem('wolf-coach-worker-v1', JSON.stringify({ workerUrl: 'https://new.example.com' }));
    const { worker } = await import('./worker.js');
    expect(worker.workerUrl).toBe('https://new.example.com');
  });

  it('新 key 空 + 老 settings key 含 workerUrl -> 迁移过来', async () => {
    localStorageMock.setItem(
      'wolf-coach-settings-v1',
      JSON.stringify({ workerUrl: 'https://old.example.com', keyMode: 'user' })
    );
    const { worker } = await import('./worker.js');
    expect(worker.workerUrl).toBe('https://old.example.com');
  });

  it('新 key 空 + 老 settings key 也无 workerUrl -> 空串', async () => {
    localStorageMock.setItem('wolf-coach-settings-v1', JSON.stringify({ keyMode: 'user' }));
    const { worker } = await import('./worker.js');
    expect(worker.workerUrl).toBe('');
  });

  it('老 key JSON 损坏 -> 不抛错，返回空串', async () => {
    localStorageMock.setItem('wolf-coach-settings-v1', 'not-json{{{');
    const { worker } = await import('./worker.js');
    expect(worker.workerUrl).toBe('');
  });
});

describe('worker.js - workerBase()', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.resetModules();
  });

  it('workerUrl 为空 -> 返回空串（同 origin）', async () => {
    const { workerBase } = await import('./worker.js');
    expect(workerBase()).toBe('');
  });

  it('workerUrl 含前后空格 -> trim 后返回', async () => {
    localStorageMock.setItem('wolf-coach-worker-v1', JSON.stringify({ workerUrl: '  https://x.workers.dev  ' }));
    const { workerBase } = await import('./worker.js');
    expect(workerBase()).toBe('https://x.workers.dev');
  });
});
