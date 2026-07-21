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
    <div class="eyebrow text-gold-400/80">熟人玩家（可选，让教练"认识"他们）</div>

    <div class="grid grid-cols-1 gap-1.5">
      <div
        v-for="seat in seats"
        :key="seat"
        class="flex items-center gap-2 p-2 rounded-lg border"
        :style="
          seatPlayer(seat)
            ? 'background: rgba(17,24,39,0.6); border-color: rgba(212,175,55,0.25);'
            : 'background: rgba(5,8,17,0.5); border-color: rgba(212,175,55,0.12);'
        "
        :class="seat === mySeat ? 'opacity-50' : ''"
      >
        <div
          class="w-8 h-8 flex items-center justify-center rounded font-serif font-bold"
          style="background: linear-gradient(135deg, rgba(212,175,55,0.25) 0%, rgba(139,0,0,0.4) 100%); border: 1px solid rgba(212,175,55,0.4); color:#e8c87a;"
        >
          {{ seat }}
        </div>

        <div v-if="seat === mySeat" class="text-xs text-parchment-200/40">你自己（无需绑定）</div>

        <template v-else-if="seatPlayer(seat)">
          <div class="text-xl">{{ seatPlayer(seat).avatar }}</div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate text-parchment">
              {{ seatPlayer(seat).name || '未命名' }}
            </div>
            <div v-if="seatPlayer(seat).styleTags.length" class="text-xs text-gold-400/60 truncate">
              {{ seatPlayer(seat).styleTags.join(' / ') }}
            </div>
          </div>
          <button class="btn-ghost text-xs" @click="edit(seat)">编辑</button>
          <button class="btn-ghost text-xs text-wolf-400" @click="unbind(seat)">解绑</button>
        </template>

        <template v-else>
          <div class="text-sm text-parchment-200/40 flex-1">未绑定</div>
          <button class="btn-ghost text-xs" @click="edit(seat)">+ 关联</button>
        </template>
      </div>
    </div>

    <!-- 编辑/新建面板 -->
    <div
      v-if="editingSeat"
      class="rounded-lg p-3 space-y-3"
      style="background: rgba(17,24,39,0.7); border: 1px solid rgba(212,175,55,0.25);"
    >
      <template v-if="seatPlayer(editingSeat)">
        <!-- 编辑现有 -->
        <div class="eyebrow text-gold-400/70">编辑 {{ seatPlayer(editingSeat).name }}</div>

        <label class="block">
          <div class="eyebrow text-gold-400/60 mb-1">昵称</div>
          <input
            :value="seatPlayer(editingSeat).name"
            @input="updatePlayer(seatPlayer(editingSeat).id, { name: $event.target.value })"
            type="text"
            class="w-full rounded p-2 text-sm text-parchment focus:outline-none"
            style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
          />
        </label>

        <div>
          <div class="eyebrow text-gold-400/60 mb-1">头像</div>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="emoji in AVATAR_POOL.slice(0, 16)"
              :key="emoji"
              class="w-8 h-8 rounded text-lg"
              :style="seatPlayer(editingSeat).avatar === emoji ? 'background: linear-gradient(180deg,#c41e3a 0%,#8b0000 100%); border:1px solid rgba(212,175,55,0.5);' : 'background: rgba(30,41,59,0.5); border:1px solid rgba(212,175,55,0.15);'"
              @click="updatePlayer(seatPlayer(editingSeat).id, { avatar: emoji })"
            >{{ emoji }}</button>
          </div>
        </div>

        <div>
          <div class="eyebrow text-gold-400/60 mb-1">风格标签</div>
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
          <div class="eyebrow text-gold-400/60 mb-1">备注</div>
          <textarea
            :value="seatPlayer(editingSeat).note"
            @input="updatePlayer(seatPlayer(editingSeat).id, { note: $event.target.value })"
            rows="2"
            class="w-full rounded p-2 text-sm text-parchment focus:outline-none"
            style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
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
        <div class="eyebrow text-gold-400/70">为 {{ editingSeat }} 号关联玩家</div>

        <!-- 现有玩家快速关联 -->
        <div v-if="roster.players.length" class="space-y-1">
          <div class="eyebrow text-gold-400/60">从档案库选：</div>
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

        <div class="pt-2" style="border-top: 1px solid rgba(212,175,55,0.15);">
          <div class="eyebrow text-gold-400/60 mb-2">新建：</div>
          <label class="block mb-2">
            <input
              v-model="newPlayer.name"
              type="text"
              class="w-full rounded p-2 text-sm text-parchment focus:outline-none placeholder:text-parchment-200/30"
              style="background: rgba(5,8,17,0.6); border: 1px solid rgba(212,175,55,0.22);"
              placeholder="昵称 / 外号"
            />
          </label>
          <div class="mb-2">
            <div class="flex flex-wrap gap-1">
              <button
                v-for="emoji in AVATAR_POOL.slice(0, 12)"
                :key="emoji"
                class="w-8 h-8 rounded text-lg"
                :style="newPlayer.avatar === emoji ? 'background: linear-gradient(180deg,#c41e3a 0%,#8b0000 100%); border:1px solid rgba(212,175,55,0.5);' : 'background: rgba(30,41,59,0.5); border:1px solid rgba(212,175,55,0.15);'"
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
