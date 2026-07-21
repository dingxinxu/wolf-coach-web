<script setup>
import { useRoute } from 'vue-router';
import { RouterLink, RouterView } from 'vue-router';
import { computed } from 'vue';
import AccessBanner from './components/AccessBanner.vue';

const route = useRoute();
const navItems = [
  { to: '/', label: '对局', icon: '🐺' },
  { to: '/settings', label: '设置', icon: '⚙️' },
];
const activePath = computed(() => route.path);
</script>

<template>
  <div class="min-h-full flex flex-col max-w-3xl mx-auto">
    <header
      class="flex items-center justify-between px-4 py-3 backdrop-blur-md sticky top-0 z-10 border-b"
      style="background: linear-gradient(180deg, rgba(5,8,17,0.96) 0%, rgba(5,8,17,0.82) 100%); border-color: rgba(212,175,55,0.2);"
    >
      <RouterLink to="/" class="flex items-center gap-2.5 active:scale-95 transition">
        <!-- 血月：signature 元素（纯 CSS） -->
        <span class="blood-moon shrink-0" aria-hidden="true"></span>
        <span class="flex flex-col leading-none">
          <span class="font-serif text-lg tracking-[0.12em] text-parchment" style="text-shadow: 0 0 10px rgba(139,0,0,0.5);">狼人杀教练</span>
          <span class="text-[9px] text-gold-400/60 mt-0.5 tracking-[0.25em] uppercase">Werewolf Coach</span>
        </span>
      </RouterLink>
      <nav class="flex items-center gap-1 text-sm">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          :class="[
            'px-3 py-1.5 rounded-lg transition active:scale-95',
            activePath === item.to
              ? 'text-gold-300 border'
              : 'text-parchment-200/60 hover:text-parchment hover:bg-night-700/40 border border-transparent',
          ]"
          :style="activePath === item.to ? 'background: rgba(139,0,0,0.25); border-color: rgba(212,175,55,0.5);' : ''"
        >
          <span class="mr-1">{{ item.icon }}</span>{{ item.label }}
        </RouterLink>
      </nav>
    </header>

    <AccessBanner />

    <main class="flex-1 overflow-y-auto px-4 py-4 pb-28">
      <RouterView />
    </main>
  </div>
</template>
