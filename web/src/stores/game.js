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

const STORAGE_KEY = 'wolf-coach-game-v1';

/** 板子预设（同 SKILL.md 主流板子表） */
export const BOARDS = {
  '9预女猎': { total: 9, gods: '预言家/女巫/猎人', civs: 3, wolves: 3, hasCaptain: true },
  '12预女猎守': { total: 12, gods: '预言家/女巫/猎人/守卫', civs: 4, wolves: 4, hasCaptain: true },
  '12预女猎白': { total: 12, gods: '预言家/女巫/猎人/白痴', civs: 4, wolves: 4, hasCaptain: true },
};

export const ROLES = [
  '预言家',
  '女巫',
  '猎人',
  '守卫',
  '白痴',
  '平民',
  '狼人',
  '狼王',
  '白狼王',
  '其他',
];

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
export function startGame({ board, myRole, mySeat, playerStyles, ruleVersion, seatBindings = {} }) {
  const preset = BOARDS[board];
  if (!preset) throw new Error('未知板子：' + board);

  game.setup = { board, myRole, mySeat, playerStyles, ruleVersion };
  game.seatBindings = seatBindings;
  game.players = Array.from({ length: preset.total }, (_, i) => ({
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
        // 老存档兼容：补 captain 字段
        for (const r of data.rounds) {
          if (!r.captain) r.captain = { runners: [], withdrawn: [], speeches: [], elected: null, badgeFlow: '' };
        }
        Object.assign(game, data);
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
