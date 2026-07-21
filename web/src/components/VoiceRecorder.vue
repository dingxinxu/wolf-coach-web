<script setup>
/**
 * 语音录制组件。
 *
 * 交互（Q5 决策 A）：
 *   点击【开始录音】 → 红色脉冲按钮 + 计时
 *   点击【结束】      → 上传 + 调 Whisper → 把文本 emit 给父组件
 *   点击【取消】      → 录音中放弃
 *
 * 父组件用法：
 *   <VoiceRecorder @transcribed="(text) => speech.text = text" />
 */
import { onBeforeUnmount, ref } from 'vue';
import { Recorder, transcribe, isRecordingSupported } from '../lib/stt.js';

const emit = defineEmits(['transcribed', 'error']);

const recorder = new Recorder();
const state = ref('idle'); // idle | recording | paused | transcribing
const elapsedSec = ref(0);
const errorMsg = ref('');
let timer = null;

const supported = isRecordingSupported();

async function toggle() {
  errorMsg.value = '';
  if (state.value === 'idle') {
    try {
      await recorder.start();
      state.value = 'recording';
      timer = setInterval(() => {
        elapsedSec.value = recorder.elapsedSec();
      }, 500);
    } catch (e) {
      errorMsg.value = e.message || '录音启动失败（可能未授权麦克风）';
      emit('error', errorMsg.value);
    }
  } else if (state.value === 'recording' || state.value === 'paused') {
    clearInterval(timer);
    timer = null;
    const result = await recorder.stop();
    state.value = 'transcribing';
    try {
      const { text } = await transcribe(result.blob, result.mimeType);
      if (text) {
        emit('transcribed', text);
      } else {
        errorMsg.value = '未识别到内容';
      }
    } catch (e) {
      errorMsg.value = e.message || '转写失败';
      emit('error', errorMsg.value);
    } finally {
      state.value = 'idle';
      elapsedSec.value = 0;
    }
  }
}

function pause() {
  if (state.value !== 'recording') return;
  recorder.pause();
  state.value = 'paused';
  elapsedSec.value = recorder.elapsedSec();
}

function resume() {
  if (state.value !== 'paused') return;
  recorder.resume();
  state.value = 'recording';
  timer = setInterval(() => {
    elapsedSec.value = recorder.elapsedSec();
  }, 500);
}

function cancel() {
  clearInterval(timer);
  timer = null;
  recorder.cancel();
  state.value = 'idle';
  elapsedSec.value = 0;
}

onBeforeUnmount(() => {
  clearInterval(timer);
  recorder.cancel();
});
</script>

<template>
  <div class="flex items-center gap-2">
    <button
      v-if="supported"
      :style="
        state === 'recording'
          ? 'background: linear-gradient(180deg,#c41e3a 0%,#8b0000 100%); border:1px solid rgba(212,175,55,0.5); color:#f4e8c1;'
          : state === 'paused'
          ? 'background: linear-gradient(180deg,#92651a 0%,#5a3d0e 100%); border:1px solid rgba(212,175,55,0.4); color:#f4e8c1;'
          : state === 'transcribing'
          ? 'background: rgba(51,65,85,0.6); border:1px solid rgba(212,175,55,0.25); color:#cdb885;'
          : 'background: linear-gradient(180deg,#1e293b 0%,#0e1422 100%); border:1px solid rgba(212,175,55,0.3); color:#f4e8c1;'
      "
      :class="[
        'px-3 py-1.5 rounded-xl text-sm font-medium transition active:scale-95 flex items-center gap-2',
        state === 'recording' ? 'rec-pulse' : '',
      ]"
      :disabled="state === 'transcribing'"
      @click="toggle"
    >
      <span v-if="state === 'idle'">🎙 开始录音</span>
      <span v-else-if="state === 'recording'" class="tabular-nums">
        ⏺ {{ elapsedSec }}s · 点击结束
      </span>
      <span v-else-if="state === 'paused'" class="tabular-nums">
        ⏸ 已暂停 {{ elapsedSec }}s · 点击结束
      </span>
      <span v-else>⏳ 转写中…</span>
    </button>

    <button
      v-if="state === 'recording'"
      class="btn-ghost text-xs text-amber-400"
      @click="pause"
    >
      ⏸ 暂停
    </button>
    <button
      v-if="state === 'paused'"
      class="btn-ghost text-xs text-good-500"
      @click="resume"
    >
      ▶ 继续
    </button>

    <button
      v-if="state === 'recording' || state === 'paused'"
      class="btn-ghost text-xs text-parchment-200/50"
      @click="cancel"
    >
      取消
    </button>

    <span v-if="!supported" class="text-xs text-parchment-200/40">
      🎙 当前浏览器不支持录音
    </span>

    <span v-if="errorMsg" class="text-xs text-wolf-400">{{ errorMsg }}</span>
  </div>
</template>
