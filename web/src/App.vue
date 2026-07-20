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
      class="flex items-center justify-between px-4 py-3 border-b border-zinc-800/80 backdrop-blur-md sticky top-0 z-10"
      style="background: linear-gradient(180deg, rgba(10,10,10,0.95) 0%, rgba(10,10,10,0.75) 100%);"
    >
      <RouterLink to="/" class="flex items-center gap-2 font-bold active:scale-95 transition">
        <span class="text-2xl drop-shadow">🐺</span>
        <span class="text-lg tracking-wide">狼人杀教练</span>
      </RouterLink>
      <nav class="flex items-center gap-1 text-sm">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          :class="[
            'px-3 py-1.5 rounded-lg transition active:scale-95',
            activePath === item.to
              ? 'bg-wolf-600/20 text-wolf-400 border border-wolf-700/50'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50',
          ]"
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
