/**
 * 语音录制 + 转写工具。
 *
 * 浏览器 MediaRecorder 录音 → webm/opus → base64 → POST /api/transcribe
 *                                        ↓
 *                                   Worker → Groq Whisper → text
 *
 * 浏览器能力检查 + 单例 recorder + 时长上限 120s（Whisper API 上限）。
 */
import { settings, buildSTTForRequest, workerBase, isSTTReady } from '../stores/settings.js';
import { access } from '../stores/access.js';

const MAX_DURATION_MS = 120 * 1000;

/**
 * 检查浏览器是否支持录音。
 */
export function isRecordingSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

/**
 * 挑选浏览器支持的 mime type。
 * Safari 给 audio/mp4，Chrome 给 audio/webm;opus。
 */
function pickMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4', // Safari
    'audio/ogg;codecs=opus',
  ];
  for (const t of candidates) {
    if (window.MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

/**
 * 录音器（单例）。
 *
 * 用法：
 *   const rec = new Recorder();
 *   await rec.start();           // 申请麦克风权限并开始
 *   ...
 *   const { blob, mimeType, durationMs } = await rec.stop();
 */
export class Recorder {
  constructor() {
    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.startedAt = 0;
    this.mimeType = '';
    this._timer = null;
    this._onStop = null;
  }

  get recording() {
    return this.mediaRecorder?.state === 'recording';
  }

  async start() {
    if (this.recording) throw new Error('已在录音中');
    if (!isRecordingSupported()) {
      throw new Error('当前浏览器不支持录音（需要 MediaRecorder API）');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mimeType = pickMimeType();
    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType || undefined,
    });
    this.chunks = [];
    this.startedAt = Date.now();

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };

    return new Promise((resolve, reject) => {
      this._onStop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType });
        const durationMs = Date.now() - this.startedAt;
        resolve({ blob, mimeType: this.mimeType, durationMs });
      };
      this.mediaRecorder.onerror = (e) => reject(e.error || new Error('录音失败'));
      this.mediaRecorder.onstop = () => {
        // 关闭麦克风
        this.stream?.getTracks().forEach((t) => t.stop());
        this._onStop?.();
      };
      this.mediaRecorder.start();

      // 120s 安全上限：自动停
      this._timer = setTimeout(() => {
        if (this.recording) this.stop();
      }, MAX_DURATION_MS);
    });
  }

  stop() {
    if (!this.recording) return Promise.resolve(null);
    clearTimeout(this._timer);
    this._timer = null;
    return new Promise((resolve) => {
      this._onStop = resolve;
      this.mediaRecorder.stop();
    });
  }

  /** 取消（不产生结果） */
  cancel() {
    clearTimeout(this._timer);
    this._timer = null;
    this._onStop = null;
    if (this.recording) {
      // 标记忽略后续数据
      this.chunks = [];
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.stop();
      this.stream?.getTracks().forEach((t) => t.stop());
    }
  }

  /** 已录时长（秒） */
  elapsedSec() {
    return this.recording ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
  }
}

/**
 * blob → base64（不带 data: 前缀）
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // reader.result = "data:audio/webm;base64,XXXX"
      const s = reader.result;
      const idx = s.indexOf(',');
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 调用 Worker 转写音频。
 * @param {Blob} audio
 * @param {string} mimeType
 * @returns {Promise<{text: string, keySource: string}>}
 */
export async function transcribe(audio, mimeType) {
  if (!isSTTReady()) {
    throw new Error('未配置 STT Key。请到【设置】页填入 Groq API Key 或选管理员共享。');
  }

  const base64 = await blobToBase64(audio);
  const base = workerBase();
  const url = `${base}/api/transcribe`;

  const body = {
    audio: base64,
    mimeType,
    stt: buildSTTForRequest(),
  };

  const headers = { 'Content-Type': 'application/json' };
  if (settings.sttKeyMode === 'admin-pool' && access.accessCode) {
    headers['X-Access-Code'] = access.accessCode;
  }
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    let detail = '';
    try {
      const j = await resp.json();
      detail = j.detail || j.error || '';
    } catch {}
    if (resp.status === 401 && detail.includes('no_stt_key')) {
      throw new Error('服务端未配置 STT Key。请联系管理员，或在设置页填入自己的 Groq Key。');
    }
    throw new Error(`转写失败 ${resp.status}: ${detail}`);
  }

  const data = await resp.json();
  return { text: (data.text || '').trim(), keySource: data._keySource || '' };
}
