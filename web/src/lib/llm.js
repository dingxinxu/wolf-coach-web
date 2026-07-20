/**
 * LLM 调用工具：调用 Worker，处理流式响应。
 *
 * Worker URL 由 settings 决定：默认相对路径（同 origin / Vite proxy）。
 *
 * 流式：使用 SSE，逐 token 透传到回调。
 */
import { settings, buildLLMForRequest, workerBase, isLLMReady } from '../stores/settings.js';

/**
 * 调用教练。
 * @param {Array<{role, content}>} messages  对话历史
 * @param {(chunk: string, full: string) => void} onChunk  流式回调（增量, 累积）
 * @param {AbortSignal} signal  可选，取消信号
 * @returns {Promise<{full: string, keySource: string}>}
 */
export async function chatWithCoach(messages, { onChunk, signal } = {}) {
  if (!isLLMReady()) {
    throw new Error(
      '当前未配置 API Key。请到【设置】页填入自己的 API Key，或选择「使用管理员共享」。'
    );
  }

  const base = workerBase();
  const url = `${base}/api/chat`;

  const body = {
    messages,
    llm: buildLLMForRequest(),
    stream: true,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    let detail = '';
    try {
      const j = await resp.json();
      detail = j.detail || j.error || '';
    } catch {}
    if (resp.status === 401 && detail.includes('no_api_key')) {
      throw new Error('服务端未配置任何可用 Key。请联系管理员，或在设置页填入自己的 Key。');
    }
    throw new Error(`上游错误 ${resp.status}: ${detail}`);
  }

  // 解析 SSE 流
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  let keySource = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE 块以空行分隔
    const blocks = buf.split('\n\n');
    buf = blocks.pop();

    for (const block of blocks) {
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const obj = JSON.parse(data);
          // OpenAI 兼容格式
          const delta = obj.choices?.[0]?.delta?.content || '';
          if (delta) {
            full += delta;
            onChunk?.(delta, full);
          }
          if (obj._keySource) keySource = obj._keySource;
        } catch {
          // 忽略无法解析的行
        }
      }
    }
  }

  return { full, keySource };
}
