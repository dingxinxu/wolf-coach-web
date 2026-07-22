/**
 * buildAuthHeaders 单测（P2-16）。
 */
import { describe, it, expect } from 'vitest';
import { buildAuthHeaders } from './request.js';

describe('buildAuthHeaders', () => {
  it('admin-pool 模式 + 有访问码 -> 含 X-Access-Code', () => {
    const h = buildAuthHeaders('admin-pool', 'CODE123');
    expect(h['Content-Type']).toBe('application/json');
    expect(h['X-Access-Code']).toBe('CODE123');
  });

  it('user 模式 -> 不含 X-Access-Code（即使有码）', () => {
    const h = buildAuthHeaders('user', 'CODE123');
    expect(h['Content-Type']).toBe('application/json');
    expect(h['X-Access-Code']).toBeUndefined();
  });

  it('admin-pool 模式但无访问码 -> 不含 X-Access-Code', () => {
    const h = buildAuthHeaders('admin-pool', '');
    expect(h['X-Access-Code']).toBeUndefined();
  });

  it('admin-pool 模式 accessCode 为 null -> 不含 X-Access-Code', () => {
    const h = buildAuthHeaders('admin-pool', null);
    expect(h['X-Access-Code']).toBeUndefined();
  });

  it('始终返回 Content-Type', () => {
    expect(buildAuthHeaders('user', '')['Content-Type']).toBe('application/json');
    expect(buildAuthHeaders('admin-pool', 'x')['Content-Type']).toBe('application/json');
  });
});
