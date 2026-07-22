/**
 * mapUpstreamError 单测（P2-16）：覆盖 LLM 侧 HTTP 状态码 + 错误码全分支。
 *
 * 注：llm.js 顶层 import 了 stores/settings.js + stores/access.js（依赖 localStorage），
 * 但 mapUpstreamError 是纯函数，import 副作用在 vitest node 环境下不报错（stores 用 try/catch 兜底）。
 */
import { describe, it, expect } from 'vitest';
import { mapUpstreamError } from './llm.js';

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
