/**
 * md.js baseline 测试。
 *
 * 目的：固化当前自写渲染器行为，P1-10 换 marked + DOMPurify 后用同样用例验证不回归。
 * 只测主流场景，不追求 100% 覆盖（自写渲染器本身有边界 bug，那是 P1-10 的事）。
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './md.js';

describe('renderMarkdown - 基础', () => {
  it('空输入返回空串', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
  });

  it('纯文本被段落包裹', () => {
    const out = renderMarkdown('hello');
    expect(out).toContain('hello');
    expect(out).toContain('<p');
  });
});

describe('renderMarkdown - HTML 转义（安全关键）', () => {
  it('<script> 标签被 DOMPurify 清洗掉', () => {
    const out = renderMarkdown('<script>alert(1)</script>');
    expect(out).not.toMatch(/<script>/i);
    expect(out).not.toContain('alert(1)');
  });

  it('<img onerror> 危险属性被剥离', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert(1)');
  });

  it('保留安全的 HTML（a/href）', () => {
    const out = renderMarkdown('[link](https://example.com)');
    expect(out).toContain('href="https://example.com"');
  });
});

describe('renderMarkdown - 标题', () => {
  it('渲染 h1-h6', () => {
    expect(renderMarkdown('# T')).toMatch(/<h1/);
    expect(renderMarkdown('## T')).toMatch(/<h2/);
    expect(renderMarkdown('### T')).toMatch(/<h3/);
    expect(renderMarkdown('#### T')).toMatch(/<h4/);
    expect(renderMarkdown('##### T')).toMatch(/<h5/);
    expect(renderMarkdown('###### T')).toMatch(/<h6/);
  });
});

describe('renderMarkdown - 行内格式', () => {
  it('**粗体** -> <strong>', () => {
    const out = renderMarkdown('**bold**');
    expect(out).toContain('<strong');
    expect(out).toContain('bold');
  });

  it('`code` -> <code>', () => {
    const out = renderMarkdown('`inline`');
    expect(out).toContain('<code');
    expect(out).toContain('inline');
  });
});

describe('renderMarkdown - 代码块', () => {
  it('```code block``` -> <pre><code>', () => {
    const out = renderMarkdown('```\nx = 1\n```');
    expect(out).toContain('<pre');
    expect(out).toContain('<code');
    expect(out).toContain('x = 1');
  });
});

describe('renderMarkdown - 列表', () => {
  it('无序列表', () => {
    const out = renderMarkdown('- a\n- b');
    expect(out).toContain('<ul');
    expect(out).toContain('<li>a</li>');
    expect(out).toContain('<li>b</li>');
  });

  it('有序列表', () => {
    const out = renderMarkdown('1. a\n2. b');
    expect(out).toContain('<ol');
    expect(out).toContain('<li>a</li>');
    expect(out).toContain('<li>b</li>');
  });
});

describe('renderMarkdown - 表格', () => {
  it('标准表格', () => {
    const out = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(out).toContain('<table');
    expect(out).toContain('<th');
    expect(out).toContain('A');
    expect(out).toContain('B');
    expect(out).toContain('<td');
    expect(out).toContain('1');
    expect(out).toContain('2');
  });

  it('表格 cell 含 / 分隔符（情绪表场景）', () => {
    // 模拟教练输出的【玩家情绪】表
    const out = renderMarkdown('| # | 情绪 |\n|---|---|\n| 3 | 紧张/回避 |');
    expect(out).toContain('紧张/回避');
    // td 应带 class（自定义 renderer 注入），AnalysisPanel 的 postProcess 依赖此结构
    expect(out).toMatch(/<td class="[^"]*">紧张\/回避<\/td>/);
  });
});
