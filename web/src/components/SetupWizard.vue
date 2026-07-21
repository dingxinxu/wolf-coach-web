<script setup>
/**
 * SETUP 采集向导。
 *
 * Q7 决策 A：全卡片选择。三步：
 *   Step 1 板子（卡片，含背景插画）
 *   Step 2 身份（卡片，含角色图标 + 主题色）
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

/**
 * 把 game-icons.net 黑底白线稿转成与血月主题协调的主题色。
 * 原图 fill="#fff" → 经 invert → sepia → hue-rotate 调出金/血/钢/紫。
 */
const ACCENT_FILTER = {
  // 古金（神职）：温暖金色调
  gold:      'invert(1) sepia(1) saturate(3) hue-rotate(-15deg) brightness(0.95)',
  // 血月红（狼人/猎人攻击性）
  blood:     'invert(1) sepia(1) saturate(4) hue-rotate(-50deg) brightness(0.85)',
  // 冷钢蓝（守卫/平民）
  steel:     'invert(1) sepia(1) saturate(2) hue-rotate(160deg) brightness(0.85)',
  // 暗紫（女巫、神秘）
  purple:    'invert(1) sepia(1) saturate(3) hue-rotate(220deg) brightness(0.85)',
  // 羊皮米（白痴、白狼王）
  parchment: 'invert(1) sepia(1) saturate(1.5) hue-rotate(-5deg) brightness(0.9)',
};

function pickBoard(b) {
  board.value = b;
  step.value = 2;
}

function pickRole(r) {
  myRole.value = r.label;
  if (r.label === '其他') return;
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
    <!-- 进度指示器 -->
    <div class="flex items-center gap-1 text-xs">
      <template v-for="(label, i) in ['板子', '身份', '座位 & 规则']" :key="i">
        <div
          :class="[
            'flex-1 text-center py-1.5 rounded-lg transition border',
            step > i + 1
              ? 'text-steel-500'
              : step === i + 1
              ? 'text-parchment'
              : 'text-parchment-200/40',
          ]"
          :style="
            step > i + 1
              ? 'background: rgba(74,111,165,0.15); border-color: rgba(74,111,165,0.4);'
              : step === i + 1
              ? 'background: linear-gradient(180deg,#c41e3a 0%,#8b0000 100%); border-color: rgba(212,175,55,0.55); box-shadow: 0 0 12px -2px rgba(220,38,38,0.5);'
              : 'background: rgba(10,14,26,0.6); border-color: rgba(212,175,55,0.15);'
          "
        >
          <span class="font-serif font-bold">{{ i + 1 }}</span> · {{ label }}
        </div>
        <div v-if="i < 2" class="text-gold-400/50 px-0.5">›</div>
      </template>
    </div>

    <!-- Step 1: 板子 -->
    <div v-if="step === 1" class="space-y-3">
      <h2 class="font-serif text-xl font-bold text-parchment flex items-center gap-2">
        <span class="text-gold-400">🎴</span> 选板子
      </h2>
      <div class="grid grid-cols-1 gap-3">
        <button
          v-for="b in boardList"
          :key="b"
          class="relative overflow-hidden text-left active:scale-[0.98] transition"
          style="
            border-radius: 14px;
            border: 1px solid rgba(212,175,55,0.28);
            background: linear-gradient(135deg, rgba(30,41,59,0.85) 0%, rgba(10,14,26,0.95) 75%);
            box-shadow: inset 0 1px 0 rgba(212,175,55,0.15), 0 4px 16px rgba(0,0,0,0.45);
            min-height: 96px;
          "
          @click="pickBoard(b)"
        >
          <!-- 背景插画：放大、低透明度、右侧居中 -->
          <img
            :src="BOARDS[b].cover"
            alt=""
            aria-hidden="true"
            class="absolute pointer-events-none select-none"
            style="
              right: -16px; top: 50%; transform: translateY(-50%);
              width: 144px; height: 144px;
              filter: invert(1) sepia(1) saturate(2.5) hue-rotate(-15deg) brightness(0.85);
              opacity: 0.22;
              mix-blend-mode: screen;
            "
          />
          <!-- 暗角遮罩，让文字易读 -->
          <div
            class="absolute inset-0 pointer-events-none"
            style="background: linear-gradient(90deg, rgba(5,8,17,0.85) 0%, rgba(5,8,17,0.45) 55%, rgba(5,8,17,0.1) 100%);"
          />
          <div class="relative flex items-center justify-between p-4">
            <div>
              <div class="font-serif text-lg font-bold text-parchment">
                {{ b }}<span class="text-gold-400 font-normal text-base">（{{ BOARDS[b].total }}人）</span>
              </div>
              <div class="text-sm text-parchment-200/70 mt-1">
                🛡 {{ BOARDS[b].gods }} · 👥 平民 ×{{ BOARDS[b].civs }} · 🐺 狼 ×{{ BOARDS[b].wolves }}
              </div>
            </div>
            <div class="text-2xl text-gold-400/70">›</div>
          </div>
        </button>
      </div>
    </div>

    <!-- Step 2: 身份 -->
    <div v-else-if="step === 2" class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="font-serif text-xl font-bold text-parchment">你的身份（{{ board }}）</h2>
        <button class="btn-ghost text-sm" @click="back">← 返回</button>
      </div>
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="r in ROLES"
          :key="r.label"
          :style="
            myRole === r.label
              ? {
                background: 'linear-gradient(180deg, rgba(196,30,58,0.5) 0%, rgba(74,2,2,0.85) 100%)',
                borderColor: 'rgba(212,175,55,0.7)',
                color: '#f4e8c1',
                boxShadow: '0 0 14px -3px rgba(220,38,38,0.55), inset 0 1px 0 rgba(212,175,55,0.2)',
              }
              : {
                background: 'linear-gradient(180deg, rgba(30,41,59,0.7) 0%, rgba(10,14,26,0.8) 100%)',
                borderColor: 'rgba(212,175,55,0.22)',
                color: '#e8d9a8',
              }
          "
          style="
            border-width: 1.5px;
            border-style: solid;
            border-radius: 12px;
            padding: 10px 6px 8px;
            transition: transform 0.1s, border-color 0.2s, background 0.2s;
          "
          class="flex flex-col items-center justify-start active:scale-95"
          @click="pickRole(r)"
        >
          <!-- 角色图标（按主题色着色） -->
          <img
            v-if="r.icon"
            :src="r.icon"
            :alt="r.label"
            :style="{ filter: ACCENT_FILTER[r.accent] || ACCENT_FILTER.parchment }"
            style="width: 40px; height: 40px; object-fit: contain; margin-bottom: 4px;"
          />
          <span
            v-else
            style="width: 40px; height: 40px; line-height: 40px; font-size: 24px; margin-bottom: 4px; opacity: 0.7;"
          >❓</span>
          <span class="text-sm font-medium" style="font-family: var(--font-serif, system-serif);">{{ r.label }}</span>
        </button>
      </div>
    </div>

    <!-- Step 3: 座位 + 风格 + 规则版本 -->
    <div v-else class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="font-serif text-xl font-bold text-parchment">座位 & 规则</h2>
        <button class="btn-ghost text-sm" @click="back">← 返回</button>
      </div>

      <div>
        <div class="eyebrow text-gold-400/80 mb-2">你的座位号（点击）</div>
        <div class="grid grid-cols-6 gap-2">
          <button
            v-for="n in preset.total"
            :key="n"
            :class="[
              'aspect-square rounded-lg border-2 font-semibold active:scale-95 transition',
              mySeat === n ? '' : '',
            ]"
            :style="
              mySeat === n
                ? 'background: linear-gradient(180deg,#c41e3a 0%,#8b0000 100%); border-color: rgba(212,175,55,0.6); color:#f4e8c1;'
                : 'background: linear-gradient(180deg,rgba(30,41,59,0.7) 0%,rgba(10,14,26,0.8) 100%); border-color: rgba(212,175,55,0.22); color:#e8d9a8;'
            "
            @click="pickSeat(n)"
          >
            {{ n }}
          </button>
        </div>
      </div>

      <div>
        <div class="eyebrow text-gold-400/80 mb-2">规则版本（默认竞技主流，按需修改）</div>
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
        <div class="eyebrow text-gold-400/80 mb-2">熟人玩家风格（可选）</div>
        <PlayerPicker
          ref="playerPickerRef"
          v-model:bindings="seatBindings"
          :total="preset.total"
          :my-seat="mySeat"
        />
      </div>

      <div>
        <div class="eyebrow text-gold-400/80 mb-2">补充备注（可选）</div>
        <textarea
          v-model="playerStyles"
          rows="2"
          class="w-full rounded-lg p-3 text-sm text-parchment focus:outline-none placeholder:text-parchment-200/30"
          style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
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
