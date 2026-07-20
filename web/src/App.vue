<script setup>
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
  <div class="min-h-full flex flex-col max-w-3xl mx-auto">
    <header class="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
      <RouterLink to="/" class="flex items-center gap-2 font-bold">
        <span class="text-2xl">🐺</span>
        <span class="text-lg">狼人杀教练</span>
      </RouterLink>
      <nav class="flex items-center gap-1 text-sm">
        <RouterLink to="/" class="btn-ghost">对局</RouterLink>
        <RouterLink to="/settings" class="btn-ghost">设置</RouterLink>
      </nav>
    </header>

    <main class="flex-1 overflow-y-auto px-4 py-4">
      <RouterView />
    </main>
  </div>
</template>
