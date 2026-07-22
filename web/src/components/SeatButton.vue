<script setup>
/**
 * 座位号按钮（P2-14 抽公共件）。
 *
 * - 选中态：血月红渐变 + 金边高亮
 * - 未选态：暗墨蓝底 + 金细边
 * - aspect-square 自适应网格
 *
 * 用法：
 *   <SeatButton :n="3" :selected="seat === 3" @click="seat = 3" />
 */
defineProps({
  n: { type: [Number, String], required: true },
  selected: { type: Boolean, default: false },
});
defineEmits(['click']);
</script>

<template>
  <button
    class="aspect-square rounded-lg border-2 text-sm font-semibold active:scale-95 transition"
    :style="
      selected
        ? 'background: linear-gradient(180deg,#c41e3a 0%,#8b0000 100%); border-color: rgba(212,175,55,0.6); color:#f4e8c1;'
        : 'background: rgba(30,41,59,0.5); border-color: rgba(212,175,55,0.22); color:#e8d9a8;'
    "
    @click="$emit('click', n)"
  >
    {{ n }}
  </button>
</template>
