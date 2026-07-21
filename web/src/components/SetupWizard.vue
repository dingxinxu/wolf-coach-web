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
 * 按 accent 给出选中态的色板（边框/背景/glow/文字/标记点）。
 * accent 分组：神职=gold、平民=steel、狼人=blood、其他=parchment
 */
const ACCENT_HEX = {
  gold: {
    border: 'rgba(212,175,55,0.85)',
    bg:     'linear-gradient(180deg, rgba(74,62,28,0.7) 0%, rgba(42,33,12,0.85) 100%)',
    glow:   'rgba(212,175,55,0.55)',
    text:   '#f4e8c1',
    dot:    '#d4af37',
  },
  blood: {
    border: 'rgba(196,30,58,0.85)',
    bg:     'linear-gradient(180deg, rgba(74,2,2,0.7) 0%, rgba(42,2,2,0.85) 100%)',
    glow:   'rgba(220,38,38,0.55)',
    text:   '#f4e8c1',
    dot:    '#dc2626',
  },
  steel: {
    border: 'rgba(74,111,165,0.85)',
    bg:     'linear-gradient(180deg, rgba(28,42,62,0.7) 0%, rgba(12,20,32,0.85) 100%)',
    glow:   'rgba(74,111,165,0.55)',
    text:   '#f4e8c1',
    dot:    '#4a6fa5',
  },
  parchment: {
    border: 'rgba(244,232,193,0.6)',
    bg:     'linear-gradient(180deg, rgba(62,55,38,0.6) 0%, rgba(32,28,18,0.85) 100%)',
    glow:   'rgba(244,232,193,0.4)',
    text:   '#f4e8c1',
    dot:    '#cdb885',
  },
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
            border: 1px solid rgba(212,175,55,0.35);
            background: linear-gradient(135deg, #1a1f2e 0%, #0a0e1a 75%);
            box-shadow: inset 0 1px 0 rgba(212,175,55,0.18), 0 6px 20px rgba(0,0,0,0.5);
            min-height: 112px;
          "
          @click="pickBoard(b)"
        >
          <!-- 右侧代表性角色立绘（网易官方卡牌图） -->
          <img
            :src="BOARDS[b].cover"
            alt=""
            aria-hidden="true"
            loading="lazy"
            class="absolute pointer-events-none select-none"
            style="
              right: -10px; top: 50%; transform: translateY(-50%);
              height: 130%;
              filter: drop-shadow(0 0 12px rgba(220,38,38,0.15));
              opacity: 0.95;
            "
          />
          <!-- 左侧暗角，让文字易读 -->
          <div
            class="absolute inset-0 pointer-events-none"
            style="background: linear-gradient(90deg, rgba(10,14,26,0.92) 0%, rgba(10,14,26,0.7) 45%, rgba(10,14,26,0) 70%);"
          />
          <div class="relative p-4 pr-32">
            <div class="font-serif text-lg font-bold text-parchment">
              {{ b }}<span class="text-gold-400 font-normal text-base">（{{ BOARDS[b].total }}人）</span>
            </div>
            <div class="text-sm text-parchment-200/75 mt-1 leading-relaxed">
              🛡 {{ BOARDS[b].gods }}<br/>
              👥 平民 ×{{ BOARDS[b].civs }} · 🐺 狼 ×{{ BOARDS[b].wolves }}
            </div>
            <div class="mt-2 text-gold-400 text-xs flex items-center gap-1">
              选择 <span class="text-base">›</span>
            </div>
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
      <!-- 角色卡网格：每张卡用网易立绘作主体 -->
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="r in ROLES"
          :key="r.label"
          :style="{
            borderWidth: '2px',
            borderStyle: 'solid',
            borderColor: myRole === r.label
              ? ACCENT_HEX[r.accent].border
              : 'rgba(212,175,55,0.18)',
            background: myRole === r.label
              ? ACCENT_HEX[r.accent].bg
              : 'linear-gradient(180deg, rgba(26,31,46,0.85) 0%, rgba(10,14,26,0.9) 100%)',
            boxShadow: myRole === r.label
              ? `0 0 18px -4px ${ACCENT_HEX[r.accent].glow}, inset 0 1px 0 rgba(212,175,55,0.22)`
              : 'inset 0 1px 0 rgba(212,175,55,0.08), 0 2px 8px rgba(0,0,0,0.35)',
            borderRadius: '12px',
            transition: 'transform 0.12s, border-color 0.2s, background 0.2s, box-shadow 0.2s',
          }"
          class="relative overflow-hidden flex flex-col active:scale-95"
          @click="pickRole(r)"
        >
          <!-- 立绘区域（顶大部分） -->
          <div class="relative" style="height: 96px; overflow: hidden;">
            <img
              v-if="r.icon"
              :src="r.icon"
              :alt="r.label"
              loading="lazy"
              class="absolute inset-0 w-full h-full"
              style="object-fit: cover; object-position: center top;"
            />
            <div
              v-else
              class="absolute inset-0 flex items-center justify-center text-3xl"
              style="background: linear-gradient(180deg, #1a1f2e 0%, #0a0e1a 100%);"
            >❓</div>
            <!-- 底部渐变，让名字条易读 -->
            <div
              class="absolute inset-x-0 bottom-0 h-12 pointer-events-none"
              style="background: linear-gradient(180deg, rgba(10,14,26,0) 0%, rgba(10,14,26,0.95) 100%);"
            />
            <!-- 阵营标记（左上角小宝石） -->
            <div
              class="absolute top-1 left-1 rounded-full"
              :style="{
                width: '8px', height: '8px',
                background: ACCENT_HEX[r.accent].dot,
                boxShadow: `0 0 6px ${ACCENT_HEX[r.accent].dot}`,
              }"
            />
          </div>
          <!-- 名字条 -->
          <div
            class="relative px-1 py-1.5 text-center"
            :style="{
              fontFamily: 'var(--font-serif, system-serif)',
              fontSize: '13px',
              fontWeight: 600,
              color: myRole === r.label ? ACCENT_HEX[r.accent].text : '#e8d9a8',
            }"
          >
            {{ r.label }}
          </div>
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
