/**
 * Worker 入口：狼人杀教练 LLM 代理
 *
 * 职责：
 *   1. 暴露 /api/chat -- 接收前端构造的对话历史，注入技能文档为 system prompt，转发到 LLM。
 *   2. 暴露 /api/health -- 简单健康检查。
 *   3. 暴露 /admin/api/* -- 管理员维护 LLM/STT 配置池 + 访问码（X-Admin-Key 密码鉴权）。
 *
 * 访问码机制（游客 vs 持码用户）：
 *   - 游客：自带 apiKey 可用 /api/chat；想用共享池需有效 X-Access-Code 头
 *   - 持码用户：X-Access-Code 通过校验后可用 admin-pool 共享池
 *
 * Key 优先级：
 *   ① request body 中 userLLM.apiKey（用户自带 Key，存浏览器 localStorage）
 *   ② KV LLM_POOL 中 active 配置（管理员维护，apiKey AES-GCM 加密存）
 *   ③ Worker Secret DEFAULT_LLM_API_KEY + vars DEFAULT_LLM_*（兜底）
 *
 * 接口格式统一为 OpenAI Chat Completions。
 */

import { loadSkillBundle, buildSystemPrompt } from './skill-loader.js';

// ========== 常量 ==========
// 注意：Cloudflare Workers runtime 会扫描顶层 export，期望它们是 function 或 ExportedHandler。
// 纯值（number/string）的顶层 export 会触发 "Incorrect type for map entry" 启动错误。
// 因此这里的常量保持模块内私有，不 export；测试通过行为间接验证。

// C3：单次请求 input 字符上限（system + user 合计）。
// system prompt ~32K + user 侧 ~28K = 60K 字符 ≈ 15K tokens user，防超大 message 烧账单。
export const MAX_INPUT_CHARS = 60000;

// D1：admin 登录失败限流。连续失败 5 次锁 10 分钟。
export const ADMIN_FAIL_LIMIT = 5;
export const ADMIN_LOCK_MS = 10 * 60 * 1000;

// P1-7：verify-code 公开端点 IP 日限，防高频枚举访问码（非原子，半公开场景够用）
export const VERIFY_DAILY_LIMIT = 50;

// P1-9：SSE 透传 stall 超时（与前端 llm.js STALL_MS 一致），上游无 chunk 超此时长则注入 error
export const SSE_STALL_MS = 30000;

/**
 * C3：检查 messages 总长度是否超阈值（纯函数，供 handleChat 和测试共用）。
 * @param {Array<{content?: string}>} messages
 * @returns {{ tooLarge: boolean, length: number, limit: number }}
 */
export function checkInputSize(messages) {
  const length = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  return { tooLarge: length > MAX_INPUT_CHARS, length, limit: MAX_INPUT_CHARS };
}

// ========== KV 加密 / 访问码哈希 ==========

/**
 * AES-GCM 加密 apiKey。密钥从 KV_ENC_KEY secret（base64）派生。
 * 返回 base64(iv + ciphertext)，存入 KV。
 */
export async function encryptApiKey(plain, env) {
  if (!plain) return '';
  const keyRaw = base64ToBytes(env.KV_ENC_KEY);
  const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.length);
  return bytesToBase64(combined);
}

/**
 * AES-GCM 解密 apiKey。
 */
export async function decryptApiKey(cipher, env) {
  if (!cipher) return '';
  try {
    const keyRaw = base64ToBytes(env.KV_ENC_KEY);
    const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['decrypt']);
    const combined = base64ToBytes(cipher);
    const iv = combined.slice(0, 12);
    const ct = combined.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch (e) {
    console.warn('apiKey 解密失败', e);
    return '';
  }
}

/** SHA-256 哈希访问码，返回 hex。 */
export async function hashAccessCode(code) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 常量时间字符串比较（P1-8）：两侧 SHA-256 后比较 hex（长度固定 64，无早退），
 * 消除 admin 密码 === 比较的理论时序面。任一为空直接返回 false。
 */
export async function constantTimeEqual(a, b) {
  if (!a || !b) return false;
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(a)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(b)),
  ]);
  const toHex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return toHex(ha) === toHex(hb);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** 生成 8 位访问码（去易混淆字符 0/O/I/1/L）。 */
export function generateAccessCode() {
  const chars = 'ABCDEFGJKMNPQRSTUVWXYZ23456789';
  let code = '';
  const arr = crypto.getRandomValues(new Uint8Array(8));
  for (let i = 0; i < 8; i++) code += chars[arr[i] % chars.length];
  return code;
}

// ========== 配置解析 ==========

/**
 * 解析前端传入的 LLM 配置，确定最终调用参数与 Key。
 * 返回 { baseUrl, model, reasoning, apiKey, source } 或 null
 */
export async function resolveLLMConfig(env, body) {
  // ① 用户自带
  const userLLM = body?.llm;
  if (userLLM?.apiKey) {
    return {
      baseUrl: userLLM.baseUrl || env.DEFAULT_LLM_BASE_URL,
      model: userLLM.model || env.DEFAULT_LLM_MODEL,
      reasoning: userLLM.reasoning || env.DEFAULT_LLM_REASONING,
      apiKey: userLLM.apiKey,
      source: 'user',
    };
  }

  // ② 管理员池（KV，apiKey AES-GCM 加密存）
  try {
    const active = await env.LLM_POOL?.get('active', { type: 'json' });
    if (active?.apiKey) {
      const plainKey = await decryptApiKey(active.apiKey, env);
      if (plainKey) {
        return {
          baseUrl: active.baseUrl || env.DEFAULT_LLM_BASE_URL,
          model: active.model || env.DEFAULT_LLM_MODEL,
          reasoning: active.reasoning || env.DEFAULT_LLM_REASONING,
          apiKey: plainKey,
          source: 'admin-pool',
        };
      }
    }
  } catch (e) {
    console.warn('KV 读取失败', e);
  }

  // ③ 兜底
  if (env.DEFAULT_LLM_API_KEY) {
    return {
      baseUrl: env.DEFAULT_LLM_BASE_URL,
      model: env.DEFAULT_LLM_MODEL,
      reasoning: env.DEFAULT_LLM_REASONING,
      apiKey: env.DEFAULT_LLM_API_KEY,
      source: 'fallback',
    };
  }

  return null;
}

// ========== OpenAI 兼容请求 ==========

/**
 * 调用 OpenAI 兼容接口，返回 Response（支持 stream）。
 *
 * reasoning 字段处理：
 *   - 'disabled' 时不带该字段（很多模型不支持）
 *   - 其他值原样传递为 reasoning_effort（OpenAI o 系列、DeepSeek-R1 等兼容）
 */
async function callLLM({ baseUrl, model, reasoning, apiKey, messages, stream }) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const payload = {
    model,
    messages,
    stream: !!stream,
    temperature: 0.7,
  };
  if (reasoning && reasoning !== 'disabled') {
    payload.reasoning_effort = reasoning;
  }

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
}

// ========== 路由 ==========

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS
    if (request.method === 'OPTIONS') {
      return cors(request, env, new Response(null, { status: 204 }));
    }

    // 健康检查
    if (url.pathname === '/' || url.pathname === '/api/health') {
      return cors(request, env, json({ ok: true, ts: Date.now() }));
    }

    // 教练对话主接口
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      return handleChat(request, env, ctx);
    }

    // 语音转写接口（Groq Whisper 透传）
    if (url.pathname === '/api/transcribe' && request.method === 'POST') {
      return handleTranscribe(request, env, ctx);
    }

    // 访问码验证（前端输码后调此端点验证有效性）
    if (url.pathname === '/api/verify-code' && request.method === 'POST') {
      return handleVerifyCode(request, env);
    }

    // 管理员：维护 LLM 池（受 CF Access 保护，部署时配置）
    if (url.pathname.startsWith('/admin/api/')) {
      return handleAdmin(request, env, url.pathname);
    }

    return cors(request, env, json({ error: 'Not Found', path: url.pathname }, 404));
  },
};

// ========== /api/chat 处理 ==========

async function handleChat(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return cors(request, env, json({ error: 'Invalid JSON' }, 400));
  }

  const { messages: userMessages, stream = false } = body;
  if (!Array.isArray(userMessages) || userMessages.length === 0) {
    return cors(request, env, json({ error: 'messages required' }, 400));
  }

  // WR-02：C3 input size 预检挪到访问码校验之前。
  // 先加载 system prompt 算总长度，超阈值直接拒绝——避免超大请求白扣用户每日配额。
  const skillBundle = await loadSkillBundle(env);
  const systemPrompt = buildSystemPrompt(skillBundle);
  const finalMessages = [{ role: 'system', content: systemPrompt }, ...userMessages];
  const sizeCheck = checkInputSize(finalMessages);
  if (sizeCheck.tooLarge) {
    return cors(
      request,
      env,
      json(
        {
          error: 'input_too_large',
          detail: `输入过长（${sizeCheck.length} 字符 > ${sizeCheck.limit}）。请减少发言条数或开新局。`,
          length: sizeCheck.length,
          limit: sizeCheck.limit,
        },
        400
      )
    );
  }

  // 用户没自带 apiKey 时，校验访问码（防共享池被白嫖）
  // 仅校验不计数；计数在 callLLM 上游 ok 后由 bumpUsage 执行，避免扣费却不服务
  let accessGuard = null;
  if (!body?.llm?.apiKey) {
    accessGuard = await validateAccessCode(request, env);
    if (!accessGuard.ok) return accessGuard.response;
  }

  // 解析最终配置（若池空且无 DEFAULT_LLM_API_KEY -> no_api_key，此时未计数，不扣额度）
  const cfg = await resolveLLMConfig(env, body);
  if (!cfg) {
    return cors(request, env,
      json(
        {
          error: 'no_api_key',
          detail: '请在设置页填入自己的 API Key，或联系管理员配置共享 Key 池。',
        },
        401
      )
    );
  }

  // Prompt cache 稳定性日志（P1-7）：固定 system prompt 才能命中 DeepSeek/OpenAI prompt cache
  // 哈希应跨请求一致；若哈希变化说明 system prompt 被无意修改，cache 失效
  if (typeof console !== 'undefined' && console.debug) {
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(systemPrompt));
    const hashHex = [...new Uint8Array(hashBuf)].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
    console.debug(`[chat] system_prompt len=${systemPrompt.length} hash=${hashHex} cache_stable=yes`);
  }

  try {
    const upstream = await callLLM({
      ...cfg,
      messages: finalMessages,
      stream,
    });

    if (!upstream.ok) {
      const txt = await upstream.text();
      return cors(request, env,
        json({ error: 'upstream_error', status: upstream.status, detail: txt }, 502)
      );
    }

    // 上游 ok，此时才扣访问码额度（P0-2：避免扣费却不服务）
    if (accessGuard) await bumpUsage(accessGuard.codeHash, accessGuard.entry, env);

    // 流式：透传 SSE（P1-9：TransformStream 包裹，30s 无 chunk 注入 error 后关闭，防上游挂起耗 Worker）
    if (stream) {
      const encoder = new TextEncoder();
      let stallTimer = null;
      let streamController = null;
      const clearStall = () => { if (stallTimer) clearTimeout(stallTimer); stallTimer = null; };
      const resetStall = () => {
        clearStall();
        stallTimer = setTimeout(() => {
          // 超时：注入 SSE error 事件并关闭流
          try {
            streamController?.enqueue(encoder.encode(`data:{"error":"upstream_stall","detail":"上游 ${SSE_STALL_MS / 1000}s 无响应"}\n\n`));
            streamController?.close();
          } catch { /* 流已关闭，忽略 */ }
        }, SSE_STALL_MS);
      };
      const { readable, writable } = new TransformStream({
        start(controller) { streamController = controller; resetStall(); },
        transform(chunk, controller) { resetStall(); controller.enqueue(chunk); },
        flush() { clearStall(); },
        cancel() { clearStall(); },
      });
      // pipeTo 异步执行，不阻塞响应返回；upstream 中断/完成时清理 timer
      upstream.body.pipeTo(writable).catch(clearStall).finally(clearStall);
      return cors(request, env,
        new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          },
        })
      );
    }

    // 非流式：解析并标注 source（前端用于显示 Key 来源）
    const data = await upstream.json();
    return cors(request, env, json({ ...data, _keySource: cfg.source }));
  } catch (e) {
    return cors(request, env, json({ error: 'fetch_failed', detail: String(e) }, 502));
  }
}

// ========== /api/verify-code 处理 ==========

/**
 * 验证访问码有效性。无需鉴权（公开端点，仅查访问码是否存在于 KV 且 enabled 且未过期）。
 *
 * P1-7：按 CF-Connecting-IP 每日限流（VERIFY_DAILY_LIMIT），防高频枚举探测码。
 * 计数非原子（read-modify-write），半公开场景作"业余枚举防御"够用。
 */
async function handleVerifyCode(request, env) {
  // IP 日限检查
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const today = new Date().toISOString().slice(0, 10);
  const vkey = `verify_count:${ip}`;
  let vc = await env.LLM_POOL?.get(vkey, { type: 'json' }).catch(() => null);
  if (!vc || vc.day !== today) vc = { day: today, count: 0 };
  if (vc.count >= VERIFY_DAILY_LIMIT) {
    return cors(request, env, json({ error: 'rate_limit_exceeded', detail: '验证请求过多，请明日再试', limit: VERIFY_DAILY_LIMIT }, 429));
  }
  vc.count += 1;
  await env.LLM_POOL?.put(vkey, JSON.stringify(vc)).catch(() => {});

  let body;
  try {
    body = await request.json();
  } catch {
    return cors(request, env, json({ valid: false }, 400));
  }
  const { accessCode } = body;
  if (!accessCode) return cors(request, env, json({ valid: false }));
  const codeHash = await hashAccessCode(accessCode);
  const entry = await env.LLM_POOL?.get(`code:${codeHash}`, { type: 'json' });
  const valid = !!entry && !!entry.enabled && !(entry.expiresAt && Date.now() > entry.expiresAt);
  return cors(request, env, json({ valid }));
}

// ========== /api/transcribe 处理 ==========

/**
 * STT 配置解析。优先级同 LLM：
 *   ① request body 中 stt.apiKey（用户自带）
 *   ② KV LLM_POOL.active_stt（管理员维护）
 *   ③ Worker Secret DEFAULT_STT_API_KEY + vars DEFAULT_STT_*
 */
async function resolveSTTConfig(env, body) {
  const userSTT = body?.stt;
  if (userSTT?.apiKey) {
    return {
      baseUrl: userSTT.baseUrl || env.DEFAULT_STT_BASE_URL,
      model: userSTT.model || env.DEFAULT_STT_MODEL,
      apiKey: userSTT.apiKey,
      source: 'user',
    };
  }
  try {
    const active = await env.LLM_POOL?.get('active_stt', { type: 'json' });
    if (active?.apiKey) {
      const plainKey = await decryptApiKey(active.apiKey, env);
      if (plainKey) {
        return {
          baseUrl: active.baseUrl || env.DEFAULT_STT_BASE_URL,
          model: active.model || env.DEFAULT_STT_MODEL,
          apiKey: plainKey,
          source: 'admin-pool',
        };
      }
    }
  } catch (e) {
    console.warn('STT KV 读取失败', e);
  }
  if (env.DEFAULT_STT_API_KEY) {
    return {
      baseUrl: env.DEFAULT_STT_BASE_URL,
      model: env.DEFAULT_STT_MODEL,
      apiKey: env.DEFAULT_STT_API_KEY,
      source: 'fallback',
    };
  }
  return null;
}

async function handleTranscribe(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return cors(request, env, json({ error: 'Invalid JSON' }, 400));
  }

  const { audio, mimeType, stt: userSTT } = body;
  if (!audio || !mimeType) {
    return cors(request, env, json({ error: 'audio (base64) and mimeType required' }, 400));
  }

  // 用户没自带 stt.apiKey 时，校验访问码（仅校验，计数推迟到上游 ok 后）
  let accessGuard = null;
  if (!body?.stt?.apiKey) {
    accessGuard = await validateAccessCode(request, env);
    if (!accessGuard.ok) return accessGuard.response;
  }

  const cfg = await resolveSTTConfig(env, body);
  if (!cfg) {
    return cors(request, env, 
      json(
        {
          error: 'no_stt_key',
          detail: '请在设置页填入 STT API Key（Groq），或联系管理员配置共享池。',
        },
        401
      )
    );
  }

  // base64 → Blob
  let audioBlob;
  try {
    const binary = atob(audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    audioBlob = new Blob([bytes], { type: mimeType });
  } catch (e) {
    return cors(request, env, json({ error: 'audio_decode_failed', detail: String(e) }, 400));
  }

  // multipart/form-data
  const form = new FormData();
  form.append('file', audioBlob, `audio.${(mimeType.split('/')[1] || 'webm').split(';')[0]}`);
  form.append('model', cfg.model);
  form.append('language', 'zh'); // 强制中文，避免误判英文
  form.append('response_format', 'json');
  // 大模型一般自带标点；temperature=0 提高一致性
  form.append('temperature', '0');

  const url = `${cfg.baseUrl.replace(/\/$/, '')}/audio/transcriptions`;
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
    });

    if (!upstream.ok) {
      const txt = await upstream.text();
      return cors(request, env,
        json({ error: 'stt_upstream_error', status: upstream.status, detail: txt }, 502)
      );
    }

    // 上游 ok，此时才扣访问码额度（P0-2：避免扣费却不服务）
    if (accessGuard) await bumpUsage(accessGuard.codeHash, accessGuard.entry, env);

    const data = await upstream.json();
    return cors(request, env, json({ text: data.text || '', _keySource: cfg.source }));
  } catch (e) {
    return cors(request, env, json({ error: 'stt_fetch_failed', detail: String(e) }, 502));
  }
}

// ========== /admin/api/* 处理 ==========

/**
 * admin 鉴权：X-Admin-Key 头比对 Worker secret ADMIN_PASSWORD。
 * 前端 admin 页面输入密码后存 localStorage，每次请求带 X-Admin-Key 头。
 *
 * D1：连续失败 5 次锁 10 分钟（按 CF-Connecting-IP）。防在线字典爆破。
 */
export async function requireAdmin(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // 先查是否已被锁
  const failEntry = await env.LLM_POOL?.get(`admin_fails:${ip}`, { type: 'json' }).catch(() => null);
  if (failEntry && failEntry.lockedUntil && Date.now() < failEntry.lockedUntil) {
    const remainMin = Math.ceil((failEntry.lockedUntil - Date.now()) / 60000);
    return cors(
      request,
      env,
      json(
        { error: 'admin_locked', detail: `登录失败次数过多，请 ${remainMin} 分钟后再试` },
        429
      )
    );
  }

  const key = request.headers.get('X-Admin-Key');
  if (!(await constantTimeEqual(key, env.ADMIN_PASSWORD))) {
    // 记一次失败
    const count = (failEntry?.count || 0) + 1;
    const next = { count, lockedUntil: count >= ADMIN_FAIL_LIMIT ? Date.now() + ADMIN_LOCK_MS : 0 };
    await env.LLM_POOL?.put(`admin_fails:${ip}`, JSON.stringify(next)).catch(() => {});
    return cors(request, env, json({ error: 'unauthorized', detail: 'admin key required' }, 401));
  }

  // 成功 -> 清除失败计数
  if (failEntry) {
    await env.LLM_POOL?.delete(`admin_fails:${ip}`).catch(() => {});
  }
  return null;
}

/**
 * 访问码校验：用户没自带 apiKey（想用共享池）时，要求有效 X-Access-Code 头。
 * 同时维护每访问码每日用量计数，超出 dailyLimit 拒绝（防滥用烧钱）。
 * 返回 null 表示通过，返回 Response 表示拒绝。
 *
 * 失败原因码：
 *   - access_code_required: 未带访问码头
 *   - invalid_access_code: 码不存在或已撤销
 *   - access_code_expired: 码已过期（admin 设的 expiresAt）
 *   - rate_limit_exceeded: 今日用量达上限
 *
 * P0-2：拆成 validateAccessCode（只校验）+ bumpUsage（计数）。
 * 计数推迟到 resolveConfig 成功 + 上游 callLLM/callSTT 返回 ok 后执行，
 * 避免「池空/无 DEFAULT_KEY 或上游 502 时仍扣额度」。
 */
export async function validateAccessCode(request, env) {
  const accessCode = request.headers.get('X-Access-Code');
  if (!accessCode) {
    return { ok: false, response: cors(request, env, json({ error: 'access_code_required', detail: '使用共享池需要访问码' }, 403)) };
  }
  const codeHash = await hashAccessCode(accessCode);
  const entry = await env.LLM_POOL?.get(`code:${codeHash}`, { type: 'json' });
  if (!entry || !entry.enabled) {
    return { ok: false, response: cors(request, env, json({ error: 'invalid_access_code' }, 403)) };
  }

  // 管理员设的过期时间（0 或不存在 = 永久）
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    return { ok: false, response: cors(request, env, json({ error: 'access_code_expired', detail: '访问码已过期，请联系管理员' }, 403)) };
  }

  // 每日用量计数（按 UTC 日期重置）—— 仅校验是否超限，不自增
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (!entry.usage || entry.usage.day !== today) {
    entry.usage = { day: today, count: 0 };
  }
  const limit = entry.dailyLimit || 100; // 默认每日 100 次
  if (entry.usage.count >= limit) {
    return { ok: false, response: cors(request, env, json({ error: 'rate_limit_exceeded', detail: `今日用量已达上限 ${limit} 次`, limit, used: entry.usage.count }, 429)) };
  }
  return { ok: true, codeHash, entry };
}

/**
 * 访问码用量自增并写回 KV。在确认能提供服务（resolveConfig 成功 + 上游 ok）后调用。
 * 注：仍是 read-modify-write 非原子，并发下可能少计（已知 P1，需 Durable Object 彻底修）。
 */
export async function bumpUsage(codeHash, entry, env) {
  entry.usage.count += 1;
  await env.LLM_POOL?.put(`code:${codeHash}`, JSON.stringify(entry));
}

async function handleAdmin(request, env, pathname) {
  const guard = await requireAdmin(request, env);
  if (guard) return guard;

  // GET /admin/api/config -- 读 LLM 配置（脱敏，apiKey 解密后 mask）
  if (pathname === '/admin/api/config' && request.method === 'GET') {
    const active = await env.LLM_POOL?.get('active', { type: 'json' });
    if (!active) return cors(request, env, json({ active: null }));
    const plainKey = await decryptApiKey(active.apiKey, env);
    const { apiKey, ...safe } = active;
    return cors(request, env, 
      json({ active: { ...safe, hasKey: !!plainKey, apiKeyMasked: maskKey(plainKey) } })
    );
  }

  // PUT /admin/api/config -- 写 LLM 配置（apiKey AES-GCM 加密存）
  if (pathname === '/admin/api/config' && request.method === 'PUT') {
    const body = await request.json();
    const { baseUrl, model, reasoning, apiKey } = body;
    if (!baseUrl || !model) {
      return cors(request, env, json({ error: 'baseUrl and model required' }, 400));
    }
    const prev = (await env.LLM_POOL?.get('active', { type: 'json' })) || {};
    const storedApiKey = apiKey ? await encryptApiKey(apiKey, env) : (prev.apiKey || '');
    const next = {
      baseUrl,
      model,
      reasoning: reasoning || 'medium',
      apiKey: storedApiKey,
      updatedAt: Date.now(),
    };
    await env.LLM_POOL?.put('active', JSON.stringify(next));
    return cors(request, env, json({ ok: true, hasKey: !!storedApiKey }));
  }

  // ===== STT (Whisper) 共享池 =====

  // GET /admin/api/stt -- 读 STT 配置（脱敏，apiKey 解密后 mask）
  if (pathname === '/admin/api/stt' && request.method === 'GET') {
    const active = await env.LLM_POOL?.get('active_stt', { type: 'json' });
    if (!active) return cors(request, env, json({ active: null }));
    const plainKey = await decryptApiKey(active.apiKey, env);
    const { apiKey, ...safe } = active;
    return cors(request, env, 
      json({ active: { ...safe, hasKey: !!plainKey, apiKeyMasked: maskKey(plainKey) } })
    );
  }

  // PUT /admin/api/stt -- 写 STT 配置（apiKey AES-GCM 加密存）
  if (pathname === '/admin/api/stt' && request.method === 'PUT') {
    const body = await request.json();
    const { baseUrl, model, apiKey } = body;
    if (!baseUrl || !model) {
      return cors(request, env, json({ error: 'baseUrl and model required' }, 400));
    }
    const prev = (await env.LLM_POOL?.get('active_stt', { type: 'json' })) || {};
    const storedApiKey = apiKey ? await encryptApiKey(apiKey, env) : (prev.apiKey || '');
    const next = {
      baseUrl,
      model,
      apiKey: storedApiKey,
      updatedAt: Date.now(),
    };
    await env.LLM_POOL?.put('active_stt', JSON.stringify(next));
    return cors(request, env, json({ ok: true, hasKey: !!storedApiKey }));
  }

  // ===== 访问码管理 =====

  // POST /admin/api/codes -- 批量生成访问码（原码只此一次返回）
  if (pathname === '/admin/api/codes' && request.method === 'POST') {
    const body = await request.json();
    const count = Math.min(body?.count || 5, 50);
    const note = body?.note || '';
    // 每日调用上限：1-1000，默认 100（防滥用烧钱）
    const dailyLimit = Math.min(Math.max(Number(body?.dailyLimit) || 100, 1), 1000);
    // 有效期天数：0=永久，1-365，默认 30 天（防码长期泄漏）
    const expiresInDays = Math.min(Math.max(Number(body?.expiresInDays) ?? 30, 0), 365);
    const expiresAt = expiresInDays > 0 ? Date.now() + expiresInDays * 24 * 60 * 60 * 1000 : 0;
    const codes = [];
    for (let i = 0; i < count; i++) {
      const code = generateAccessCode();
      const hash = await hashAccessCode(code);
      const entry = { note, createdAt: Date.now(), enabled: true, dailyLimit, expiresAt };
      await env.LLM_POOL?.put(`code:${hash}`, JSON.stringify(entry));
      codes.push({ code, hash, note, createdAt: entry.createdAt, dailyLimit, expiresAt });
    }
    return cors(request, env, json({ codes }));
  }

  // GET /admin/api/codes -- 列出所有访问码（不含原码）
  if (pathname === '/admin/api/codes' && request.method === 'GET') {
    const list = await env.LLM_POOL?.list({ prefix: 'code:' });
    const codes = [];
    for (const k of list?.keys || []) {
      const v = await env.LLM_POOL?.get(k.name, { type: 'json' });
      if (v) codes.push({ hash: k.name.replace('code:', ''), ...v });
    }
    return cors(request, env, json({ codes }));
  }

  // DELETE /admin/api/codes/:hash -- 撤销访问码
  if (pathname.startsWith('/admin/api/codes/') && request.method === 'DELETE') {
    const hash = pathname.replace('/admin/api/codes/', '');
    const entry = await env.LLM_POOL?.get(`code:${hash}`, { type: 'json' });
    if (!entry) return cors(request, env, json({ error: 'not_found' }, 404));
    entry.enabled = false;
    await env.LLM_POOL?.put(`code:${hash}`, JSON.stringify(entry));
    return cors(request, env, json({ ok: true }));
  }

  return cors(request, env, json({ error: 'Not Found' }, 404));
}

export function maskKey(k) {
  if (!k) return '';
  if (k.length <= 8) return '*'.repeat(k.length);
  return k.slice(0, 4) + '****' + k.slice(-4);
}

// ========== 工具函数 ==========

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function cors(request, env, res) {
  // CORS 白名单：只对 env.ALLOWED_ORIGINS 内的 origin 返回 Access-Control-Allow-Origin
  // 同源请求（无 Origin 头）和不在白名单的 origin 都不设该头 -> 浏览器拒绝跨域读
  const origin = request.headers.get('Origin') || '';
  const allowed = (env?.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (origin && allowed.includes(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
  }
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key, X-Access-Code');
  return res;
}
