/**
 * Worker 入口：狼人杀教练 LLM 代理
 *
 * 职责：
 *   1. 暴露 /api/chat —— 接收前端构造的对话历史，注入技能文档为 system prompt，转发到 LLM。
 *   2. 暴露 /api/health —— 简单健康检查。
 *   3. 暴露 /admin/api/* —— 管理员维护 LLM 配置池（受 CF Access 保护）。
 *
 * Key 优先级（Q13/14 决策）：
 *   ① request body 中 userLLM.apiKey（用户自带 Key，存浏览器 localStorage）
 *   ② KV LLM_POOL 中 active 配置（管理员维护）
 *   ③ Worker Secret DEFAULT_LLM_API_KEY + vars DEFAULT_LLM_*（兜底）
 *
 * 接口格式统一为 OpenAI Chat Completions（Q12 决策）。
 */

import { loadSkillBundle, buildSystemPrompt } from './skill-loader.js';

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

  // ② 管理员池（KV）
  try {
    const active = await env.LLM_POOL?.get('active', { type: 'json' });
    if (active?.apiKey) {
      return {
        baseUrl: active.baseUrl || env.DEFAULT_LLM_BASE_URL,
        model: active.model || env.DEFAULT_LLM_MODEL,
        reasoning: active.reasoning || env.DEFAULT_LLM_REASONING,
        apiKey: active.apiKey,
        source: 'admin-pool',
      };
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
      return {
        baseUrl: active.baseUrl || env.DEFAULT_STT_BASE_URL,
        model: active.model || env.DEFAULT_STT_MODEL,
        apiKey: active.apiKey,
        source: 'admin-pool',
      };
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
 * CF Access 保护：部署时给 /admin/* 配 Cloudflare Access 应用（邮箱 OTP 或 Google 登录）。
 * Worker 这里做轻校验：检查 Cf-Access-Jwt-Assertion 头存在即可，签名验证交给 CF 边缘。
 */
function requireAccess(request) {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) {
    return corsResponse(json({ error: 'unauthorized', detail: 'CF Access required' }, 401));
  }
  return null;
}

async function handleAdmin(request, env, pathname) {
  const guard = requireAccess(request);
  if (guard) return guard;

  // GET /admin/api/config —— 读当前激活配置（脱敏，不返回 apiKey）
  if (pathname === '/admin/api/config' && request.method === 'GET') {
    const active = await env.LLM_POOL?.get('active', { type: 'json' });
    if (!active) return corsResponse(json({ active: null }));
    const { apiKey, ...safe } = active;
    return corsResponse(
      json({ active: { ...safe, hasKey: !!apiKey, apiKeyMasked: maskKey(apiKey) } })
    );
  }

  // PUT /admin/api/config —— 写当前激活配置
  if (pathname === '/admin/api/config' && request.method === 'PUT') {
    const body = await request.json();
    const { baseUrl, model, reasoning, apiKey } = body;
    if (!baseUrl || !model) {
      return corsResponse(json({ error: 'baseUrl and model required' }, 400));
    }
    // 如果未传 apiKey，保留旧的
    const prev = (await env.LLM_POOL?.get('active', { type: 'json' })) || {};
    const next = {
      baseUrl,
      model,
      reasoning: reasoning || 'medium',
      apiKey: apiKey || prev.apiKey || '',
      updatedAt: Date.now(),
    };
    await env.LLM_POOL?.put('active', JSON.stringify(next));
    return corsResponse(
      json({ ok: true, hasKey: !!next.apiKey, apiKeyMasked: maskKey(next.apiKey) })
    );
  }

  // ===== STT (Whisper) 共享池 =====

  // GET /admin/api/stt
  if (pathname === '/admin/api/stt' && request.method === 'GET') {
    const active = await env.LLM_POOL?.get('active_stt', { type: 'json' });
    if (!active) return corsResponse(json({ active: null }));
    const { apiKey, ...safe } = active;
    return corsResponse(
      json({ active: { ...safe, hasKey: !!apiKey, apiKeyMasked: maskKey(apiKey) } })
    );
  }

  // PUT /admin/api/stt
  if (pathname === '/admin/api/stt' && request.method === 'PUT') {
    const body = await request.json();
    const { baseUrl, model, apiKey } = body;
    if (!baseUrl || !model) {
      return corsResponse(json({ error: 'baseUrl and model required' }, 400));
    }
    const prev = (await env.LLM_POOL?.get('active_stt', { type: 'json' })) || {};
    const next = {
      baseUrl,
      model,
      apiKey: apiKey || prev.apiKey || '',
      updatedAt: Date.now(),
    };
    await env.LLM_POOL?.put('active_stt', JSON.stringify(next));
    return corsResponse(
      json({ ok: true, hasKey: !!next.apiKey, apiKeyMasked: maskKey(next.apiKey) })
    );
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
