/**
 * 极简 Markdown 渲染。
 * 只处理教练输出常见结构：标题/列表/粗体/表格/代码块。
 * 不引外部依赖，避免 bundle 膨胀。
 */
export function renderMarkdown(src) {
  if (!src) return '';
  let s = String(src);

  // 转义 HTML
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 代码块
  s = s.replace(/```([\s\S]*?)```/g, (_, c) => `<pre class="bg-zinc-950 p-3 rounded overflow-x-auto text-xs"><code>${c}</code></pre>`);

  // 表格（简易：行首 | 视为表格）
  const lines = s.split('\n');
  const out = [];
  let inTable = false;
  let tableBuf = [];
  const flushTable = () => {
    if (tableBuf.length < 2) {
      out.push(...tableBuf);
      tableBuf = [];
      inTable = false;
      return;
    }
    const rows = tableBuf.map((l) => l.split('|').map((c) => c.trim()).filter((c, i, a) => !(i === 0 && c === '') && !(i === a.length - 1 && c === '')));
    // 第二行是分隔（|---|---|）
    const isSep = (r) => r.every((c) => /^:?-+:?$/.test(c));
    let html = '<table class="text-sm w-full my-2 border-collapse">';
    rows.forEach((r, i) => {
      if (i === 1 && isSep(r)) return;
      const tag = i === 0 ? 'th' : 'td';
      const cls = i === 0 ? 'bg-zinc-800 text-left font-semibold' : 'bg-zinc-900/50';
      html += `<tr>${r.map((c) => `<${tag} class="border border-zinc-700 px-2 py-1 ${cls}">${c}</${tag}>`).join('')}</tr>`;
    });
    html += '</table>';
    out.push(html);
    tableBuf = [];
    inTable = false;
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('|')) {
      inTable = true;
      tableBuf.push(line);
    } else {
      if (inTable) flushTable();
      out.push(line);
    }
  }
  if (inTable) flushTable();

  s = out.join('\n');

  // 标题
  s = s.replace(/^######\s+(.+)$/gm, '<h6 class="text-sm font-semibold mt-3 mb-1">$1</h6>');
  s = s.replace(/^#####\s+(.+)$/gm, '<h5 class="text-sm font-semibold mt-3 mb-1">$1</h5>');
  s = s.replace(/^####\s+(.+)$/gm, '<h4 class="text-base font-semibold mt-3 mb-1">$1</h4>');
  s = s.replace(/^###\s+(.+)$/gm, '<h3 class="text-lg font-semibold mt-4 mb-1">$1</h3>');
  s = s.replace(/^##\s+(.+)$/gm, '<h2 class="text-xl font-bold mt-4 mb-2 text-wolf-400">$1</h2>');
  s = s.replace(/^#\s+(.+)$/gm, '<h1 class="text-2xl font-bold mt-4 mb-2 text-wolf-400">$1</h1>');

  // 粗体
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong class="text-wolf-300">$1</strong>');

  // 行内代码
  s = s.replace(/`([^`]+)`/g, '<code class="bg-zinc-800 px-1 rounded text-xs">$1</code>');

  // 有序列表（连续多行）
  s = s.replace(/(?:^|\n)((?:\s*\d+\.\s+.+(?:\n|$))+)/g, (m, g) => {
    const items = g.trim().split('\n').map((l) => l.replace(/^\s*\d+\.\s+/, ''));
    return '\n<ol class="list-decimal pl-6 my-1">' + items.map((i) => `<li>${i}</li>`).join('') + '</ol>';
  });

  // 无序列表
  s = s.replace(/(?:^|\n)((?:\s*[-•]\s+.+(?:\n|$))+)/g, (m, g) => {
    const items = g.trim().split('\n').map((l) => l.replace(/^\s*[-•]\s+/, ''));
    return '\n<ul class="list-disc pl-6 my-1">' + items.map((i) => `<li>${i}</li>`).join('') + '</ul>';
  });

  // 引用块
  s = s.replace(/^&gt;\s?(.+)$/gm, '<blockquote class="border-l-2 border-zinc-600 pl-3 text-zinc-400 italic my-1">$1</blockquote>');

  // 段落（连续空行 -> 段落分隔；剩余单行）
  s = s.replace(/\n{2,}/g, '\n\n');
  s = s.split('\n\n').map((p) => {
    if (/^\s*<(h\d|ul|ol|pre|blockquote|table)/.test(p)) return p;
    return `<p class="my-1 leading-relaxed">${p.replace(/\n/g, '<br/>')}</p>`;
  }).join('\n');

  return s;
}
