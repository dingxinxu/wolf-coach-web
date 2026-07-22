/**
 * Markdown 渲染：基于 marked + DOMPurify。
 *
 * P1-10：替换原自写 90 行正则渲染器，解决嵌套列表/加粗里代码/表格 cell 换行等边界 bug。
 * 防 XSS 由 DOMPurify 兜底（即使 LLM 输出 <script> 等也会被清洗）。
 *
 * class 注入：保留原渲染器对 h1-h6/strong/code/blockquote/table 的主题样式类，
 * 让 AnalysisPanel 的情绪表染色、style.css 的 prose-invert 样式继续工作。
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// 配置 marked：GFM 表格 + 换行转 <br>
marked.setOptions({
  gfm: true,
  breaks: false,
});

// 自定义 renderer：给元素加主题 class（保持视觉风格与原渲染器一致）
// 注：必须用普通函数（非箭头），marked 调用时 this 绑定 Renderer 实例，
// 才能拿到 this.parser 递归渲染子 token（修复 P0-4：cell/heading/strong 内嵌套不渲染）
const renderer = new marked.Renderer();

renderer.heading = function ({ tokens, depth }) {
  const inner = this.parser.parseInline(tokens);
  const clsMap = {
    1: 'text-2xl font-bold mt-4 mb-2 text-wolf-400',
    2: 'text-xl font-bold mt-4 mb-2 text-wolf-400',
    3: 'text-lg font-semibold mt-4 mb-1',
    4: 'text-base font-semibold mt-3 mb-1',
    5: 'text-sm font-semibold mt-3 mb-1',
    6: 'text-sm font-semibold mt-3 mb-1',
  };
  return `<h${depth} class="${clsMap[depth] || ''}">${inner}</h${depth}>`;
};

renderer.strong = function ({ tokens }) {
  const inner = this.parser.parseInline(tokens);
  return `<strong class="text-wolf-300">${inner}</strong>`;
};

renderer.codespan = ({ text }) => `<code class="bg-zinc-800 px-1 rounded text-xs">${text}</code>`;

renderer.code = ({ text }) =>
  `<pre class="bg-zinc-950 p-3 rounded overflow-x-auto text-xs"><code>${text}</code></pre>`;

renderer.blockquote = ({ text }) =>
  `<blockquote class="border-l-2 border-zinc-600 pl-3 text-zinc-400 italic my-1">${text}</blockquote>`;

// 表格 class 由 DOMPurify 保留，CSS 通过 .prose-invert table 选择器样式化
renderer.table = function ({ header, rows }) {
  let html = '<table class="text-sm w-full my-2 border-collapse">';
  if (header) {
    html += '<thead><tr>';
    for (const h of header) {
      html += `<th class="border border-zinc-700 px-2 py-1 bg-zinc-800 text-left font-semibold">${this.parser.parseInline(h.tokens)}</th>`;
    }
    html += '</tr></thead>';
  }
  if (rows) {
    html += '<tbody>';
    for (const row of rows) {
      html += '<tr>';
      for (const cell of row) {
        html += `<td class="border border-zinc-700 px-2 py-1 bg-zinc-900/50">${this.parser.parseInline(cell.tokens)}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody>';
  }
  html += '</table>';
  return html;
};

marked.use({ renderer });

// DOMPurify 配置：允许 class 属性（主题样式需要），禁所有脚本/事件
const PURIFY_CONFIG = {
  ALLOWED_ATTR: ['class', 'href', 'src', 'alt', 'title'],
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'strong', 'em', 'del', 's',
    'code', 'pre',
    'blockquote',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'a', 'img',
    'span', 'div',
  ],
  FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover'],
};

/**
 * 渲染 markdown 为已 sanitize 的 HTML 字符串。
 * @param {string} src
 * @returns {string}
 */
export function renderMarkdown(src) {
  if (!src) return '';
  const rawHtml = marked.parse(String(src));
  return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
}
