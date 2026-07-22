<script setup>
/**
 * 对局主页面。
 *
 * 状态分支：
 *   - phase === 'setup'   显示 SetupWizard
 *   - phase === 'playing' 显示 SeatGrid + RoundInput + AnalysisPanel + 操作栏
 *   - phase === 'ended'   显示复盘（让 LLM 输出复盘模板）
 */
import { computed, ref } from 'vue';
import {
  game,
  currentRound,
  nextRound,
  resetGame,
  exportGame,
  importGame,
  endGame,
  BOARDS,
  canEditSetup,
  updateSetup,
} from '../stores/game.js';
import { isLLMReady } from '../stores/settings.js';
import { chatWithCoach } from '../lib/llm.js';
import { renderMarkdown } from '../lib/md.js';
import SetupWizard from '../components/SetupWizard.vue';
import SeatGrid from '../components/SeatGrid.vue';
import RoundInput from '../components/RoundInput.vue';
import AnalysisPanel from '../components/AnalysisPanel.vue';
import TermFaq from '../components/TermFaq.vue';
import Modal from '../components/Modal.vue';
import SeatButton from '../components/SeatButton.vue';
import { buildMessages } from '../composables/playMessages.js';

const loading = ref(false);
const error = ref('');
const keySource = ref('');
const showTermFaq = ref(false);
const fileInput = ref(null);
const showEditSetup = ref(false); // P2-18：编辑 setup 模式
const showResetModal = ref(false); // F1a：重开确认模态

const r = computed(() => currentRound());
// P1-6：自定义板子时构造虚拟 preset，让模板不报 NPE
const preset = computed(() => {
  const board = game.setup.board;
  if (!board) return null;
  if (BOARDS[board]) return BOARDS[board];
  if (board.startsWith('自定义：')) {
    return { total: game.players.length || 12, hasCaptain: !game.setup.ruleVersion?.no_captain_9p };
  }
  return null;
});

/** 调用教练分析当前轮或复盘（forReview=true 时生成终局复盘） */
async function analyze(forReview = false) {
  if (!isLLMReady()) {
    error.value = '当前未配置 API Key。请到【设置】页配置。';
    return;
  }

  loading.value = true;
  error.value = '';
  r.value.analysis = '';
  keySource.value = '';

  try {
    const { full, keySource: src, partial, error: partialError } = await chatWithCoach(
      buildMessages({ preset: preset.value, currentRoundObj: r.value, forReview }),
      {
        onChunk: (_chunk, full) => {
          r.value.analysis = full;
        },
      }
    );
    r.value.analysis = full;
    r.value.analyzedAt = Date.now();
    keySource.value = src;
    // partial：流式中断或超时，已保留已收到内容 + 提示用户
    if (partial) {
      error.value = partialError
        ? `⚠️ 内容不完整：${partialError}。已保留已收到的部分，建议重试。`
        : '⚠️ 内容不完整（流式中断或超时）。已保留已收到的部分，建议重试。';
    }
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

function next() {
  // P1-9：当前轮无 analysis 时确认（避免误触丢失录入上下文）
  if (!r.value.analysis && (r.value.speeches.length || r.value.votes.length || r.value.deaths.length)) {
    if (!confirm('本轮还没让教练分析，确定进入下一轮？（已录入的信息会保留在历史回合）')) return;
  }
  nextRound();
}

/**
 * F1a：重开确认改用模态（替代 confirm）。
 * 模态里二选一：「同配置重开」（保留 setup）或「完全重开」（回 SETUP）。
 */
function guardedReset() {
  showResetModal.value = true;
}

/** F1a：同配置重开（保留板子/身份/座位/规则/熟人） */
function resetKeepSetup() {
  resetGame({ keepSetup: true });
  showResetModal.value = false;
}

/** F1a：完全重开（回 SETUP 向导） */
function resetFull() {
  resetGame({ keepSetup: false });
  showResetModal.value = false;
}

function guardedEnd() {
  if (!confirm('确定结束对局进入复盘？之后无法再加轮次（仍可查看历史回合和生成复盘）。')) return;
  endGame();
}

function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  importGame(file).catch((err) => {
    error.value = '导入失败：' + err.message;
  });
  e.target.value = '';
}

const phaseLabel = computed(() => {
  if (game.phase === 'setup') return '准备中';
  if (game.phase === 'ended') return '复盘';
  return `第 ${game.currentRound} 轮 · ${game.setup.myRole} · ${game.setup.mySeat}号`;
});

const aliveCount = computed(() => game.players.filter((p) => p.alive).length);
</script>

<template>
  <!-- SETUP 阶段 -->
  <div v-if="game.phase === 'setup'" class="space-y-4">
    <div class="card flex items-center justify-between">
      <div>
        <div class="font-serif font-bold text-parchment text-lg">新对局</div>
        <div class="text-xs text-parchment-200/50 mt-0.5">还没开始，先配置本局信息</div>
      </div>
      <button class="btn-ghost text-sm" @click="fileInput?.click()">
        📥 导入旧局
      </button>
      <input
        ref="fileInput"
        type="file"
        accept=".json"
        class="hidden"
        @change="handleImport"
      />
    </div>

    <SetupWizard @done="() => {}" />
  </div>

  <!-- 游戏中 -->
  <div v-else class="space-y-4 pb-32">
    <!-- 头部 -->
    <div class="card" style="background: linear-gradient(135deg, rgba(74,2,2,0.35) 0%, rgba(10,14,26,0.9) 70%);">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-serif font-bold flex items-center gap-2 text-parchment text-lg">
            <span class="text-wolf-400 drop-shadow" style="text-shadow:0 0 8px rgba(220,38,38,0.7);">●</span>
            <span>{{ phaseLabel }}</span>
          </div>
          <div class="text-xs text-parchment-200/60 mt-1">
            存活 <span class="text-steel-500 font-semibold">{{ aliveCount }}</span> / {{ preset?.total ?? '?' }}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn-ghost text-xs" @click="showTermFaq = true">
            📖 术语
          </button>
          <button class="btn-ghost text-xs" @click="exportGame">📤 导出</button>
          <button
            v-if="canEditSetup()"
            class="btn-ghost text-xs text-gold-400"
            @click="showEditSetup = true"
            title="仅在第 1 轮未分析时可改"
          >
            ⚙ 改配置
          </button>
          <button
            class="btn-ghost text-xs text-wolf-400"
            @click="guardedReset"
          >
            重开
          </button>
        </div>
      </div>
    </div>

    <!-- 座位网格 -->
    <SeatGrid />

    <!-- 当前轮次输入 -->
    <RoundInput v-if="game.phase === 'playing'" />

    <!-- 操作按钮 -->
    <div
      class="fixed bottom-0 left-0 right-0 max-w-3xl mx-auto backdrop-blur-md p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] flex gap-2 shadow-2xl"
      style="background: rgba(5,8,17,0.96); border-top: 1px solid rgba(212,175,55,0.25); box-shadow: 0 -8px 24px -8px rgba(0,0,0,0.6);"
    >
      <button
        class="btn-primary flex-1 text-base"
        :class="{ 'eye-pulse': !loading }"
        :disabled="loading"
        @click="analyze(false)"
      >
        {{ loading ? '思考中…' : '🧠 让教练分析' }}
      </button>
      <button
        class="btn-secondary"
        :disabled="loading"
        @click="next"
        v-if="game.phase === 'playing'"
      >
        下一轮
      </button>
      <button
        class="btn-secondary"
        :disabled="loading"
        @click="guardedEnd"
        v-if="game.phase === 'playing'"
      >
        结束
      </button>
    </div>

    <!-- 分析面板 -->
    <AnalysisPanel
      :content="r?.analysis || ''"
      :loading="loading"
      :error="error"
      :key-source="keySource"
    />

    <!-- 历史回合折叠 -->
    <div v-if="game.rounds.length > 1" class="card">
      <div class="text-sm font-semibold text-parchment-200/70 mb-2">历史回合</div>
      <div class="space-y-2">
        <details
          v-for="rr in game.rounds.filter(x => x.round !== game.currentRound).reverse()"
          :key="rr.round"
          class="rounded-lg p-2"
          style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.12);"
        >
          <summary class="cursor-pointer text-sm text-parchment-200/80">
            第 {{ rr.round }} 轮 · 出局 {{ rr.deaths.length ? rr.deaths.join(',') : '无' }}
          </summary>
          <div
            v-if="rr.analysis"
            class="mt-2 text-xs prose-invert"
            v-html="renderMarkdown(rr.analysis)"
          />
        </details>
      </div>
    </div>

    <!-- 结束后复盘按钮 -->
    <div v-if="game.phase === 'ended'" class="card">
      <button
        class="btn-primary w-full"
        :disabled="loading"
        @click="analyze(true)"
      >
        {{ loading ? '生成复盘中…' : '🧠 生成终局复盘' }}
      </button>
    </div>

    <!-- 术语/FAQ 弹层 -->
    <TermFaq v-if="showTermFaq" @close="showTermFaq = false" />

    <!-- P2-18：编辑 setup 模态框（仅第 1 轮无 analysis 时） -->
    <Modal :show="showEditSetup" @close="showEditSetup = false">
      <div class="flex items-center justify-between">
        <div class="font-serif font-bold text-parchment">编辑本局配置</div>
        <button class="btn-ghost text-xs" aria-label="关闭" @click="showEditSetup = false">✕</button>
      </div>
      <div class="text-xs text-parchment-200/60">
        仅在第 1 轮未分析时可改。改板子需重开（避免座位/players 错位）。
      </div>

      <label class="block">
        <div class="eyebrow text-gold-400/80 mb-1">我的身份</div>
        <select
          :value="game.setup.myRole"
          @change="updateSetup({ myRole: $event.target.value })"
          class="field-input"
        >
          <option v-for="r in preset?.roles || []" :key="r" :value="r">{{ r }}</option>
          <option value="其他">其他</option>
        </select>
      </label>

      <div>
        <div class="eyebrow text-gold-400/80 mb-2">我的座位</div>
        <div class="grid grid-cols-6 gap-2">
          <SeatButton
            v-for="n in preset?.total || game.players.length"
            :key="n"
            :n="n"
            :selected="game.setup.mySeat === n"
            @click="updateSetup({ mySeat: n })"
          />
        </div>
      </div>

      <button class="btn-primary w-full" @click="showEditSetup = false">完成</button>
    </Modal>

    <!-- F1a：重开确认模态（同配置 vs 完全重开） -->
    <Modal :show="showResetModal" @close="showResetModal = false">
      <div class="font-serif font-bold text-parchment">重开对局</div>
      <div class="text-xs text-parchment-200/60">
        当前：{{ game.setup.board }} · {{ game.setup.myRole }} · {{ game.setup.mySeat }}号 · {{ game.rounds.length }} 轮
      </div>
      <button
        class="btn-primary w-full text-left flex items-center gap-2"
        @click="resetKeepSetup"
      >
        <span class="text-lg">🔄</span>
        <div>
          <div class="font-semibold">同配置重开</div>
          <div class="text-xs opacity-80">保留板子/身份/座位/熟人，清空轮次。线下连开下一局选这个。</div>
        </div>
      </button>
      <button
        class="btn-secondary w-full text-left flex items-center gap-2"
        @click="resetFull"
      >
        <span class="text-lg">🗑</span>
        <div>
          <div class="font-semibold">完全重开</div>
          <div class="text-xs opacity-70">回到 SETUP 向导，重新选板子和身份。</div>
        </div>
      </button>
      <button class="btn-ghost w-full text-xs" @click="showResetModal = false">取消</button>
    </Modal>
  </div>
</template>
