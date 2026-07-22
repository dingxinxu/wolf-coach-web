/**
 * mapUpstreamError 单测（P2-16）：覆盖 LLM 侧 HTTP 状态码 + 错误码全分支。
 *
 * 注：llm.js 顶层 import 了 stores/settings.js + stores/access.js（依赖 localStorage），
 * 但 mapUpstreamError 是纯函数，import 副作用在 vitest node 环境下不报错（stores 用 try/catch 兜底）。
 *
 * B4 双阈值单测：pickStallTimeout 验证首 token 前后阈值切换。
 *
 * B4 端到端集成测试：chatWithCoach + mock fetch SSE 流 + fake timers，
 * 验证双阈值 stall 超时在完整流程中的行为（首 token 前 90s / 首 token 后 30s）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mapUpstreamError,
  pickStallTimeout,
  chatWithCoach,
  FIRST_TOKEN_TIMEOUT_MS,
  STALL_TIMEOUT_MS,
} from './llm.js';
import { settings } from '../stores/settings.js';

// ===== mock localStorage + sessionStorage（node 环境无，stores 初始化 + watch 持久化需要）=====
// 与 stores/worker.test.js 同款模式。ES import 会被提升到顶部，stores 已用默认值初始化，
// 这里 stub 主要服务于后续 beforeEach 改写 settings 时 watch() 触发的 setItem。
const storageStore = {};
const storageMock = {
  getItem: (k) => (k in storageStore ? storageStore[k] : null),
  setItem: (k, v) => {
    storageStore[k] = String(v);
  },
  removeItem: (k) => {
    delete storageStore[k];
  },
  clear: () => {
    Object.keys(storageStore).forEach((k) => delete storageStore[k]);
  },
};
vi.stubGlobal('localStorage', storageMock);
vi.stubGlobal('sessionStorage', storageMock);

describe('B4 · pickStallTimeout 双阈值切换', () => {
  it('首 token 前（firstChunkReceived=false）返回 90s', () => {
    expect(pickStallTimeout(false)).toBe(FIRST_TOKEN_TIMEOUT_MS);
    expect(pickStallTimeout(false)).toBe(90_000);
  });

  it('首 token 后（firstChunkReceived=true）返回 30s', () => {
    expect(pickStallTimeout(true)).toBe(STALL_TIMEOUT_MS);
    expect(pickStallTimeout(true)).toBe(30_000);
  });

  it('首 token 前阈值 > 首 token 后阈值（reasoning 思考期需更长容忍）', () => {
    expect(FIRST_TOKEN_TIMEOUT_MS).toBeGreaterThan(STALL_TIMEOUT_MS);
  });
});

describe('mapUpstreamError', () => {
  it('401 -> API Key 失效提示', () => {
    expect(mapUpstreamError(401, '')).toContain('API Key 失效');
  });

  it('403 + access_code_required -> 访问码提示', () => {
    const msg = mapUpstreamError(403, 'access_code_required');
    expect(msg).toContain('访问码');
  });

  it('403 + invalid_access_code -> 无效提示', () => {
    const msg = mapUpstreamError(403, 'invalid_access_code');
    expect(msg).toContain('无效');
  });

  it('403 + access_code_expired -> 过期提示', () => {
    const msg = mapUpstreamError(403, 'access_code_expired');
    expect(msg).toContain('过期');
  });

  it('403 其它 -> 访问被拒绝', () => {
    expect(mapUpstreamError(403, 'something_else')).toContain('访问被拒绝');
  });

  it('429 -> 请求过快提示', () => {
    expect(mapUpstreamError(429, '')).toContain('请求过快');
  });

  it('502 + context_length -> 上下文过长', () => {
    expect(mapUpstreamError(502, 'context_length_exceeded')).toContain('上下文过长');
  });

  it('502 + upstream_error -> 上游异常', () => {
    expect(mapUpstreamError(502, 'upstream_error')).toContain('上游 LLM 服务异常');
  });

  it('502 其它 -> 上游服务异常', () => {
    expect(mapUpstreamError(502, '')).toContain('上游服务异常');
  });

  it('其它状态码 -> 带状态码的通用提示', () => {
    const msg = mapUpstreamError(500, 'boom');
    expect(msg).toContain('500');
    expect(msg).toContain('boom');
  });

  it('detail 为 null 不报错', () => {
    expect(() => mapUpstreamError(502, null)).not.toThrow();
  });
});

// ============================================================================
// B4 chatWithCoach 端到端 stall 双阈值集成测试
//
// 验证完整 SSE 流程中双阈值超时行为：
//   - 首 token 前 90s 内不超时（覆盖 reasoning 模型思考期）
//   - 首 token 后 30s 无新 chunk 触发流断超时
//
// 技术要点：
//   1. mock fetch 返回 ReadableStream body，在 signal.abort 时调 controller.error(reason)
//      （模拟真实 fetch 把 abort 信号透传到 body stream）
//   2. vi.useFakeTimers() 控制 chatWithCoach 内的 setTimeout/clearTimeout stall 计时
//   3. vi.advanceTimersByTimeAsync() 同时推进 fake timer + flush microtask，
//      让 fetch resolve、reader.read() 挂起/唤醒都能正常跑
//   4. 跟踪 promise 是否 resolve 用外部 state 对象（避免 await 阻塞断言）
// ============================================================================
describe('B4 · chatWithCoach 端到端 stall 双阈值', () => {
  const encoder = new TextEncoder();
  let originalFetch;

  beforeEach(() => {
    // 让 isLLMReady() 返回 true：切到 user 模式 + 给 apiKey
    // （settings 是响应式单例，直接改字段即可，chatWithCoach 内部实时读）
    settings.keyMode = 'user';
    settings.userLLM.apiKey = 'test-key-e2e';

    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalFetch) globalThis.fetch = originalFetch;
    // 还原 settings，避免污染其它 describe
    settings.keyMode = 'admin-pool';
    settings.userLLM.apiKey = '';
    vi.restoreAllMocks();
  });

  /**
   * 构造 mock fetch：返回 ok 响应，body 是 ReadableStream。
   * abort 触发时把 reason 透传给 controller.error（模拟真实 fetch body 在 signal abort 时报错）。
   * @param {(controller, signal) => void} emit  chunk 发射逻辑
   */
  function mockFetchSSE(emit) {
    globalThis.fetch = vi.fn((_url, opts) => {
      const stream = new ReadableStream({
        start(controller) {
          // 把 abort 信号接到 stream 错误上（真实 fetch polyfill 的核心行为）
          opts.signal.addEventListener('abort', () => controller.error(opts.signal.reason));
          emit?.(controller, opts.signal);
        },
      });
      return Promise.resolve({ ok: true, body: stream, headers: new Map() });
    });
  }

  it('首 token 前：advance 31s（超旧 30s 阈值但未到新 90s）不超时；到 91s 才 abort 且提示思考过长', async () => {
    // stream 永不发 chunk（模拟 reasoning 模型思考期，迟迟无输出）
    mockFetchSSE(() => {
      /* never enqueue */
    });

    const state = { resolved: false, result: null };
    chatWithCoach([{ role: 'user', content: '分析这局' }], { onChunk: () => {} }).then((r) => {
      state.resolved = true;
      state.result = r;
    });

    // 让 fetch resolve + reader.read() 挂起 + stall 计时器（90s）就位
    await vi.advanceTimersByTimeAsync(31_000);
    // 31s 已超过旧的 30s 单阈值，但 B4 新阈值是首 token 前 90s，不应触发
    expect(state.resolved).toBe(false);

    // 推进到 91s（> 90s 首 token 阈值）-> stall timer 触发 -> abort -> reader.read() reject
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.resolved).toBe(true);
    expect(state.result.partial).toBe(true);
    // 未收到任何 token，full 为空但 B4 仍标记 partial:true 让调用方决定重试
    expect(state.result.full).toBe('');
    // 提示文案命中首 token 前分支（覆盖 reasoning 思考期）
    expect(state.result.error).toContain('思考时间过长');
    expect(state.result.error).toContain('90s');
  });

  it('首 token 后：advance 29s 不超时；到 31s（> 30s 流断阈值）才 abort 且提示 30s 无新内容', async () => {
    const chunks = [];
    // stream 立即发首个有效 token，之后不再发（模拟流断）
    mockFetchSSE((controller) => {
      controller.enqueue(
        encoder.encode('data: {"choices":[{"delta":{"content":"分析"}}]}\n\n')
      );
    });

    const state = { resolved: false, result: null };
    chatWithCoach([{ role: 'user', content: '分析这局' }], {
      onChunk: (d) => chunks.push(d),
    }).then((r) => {
      state.resolved = true;
      state.result = r;
    });

    // flush microtask：让首个 chunk 被 reader 读到，firstChunkReceived=true，
    // stall 计时器重置到 30s（首 token 后短阈值生效）
    await vi.advanceTimersByTimeAsync(0);
    expect(chunks).toEqual(['分析']);

    await vi.advanceTimersByTimeAsync(29_000);
    // 29s < 30s 流断阈值，不应 abort
    expect(state.resolved).toBe(false);

    // 推进到 31s（> 30s）-> stall timer 触发 -> abort
    await vi.advanceTimersByTimeAsync(2_000);
    expect(state.resolved).toBe(true);
    expect(state.result.partial).toBe(true);
    // 已收到的 partial 内容保留
    expect(state.result.full).toBe('分析');
    // 提示文案命中首 token 后流断分支
    expect(state.result.error).toContain('30s 无新内容');
  });
});
