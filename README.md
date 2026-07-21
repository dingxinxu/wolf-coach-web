# 🐺 狼人杀制胜教练 · Web

> 把 wolf-game-coach 技能封装为 H5 应用，
> 让你在线下对局时随时拿出手机访问，实时获得教练级建议。

[![Deploy](https://github.com/dingxinxu/wolf-coach-web/actions/workflows/deploy.yml/badge.svg)](./.github/workflows/deploy.yml)

> 🌐 **线上访问**：<https://dingxinxu.github.io/wolf-coach-web/>
> 📦 **源码仓库**：<https://github.com/dingxinxu/wolf-coach-web>

## ✨ 特性

- **极简卡片选择**：板子、身份、座位、票型全部点击选择，几乎不用打字。
- **教练级分析**：直接注入 wolf-game-coach 全套规则+策略文档作为 system prompt，
  LLM 按 SKILL.md 规范的 6 段格式输出（追问/态势/发言/决策/风险/下轮）。
- **🎙 语音转写**：每个玩家发言一段录音，Groq Whisper large-v3 自动转写到文本框。
- **🧠 文本情绪判断**：每轮分析追加【玩家情绪】表格，依据话术特征识别紧张/说谎嫌疑等。
- **👥 玩家档案库**：跨局保存熟人玩家头像 + 风格标签（悍跳狼/倒钩狼/新手等），
  开新局一键关联座位，让教练"认识"他们。
- **OpenAI 兼容**：默认 DeepSeek（国内原生访问），可改 Claude / OpenAI / Groq 等。
- **双 Key 模式**：用你自己的 API Key，或用管理员维护的共享池。LLM 与 STT Key 独立。
- **离线持久化**：每局进度 + 玩家档案库 自动存 localStorage，一键导出/导入 JSON。
- **术语/FAQ 内置**：直接读技能 md，零 token 消耗。

## 🏗 架构

```
wolf-coach-web/                # 本仓库（monorepo）
├── skill-source/              # 技能源（仓库内真相源，4 个 md 文件）
│   ├── SKILL.md
│   ├── README.md
│   └── references/{rules,strategy,glossary}.md
├── web/                       # Vue 3 + Vite + Tailwind 前端
│   ├── src/
│   │   ├── views/             # Play / Settings / Admin
│   │   ├── components/        # SetupWizard / SeatGrid / RoundInput / AnalysisPanel / TermFaq / VoiceRecorder / PlayerPicker
│   │   ├── stores/            # settings.js / game.js / players-roster.js
│   │   └── lib/               # llm.js / md.js / stt.js
│   └── public/skill/          # ← 由 scripts/sync-skill.js 同步过来
├── worker/                    # Cloudflare Worker 后端代理
│   ├── src/index.js           # 主入口（路由 + OpenAI 兼容转发 + Whisper 透传）
│   ├── src/skill-loader.js    # 加载技能 md 并组装 system prompt
│   ├── skill/                 # ← 由 sync-skill.js 同步过来
│   └── skill-bundle.js        # ← 由 inline-skill.js 生成（md → JS 模块）
├── scripts/
│   ├── sync-skill.js          # 从 skill-source/ 同步到 web/worker
│   └── inline-skill.js        # 把 md 打包成 worker 可 import 的 JS
└── .github/workflows/deploy.yml
```

**数据流：**

```
┌─────────────┐     /api/chat      ┌──────────────┐    OpenAI 兼容    ┌─────┐
│  Vue 前端   │ ──────────────────▶│  CF Worker   │ ───────────────▶ │ LLM │
│ (GitHub     │                    │  - 注入技能   │ ◀───────────────│     │
│  Pages)     │ ◀──────────────────│  - Key 透传   │   SSE 流式       └─────┘
└─────────────┘    SSE 流式        │  - 路由 admin │
                                    └──────────────┘
```

## 🚀 快速开始（本地开发）

```bash
# 1. 克隆
git clone https://github.com/dingxinxu/wolf-coach-web.git
cd wolf-coach-web

# 2. 安装依赖
pnpm install

# 3. 同步技能文档（从 skill-source/ 拷贝到 web/worker）
node scripts/sync-skill.js
node scripts/inline-skill.js

# 4. 配置 Worker Secret（仅当你想用兜底 Key）
cp worker/.dev.vars.example worker/.dev.vars
# 编辑 .dev.vars 填入 DEFAULT_LLM_API_KEY=sk-xxx

# 5. 启动
# 终端 A：Worker
pnpm dev:worker    # 监听 http://localhost:8787
# 终端 B：前端
pnpm dev:web       # 监听 http://localhost:5173，自动代理 /api -> 8787
```

打开 http://localhost:5173/wolf-coach-web/，进【设置】填入你自己的 API Key（推荐 DeepSeek），
回到【对局】开始配置本局。

## 📦 部署

### 前端 → GitHub Pages

1. Fork 或推送到你的 GitHub 仓库。
2. 仓库 Settings → Pages → Source：**GitHub Actions**。
3. push 到 main 自动部署。
4. 访问地址：`https://dingxinxu.github.io/wolf-coach-web/`

> 仓库名默认与 `web/vite.config.js` 中的 `GH_PAGES_BASE = '/wolf-coach-web/'` 匹配。
> 如改仓库名需同步修改 base path。

### Worker → Cloudflare Workers

1. 注册 Cloudflare 账号，安装 wrangler：`pnpm add -g wrangler`。
2. 登录：`wrangler login`。
3. 创建 KV namespace：
   ```bash
   wrangler kv:namespace create LLM_POOL
   wrangler kv:namespace create LLM_POOL --preview
   ```
   把返回的 `id` 和 `preview_id` 填入 `worker/wrangler.toml`。
4. 部署：
   ```bash
   cd worker
   wrangler deploy
   ```
5. （可选）设置兜底 Key：
   ```bash
   wrangler secret put DEFAULT_LLM_API_KEY
   ```
6. 前端【设置】页的「Worker URL」填部署后的 `https://<name>.workers.dev`。

### CF Access 保护 /admin（推荐）

1. Cloudflare Dashboard → Zero Trust → Access → Applications → Add Application.
2. Type: Self-hosted，Application domain: `<your-worker>.workers.dev/admin/*`。
3. 配置 Policy（邮箱 OTP 或 Google 登录）。
4. 部署后访问 `/admin` 会被 CF Access 拦截要求登录，通过后才能修改共享池配置。

## 🔒 隐私与安全

- **用户自带 Key**：仅存浏览器 localStorage，每次请求透传给 Worker，
  Worker 不存储，转发给 LLM 后丢弃。
- **管理员共享池**：Key 存 Worker KV，管理员通过 CF Access 维护，普通用户不可见。
- **对局数据**：完全本地 localStorage，永不上传。
- **录音数据**：只在转写期间传给 Groq Whisper，Worker 不存盘，转写完即丢弃。

## 🎙 录音使用须知

- **必须 HTTPS**：浏览器只在 HTTPS（或 localhost）下授权麦克风。
  GitHub Pages 和 Cloudflare Workers 默认都是 HTTPS，无需额外配置。
- **首次授权**：第一次点【开始录音】浏览器会弹出麦克风权限请求，请允许。
- **单段上限**：120 秒（Whisper API 限制）。一段一玩家，超长可分多段。
- **国内访问 Groq**：Groq API 国内可访问，但偶有抖动。
  如果转写经常超时，可在设置页改 baseUrl 指向自己的反代。
- **Safari 兼容**：iOS Safari 录音格式为 audio/mp4，已自动适配。

## 🛣 路线图

### MVP（已实现）

- ✅ SETUP 三步卡片采集
- ✅ 座位网格 + 死亡/票型点击
- ✅ 发言文本录入（每玩家一段）
- ✅ 🎙 发言语音录制 + Groq Whisper 转写（按玩家分段）
- ✅ 🧠 文本情绪判断（追加【玩家情绪】表格）
- ✅ 👥 玩家档案库（跨局保留熟人玩家头像 + 风格标签）
- ✅ 教练分析（流式渲染）
- ✅ localStorage + 导出/导入（对局与档案库独立）
- ✅ 术语/FAQ 内置查阅
- ✅ 终局复盘
- ✅ 多 LLM 配置 + 双 Key 模式
- ✅ 管理员入口（含 STT 共享池）

### 后续（暂未规划）

- 暂无。TTS 经评估不做（对制胜价值有限）。

## 🧭 项目状态

- **当前阶段**：MVP 完整可用 + UI 视觉打磨完成
- **线上访问**：<https://dingxinxu.github.io/wolf-coach-web/>（前端，需自备 LLM Key）
- **Worker 部署**：可选，未上线（如需共享 Key 池模式才需部署）
- **最新 commits**：
  - `ui: 视觉与移动端体验优化`
  - `docs: README 替换真实 GitHub 用户名 dingxinxu`
  - `feat: 狼人杀制胜教练 H5 MVP`
- **下一步候选方向**（如需继续开发可参考）：
  - 实测线下对局体验，根据反馈调整卡片密度与交互节奏
  - 添加「快速重开」（保留玩家档案库 + 板子配置，仅清空当前局）
  - 给玩家档案库加「上次对局」时间戳，方便识别生疏熟人
  - 把 Worker 部署到 Cloudflare，启用共享 Key 池模式

## 🤝 贡献

欢迎提 Issue / PR。本仓库技能源 `skill-source/` 来自 wolf-game-coach 技能，
如需修改规则/策略，请直接编辑 `skill-source/SKILL.md` 与 `references/*.md`，
然后运行 `node scripts/sync-skill.js && node scripts/inline-skill.js` 同步。

## 📄 许可

MIT

## 🎨 素材归因与版权声明

`web/public/role-art/` 下的 9 张角色立绘（seer/witch/hunter/guard/idiot/civilian/werewolf/wolf-king/white-wolf）
来自**网易《狼人杀》官方卡牌图**（https://langrensha.163.com 卡牌展示栏目）。

- **版权归原作者（网易公司）所有**
- 本项目为开源、非商业用途的个人技术演示，仅作风格参考使用
- 如网易方主张权利，请通过 Issue 联系，将在 24 小时内移除并清空 git 历史
- 商业部署前**必须**替换为自有/已授权素材

