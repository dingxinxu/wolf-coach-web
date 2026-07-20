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

// ========== KV 加密 / 访问码哈希 ==========

/**
 * AES-GCM 加密 apiKey。密钥从 KV_ENC_KEY secret（base64）派生。
 * 返回 base64(iv + ciphertext)，存入 KV。
 */
async function encryptApiKey(plain, env) {
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
async function decryptApiKey(cipher, env) {
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
async function hashAccessCode(code) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
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

/** 生成 8 位访问码（去易混淆字符）。 */
function generateAccessCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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
async function resolveLLMConfig(env, body) {
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
      return corsResponse(new Response(null, { status: 204 }));
    }

    // 健康检查
    if (url.pathname === '/' || url.pathname === '/api/health') {
      return corsResponse(json({ ok: true, ts: Date.now() }));
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

    return corsResponse(json({ error: 'Not Found', path: url.pathname }, 404));
  },
};

// ========== /api/chat 处理 ==========

async function handleChat(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return corsResponse(json({ error: 'Invalid JSON' }, 400));
  }

  const { messages: userMessages, stream = false } = body;
  if (!Array.isArray(userMessages) || userMessages.length === 0) {
    return corsResponse(json({ error: 'messages required' }, 400));
  }

  // 用户没自带 apiKey 时，校验访问码（防共享池被白嫖）
  if (!body?.llm?.apiKey) {
    const guard = await requireAccessCode(request, env);
    if (guard) return guard;
  }

  // 解析最终配置
  const cfg = await resolveLLMConfig(env, body);
  if (!cfg) {
    return corsResponse(
      json(
        {
          error: 'no_api_key',
          detail: '请在设置页填入自己的 API Key，或联系管理员配置共享 Key 池。',
        },
        401
      )
    );
  }

  // 注入技能文档作为 system prompt（首条）
  const skillBundle = await loadSkillBundle(env);
  const systemPrompt = buildSystemPrompt(skillBundle);
  const finalMessages = [{ role: 'system', content: systemPrompt }, ...userMessages];

  try {
    const upstream = await callLLM({
      ...cfg,
      messages: finalMessages,
      stream,
    });

    if (!upstream.ok) {
      const txt = await upstream.text();
      return corsResponse(
        json({ error: 'upstream_error', status: upstream.status, detail: txt }, 502)
      );
    }

    // 流式：透传 SSE
    if (stream) {
      return corsResponse(
        new Response(upstream.body, {
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
    return corsResponse(json({ ...data, _keySource: cfg.source }));
  } catch (e) {
    return corsResponse(json({ error: 'fetch_failed', detail: String(e) }, 502));
  }
}

// ========== /api/verify-code 处理 ==========

/**
 * 验证访问码有效性。无需鉴权（公开端点，仅查访问码是否存在于 KV 且 enabled）。
 */
async function handleVerifyCode(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return corsResponse(json({ valid: false }, 400));
  }
  const { accessCode } = body;
  if (!accessCode) return corsResponse(json({ valid: false }));
  const codeHash = await hashAccessCode(accessCode);
  const entry = await env.LLM_POOL?.get(`code:${codeHash}`, { type: 'json' });
  return corsResponse(json({ valid: !!entry && !!entry.enabled }));
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
    return corsResponse(json({ error: 'Invalid JSON' }, 400));
  }

  const { audio, mimeType, stt: userSTT } = body;
  if (!audio || !mimeType) {
    return corsResponse(json({ error: 'audio (base64) and mimeType required' }, 400));
  }

  // 用户没自带 stt.apiKey 时，校验访问码
  if (!body?.stt?.apiKey) {
    const guard = await requireAccessCode(request, env);
    if (guard) return guard;
  }

  const cfg = await resolveSTTConfig(env, body);
  if (!cfg) {
    return corsResponse(
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
    return corsResponse(json({ error: 'audio_decode_failed', detail: String(e) }, 400));
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
      return corsResponse(
        json({ error: 'stt_upstream_error', status: upstream.status, detail: txt }, 502)
      );
    }

    const data = await upstream.json();
    return corsResponse(json({ text: data.text || '', _keySource: cfg.source }));
  } catch (e) {
    return corsResponse(json({ error: 'stt_fetch_failed', detail: String(e) }, 502));
  }
}

// ========== /admin/api/* 处理 ==========

/**
 * admin 鉴权：X-Admin-Key 头比对 Worker secret ADMIN_PASSWORD。
 * 前端 admin 页面输入密码后存 localStorage，每次请求带 X-Admin-Key 头。
 */
function requireAdmin(request, env) {
  const key = request.headers.get('X-Admin-Key');
  if (!key || key !== env.ADMIN_PASSWORD) {
    return corsResponse(json({ error: 'unauthorized', detail: 'admin key required' }, 401));
  }
  return null;
}

/**
 * 访问码校验：用户没自带 apiKey（想用共享池）时，要求有效 X-Access-Code 头。
 * 返回 null 表示通过，返回 Response 表示拒绝。
 */
async function requireAccessCode(request, env) {
  const accessCode = request.headers.get('X-Access-Code');
  if (!accessCode) {
    return corsResponse(json({ error: 'access_code_required', detail: '使用共享池需要访问码' }, 403));
  }
  const codeHash = await hashAccessCode(accessCode);
  const entry = await env.LLM_POOL?.get(`code:${codeHash}`, { type: 'json' });
  if (!entry || !entry.enabled) {
    return corsResponse(json({ error: 'invalid_access_code' }, 403));
  }
  return null;
}

async function handleAdmin(request, env, pathname) {
  const guard = requireAdmin(request, env);
  if (guard) return guard;

  // GET /admin/api/config -- 读 LLM 配置（脱敏，apiKey 解密后 mask）
  if (pathname === '/admin/api/config' && request.method === 'GET') {
    const active = await env.LLM_POOL?.get('active', { type: 'json' });
    if (!active) return corsResponse(json({ active: null }));
    const plainKey = await decryptApiKey(active.apiKey, env);
    const { apiKey, ...safe } = active;
    return corsResponse(
      json({ active: { ...safe, hasKey: !!plainKey, apiKeyMasked: maskKey(plainKey) } })
    );
  }

  // PUT /admin/api/config -- 写 LLM 配置（apiKey AES-GCM 加密存）
  if (pathname === '/admin/api/config' && request.method === 'PUT') {
    const body = await request.json();
    const { baseUrl, model, reasoning, apiKey } = body;
    if (!baseUrl || !model) {
      return corsResponse(json({ error: 'baseUrl and model required' }, 400));
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
    return corsResponse(json({ ok: true, hasKey: !!storedApiKey }));
  }

  // ===== STT (Whisper) 共享池 =====

  // GET /admin/api/stt -- 读 STT 配置（脱敏，apiKey 解密后 mask）
  if (pathname === '/admin/api/stt' && request.method === 'GET') {
    const active = await env.LLM_POOL?.get('active_stt', { type: 'json' });
    if (!active) return corsResponse(json({ active: null }));
    const plainKey = await decryptApiKey(active.apiKey, env);
    const { apiKey, ...safe } = active;
    return corsResponse(
      json({ active: { ...safe, hasKey: !!plainKey, apiKeyMasked: maskKey(plainKey) } })
    );
  }

  // PUT /admin/api/stt -- 写 STT 配置（apiKey AES-GCM 加密存）
  if (pathname === '/admin/api/stt' && request.method === 'PUT') {
    const body = await request.json();
    const { baseUrl, model, apiKey } = body;
    if (!baseUrl || !model) {
      return corsResponse(json({ error: 'baseUrl and model required' }, 400));
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
    return corsResponse(json({ ok: true, hasKey: !!storedApiKey }));
  }

  // ===== 访问码管理 =====

  // POST /admin/api/codes -- 批量生成访问码（原码只此一次返回）
  if (pathname === '/admin/api/codes' && request.method === 'POST') {
    const body = await request.json();
    const count = Math.min(body?.count || 5, 50);
    const note = body?.note || '';
    const codes = [];
    for (let i = 0; i < count; i++) {
      const code = generateAccessCode();
      const hash = await hashAccessCode(code);
      const entry = { note, createdAt: Date.now(), enabled: true };
      await env.LLM_POOL?.put(`code:${hash}`, JSON.stringify(entry));
      codes.push({ code, hash, note, createdAt: entry.createdAt });
    }
    return corsResponse(json({ codes }));
  }

  // GET /admin/api/codes -- 列出所有访问码（不含原码）
  if (pathname === '/admin/api/codes' && request.method === 'GET') {
    const list = await env.LLM_POOL?.list({ prefix: 'code:' });
    const codes = [];
    for (const k of list?.keys || []) {
      const v = await env.LLM_POOL?.get(k.name, { type: 'json' });
      if (v) codes.push({ hash: k.name.replace('code:', ''), ...v });
    }
    return corsResponse(json({ codes }));
  }

  // DELETE /admin/api/codes/:hash -- 撤销访问码
  if (pathname.startsWith('/admin/api/codes/') && request.method === 'DELETE') {
    const hash = pathname.replace('/admin/api/codes/', '');
    const entry = await env.LLM_POOL?.get(`code:${hash}`, { type: 'json' });
    if (!entry) return corsResponse(json({ error: 'not_found' }, 404));
    entry.enabled = false;
    await env.LLM_POOL?.put(`code:${hash}`, JSON.stringify(entry));
    return corsResponse(json({ ok: true }));
  }

  return corsResponse(json({ error: 'Not Found' }, 404));
}

function maskKey(k) {
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

function corsResponse(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return res;
}
