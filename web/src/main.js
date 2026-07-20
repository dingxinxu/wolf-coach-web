import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import Play from './views/Play.vue';
import Settings from './views/Settings.vue';
import Admin from './views/Admin.vue';
import './style.css';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'play', component: Play },
    { path: '/settings', name: 'settings', component: Settings },
    { path: '/admin', name: 'admin', component: Admin },
  ],
});

createApp(App).use(router).mount('#app');
