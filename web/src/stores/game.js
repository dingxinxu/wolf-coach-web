/**
 * 游戏 store：管理本局所有状态。
 *
 * 状态结构（Q7 决策：全卡片选择 + 发言语音，MVP 期发言用文本）：
 *   - setup: { board, myRole, mySeat, playerStyles, ruleVersion }
 *   - players: [{ seat, alive, isMe, notes }]  —— 玩家档案（座位网格点击维护存活状态）
 *   - rounds: [{ round, deaths, mySkill, speeches, votes, analysis }]  —— 每轮回合
 *   - phase: 'setup' | 'playing' | 'ended'
 *   - currentRound: 当前轮次号
 *
 * 持久化（Q9 决策 A）：localStorage 自动 + 一键导出/导入 JSON。
 */
import { reactive, watch } from 'vue';

// GitHub Pages 部署在子路径（/wolf-coach-web/），public/ 下的资源引用需带 base 前缀
// P1-8：PNG -> webp（体积降 76%，原 PNG 保留作版权证据）
const BASE = import.meta.env.BASE_URL || '/';
const icon = (name) => `${BASE}role-art/${name}.webp`;

const STORAGE_KEY = 'wolf-coach-game-v1';

/** 板子预设（同 SKILL.md 主流板子表） */
export const BOARDS = {
  '9预女猎': {
    total: 9, gods: '预言家/女巫/猎人', civs: 3, wolves: 3, hasCaptain: true,
    cover: icon('seer'),     // 板子封面取代表性神职立绘
    // 该板子可能出现的身份（用于 Step 2 过滤，防矛盾组合）
    roles: ['预言家', '女巫', '猎人', '平民', '狼人'],
  },
  '12预女猎守': {
    total: 12, gods: '预言家/女巫/猎人/守卫', civs: 4, wolves: 4, hasCaptain: true,
    cover: icon('guard'),
    roles: ['预言家', '女巫', '猎人', '守卫', '平民', '狼人'],
  },
  '12预女猎白': {
    total: 12, gods: '预言家/女巫/猎人/白痴', civs: 4, wolves: 4, hasCaptain: true,
    cover: icon('idiot'),
    roles: ['预言家', '女巫', '猎人', '白痴', '平民', '狼人'],
  },
  // P1-6：扩展 3 个狼王板（国内竞技常见）
  '12狼王预女猎守': {
    total: 12, gods: '预言家/女巫/猎人/守卫', civs: 4, wolves: 4, hasCaptain: true,
    cover: icon('wolf-king'),
    roles: ['预言家', '女巫', '猎人', '守卫', '平民', '狼人', '狼王'],
  },
  '12白狼王预女猎守': {
    total: 12, gods: '预言家/女巫/猎人/守卫', civs: 4, wolves: 4, hasCaptain: true,
    cover: icon('white-wolf'),
    roles: ['预言家', '女巫', '猎人', '守卫', '平民', '狼人', '白狼王'],
  },
  '9狼王预女猎': {
    total: 9, gods: '预言家/女巫/猎人', civs: 3, wolves: 3, hasCaptain: true,
    cover: icon('wolf-king'),
    roles: ['预言家', '女巫', '猎人', '平民', '狼人', '狼王'],
  },
};

/**
 * 身份表（含网易官方立绘 + 主题色）。
 * key 仍是中文 label（向后兼容：myRole 比较仍按 label），其他字段只用于渲染。
 * accent 用于选中态边框/glow 颜色，按阵营分组：
 *   神职 = gold（金）、平民 = steel（钢蓝）、狼人 = blood（血月红）
 */
export const ROLES = [
  { label: '预言家', icon: icon('seer'),       accent: 'gold' },
  { label: '女巫',   icon: icon('witch'),       accent: 'gold' },
  { label: '猎人',   icon: icon('hunter'),      accent: 'gold' },
  { label: '守卫',   icon: icon('guard'),       accent: 'gold' },
  { label: '白痴',   icon: icon('idiot'),       accent: 'gold' },
  { label: '平民',   icon: icon('civilian'),    accent: 'steel' },
  { label: '狼人',   icon: icon('werewolf'),    accent: 'blood' },
  { label: '狼王',   icon: icon('wolf-king'),   accent: 'blood' },
  { label: '白狼王', icon: icon('white-wolf'),  accent: 'blood' },
  { label: '其他',   icon: '',                  accent: 'parchment' },
];

/** 按中文 label 取角色配置（向后兼容老代码） */
export const ROLE_BY_LABEL = Object.fromEntries(ROLES.map((r) => [r.label, r]));

export const RULE_VERSIONS = [
  { key: 'witch_full_vision', label: '女巫全程看刀口', default: true },
  { key: 'always_last_words', label: '全程遗言权', default: false },
  { key: 'no_captain_9p', label: '9 人局无警长', default: false },
  { key: 'guard_priority', label: '同守同救守卫优先', default: false },
];

function freshRound(roundNo) {
  return {
    round: roundNo,
    deaths: [], // 出局座位号列表
    mySkill: '', // 用户夜间技能使用描述（自由文本）
    speeches: [], // [{ seat, text }]
    votes: [], // [{ from, to }]  to=null 表示弃票
    // 上警环节（仅第 1 轮使用；其他轮保留空值，不渲染）
    captain: {
      runners: [], // 上警玩家座位号列表
      withdrawn: [], // 退水玩家座位号列表
      speeches: [], // [{ seat, text }] 警上发言
      elected: null, // 当选警长座位号
      badgeFlow: '', // 警徽流（自由文本，预言家常用）
    },
    analysis: '', // LLM 返回的分析（markdown）
    analyzedAt: 0,
  };
}

function freshState() {
  return {
    phase: 'setup',
    setup: {
      board: '',
      myRole: '',
      mySeat: null,
      playerStyles: '', // 自由文本：熟人玩家风格（由档案库 + 手输合成）
      ruleVersion: {}, // {key: bool}
    },
    /**
     * 座位 → 玩家档案 ID 的绑定。
     * 例：{ "3": "p_xxx", "7": "p_yyy" }
     * 没绑定的座位 = 没见过/不在档案库
     */
    seatBindings: {},
    players: [], // 初始化在 setup 完成后
    rounds: [],
    currentRound: 0,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    // 老存档兼容：给每个 round 补 captain 字段
    if (parsed && Array.isArray(parsed.rounds)) {
      for (const r of parsed.rounds) {
        if (!r.captain) r.captain = { runners: [], withdrawn: [], speeches: [], elected: null, badgeFlow: '' };
      }
    }
    return parsed;
  } catch {
    return freshState();
  }
}

export const game = reactive(load());

watch(
  game,
  (v) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  },
  { deep: true }
);

/** 初始化一局新游戏（SETUP 完成） */
export function startGame({ board, myRole, mySeat, playerStyles, ruleVersion, seatBindings = {}, boardDesc = '' }) {
  // P1-6：支持自定义板子（board 以"自定义："开头时用 boardDesc 描述）
  const isCustom = typeof board === 'string' && board.startsWith('自定义：');
  const preset = isCustom ? null : BOARDS[board];
  if (!isCustom && !preset) throw new Error('未知板子：' + board);

  // 自定义板子从 boardDesc 解析人数（兜底 12）
  let total;
  if (isCustom) {
    const m = boardDesc.match(/(\d+)\s*人/);
    total = m ? Number(m[1]) : 12;
    if (total < 6 || total > 18) total = 12;
  } else {
    total = preset.total;
  }

  game.setup = { board, myRole, mySeat, playerStyles, ruleVersion };
  if (isCustom) game.setup.boardDesc = boardDesc;
  game.seatBindings = seatBindings;
  game.players = Array.from({ length: total }, (_, i) => ({
    seat: i + 1,
    alive: true,
    isMe: i + 1 === mySeat,
    notes: '',
  }));
  game.rounds = [freshRound(1)];
  game.currentRound = 1;
  game.phase = 'playing';
}

/** 切换座位存活状态 */
export function toggleSeatAlive(seat) {
  const p = game.players.find((p) => p.seat === seat);
  if (p) p.alive = !p.alive;
}

/** 进入下一轮 */
export function nextRound() {
  game.currentRound += 1;
  game.rounds.push(freshRound(game.currentRound));
}

/** 当前轮次对象 */
export function currentRound() {
  return game.rounds.find((r) => r.round === game.currentRound);
}

/** 重置整局（清空 localStorage 中的游戏） */
export function resetGame() {
  Object.assign(game, freshState());
  localStorage.removeItem(STORAGE_KEY);
}

/** 导出 JSON（给"导出按钮"用） */
export function exportGame() {
  const blob = new Blob([JSON.stringify(game, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wolf-coach-${new Date().toISOString().slice(0, 10)}-r${game.currentRound}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 导入 JSON */
export function importGame(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
    const data = JSON.parse(reader.result);
    if (!data.setup || !data.rounds) throw new Error('文件格式不正确');
    // 未知板子校验：导入后游戏无法正常初始化 players
    // P1-6：自定义板子（"自定义："开头）放行
    if (data.setup.board && !BOARDS[data.setup.board] && !data.setup.board.startsWith('自定义：')) {
      throw new Error(`未知板子：${data.setup.board}（请确认导出文件来自本应用）`);
    }
        // 老存档兼容：补 captain 字段
        for (const r of data.rounds) {
          if (!r.captain) r.captain = { runners: [], withdrawn: [], speeches: [], elected: null, badgeFlow: '' };
        }
        // 白名单字段过滤（防 __proto__ 等污染）
        const safeFields = ['phase', 'setup', 'seatBindings', 'players', 'rounds', 'currentRound'];
        const safeSetupFields = ['board', 'myRole', 'mySeat', 'playerStyles', 'ruleVersion', 'boardDesc'];
        const safe = {};
        for (const k of safeFields) {
          if (k in data) safe[k] = data[k];
        }
        if (safe.setup && typeof safe.setup === 'object') {
          const safeSetup = {};
          for (const k of safeSetupFields) {
            if (k in safe.setup) safeSetup[k] = safe.setup[k];
          }
          safe.setup = safeSetup;
        }
        Object.assign(game, safe);
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/** 结束游戏（进入复盘阶段） */
export function endGame() {
  game.phase = 'ended';
}

/**
 * P2-18：判断当前是否允许编辑 setup。
 * 守卫：仅在第 1 轮且当前轮未生成 analysis 时可改，避免破坏已有推理上下文。
 */
export function canEditSetup() {
  if (game.phase !== 'playing') return false;
  if (game.currentRound !== 1) return false;
  const r = game.rounds.find((x) => x.round === game.currentRound);
  return !r?.analysis;
}

/**
 * P2-18：更新 setup（保留 rounds，若人数变了则 confirm 后重建 players）。
 * @param {Object} patch { board?, myRole?, mySeat?, playerStyles?, ruleVersion?, boardDesc? }
 */
export function updateSetup(patch) {
  const oldTotal = game.players.length;
  const newBoard = patch.board ?? game.setup.board;
  const isCustom = typeof newBoard === 'string' && newBoard.startsWith('自定义：');
  let newTotal = oldTotal;
  if (!isCustom && BOARDS[newBoard]) {
    newTotal = BOARDS[newBoard].total;
  } else if (isCustom && patch.boardDesc) {
    const m = patch.boardDesc.match(/(\d+)\s*人/);
    newTotal = m ? Number(m[1]) : oldTotal;
    if (newTotal < 6 || newTotal > 18) newTotal = oldTotal;
  }

  // 人数变化 -> confirm 后重建 players（rounds 数据保留但可能不再匹配座位）
  if (newTotal !== oldTotal) {
    if (!confirm(`板子人数从 ${oldTotal} 变为 ${newTotal}，将清空当前轮录入（历史回合保留）。继续？`)) {
      return false;
    }
    // 清掉当前轮（避免座位号错位）
    game.rounds = [freshRound(1)];
    game.currentRound = 1;
  }

  // 应用 setup patch
  Object.assign(game.setup, patch);
  // 重建 players（保留 mySeat 标记）
  if (newTotal !== oldTotal) {
    const mySeat = patch.mySeat ?? game.setup.mySeat;
    game.players = Array.from({ length: newTotal }, (_, i) => ({
      seat: i + 1,
      alive: true,
      isMe: i + 1 === mySeat,
      notes: '',
    }));
  } else if (patch.mySeat !== undefined) {
    // 人数没变但 mySeat 改了
    game.players = game.players.map((p) => ({ ...p, isMe: p.seat === patch.mySeat }));
  }
  return true;
}
