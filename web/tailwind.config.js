/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts}'],
  theme: {
    extend: {
      colors: {
        // 狼人杀主题：午夜墨蓝 + 血月赤红 + 古金 + 羊皮卷（网易官方狼人杀风格）
        // night：带蓝调的深黑/深蓝，替换中性 zinc 灰
        night: {
          950: '#050811',
          900: '#0a0e1a',
          850: '#0e1422',
          800: '#111827',
          700: '#1e293b',
          600: '#334155',
          500: '#475569',
        },
        wolf: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#dc2626',
          600: '#b91c1c',
          700: '#991b1b',
          800: '#7f1d1d',
          900: '#5b1313',
        },
        blood: {
          // 血月深红
          700: '#8b0000',
          800: '#6b0000',
          900: '#4a0202',
        },
        good: {
          400: '#4ade80',
          500: '#16a34a',
          600: '#15803d',
        },
        gold: {
          200: '#f0d99a',
          300: '#e8c87a',
          400: '#d4af37',
          500: '#c9a961',
          600: '#a8893f',
        },
        parchment: {
          // 羊皮卷乳白，用于对比正文
          DEFAULT: '#f4e8c1',
          200: '#e8d9a8',
          300: '#cdb885',
        },
        steel: {
          // 冷钢蓝，存活/好人提示
          500: '#4a6fa5',
          600: '#3a5a8a',
        },
      },
      fontFamily: {
        sans: ['"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
        serif: ['"Songti SC"', '"STSong"', '"STKaiti"', '"KaiTi"', '"SimSun"', '"Noto Serif CJK SC"', 'serif'],
      },
    },
  },
  plugins: [],
};
