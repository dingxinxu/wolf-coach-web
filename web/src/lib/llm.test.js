/**
 * mapUpstreamError 单测（P2-16）：覆盖 LLM 侧 HTTP 状态码 + 错误码全分支。
 *
 * 注：llm.js 顶层 import 了 stores/settings.js + stores/access.js（依赖 localStorage），
 * 但 mapUpstreamError 是纯函数，import 副作用在 vitest node 环境下不报错（stores 用 try/catch 兜底）。
 *
 * B4 双阈值单测：pickStallTimeout 验证首 token 前后阈值切换。
 */
import { describe, it, expect } from 'vitest';
import {
  mapUpstreamError,
  pickStallTimeout,
  FIRST_TOKEN_TIMEOUT_MS,
  STALL_TIMEOUT_MS,
} from './llm.js';

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
