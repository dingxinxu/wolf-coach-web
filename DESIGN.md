# DESIGN — 狼人杀教练 H5 视觉重塑（网易官方狼人杀风格）

> Visual north star: 网易《狼人杀》官方站 — 午夜墨蓝、血月赤红、古金、羊皮卷、哥特/玄秘。
> 当前 UI 是"zinc-on-zinc SaaS 仪表盘"味，本次重塑让它一眼像狼人杀。

## 1. Palette（命名 token）

保留 `wolf`（现有鲜红，已被全代码引用，不重命名以保外科手术性），新增 4 组：

| Token | Hex | 用途 |
|---|---|---|
| `night-950` | `#050811` | 最深底色（替换 `zinc-950`） |
| `night-900` | `#0a0e1a` | 主背景（替换 `zinc-900`） |
| `night-800` | `#111827` | 卡片面（替换 `zinc-800`） |
| `night-700` | `#1e293b` | 抬升面 / hover（替换 `zinc-700`） |
| `night-600` | `#334155` | 分隔线/边框（替换 `zinc-600`） |
| `wolf-*` | 既有 | 血月赤红（主操作 / 危险 / 出局） |
| `blood-700` | `#8b0000` | 血月深（hero 渐变收尾） |
| `gold-300` | `#e8c87a` | 古金亮（标题/重点文本） |
| `gold-400` | `#d4af37` | 古金（边框/装饰） |
| `gold-500` | `#c9a961` | 古金暗（"我"座位边框） |
| `parchment` | `#f4e8c1` | 羊皮卷乳白（对比正文） |
| `steel-500` | `#4a6fa5` | 冷钢蓝（存活/好人提示） |

**核心动作**：把组件里所有 `zinc-*` 替换成对应 `night-*`（带蓝黑调，不再是中性灰）。

## 2. Type Scale

显示字族用系统**宋体/楷体**栈（哥特/古典感），正文用既有 sans。不引外部字体包。

```css
--font-display: "Songti SC","STSong","STKaiti","KaiTi","SimSun","Noto Serif CJK SC",serif;
--font-sans:    "PingFang SC","Microsoft YaHei",system-ui,sans-serif;
```

| 角色 | 字族 | 字号 | 字重 | 行高 |
|---|---|---|---|---|
| wordmark（页头） | serif | text-xl | 700 | tight |
| h1（页标题） | serif | text-2xl | 700 | tight |
| h2（区块） | sans | text-lg | 600 | snug |
| label/eyebrow | sans | text-xs | 500 tracking-wide | normal |
| body | sans | text-sm | 400 | relaxed |
| caption | sans | text-xs | 400 | normal |

## 3. 布局概念（每页 ASCII）

```
对局页（playing）              设置页
┌────────────────────┐        ┌────────────────────┐
│ ☾ 血月 狼人杀教练 ·· │ header │ ☾ 狼人杀教练        │
├────────────────────┤        ├────────────────────┤
│ 第N轮·身份·座位 (金线)│        │ API Key 来源(卡片)   │
│ 存活 N/M            │        │ LLM 配置(卡片)       │
├────────────────────┤        │ 语音转写(卡片)       │
│ ▢ 座位网格 6×N      │        │ 档案库(卡片)         │
├────────────────────┤        ├────────────────────┤
│ ▢ 夜晚报告 卡片      │        └────────────────────┘
│ ▢ 上警 卡片(可选)    │
│ ▢ 发言 卡片          │  固定底栏(playing)
│ ▢ 票型 卡片          │  ┌────────────────────┐
├────────────────────┤  │ [让教练分析] [下一轮]│
│ 教练分析（金角装饰）  │  └────────────────────┘
└────────────────────┘
```

## 4. Signature Element（一个记忆点）

**血月页头**：header 左侧放一个 CSS 血月（径向赤红光晕 + 暗金描边的圆盘），右侧"狼人杀教练"用宋体竖排笔意。
全站每页可见，是唯一的高调装饰；其余元素克制。分析 CTA 用血色渐变 + idle 时金边微脉冲（狼眼感），作为 signature 的余韵而非第二个高潮。

## 5. 组件重塑清单

| 文件 | 改动 |
|---|---|
| `tailwind.config.js` | +`night`/`blood`/扩展`gold`/`parchment`/`steel`，+`font.serif` |
| `style.css` | 背景换午夜+血月径向；`.card`/`.btn-*`/`.seat-*`/`.chip-*` 重写为 night+gold；新增 `.blood-moon`/`.card-tarot`/`moon-glow` keyframe；保留 `rec-pulse`/`stream-cursor`/`prose-invert h2` |
| `App.vue` | header 加血月元素 + 宋体 wordmark；nav pill 换 night+gold |
| `Play.vue` | 头部卡换金线；底操作栏 night 底+金细分隔；分析 CTA 加 idle 金脉冲 |
| `SetupWizard.vue` | 板子卡→tarot 风；进度条 gold/wolf；身份/规则 chip 沿用新 chip 样式 |
| `SeatGrid.vue` | seat 我=金边、出局=血红 glow；提示文案改"金框是你" |
| `RoundInput.vue` | 4 卡片标题 eyebrow 化（夜🔴/上警🟣/发言🟡/票型🔴）；内部 input/select night 化 |
| `AnalysisPanel.vue` | 卡片金角装饰；loader 狼眼脉冲；key 来源 chip night 化 |
| `VoiceRecorder.vue` | 录音键血月渐变（沿用 rec-pulse） |
| `AccessBanner.vue` | 未解锁=血色条；已解锁=钢蓝条 |
| `TermFaq.vue` | 模态 night 底+金边；tab chip 新样式 |
| `PlayerPicker.vue` | 座位徽章 gold；编辑面板 night |
| `Settings.vue`/`Admin.vue` | input/select/code 全 night 化；preset chip 新样式 |

## 6. 自我批评（避免"AI 默认"）

- **反面**：当前是 zinc-900 卡 + wolf-600 按钮 = 任何深色 SaaS 都长这样。
- **纠正**：所有面换带蓝调的 `night`（不是中性灰），边框一律 gold 色调 1px 细线（不是 zinc），卡片有极轻金色内高光——整体读起来像"夜里点蜡烛的圆桌"，而非"Vercel dashboard"。
- **克制**：血月只用在一处（页头）。不用 acid 绿/朱砂单色酸调（AI 默认黑底套路之一），不用暖奶油底（另一 AI 默认）——选**墨蓝+古金+血月**三色叙事，是狼人杀本身的世界观。
- **字体风险**：系统宋体在不同设备渲染差异大，但比引外部字体包更稳（约束 3）。显示字仅用于 wordmark/h1，正文仍 sans，可读性不降。
- **不做的事**：不引动画库/字体包/图标库；不改任何 store/逻辑/函数名；不动 props/emit 契约。
