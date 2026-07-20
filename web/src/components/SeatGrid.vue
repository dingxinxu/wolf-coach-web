<script setup>
/**
 * 座位网格：点击切换存活。
 * 我的座位用红色 ring 标注。
 * 若座位绑定了玩家档案，显示头像 emoji（替换默认座位号布局）。
 */
import { computed } from 'vue';
import { game, toggleSeatAlive } from '../stores/game.js';
import { getPlayer } from '../stores/players-roster.js';

const props = defineProps({
  /** 是否允许修改存活状态（false 时仅展示） */
  editable: { type: Boolean, default: true },
});

function seatClass(p) {
  return [
    'seat',
    p.alive ? 'seat-alive' : 'seat-dead',
    p.isMe ? 'seat-me' : '',
  ];
}

/** 当前座位绑定的玩家档案（如果有） */
function boundPlayer(seat) {
  const id = game.seatBindings?.[String(seat)];
  return id ? getPlayer(id) : null;
}

function click(p) {
  if (!props.editable) return;
  if (p.isMe) return; // 不允许把自己点死
  toggleSeatAlive(p.seat);
}
</script>

<template>
  <div>
    <div class="text-xs text-zinc-500 mb-2">
      点击切换存活 · 红框是你的座位 · 头像来自玩家档案库
    </div>
    <div class="grid grid-cols-6 gap-2">
      <button
        v-for="p in game.players"
        :key="p.seat"
        :class="seatClass(p)"
        @click="click(p)"
      >
        <!-- 有绑定的座位：头像 + 座位号 -->
        <template v-if="boundPlayer(p.seat)">
          <div class="text-2xl leading-none">{{ boundPlayer(p.seat).avatar }}</div>
          <div class="text-[10px] text-zinc-400 mt-0.5">#{{ p.seat }}</div>
        </template>
        <!-- 我的座位 -->
        <template v-else-if="p.isMe">
          <div class="text-xl">🙋</div>
          <div class="text-[10px] text-wolf-400 mt-0.5">我 #{{ p.seat }}</div>
        </template>
        <!-- 未绑定 + 已出局 -->
        <template v-else-if="!p.alive">
          <div>{{ p.seat }}</div>
          <div class="text-[10px] mt-0.5">出局</div>
        </template>
        <!-- 未绑定 + 存活 -->
        <template v-else>
          <div>{{ p.seat }}</div>
        </template>
      </button>
    </div>
  </div>
</template>
