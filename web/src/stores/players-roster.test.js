/**
 * players-roster.js 测试。
 *
 * F2：覆盖 lastPlayedAt 字段默认值、相对时间格式化、按 lastPlayedAt 排序。
 *
 * 注：players-roster.js 用了 reactive() + localStorage，
 * 测试需 mock localStorage（node 环境无）。
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

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

describe('F2 · createPlayer 默认 lastPlayedAt', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.resetModules();
  });

  it('新建玩家 lastPlayedAt 默认 0（从未同玩）', async () => {
    const { createPlayer, roster } = await import('./players-roster.js');
    const p = createPlayer({ name: 'test' });
    expect(p.lastPlayedAt).toBe(0);
    expect(roster.players.length).toBe(1);
  });
});

describe('F2 · lastPlayedLabel 相对时间', () => {
  // vitest 支持 top-level await，但模块内 describe 回调需动态 import
  let lastPlayedLabel;
  beforeAll(async () => {
    ({ lastPlayedLabel } = await import('./players-roster.js'));
  });
  const DAY = 24 * 60 * 60 * 1000;

  it('lastPlayedAt=0 或缺失 -> 空文本', () => {
    expect(lastPlayedLabel(0).text).toBe('');
    expect(lastPlayedLabel(undefined).text).toBe('');
    expect(lastPlayedLabel(null).text).toBe('');
  });

  it('刚刚（< 1 天）-> 今天，不生疏', () => {
    const label = lastPlayedLabel(Date.now() - 2 * 60 * 60 * 1000); // 2 小时前
    expect(label.text).toBe('今天');
    expect(label.stale).toBe(false);
  });

  it('1-2 天 -> 昨天，不生疏', () => {
    const label = lastPlayedLabel(Date.now() - 1.5 * DAY);
    expect(label.text).toBe('昨天');
    expect(label.stale).toBe(false);
  });

  it('3-6 天 -> N天前，不生疏', () => {
    const label = lastPlayedLabel(Date.now() - 4 * DAY);
    expect(label.text).toBe('4天前');
    expect(label.stale).toBe(false);
  });

  it('7-29 天 -> N周前，不生疏', () => {
    const label = lastPlayedLabel(Date.now() - 14 * DAY);
    expect(label.text).toBe('2周前');
    expect(label.stale).toBe(false);
  });

  it('30 天整 -> N月前 + 生疏标记', () => {
    const label = lastPlayedLabel(Date.now() - 60 * DAY);
    expect(label.text).toBe('2月前');
    expect(label.stale).toBe(true);
  });

  it('> 1 年 -> N年前 + 生疏', () => {
    const label = lastPlayedLabel(Date.now() - 400 * DAY);
    expect(label.text).toBe('1年前');
    expect(label.stale).toBe(true);
  });
});

describe('F2 · playersByLastPlayed 排序', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.resetModules();
  });

  it('按 lastPlayedAt 倒序，从未同玩（0）排最后', async () => {
    const { createPlayer, updatePlayer, playersByLastPlayed } = await import('./players-roster.js');
    const p1 = createPlayer({ name: '老王' });
    const p2 = createPlayer({ name: '老张' });
    const p3 = createPlayer({ name: '新手' }); // lastPlayedAt=0
    updatePlayer(p1.id, { lastPlayedAt: 1000 });
    updatePlayer(p2.id, { lastPlayedAt: 2000 });
    const sorted = playersByLastPlayed();
    expect(sorted.map((p) => p.name)).toEqual(['老张', '老王', '新手']);
  });

  it('空档案库 -> 空数组', async () => {
    const { playersByLastPlayed } = await import('./players-roster.js');
    expect(playersByLastPlayed()).toEqual([]);
  });
});
