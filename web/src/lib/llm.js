/**
 * LLM 调用工具：调用 Worker，处理流式响应。
 *
 * Worker URL 由 settings 决定：默认相对路径（同 origin / Vite proxy）。
 *
 * 流式：使用 SSE，逐 token 透传到回调。
 *
 * 错误处理：
 *   - 上游 SSE 错误事件（data: {"error":...}）抛出并携带 status/错误码
 *   - 网络中断抛错时标记 partial，调用方应显示"内容不完整"
 *   - 30s 无 chunk 视为超时（Worker 卡死/网络挂起）
 */
import { settings, buildLLMForRequest, workerBase, isLLMReady } from '../stores/settings.js';
import { access } from '../stores/access.js';
import { buildAuthHeaders } from './request.js';

const STALL_TIMEOUT_MS = 30_000; // 30s 无新 chunk 视为超时

/**
 * HTTP 状态码 + 上游错误类型 -> 友好提示。
 */
export function mapUpstreamError(status, detail) {
  if (status === 401) return 'API Key 失效或余额不足，请到【设置】检查或联系管理员。';
  if (status === 403) {
    if (detail?.includes('access_code_required')) return '需要访问码才能使用共享池，请在顶部输入。';
    if (detail?.includes('invalid_access_code')) return '访问码无效或已撤销。';
    if (detail?.includes('access_code_expired')) return '访问码已过期，请联系管理员。';
    return '访问被拒绝。';
  }
  if (status === 429) return '请求过快或今日用量已达上限，请稍后再试。';
  if (status === 502) {
    if (detail?.includes('context_length')) return '上下文过长，请减少发言条数或开新局。';
    if (detail?.includes('upstream_error')) return '上游 LLM 服务异常，建议换模型或稍后重试。';
    return '上游服务异常，请稍后重试。';
  }
  return `上游错误 ${status}${detail ? ': ' + detail : ''}`;
}

/**
 * 调用教练。
 * @param {Array<{role, content}>} messages  对话历史
 * @param {(chunk: string, full: string) => void} onChunk  流式回调（增量, 累积）
 * @param {AbortSignal} signal  可选，取消信号
 * @returns {Promise<{full: string, keySource: string, partial: boolean, error?: string}>}
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

  const headers = buildAuthHeaders(settings.keyMode, access.accessCode);

  // 超时控制：30s 无新 chunk 触发 abort
  const timeoutAbort = new AbortController();
  let stallTimer = null;
  const resetStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      timeoutAbort.abort(new Error('stream_stall_timeout'));
    }, STALL_TIMEOUT_MS);
  };
  // 用户外部取消信号
  if (signal) {
    if (signal.aborted) timeoutAbort.abort(signal.reason);
    else signal.addEventListener('abort', () => timeoutAbort.abort(signal.reason), { once: true });
  }

  let resp;
  resetStall();
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: timeoutAbort.signal,
    });
  } catch (e) {
    if (stallTimer) clearTimeout(stallTimer);
    throw new Error(e.name === 'AbortError' ? '请求已取消' : `网络错误：${e.message}`);
  }

  if (!resp.ok) {
    if (stallTimer) clearTimeout(stallTimer);
    let detail = '';
    try {
      const j = await resp.json();
      detail = j.detail || j.error || '';
    } catch {}
    throw new Error(mapUpstreamError(resp.status, detail));
  }

  // 解析 SSE 流
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  let keySource = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetStall(); // 收到 chunk，重置 stall 计时
      buf += decoder.decode(value, { stream: true });

      // SSE 块以空行分隔
      const blocks = buf.split('\n\n');
      buf = blocks.pop();

      for (const block of blocks) {
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let obj;
          try {
            obj = JSON.parse(data);
          } catch {
            // 解析失败：上游可能发了非标准错误事件，记 console 不静默吞
            console.warn('[chatWithCoach] SSE 行解析失败：', data);
            continue;
          }
          // 上游错误事件（OpenAI 兼容：data: {"error":{...}}）
          if (obj.error) {
            const msg = obj.error.message || obj.error.detail || JSON.stringify(obj.error);
            const err = new Error(`上游错误：${msg}`);
            err.upstreamError = true;
            throw err;
          }
          // OpenAI 兼容格式
          const delta = obj.choices?.[0]?.delta?.content || '';
          if (delta) {
            full += delta;
            onChunk?.(delta, full);
          }
          if (obj._keySource) keySource = obj._keySource;
        }
      }
    }
  } catch (e) {
    // 已收到部分内容 -> 标记 partial，让调用方决定如何处理
    const partial = full.length > 0;

    if (e.message === 'stream_stall_timeout') {
      // 超时不抛错，让调用方拿到 partial 内容 + partial=true
      return { full, keySource, partial: true, error: '流式响应 30s 无新内容（超时）' };
    }
    if (e.name === 'AbortError') {
      // 用户取消：保留 partial 内容
      return { full, keySource, partial };
    }
    // 上游错误事件（throw 出来的）
    if (partial) {
      console.warn('[chatWithCoach] 上游错误但已有 partial 内容：', e.message);
      return { full, keySource, partial: true, error: e.message };
    }
    throw e;
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }

  return { full, keySource, partial: false };
}
