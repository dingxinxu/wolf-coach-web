<script setup>
/**
 * 通用模态外壳（P2-14 抽公共件 + P2-17 无障碍）。
 *
 * - 底部抽屉（移动端）/ 居中弹窗（桌面）自适应
 * - backdrop 点击关闭 + Esc 键关闭
 * - role=dialog + aria-modal=true（无障碍）
 * - 内容通过默认 slot 传入
 *
 * 用法：
 *   <Modal :show="visible" @close="visible = false" max-width="max-w-md">
 *     ...内容...
 *   </Modal>
 */
import { watch, onBeforeUnmount } from 'vue';

const props = defineProps({
  show: { type: Boolean, default: false },
  /** 内层卡片最大宽度 class，如 'max-w-md' / 'max-w-2xl' */
  maxWidth: { type: String, default: 'max-w-md' },
});

const emit = defineEmits(['close']);

function onKeydown(e) {
  if (e.key === 'Escape') emit('close');
}

watch(
  () => props.show,
  (v) => {
    if (v) {
      document.addEventListener('keydown', onKeydown);
      document.body.style.overflow = 'hidden';
    } else {
      document.removeEventListener('keydown', onKeydown);
      document.body.style.overflow = '';
    }
  }
);

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="fixed inset-0 backdrop-blur z-50 flex items-end sm:items-center justify-center"
      style="background: rgba(5, 8, 17, 0.78);"
      @click.self="emit('close')"
    >
      <div
        role="dialog"
        aria-modal="true"
        :class="['rounded-t-2xl sm:rounded-2xl w-full p-4 space-y-3', maxWidth]"
        style="background: linear-gradient(180deg, rgba(17, 24, 39, 0.95) 0%, rgba(5, 8, 17, 0.98) 100%); border: 1px solid rgba(212, 175, 55, 0.3);"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>
