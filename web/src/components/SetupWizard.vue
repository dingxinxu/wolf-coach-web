<script setup>
/**
 * SETUP 采集向导。
 *
 * Q7 决策 A：全卡片选择。三步：
 *   Step 1 板子（卡片，含背景插画）+ 自定义板子入口
 *   Step 2 身份（卡片，含角色图标 + 主题色，按板子 roles 过滤防矛盾组合）
 *   Step 3 座位 + 熟人备注 + 规则版本（多选）
 *
 * P1-6：
 *   - 加 3 个狼王板（12狼王/12白狼王/9狼王）
 *   - 自定义板子入口（textarea 描述）
 *   - 身份选择按 BOARDS[].roles 过滤（自定义板子不过滤）
 */
import { ref, computed } from 'vue';
import { BOARDS, ROLES, RULE_VERSIONS, startGame } from '../stores/game.js';
import PlayerPicker from './PlayerPicker.vue';
import Modal from './Modal.vue';

const emit = defineEmits(['done']);

const step = ref(1);

const board = ref('');
const boardDesc = ref(''); // P1-6：自定义板子描述
const myRole = ref('');
const mySeat = ref(null);
const seatBindings = ref({}); // { seat: playerId }
const playerStyles = ref('');
const ruleVersion = ref(
  Object.fromEntries(RULE_VERSIONS.map((r) => [r.key, r.default]))
);

const playerPickerRef = ref(null);

// B1：选「其他」身份时的自定义输入态
const customRoleInput = ref(''); // 文本框值
const showCustomRoleModal = ref(false);

const boardList = Object.keys(BOARDS);
const preset = computed(() => (board.value && !isCustom.value ? BOARDS[board.value] : null));
const isCustom = computed(() => board.value.startsWith('自定义：'));

/**
 * P1-6：Step 2 可选身份列表。
 * - 标准板子：按 BOARDS[board].roles 过滤
 * - 自定义板子：显示全部 ROLES（用户自己负责）
 */
const availableRoles = computed(() => {
  if (isCustom.value) return ROLES;
  if (!preset.value?.roles) return ROLES;
  return ROLES.filter((r) => preset.value.roles.includes(r.label));
});

/**
 * P1-6：Step 3 座位网格的总人数。
 * - 标准板子：preset.total
 * - 自定义板子：从 boardDesc 解析（兜底 12）
 */
const customTotal = computed(() => {
  if (!isCustom.value) return preset.value?.total || 12;
  const m = boardDesc.value.match(/(\d+)\s*人/);
  const n = m ? Number(m[1]) : 12;
  return n >= 6 && n <= 18 ? n : 12;
});

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
  boardDesc.value = '';
  // B2：切板子时智能清理 stale 身份。
  // 仅当 myRole 不在新板子的 roles 列表里才清空（同系列板子切换时保留预言家/女巫等兼容身份）。
  // 自定义板子不过滤身份，保留 myRole。
  if (myRole.value) {
    const newPreset = BOARDS[b];
    const newRoles = newPreset?.roles;
    if (newRoles && !newRoles.includes(myRole.value) && myRole.value !== '其他') {
      myRole.value = '';
    }
  }
  step.value = 2;
}

/** P1-6：选自定义板子 -> 展开描述输入 */
function pickCustomBoard() {
  board.value = '自定义：';
  step.value = 2;
}

function pickRole(r) {
  // B1：选「其他」弹输入框让用户填自定义身份名，避免透传无意义的"其他"给 LLM
  if (r.label === '其他') {
    customRoleInput.value = '';
    showCustomRoleModal.value = true;
    return;
  }
  myRole.value = r.label;
  step.value = 3;
}

/** B1：确认自定义身份 */
function confirmCustomRole() {
  const trimmed = customRoleInput.value.trim();
  if (!trimmed) return;
  myRole.value = trimmed.slice(0, 12); // 限长，防 prompt 注入超长字符串
  showCustomRoleModal.value = false;
  step.value = 3;
}

/** B1：取消自定义身份输入 */
function cancelCustomRole() {
  showCustomRoleModal.value = false;
  customRoleInput.value = '';
}

function pickSeat(n) {
  mySeat.value = n;
}

function toggleRule(key) {
  ruleVersion.value[key] = !ruleVersion.value[key];
}

function confirm() {
  if (!board.value || !myRole.value || !mySeat.value) return;
  // 自定义板子要求 boardDesc 非空
  if (isCustom.value && !boardDesc.value.trim()) {
    alert('请描述自定义板子（人数、神民狼配置、特殊规则）');
    return;
  }
  // B2：防御性兜底——标准板子下若 myRole 不在该板子的 roles 列表（也不应是"其他"），拒绝放行
  // 理论上 pickBoard 的智能清理已避免此情况，这里防极端路径（如回退后直接 confirm）
  if (!isCustom.value && preset.value?.roles) {
    if (!preset.value.roles.includes(myRole.value) && myRole.value !== '其他') {
      alert(`「${myRole.value}」不在「${board.value}」板子的身份列表里，请重选身份`);
      myRole.value = '';
      step.value = 2;
      return;
    }
  }
  // 合成最终 playerStyles：档案库合成 + 手输
  const fromRoster = playerPickerRef.value?.formatBindings?.() || '';
  const combined = [fromRoster, playerStyles.value].filter(Boolean).join('；');
  startGame({
    board: isCustom.value ? `自定义：${boardDesc.value.trim().slice(0, 30)}` : board.value,
    myRole: myRole.value,
    mySeat: mySeat.value,
    playerStyles: combined,
    ruleVersion: { ...ruleVersion.value },
    seatBindings: { ...seatBindings.value },
    boardDesc: isCustom.value ? boardDesc.value.trim() : '',
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

        <!-- P1-6：自定义板子入口 -->
        <button
          class="relative overflow-hidden text-left active:scale-[0.98] transition"
          style="
            border-radius: 14px;
            border: 1px dashed rgba(212,175,55,0.45);
            background: linear-gradient(135deg, rgba(30,41,59,0.6) 0%, rgba(10,14,26,0.85) 75%);
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            min-height: 80px;
          "
          @click="pickCustomBoard"
        >
          <div class="p-4 flex items-center gap-3">
            <span class="text-3xl">➕</span>
            <div>
              <div class="font-serif text-lg font-bold text-parchment">自定义板子</div>
              <div class="text-xs text-parchment-200/60 mt-0.5">
                狼美人 / 守墓人石像鬼 / 丘比特 / 非标准人数 等罕见板
              </div>
            </div>
            <span class="ml-auto text-gold-400 text-base">›</span>
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

      <!-- P1-6：自定义板子描述输入 -->
      <div v-if="isCustom" class="rounded-lg p-3" style="background: rgba(74,2,2,0.25); border: 1px solid rgba(212,175,55,0.35);">
        <div class="eyebrow text-gold-400/80 mb-2">📋 描述本局板子</div>
        <textarea
          v-model="boardDesc"
          rows="3"
          class="w-full rounded-lg p-3 text-sm text-parchment focus:outline-none placeholder:text-parchment-200/30"
          style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
          placeholder="例：12 人局，4 神（预言家/女巫/猎人/守卫），4 民，4 狼（含 1 狼美人，狼美人不能自刀）"
        />
        <div class="text-xs text-parchment-200/40 mt-1">
          这段描述会作为 system prompt 上下文喂给教练 LLM，写清楚人数和配置
        </div>
      </div>

      <!-- 角色卡网格：每张卡用网易立绘作主体 -->
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="r in availableRoles"
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

      <!-- P1-6：自定义板子时显示当前描述（只读） -->
      <div v-if="isCustom && boardDesc" class="rounded-lg p-2 text-xs text-parchment-200/70" style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.15);">
        📋 {{ boardDesc }}
      </div>

      <div>
        <div class="eyebrow text-gold-400/80 mb-2">你的座位号（点击）</div>
        <div class="grid grid-cols-6 gap-2">
          <button
            v-for="n in customTotal"
            :key="n"
            class="aspect-square rounded-lg border-2 font-semibold active:scale-95 transition"
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
          :total="customTotal"
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

    <!-- B1：选「其他」身份时弹出自定义身份输入框 -->
    <Modal :show="showCustomRoleModal" @close="cancelCustomRole" max-width="max-w-sm">
      <h3 class="font-serif text-lg font-bold text-parchment mb-2">自定义身份</h3>
      <p class="text-sm text-parchment-200/70 mb-3">
        输入你的身份名（如「混血儿」「吹笛者」「盗贼」），教练会按这个名字理解你的角色。
      </p>
      <input
        ref="customRoleInputEl"
        v-model="customRoleInput"
        type="text"
        maxlength="12"
        class="w-full rounded-lg p-3 text-sm text-parchment focus:outline-none placeholder:text-parchment-200/30"
        style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
        placeholder="身份名（最多 12 字）"
        @keydown.enter="confirmCustomRole"
        @keydown.escape="cancelCustomRole"
      />
      <div class="flex gap-2 mt-3">
        <button class="btn-ghost flex-1" @click="cancelCustomRole">取消</button>
        <button
          class="btn-primary flex-1"
          :disabled="!customRoleInput.trim()"
          @click="confirmCustomRole"
        >
          确定
        </button>
      </div>
    </Modal>
  </div>
</template>
