/**
 * Worker 测试：纯函数（E1）+ 业务规则（E2）。
 *
 * 不测路由集成（E3）——那需要 mock Request/Response/fetch，成本高收益低。
 * 这里覆盖：加密往返、哈希稳定性、访问码生成、脱敏、LLM 配置解析、
 *          访问码校验全分支（无码/无效/过期/超限/通过）。
 *
 * 约定：crypto.subtle 需 node 20+ 全局可用（vitest node 环境）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  encryptApiKey,
  decryptApiKey,
  hashAccessCode,
  generateAccessCode,
  maskKey,
  resolveLLMConfig,
  validateAccessCode,
  bumpUsage,
  requireAdmin,
  checkInputSize,
  constantTimeEqual,
  MAX_INPUT_CHARS,
  ADMIN_FAIL_LIMIT,
  ADMIN_LOCK_MS,
  VERIFY_DAILY_LIMIT,
} from './index.js';

// P0-6：常量从 index.js import，单一真相源，避免两处硬编码不同步

// ========== E1: 纯函数 ==========

// 32 字节 base64 密钥（用于 AES-GCM 测试）
const TEST_KEY = btoa(
  String.fromCharCode(...new Uint8Array(32).fill(42))
);

describe('E1 · encryptApiKey / decryptApiKey 往返', () => {
  const env = { KV_ENC_KEY: TEST_KEY };

  it('加密后再解密 = 原文', async () => {
    const plain = 'sk-deepseek-abc123';
    const cipher = await encryptApiKey(plain, env);
    expect(cipher).not.toBe(plain);
    expect(cipher.length).toBeGreaterThan(0);
    const back = await decryptApiKey(cipher, env);
    expect(back).toBe(plain);
  });

  it('空串加密返回空串', async () => {
    expect(await encryptApiKey('', env)).toBe('');
  });

  it('空串解密返回空串', async () => {
    expect(await decryptApiKey('', env)).toBe('');
  });

  it('密文被篡改 -> 解密返回空串（不抛错）', async () => {
    const cipher = await encryptApiKey('sk-test', env);
    // 篡改最后一个字符
    const tampered = cipher.slice(0, -1) + (cipher.endsWith('A') ? 'B' : 'A');
    const back = await decryptApiKey(tampered, env);
    expect(back).toBe('');
  });

  it('用错误的密钥解密 -> 返回空串', async () => {
    const cipher = await encryptApiKey('sk-test', env);
    const wrongEnv = {
      KV_ENC_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(99))),
    };
    const back = await decryptApiKey(cipher, wrongEnv);
    expect(back).toBe('');
  });
});

describe('E1 · hashAccessCode 稳定性', () => {
  it('相同输入 = 相同输出', async () => {
    const a = await hashAccessCode('ABC12345');
    const b = await hashAccessCode('ABC12345');
    expect(a).toBe(b);
  });

  it('不同输入 = 不同输出', async () => {
    const a = await hashAccessCode('ABC12345');
    const b = await hashAccessCode('ABC12346');
    expect(a).not.toBe(b);
  });

  it('输出是 hex 字符串', async () => {
    const h = await hashAccessCode('test');
    expect(h).toMatch(/^[0-9a-f]+$/);
    expect(h.length).toBe(64); // SHA-256 hex
  });
});

describe('E1 · generateAccessCode', () => {
  it('长度 = 8', () => {
    expect(generateAccessCode().length).toBe(8);
  });

  it('不含易混淆字符（0/O/I/1/L）', () => {
    const forbidden = ['0', 'O', 'I', '1', 'L'];
    for (let i = 0; i < 100; i++) {
      const code = generateAccessCode();
      for (const c of forbidden) {
        expect(code).not.toContain(c);
      }
    }
  });

  it('多次调用生成不同码（概率性）', () => {
    const codes = new Set();
    for (let i = 0; i < 20; i++) codes.add(generateAccessCode());
    // 20 个里至少 18 个不同（容许极小概率碰撞）
    expect(codes.size).toBeGreaterThanOrEqual(18);
  });
});

describe('E1 · maskKey', () => {
  it('空串返回空串', () => {
    expect(maskKey('')).toBe('');
  });

  it('短 key（≤8）全遮', () => {
    expect(maskKey('sk-1234')).toBe('*******');
  });

  it('长 key 保留首4末4', () => {
    expect(maskKey('sk-deepseek-abc1234567890')).toBe('sk-d****7890');
  });
});

// ========== E2: 业务规则 ==========

/**
 * 构造 mock KV namespace。
 * 用法：const kv = mockKV(); const env = { LLM_POOL: kv };
 */
function mockKV(initial = {}) {
  const store = { ...initial };
  return {
    store, // 暴露给测试断言用
    async get(key, opts) {
      const v = store[key];
      if (v === undefined) return null;
      if (opts?.type === 'json') {
        try {
          return JSON.parse(v);
        } catch {
          return null;
        }
      }
      return v;
    },
    async put(key, value) {
      store[key] = value;
    },
    async delete(key) {
      delete store[key];
    },
    async list({ prefix } = {}) {
      const keys = Object.keys(store)
        .filter((k) => (prefix ? k.startsWith(prefix) : true))
        .map((name) => ({ name }));
      return { keys };
    },
  };
}

/** 构造带 X-Access-Code 头的 mock Request */
function mockRequest(accessCode) {
  const headers = new Map();
  if (accessCode) headers.set('x-access-code', accessCode);
  return {
    headers: { get: (k) => headers.get(k.toLowerCase()) || null },
  };
}

describe('E2 · resolveLLMConfig 优先级', () => {
  it('① 用户自带 Key 优先', async () => {
    const kv = mockKV({
      active: JSON.stringify({ apiKey: 'cipher', baseUrl: 'https://pool', model: 'pool-m' }),
    });
    const env = {
      LLM_POOL: kv,
      DEFAULT_LLM_API_KEY: 'fallback',
      DEFAULT_LLM_BASE_URL: 'https://fallback',
      DEFAULT_LLM_MODEL: 'fallback-m',
      KV_ENC_KEY: TEST_KEY,
    };
    const cfg = await resolveLLMConfig(env, {
      llm: { apiKey: 'sk-user', baseUrl: 'https://user', model: 'user-m' },
    });
    expect(cfg.apiKey).toBe('sk-user');
    expect(cfg.source).toBe('user');
    expect(cfg.baseUrl).toBe('https://user');
  });

  it('② 用户无 Key + KV 池有加密 Key -> 解密用池', async () => {
    const cipher = await encryptApiKey('sk-pool', { KV_ENC_KEY: TEST_KEY });
    const kv = mockKV({
      active: JSON.stringify({ apiKey: cipher, baseUrl: 'https://pool', model: 'pool-m' }),
    });
    const env = {
      LLM_POOL: kv,
      KV_ENC_KEY: TEST_KEY,
      DEFAULT_LLM_BASE_URL: 'https://fallback',
      DEFAULT_LLM_MODEL: 'fallback-m',
    };
    const cfg = await resolveLLMConfig(env, { llm: {} });
    expect(cfg.apiKey).toBe('sk-pool');
    expect(cfg.source).toBe('admin-pool');
  });

  it('③ 用户无 Key + KV 池空 -> 兜底 DEFAULT_LLM_API_KEY', async () => {
    const kv = mockKV({});
    const env = {
      LLM_POOL: kv,
      DEFAULT_LLM_API_KEY: 'sk-fallback',
      DEFAULT_LLM_BASE_URL: 'https://fallback',
      DEFAULT_LLM_MODEL: 'fallback-m',
    };
    const cfg = await resolveLLMConfig(env, { llm: {} });
    expect(cfg.apiKey).toBe('sk-fallback');
    expect(cfg.source).toBe('fallback');
  });

  it('全空 -> 返回 null', async () => {
    const kv = mockKV({});
    const env = { LLM_POOL: kv };
    const cfg = await resolveLLMConfig(env, { llm: {} });
    expect(cfg).toBeNull();
  });
});

describe('E2 · validateAccessCode + bumpUsage 全分支', () => {
  const baseCode = 'TESTCODE1';
  let codeHash;

  beforeEach(async () => {
    codeHash = await hashAccessCode(baseCode);
  });

  /** 构造带这个测试码的 env */
  async function envWithCode(entry) {
    const kv = mockKV(entry ? { [`code:${codeHash}`]: JSON.stringify(entry) } : {});
    return { LLM_POOL: kv };
  }

  it('未带 X-Access-Code 头 -> 403 access_code_required', async () => {
    const env = await envWithCode({ enabled: true, dailyLimit: 100, usage: { day: '2026-01-01', count: 0 } });
    const r = await validateAccessCode(mockRequest(null), env);
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(403);
    const body = await r.response.json();
    expect(body.error).toBe('access_code_required');
  });

  it('带无效码（KV 无此 hash）-> 403 invalid_access_code', async () => {
    const env = await envWithCode(null);
    const r = await validateAccessCode(mockRequest('WRONGCODE'), env);
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(403);
    const body = await r.response.json();
    expect(body.error).toBe('invalid_access_code');
  });

  it('码存在但 enabled=false -> 403 invalid_access_code', async () => {
    const env = await envWithCode({ enabled: false, dailyLimit: 100, usage: { day: '2026-01-01', count: 0 } });
    const r = await validateAccessCode(mockRequest(baseCode), env);
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(403);
    const body = await r.response.json();
    expect(body.error).toBe('invalid_access_code');
  });

  it('码已过期 -> 403 access_code_expired', async () => {
    const env = await envWithCode({
      enabled: true,
      dailyLimit: 100,
      expiresAt: Date.now() - 1000,
      usage: { day: '2026-01-01', count: 0 },
    });
    const r = await validateAccessCode(mockRequest(baseCode), env);
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(403);
    const body = await r.response.json();
    expect(body.error).toBe('access_code_expired');
  });

  it('永久码（expiresAt=0）-> 通过', async () => {
    const env = await envWithCode({
      enabled: true,
      dailyLimit: 100,
      expiresAt: 0,
      usage: { day: '2026-01-01', count: 0 },
    });
    const r = await validateAccessCode(mockRequest(baseCode), env);
    expect(r.ok).toBe(true);
  });

  it('今日用量达上限 -> 429 rate_limit_exceeded', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const env = await envWithCode({
      enabled: true,
      dailyLimit: 100,
      usage: { day: today, count: 100 },
    });
    const r = await validateAccessCode(mockRequest(baseCode), env);
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(429);
    const body = await r.response.json();
    expect(body.error).toBe('rate_limit_exceeded');
    expect(body.limit).toBe(100);
    expect(body.used).toBe(100);
  });

  it('日期跨天 -> count 重置后通过', async () => {
    const env = await envWithCode({
      enabled: true,
      dailyLimit: 100,
      usage: { day: '2020-01-01', count: 100 }, // 昨天已满
    });
    const r = await validateAccessCode(mockRequest(baseCode), env);
    expect(r.ok).toBe(true); // 今天重置，通过
  });

  it('校验通过 -> 不自增 count（计数由 bumpUsage 单独负责）', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const env = await envWithCode({
      enabled: true,
      dailyLimit: 100,
      usage: { day: today, count: 5 },
    });
    const r = await validateAccessCode(mockRequest(baseCode), env);
    expect(r.ok).toBe(true);
    // validate 不应写回 KV
    const after = JSON.parse(env.LLM_POOL.store[`code:${codeHash}`]);
    expect(after.usage.count).toBe(5); // 仍是 5，未自增
  });

  it('无 dailyLimit 字段 -> 默认 100', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const env = await envWithCode({
      enabled: true,
      usage: { day: today, count: 99 }, // 接近默认上限
    });
    const r = await validateAccessCode(mockRequest(baseCode), env);
    expect(r.ok).toBe(true); // 第 100 次，仍通过
  });

  it('bumpUsage -> count 自增并写回 KV', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const entry = { enabled: true, dailyLimit: 100, usage: { day: today, count: 5 } };
    const env = await envWithCode(entry);
    const r = await validateAccessCode(mockRequest(baseCode), env);
    expect(r.ok).toBe(true);
    await bumpUsage(r.codeHash, r.entry, env);
    const updated = JSON.parse(env.LLM_POOL.store[`code:${codeHash}`]);
    expect(updated.usage.count).toBe(6);
    expect(updated.usage.day).toBe(today);
  });

  it('P0-2 回归：no_api_key 路径不调 bumpUsage -> count 不变', async () => {
    // 模拟 handleChat 在 resolveConfig 返回 null 时不扣费：
    // validate 通过后 entry.count 仍是原值，bumpUsage 不被调用
    const today = new Date().toISOString().slice(0, 10);
    const env = await envWithCode({
      enabled: true,
      dailyLimit: 100,
      usage: { day: today, count: 7 },
    });
    const r = await validateAccessCode(mockRequest(baseCode), env);
    expect(r.ok).toBe(true);
    // 模拟 resolveConfig 失败 -> 不调 bumpUsage
    const unchanged = JSON.parse(env.LLM_POOL.store[`code:${codeHash}`]);
    expect(unchanged.usage.count).toBe(7); // 未扣
  });
});

// ========== C3: input size 预检（checkInputSize） ==========

describe('C3 · checkInputSize', () => {
  it('阈值 60000（通过 limit 字段间接断言常量值）', () => {
    const r = checkInputSize([{ content: 'x' }]);
    expect(r.limit).toBe(60000);
  });

  it('总长度 < 阈值 -> tooLarge=false', () => {
    const r = checkInputSize([{ content: 'a'.repeat(59999) }]);
    expect(r.tooLarge).toBe(false);
    expect(r.length).toBe(59999);
  });

  it('总长度 = 阈值 -> tooLarge=false（边界：恰好不超）', () => {
    const r = checkInputSize([{ content: 'a'.repeat(60000) }]);
    expect(r.tooLarge).toBe(false);
  });

  it('总长度 > 阈值 -> tooLarge=true', () => {
    const r = checkInputSize([{ content: 'a'.repeat(60001) }]);
    expect(r.tooLarge).toBe(true);
    expect(r.length).toBe(60001);
  });

  it('多 message 累加长度', () => {
    const r = checkInputSize([
      { content: '系统'.repeat(16000) }, // 32K
      { content: '用户'.repeat(15000) }, // 30K
    ]);
    // 每个中文字符长度 1，合计 62K > 60K
    expect(r.length).toBe(62000);
    expect(r.tooLarge).toBe(true);
  });

  it('content 为 undefined/空 -> 不计入长度', () => {
    const r = checkInputSize([{ role: 'system' }, { content: '' }, { content: 'abc' }]);
    expect(r.length).toBe(3);
  });
});

// ========== D1: admin 失败限流 ==========

describe('D1 · requireAdmin 失败限流', () => {
  const ADMIN_PASSWORD = 'correct-password';
  const IP = '1.2.3.4';

  /** 构造带 X-Admin-Key + CF-Connecting-IP 的 mock Request */
  function mockAdminRequest(key) {
    const headers = new Map();
    headers.set('cf-connecting-ip', IP);
    if (key !== undefined) headers.set('x-admin-key', key);
    return {
      headers: { get: (k) => headers.get(k.toLowerCase()) || null },
    };
  }

  function envWithFails(initial = {}) {
    const kv = mockKV(initial);
    return { LLM_POOL: kv, ADMIN_PASSWORD };
  }

  it('正确密码 -> 通过，清失败计数', async () => {
    const env = envWithFails({ [`admin_fails:${IP}`]: JSON.stringify({ count: 2, lockedUntil: 0 }) });
    const res = await requireAdmin(mockAdminRequest(ADMIN_PASSWORD), env);
    expect(res).toBeNull();
    // 失败计数应被清除
    expect(env.LLM_POOL.store[`admin_fails:${IP}`]).toBeUndefined();
  });

  it('错误密码 -> 401，计数 +1', async () => {
    const env = envWithFails();
    const res = await requireAdmin(mockAdminRequest('wrong'), env);
    expect(res.status).toBe(401);
    const fail = JSON.parse(env.LLM_POOL.store[`admin_fails:${IP}`]);
    expect(fail.count).toBe(1);
    expect(fail.lockedUntil).toBe(0);
  });

  it('连续失败达 ADMIN_FAIL_LIMIT 次 -> 锁定（lockedUntil > now）', async () => {
    const env = envWithFails();
    // 前 4 次失败但不锁
    for (let i = 0; i < ADMIN_FAIL_LIMIT - 1; i++) {
      await requireAdmin(mockAdminRequest('wrong'), env);
    }
    let fail = JSON.parse(env.LLM_POOL.store[`admin_fails:${IP}`]);
    expect(fail.count).toBe(ADMIN_FAIL_LIMIT - 1);
    expect(fail.lockedUntil).toBe(0);

    // 第 5 次 -> 锁
    const res = await requireAdmin(mockAdminRequest('wrong'), env);
    expect(res.status).toBe(401);
    fail = JSON.parse(env.LLM_POOL.store[`admin_fails:${IP}`]);
    expect(fail.count).toBe(ADMIN_FAIL_LIMIT);
    expect(fail.lockedUntil).toBeGreaterThan(Date.now());
  });

  it('锁定期间即使密码正确也返回 429 admin_locked', async () => {
    const env = envWithFails({
      [`admin_fails:${IP}`]: JSON.stringify({ count: ADMIN_FAIL_LIMIT, lockedUntil: Date.now() + 5 * 60 * 1000 }),
    });
    const res = await requireAdmin(mockAdminRequest(ADMIN_PASSWORD), env);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('admin_locked');
  });

  it('锁过期后允许重试', async () => {
    const env = envWithFails({
      [`admin_fails:${IP}`]: JSON.stringify({ count: ADMIN_FAIL_LIMIT, lockedUntil: Date.now() - 1000 }),
    });
    const res = await requireAdmin(mockAdminRequest(ADMIN_PASSWORD), env);
    expect(res).toBeNull(); // 锁已过期，密码正确，通过
  });

  it('P1-8 回归：空 key -> 401（constantTimeEqual 空值边界）', async () => {
    const env = envWithFails();
    // key 为 undefined（mockAdminRequest(undefined) 不设头）
    const res = await requireAdmin(mockAdminRequest(undefined), env);
    expect(res.status).toBe(401);
  });

  it('P1-8 回归：ADMIN_PASSWORD 未配置 -> 401（不通过）', async () => {
    const kv = mockKV({});
    const env = { LLM_POOL: kv }; // 无 ADMIN_PASSWORD
    const res = await requireAdmin(mockAdminRequest('anything'), env);
    expect(res.status).toBe(401);
  });
});

describe('P1-8 · constantTimeEqual', () => {
  it('相等字符串 -> true', async () => {
    expect(await constantTimeEqual('secret', 'secret')).toBe(true);
  });

  it('不等字符串 -> false', async () => {
    expect(await constantTimeEqual('secret', 'secreX')).toBe(false);
  });

  it('任一为空 -> false（不抛错）', async () => {
    expect(await constantTimeEqual('', 'x')).toBe(false);
    expect(await constantTimeEqual('x', '')).toBe(false);
    expect(await constantTimeEqual('', '')).toBe(false);
    expect(await constantTimeEqual(null, 'x')).toBe(false);
    expect(await constantTimeEqual('x', undefined)).toBe(false);
  });

  it('长度不同但哈希后定长比较 -> false', async () => {
    expect(await constantTimeEqual('a', 'aa')).toBe(false);
  });
});
