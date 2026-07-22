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
import { buildAuthHeaders } from './request.js';

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
// P2-18：全局互斥引用。同一时刻只允许一个 Recorder 持有麦克风，
// 防止 RoundInput 警上/白天多个 VoiceRecorder 实例并发录音。
let activeRecorder = null;

export class Recorder {
  constructor() {
    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.mimeType = '';
    this._timer = null;
    this._onStop = null;
    this._recordedMs = 0; // 累积有效录音时长（不含暂停段）
    this._segStart = 0; // 当前段起点（recording 状态下计时用）
  }

  get recording() {
    return this.mediaRecorder?.state === 'recording';
  }

  get paused() {
    return this.mediaRecorder?.state === 'paused';
  }

  /** 把"自上次 _segStart 至今"的时长累加到 _recordedMs，并重置 _segStart。 */
  _tickSegment() {
    if (this.recording) {
      this._recordedMs += Date.now() - this._segStart;
    }
    this._segStart = Date.now();
  }

  async start() {
    if (this.mediaRecorder) throw new Error('已在录音中');
    if (!isRecordingSupported()) {
      throw new Error('当前浏览器不支持录音（需要 MediaRecorder API）');
    }
    // P2-18：若有其它实例正在录音或暂停，抢占式拒绝
    if (activeRecorder && activeRecorder !== this && (activeRecorder.recording || activeRecorder.paused)) {
      throw new Error('请先停止当前录音');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mimeType = pickMimeType();
    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType || undefined,
    });
    this.chunks = [];
    this._recordedMs = 0;
    this._segStart = Date.now();

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };

    return new Promise((resolve, reject) => {
      this._onStop = () => {
        this._tickSegment();
        const blob = new Blob(this.chunks, { type: this.mimeType });
        resolve({ blob, mimeType: this.mimeType, durationMs: this._recordedMs });
      };
      this.mediaRecorder.onerror = (e) => reject(e.error || new Error('录音失败'));
      this.mediaRecorder.onstop = () => {
        // 关闭麦克风
        this.stream?.getTracks().forEach((t) => t.stop());
        this._onStop?.();
      };
      this.mediaRecorder.start();
      activeRecorder = this; // P2-18：登记为当前活跃录音器

      // 120s 安全上限（按有效录音时长）：定时检查
      this._timer = setInterval(() => {
        if (this.elapsedSec() * 1000 >= MAX_DURATION_MS && this.recording) {
          this.stop();
        }
      }, 500);
    });
  }

  /** 暂停（不释放麦克风，暂停期间不采集）。 */
  pause() {
    if (!this.recording) return;
    this._tickSegment();
    this.mediaRecorder.pause();
  }

  /** 继续录音。 */
  resume() {
    if (!this.paused) return;
    this._segStart = Date.now();
    this.mediaRecorder.resume();
  }

  stop() {
    if (!this.recording && !this.paused) return Promise.resolve(null);
    clearInterval(this._timer);
    this._timer = null;
    if (activeRecorder === this) activeRecorder = null;
    return new Promise((resolve) => {
      this._onStop = resolve;
      this.mediaRecorder.stop();
    });
  }

  /** 取消（不产生结果） */
  cancel() {
    clearInterval(this._timer);
    this._timer = null;
    this._onStop = null;
    if (activeRecorder === this) activeRecorder = null;
    if (this.recording || this.paused) {
      // 标记忽略后续数据
      this.chunks = [];
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.stop();
      this.stream?.getTracks().forEach((t) => t.stop());
    }
  }

  /** 已录有效时长（秒），不含暂停段。 */
  elapsedSec() {
    if (!this.mediaRecorder) return 0;
    const live = this.recording ? Date.now() - this._segStart : 0;
    return Math.floor((this._recordedMs + live) / 1000);
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

  const headers = buildAuthHeaders(settings.sttKeyMode, access.accessCode);
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
