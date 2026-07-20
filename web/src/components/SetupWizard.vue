<script setup>
/**
 * SETUP 采集向导。
 *
 * Q7 决策 A：全卡片选择。三步：
 *   Step 1 板子（卡片）
 *   Step 2 身份（卡片）
 *   Step 3 座位 + 熟人备注 + 规则版本（多选）
 */
import { ref, computed } from 'vue';
import { BOARDS, ROLES, RULE_VERSIONS, startGame } from '../stores/game.js';
import PlayerPicker from './PlayerPicker.vue';

const emit = defineEmits(['done']);

const step = ref(1);

const board = ref('');
const myRole = ref('');
const mySeat = ref(null);
const seatBindings = ref({}); // { seat: playerId }
const playerStyles = ref('');
const ruleVersion = ref(
  Object.fromEntries(RULE_VERSIONS.map((r) => [r.key, r.default]))
);

const playerPickerRef = ref(null);

const boardList = Object.keys(BOARDS);
const preset = computed(() => (board.value ? BOARDS[board.value] : null));

function pickBoard(b) {
  board.value = b;
  step.value = 2;
}

function pickRole(r) {
  myRole.value = r;
  if (r === '其他') return; // 让用户手填？MVP 直接走"其他"
  step.value = 3;
}

function pickSeat(n) {
  mySeat.value = n;
}

function toggleRule(key) {
  ruleVersion.value[key] = !ruleVersion.value[key];
}

function confirm() {
  if (!board.value || !myRole.value || !mySeat.value) return;
  // 合成最终 playerStyles：档案库合成 + 手输
  const fromRoster = playerPickerRef.value?.formatBindings?.() || '';
  const combined = [fromRoster, playerStyles.value].filter(Boolean).join('；');
  startGame({
    board: board.value,
    myRole: myRole.value,
    mySeat: mySeat.value,
    playerStyles: combined,
    ruleVersion: { ...ruleVersion.value },
    seatBindings: { ...seatBindings.value },
  });
  emit('done');
}

function back() {
  if (step.value > 1) step.value--;
}
</script>

<template>
  <div class="space-y-4">
    <!-- 进度 -->
    <div class="flex items-center gap-2 text-sm text-zinc-400">
      <span :class="step >= 1 ? 'text-wolf-400' : ''">① 板子</span>
      <span>→</span>
      <span :class="step >= 2 ? 'text-wolf-400' : ''">② 身份</span>
      <span>→</span>
      <span :class="step >= 3 ? 'text-wolf-400' : ''">③ 座位 & 规则</span>
    </div>

    <!-- Step 1: 板子 -->
    <div v-if="step === 1" class="space-y-3">
      <h2 class="text-xl font-bold">选板子</h2>
      <div class="grid grid-cols-1 gap-2">
        <button
          v-for="b in boardList"
          :key="b"
          class="card text-left active:scale-[0.98] transition"
          @click="pickBoard(b)"
        >
          <div class="flex items-center justify-between">
            <div>
              <div class="text-lg font-bold">{{ b }}（{{ BOARDS[b].total }}人）</div>
              <div class="text-sm text-zinc-400">
                神职：{{ BOARDS[b].gods }} · 平民 ×{{ BOARDS[b].civs }} · 狼 ×{{ BOARDS[b].wolves }}
              </div>
            </div>
            <div class="text-2xl">›</div>
          </div>
        </button>
      </div>
    </div>

    <!-- Step 2: 身份 -->
    <div v-else-if="step === 2" class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-bold">你的身份（{{ board }}）</h2>
        <button class="btn-ghost text-sm" @click="back">← 返回</button>
      </div>
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="r in ROLES"
          :key="r"
          :class="myRole === r ? 'chip-on' : 'chip-off'"
          @click="pickRole(r)"
        >
          {{ r }}
        </button>
      </div>
    </div>

    <!-- Step 3: 座位 + 风格 + 规则版本 -->
    <div v-else class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-bold">座位 & 规则</h2>
        <button class="btn-ghost text-sm" @click="back">← 返回</button>
      </div>

      <div>
        <div class="text-sm text-zinc-400 mb-2">你的座位号（点击）</div>
        <div class="grid grid-cols-6 gap-2">
          <button
            v-for="n in preset.total"
            :key="n"
            :class="[
              'aspect-square rounded-lg border-2 font-semibold active:scale-95 transition',
              mySeat === n
                ? 'bg-wolf-600 border-wolf-600 text-white'
                : 'bg-zinc-900 border-zinc-700 text-zinc-200',
            ]"
            @click="pickSeat(n)"
          >
            {{ n }}
          </button>
        </div>
      </div>

      <div>
        <div class="text-sm text-zinc-400 mb-2">规则版本（默认竞技主流，按需修改）</div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="r in RULE_VERSIONS"
            :key="r.key"
            :class="ruleVersion[r.key] ? 'chip-on' : 'chip-off'"
            @click="toggleRule(r.key)"
          >
            {{ r.label }}
          </button>
        </div>
      </div>

      <div>
        <div class="text-sm text-zinc-400 mb-2">熟人玩家风格（可选）</div>
        <PlayerPicker
          ref="playerPickerRef"
          v-model:bindings="seatBindings"
          :total="preset.total"
          :my-seat="mySeat"
        />
      </div>

      <div>
        <div class="text-sm text-zinc-400 mb-2">补充备注（可选）</div>
        <textarea
          v-model="playerStyles"
          rows="2"
          class="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm focus:outline-none focus:border-wolf-500"
          placeholder="例：本局有 3 个陌生人，整体偏休闲……"
        />
      </div>

      <button
        class="btn-primary w-full"
        :disabled="!mySeat"
        @click="confirm"
      >
        开始对局
      </button>
    </div>
  </div>
</template>
