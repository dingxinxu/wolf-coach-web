<script setup>
/**
 * 玩家档案选择器：为当前局每个座位关联/创建玩家档案。
 *
 * 在 SETUP Step 3 出现，座位网格下面。
 *
 * 用法：
 *   const bindings = ref({});  // { seat: playerId }
 *   <PlayerPicker v-model:bindings="bindings" :total="preset.total" :mySeat="mySeat" />
 */
import { computed, ref, watch } from 'vue';
import {
  roster,
  createPlayer,
  updatePlayer,
  deletePlayer,
  getPlayer,
  STYLE_TAGS,
  AVATAR_POOL,
  formatBindingsForPrompt,
} from '../stores/players-roster.js';

const props = defineProps({
  bindings: { type: Object, required: true }, // { seat: playerId }
  total: { type: Number, required: true },
  mySeat: { type: Number, default: null },
});
const emit = defineEmits(['update:bindings']);

/** 当前展开编辑的座位 */
const editingSeat = ref(null);

const seats = computed(() =>
  Array.from({ length: props.total }, (_, i) => i + 1)
);

function bind(seat, playerId) {
  const next = { ...props.bindings };
  if (playerId) next[seat] = playerId;
  else delete next[seat];
  emit('update:bindings', next);
}

function seatPlayer(seat) {
  const id = props.bindings[seat];
  return id ? getPlayer(id) : null;
}

function edit(seat) {
  editingSeat.value = editingSeat.value === seat ? null : seat;
}

// ===== 新建玩家表单 =====
const newPlayer = ref({ name: '', avatar: AVATAR_POOL[0], styleTags: [], note: '' });

function toggleNewTag(tag) {
  const i = newPlayer.value.styleTags.indexOf(tag);
  if (i >= 0) newPlayer.value.styleTags.splice(i, 1);
  else newPlayer.value.styleTags.push(tag);
}

function addNewPlayer(seat) {
  if (!newPlayer.value.name.trim()) {
    alert('请填昵称');
    return;
  }
  const p = createPlayer({ ...newPlayer.value });
  bind(seat, p.id);
  newPlayer.value = { name: '', avatar: AVATAR_POOL[0], styleTags: [], note: '' };
  editingSeat.value = null;
}

function unbind(seat) {
  bind(seat, null);
}

// ===== 编辑已绑定玩家 =====
function toggleTagOn(player, tag) {
  const i = player.styleTags.indexOf(tag);
  if (i >= 0) player.styleTags.splice(i, 1);
  else player.styleTags.push(tag);
}

// 暴露合成好的描述字符串（供父组件注入 playerStyles）
defineExpose({
  formatBindings: () => formatBindingsForPrompt(props.bindings),
});
</script>

<template>
  <div class="space-y-2">
    <div class="text-sm text-zinc-400">熟人玩家（可选，让教练"认识"他们）</div>

    <div class="grid grid-cols-1 gap-1.5">
      <div
        v-for="seat in seats"
        :key="seat"
        :class="[
          'flex items-center gap-2 p-2 rounded-lg border',
          seatPlayer(seat)
            ? 'bg-zinc-900 border-zinc-700'
            : 'bg-zinc-950 border-zinc-800',
          seat === mySeat ? 'opacity-50' : '',
        ]"
      >
        <div class="w-8 h-8 flex items-center justify-center rounded bg-wolf-700 font-bold">
          {{ seat }}
        </div>

        <div v-if="seat === mySeat" class="text-xs text-zinc-500">你自己（无需绑定）</div>

        <template v-else-if="seatPlayer(seat)">
          <div class="text-xl">{{ seatPlayer(seat).avatar }}</div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">
              {{ seatPlayer(seat).name || '未命名' }}
            </div>
            <div v-if="seatPlayer(seat).styleTags.length" class="text-xs text-zinc-500 truncate">
              {{ seatPlayer(seat).styleTags.join(' / ') }}
            </div>
          </div>
          <button class="btn-ghost text-xs" @click="edit(seat)">编辑</button>
          <button class="btn-ghost text-xs text-wolf-400" @click="unbind(seat)">解绑</button>
        </template>

        <template v-else>
          <div class="text-sm text-zinc-500 flex-1">未绑定</div>
          <button class="btn-ghost text-xs" @click="edit(seat)">+ 关联</button>
        </template>
      </div>
    </div>

    <!-- 编辑/新建面板 -->
    <div
      v-if="editingSeat"
      class="bg-zinc-900 border border-zinc-700 rounded-lg p-3 space-y-3"
    >
      <template v-if="seatPlayer(editingSeat)">
        <!-- 编辑现有 -->
        <div class="text-xs text-zinc-500">编辑 {{ seatPlayer(editingSeat).name }}</div>

        <label class="block">
          <div class="text-xs text-zinc-400 mb-1">昵称</div>
          <input
            :value="seatPlayer(editingSeat).name"
            @input="updatePlayer(seatPlayer(editingSeat).id, { name: $event.target.value })"
            type="text"
            class="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-sm"
          />
        </label>

        <div>
          <div class="text-xs text-zinc-400 mb-1">头像</div>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="emoji in AVATAR_POOL.slice(0, 16)"
              :key="emoji"
              :class="[
                'w-8 h-8 rounded text-lg',
                seatPlayer(editingSeat).avatar === emoji ? 'bg-wolf-600' : 'bg-zinc-800',
              ]"
              @click="updatePlayer(seatPlayer(editingSeat).id, { avatar: emoji })"
            >{{ emoji }}</button>
          </div>
        </div>

        <div>
          <div class="text-xs text-zinc-400 mb-1">风格标签</div>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="tag in STYLE_TAGS"
              :key="tag"
              :class="seatPlayer(editingSeat).styleTags.includes(tag) ? 'chip-on text-xs' : 'chip-off text-xs'"
              @click="toggleTagOn(seatPlayer(editingSeat), tag)"
            >{{ tag }}</button>
          </div>
        </div>

        <label class="block">
          <div class="text-xs text-zinc-400 mb-1">备注</div>
          <textarea
            :value="seatPlayer(editingSeat).note"
            @input="updatePlayer(seatPlayer(editingSeat).id, { note: $event.target.value })"
            rows="2"
            class="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-sm"
          ></textarea>
        </label>

        <div class="flex justify-between">
          <button
            class="btn-ghost text-xs text-wolf-400"
            @click="deletePlayer(seatPlayer(editingSeat).id); unbind(editingSeat); editingSeat = null"
          >
            彻底删除
          </button>
          <button class="btn-secondary text-xs" @click="editingSeat = null">完成</button>
        </div>
      </template>

      <template v-else>
        <!-- 关联现有 / 新建 -->
        <div class="text-xs text-zinc-500">为 {{ editingSeat }} 号关联玩家</div>

        <!-- 现有玩家快速关联 -->
        <div v-if="roster.players.length" class="space-y-1">
          <div class="text-xs text-zinc-400">从档案库选：</div>
          <div class="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
            <button
              v-for="p in roster.players"
              :key="p.id"
              class="chip-off text-xs"
              @click="bind(editingSeat, p.id); editingSeat = null"
            >
              {{ p.avatar }} {{ p.name || '未命名' }}
            </button>
          </div>
        </div>

        <div class="border-t border-zinc-800 pt-2">
          <div class="text-xs text-zinc-400 mb-2">新建：</div>
          <label class="block mb-2">
            <input
              v-model="newPlayer.name"
              type="text"
              class="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-sm"
              placeholder="昵称 / 外号"
            />
          </label>
          <div class="mb-2">
            <div class="flex flex-wrap gap-1">
              <button
                v-for="emoji in AVATAR_POOL.slice(0, 12)"
                :key="emoji"
                :class="[
                  'w-8 h-8 rounded text-lg',
                  newPlayer.avatar === emoji ? 'bg-wolf-600' : 'bg-zinc-800',
                ]"
                @click="newPlayer.avatar = emoji"
              >{{ emoji }}</button>
            </div>
          </div>
          <div class="mb-2">
            <div class="flex flex-wrap gap-1">
              <button
                v-for="tag in STYLE_TAGS"
                :key="tag"
                :class="newPlayer.styleTags.includes(tag) ? 'chip-on text-xs' : 'chip-off text-xs'"
                @click="toggleNewTag(tag)"
              >{{ tag }}</button>
            </div>
          </div>
          <button class="btn-primary w-full text-sm" @click="addNewPlayer(editingSeat)">
            + 新建并关联
          </button>
        </div>

        <button class="btn-ghost text-xs w-full" @click="editingSeat = null">取消</button>
      </template>
    </div>
  </div>
</template>
