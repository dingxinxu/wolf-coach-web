/**
 * 玩家档案库 store。
 *
 * 用途：跨局保存线下面杀遇到的玩家，记录风格标签 + 头像 emoji + 备注。
 * SETUP 时把档案关联到当前局座位，让教练在 system prompt 里就能"认识"熟人。
 *
 * 存储：localStorage key 'wolf-coach-roster-v1'
 *
 * 数据结构：
 *   player = {
 *     id: string,         // 用作 key，nanoid 风格时间戳
 *     name: string,       // 玩家昵称/外号
 *     avatar: string,     // emoji 单字符
 *     styleTags: string[],// 选自 STYLE_TAGS 词库
 *     note: string,       // 自由备注
 *     createdAt: number,
 *     updatedAt: number,
 *   }
 *
 * 当前局关联：
 *   currentGameBindings: { [playerId]: seatNumber }  反向: seat → playerId
 *   存在 game store 的 setup 里，本 store 只负责档案库本身。
 */
import { reactive, watch } from 'vue';

const STORAGE_KEY = 'wolf-coach-roster-v1';

/** 风格标签词库（与狼人杀场景贴合） */
export const STYLE_TAGS = [
  '悍跳狼',
  '倒钩狼',
  '深水狼',
  '冲锋狼',
  '预言家位',
  '女巫位',
  '平民高手',
  '新手',
  '熟人',
  '情绪化',
  '逻辑流',
  '表演流',
];

/** 默认 emoji 头像池 */
export const AVATAR_POOL = [
  '🐺', '🦊', '🐯', '🦁', '🐻', '🐼', '🐨', '🦝',
  '🐱', '🐶', '🦊', '🐰', '🦄', '🐙', '🦖', '🐉',
  '👨', '👩', '🧔', '👱', '👨‍🦰', '👩‍🦰', '🧑‍🦱', '👩‍🦱',
  '😏', '🤓', '😎', '🤔', '😬', '😈', '👽', '🤖',
];

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { players: [] };
    return JSON.parse(raw);
  } catch {
    return { players: [] };
  }
}

export const roster = reactive(load());

watch(
  roster,
  (v) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  },
  { deep: true }
);

function genId() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

export function createPlayer(data = {}) {
  const p = {
    id: genId(),
    name: data.name || '',
    avatar: data.avatar || AVATAR_POOL[Math.floor(Math.random() * 8)],
    styleTags: data.styleTags || [],
    note: data.note || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  roster.players.push(p);
  return p;
}

export function updatePlayer(id, patch) {
  const p = roster.players.find((p) => p.id === id);
  if (!p) return;
  Object.assign(p, patch, { updatedAt: Date.now() });
}

export function deletePlayer(id) {
  const i = roster.players.findIndex((p) => p.id === id);
  if (i >= 0) roster.players.splice(i, 1);
}

export function getPlayer(id) {
  return roster.players.find((p) => p.id === id);
}

/**
 * 把当前局座位 → 玩家档案 ID 的映射格式化成"熟人风格"字符串，
 * 用于注入 system prompt 的 playerStyles 字段。
 */
export function formatBindingsForPrompt(bindings) {
  if (!bindings || Object.keys(bindings).length === 0) return '';
  const lines = [];
  for (const [seat, pid] of Object.entries(bindings)) {
    const p = getPlayer(pid);
    if (!p) continue;
    const tags = p.styleTags.length ? p.styleTags.join('/') : '';
    const parts = [`${seat}号`];
    if (p.name) parts.push(p.name);
    if (tags) parts.push(`[${tags}]`);
    if (p.note) parts.push(`（${p.note}）`);
    lines.push(parts.join(' '));
  }
  return lines.join('；');
}
