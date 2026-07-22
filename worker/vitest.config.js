import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // worker 纯函数 + 业务规则测试用 node 环境跑（crypto.subtle 需 node 20+）
    environment: 'node',
    include: ['src/**/*.test.js', '*.test.js'],
  },
});
