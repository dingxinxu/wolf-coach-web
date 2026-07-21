# 🐺 狼人杀制胜教练 · Web

> 把 wolf-game-coach 技能封装为 H5 应用，
> 让你在线下对局时随时拿出手机访问，实时获得教练级建议。

[![Deploy](https://github.com/dingxinxu/wolf-coach-web/actions/workflows/deploy.yml/badge.svg)](./.github/workflows/deploy.yml)

> 🌐 **线上访问**：<https://dingxinxu.github.io/wolf-coach-web/>
> 📦 **源码仓库**：<https://github.com/dingxinxu/wolf-coach-web>

## ✨ 特性

### 对局体验
- **极简卡片选择**：板子、身份、座位、票型全部点击选择，几乎不用打字。
- **🎴 网易官方立绘卡牌**：板子/身份选项卡使用《狼人杀》官方角色立绘，按阵营配色（神职金/平民钢蓝/狼人血月红）。
- **🔴 夜晚 / 🟣 上警 / 🟡 发言 / 🔴 票型**：第 1 轮自动显示上警环节（上警玩家、退水、警上发言、当选警长、警徽流），与"无警长"规则联动。
- **🎙 录音 + 暂停/继续**：每个玩家发言一段录音，Groq Whisper large-v3 自动转写；录音中可暂停思考再继续，有效时长不含暂停段，120s 上限按净录音计算。
- **🧠 教练级分析**：注入 wolf-game-coach 全套规则+策略文档作为 system prompt，LLM 按 6 段格式输出（追问/态势/发言/决策/风险/下轮），并追加【玩家情绪】表格。
- **👥 玩家档案库**：跨局保存熟人玩家头像 + 风格标签（悍跳狼/倒钩狼/新手等），开新局一键关联座位。

### 视觉风格
- **血月主题**：tinted 深夜蓝黑底 + 血月红 + 古金 + 羊皮米，参考网易《狼人杀》官方站。
- **签名元素**：header 的纯 CSS 血月（脉动光晕）+ "让教练分析"按钮的狼眼静默脉动。
- **字体**：系统宋体做 display（标题、品牌名、卡牌名字条），系统 sans 做 body。
- **prefers-reduced-motion**：检测系统减少动效偏好，自动关闭装饰性动画。

### 工程
- **OpenAI 兼容**：默认 DeepSeek（国内原生访问），可改 Claude / OpenAI / Groq 等。
- **双 Key 模式**：用你自己的 API Key（游客模式），或用管理员维护的共享池（持访问码解锁）。
- **🔐 访问码系统**：管理员批量生成、可撤销；持码用户才能用共享池；AES-GCM 加密存储 apiKey。
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
│   │   ├── views/             # Play / Settings / Admin（配置 + 访问码管理）
│   │   ├── components/        # SetupWizard / SeatGrid / RoundInput（含上警卡）/ AnalysisPanel / TermFaq / VoiceRecorder（含暂停）/ PlayerPicker / AccessBanner
│   │   ├── stores/            # settings / game / players-roster / access（访问码+admin key）
│   │   └── lib/               # llm / md / stt（含 pause/resume Recorder）
│   └── public/
│       ├── skill/             # ← 由 scripts/sync-skill.js 同步过来
│       └── role-art/          # 9 张网易官方角色立绘（PNG）
├── worker/                    # Cloudflare Worker 后端代理
│   ├── src/index.js           # 主入口（路由 + OpenAI 兼容转发 + Whisper 透传 + admin 自鉴权 + 访问码 + AES-GCM）
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
┌─────────────┐   /api/chat (X-Access-Code)   ┌──────────────┐    OpenAI 兼容    ┌─────┐
│  Vue 前端   │ ─────────────────────────────▶│  CF Worker   │ ───────────────▶ │ LLM │
│ (GitHub     │                                │  - 注入技能   │ ◀───────────────│     │
│  Pages)     │ ◀─────────────────────────────│  - Key 透传   │   SSE 流式       └─────┘
└─────────────┘    SSE 流式                    │  - 访问码校验 │
                                                │  - admin 鉴权 │
┌─────────────┐   /admin/api/* (X-Admin-Key)  │  - KV 加密    │
│  /admin 页  │ ─────────────────────────────▶│              │
└─────────────┘   配置/访问码 CRUD              └──────────────┘
```

### 关键路由

| 路径 | 方法 | 鉴权 | 用途 |
|---|---|---|---|
| `/api/chat` | POST | X-Access-Code（共享池时） | 教练对话主接口 |
| `/api/transcribe` | POST | X-Access-Code（共享池时） | Whisper 语音转写 |
| `/api/verify-code` | POST | 公开 | 验证访问码有效性 |
| `/admin/api/config` | GET / PUT | X-Admin-Key | LLM 共享池配置（GET 解密展示，PUT AES-GCM 加密入库） |
| `/admin/api/stt` | GET / PUT | X-Admin-Key | STT 共享池配置 |
| `/admin/api/codes` | POST / GET | X-Admin-Key | 批量生成 / 列出访问码 |
| `/admin/api/codes/:hash` | DELETE | X-Admin-Key | 撤销访问码 |

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

# 4. 配置 Worker Secret（仅当你想用共享池 + admin 面板）
cp worker/.dev.vars.example worker/.dev.vars
# 编辑 .dev.vars：
#   ADMIN_PASSWORD=<openssl rand -base64 18>    # /admin 登录密码
#   KV_ENC_KEY=<openssl rand -base64 32>        # KV apiKey 加密密钥
#   DEFAULT_LLM_API_KEY=sk-xxx                  # 可选兜底
#   DEFAULT_STT_API_KEY=gsk_xxx                 # 可选 STT 兜底

# 5. 启动
# 终端 A：Worker
pnpm dev:worker    # 监听 http://localhost:8787
# 终端 B：前端
pnpm dev:web       # 监听 http://localhost:5173，自动代理 /api /admin -> 8787
```

打开 http://localhost:5173/wolf-coach-web/。

- **游客模式**：直接进【设置】填自己的 LLM + STT Key 即可使用。
- **共享池模式**：先用上面的 `ADMIN_PASSWORD` 登录 `/#/admin`，配置 LLM/STT apiKey，生成访问码；用户持访问码解锁共享池。

## 📦 部署

### 前端 → GitHub Pages（自动）

1. Fork 或推送到你的 GitHub 仓库。
2. 仓库 Settings → Pages → Source：**GitHub Actions**。
3. push 到 main 自动部署，访问 `https://<user>.github.io/<repo>/`。

> 仓库名默认与 `web/vite.config.js` 中的 `GH_PAGES_BASE = '/wolf-coach-web/'` 匹配。
> 如改仓库名需同步修改 base path。

### Worker → Cloudflare Workers（手动）

1. 注册 Cloudflare 账号，安装 wrangler：`pnpm add -g wrangler`。
2. 登录：`wrangler login`。
3. 创建 KV namespace，把返回的 `id` / `preview_id` 填入 `worker/wrangler.toml`：
   ```bash
   wrangler kv namespace create LLM_POOL
   wrangler kv namespace create LLM_POOL --preview
   ```
4. 设置生产 secrets（`ADMIN_PASSWORD` + `KV_ENC_KEY` 必需，其他可选）：
   ```bash
   cd worker
   wrangler secret put ADMIN_PASSWORD    # openssl rand -base64 18
   wrangler secret put KV_ENC_KEY        # openssl rand -base64 32
   # 可选兜底：
   wrangler secret put DEFAULT_LLM_API_KEY
   wrangler secret put DEFAULT_STT_API_KEY
   ```
5. 部署：
   ```bash
   wrangler deploy
   ```
6. 前端【设置】页的「Worker URL」填 `https://<name>.workers.dev`。

> **Worker CI 自动部署**（可选）：受仓库 Variable `ENABLE_WORKER_DEPLOY == 'true'` 显式开关控制，且需仓库 Secret `CF_API_TOKEN`（Cloudflare API Token，权限 Workers Scripts:Edit）+ `CF_ACCOUNT_ID`。三者全配齐后 push main 才会自动跑 `wrangler deploy`；未启用时 `deploy-worker` job 直接 skipped（不是 failed），不影响前端部署。

### 访问码与共享池初始化

Worker 部署后，访问 `https://<worker>.workers.dev/` 应返回 `{"ok":true}`。然后：

1. 打开 `https://<user>.github.io/<repo>/#/admin`，用 `ADMIN_PASSWORD` 登录。
2. 在 LLM 配置填 baseUrl（如 `https://api.deepseek.com`）/ model / apiKey。
3. 在 STT 配置填 baseUrl（`https://api.groq.com/openai/v1`）/ model（`whisper-large-v3`）/ apiKey。
4. 在访问码管理批量生成几个码，分发给用户。
5. 用户在前端顶部【🔒 访问码】栏输入码 → 解锁共享池 → 在【设置】选「管理员共享池」即可用。

## 🔒 隐私与安全

| 数据 | 存储 | 备注 |
|---|---|---|
| 用户自带 LLM/STT Key | 浏览器 localStorage | 每次请求透传给 Worker，Worker 不存储，转发后丢弃 |
| 管理员共享池 apiKey | Worker KV（**AES-GCM 加密**） | 明文用 `KV_ENC_KEY` 加密后入库，GET 时解密展示、PUT 时加密入库 |
| 访问码 | Worker KV（**SHA-256 哈希**） | 仅存 `code:<hash>`，明文只在生成时返回一次 |
| ADMIN_PASSWORD | Worker secret | `X-Admin-Key` 头比对，不走 CF Access（避免跨域 cookie 问题） |
| 对局数据 | 完全本地 localStorage | 永不上传 |
| 录音数据 | 转写期间传 Groq Whisper | Worker 不存盘，转写完即丢弃 |
| 玩家档案库 | 浏览器 localStorage | 跨局保留，导出 JSON 时随对局一起 |

## 🎙 录音使用须知

- **必须 HTTPS**：浏览器只在 HTTPS（或 localhost）下授权麦克风。GitHub Pages 和 Cloudflare Workers 默认都是 HTTPS。
- **首次授权**：第一次点【开始录音】浏览器会弹麦克风权限请求，请允许。
- **暂停/继续**：录音中点【⏸ 暂停】可冻结计时（暂停期间不采集音频、麦克风不释放），点【▶ 继续】恢复；点主按钮或【取消】结束。
- **单段上限**：120 秒（Whisper API 限制）。**按净录音时长**计算，暂停不计入。
- **国内访问 Groq**：Groq API 国内可访问但偶有抖动。如经常超时，可在设置页改 baseUrl 指向自己的反代。
- **Safari 兼容**：iOS Safari 录音格式为 audio/mp4，已自动适配。

## 🛣 路线图

### MVP（已实现）

**对局核心：**
- ✅ SETUP 三步卡片采集（板子 → 身份 → 座位 + 规则 + 熟人）
- ✅ 座位网格 + 死亡/票型点击
- ✅ 第 1 轮上警环节（上警/退水/警上发言/警长/警徽流），与"无警长"规则联动
- ✅ 发言文本录入 + 🎙 语音录制（含暂停/继续）+ Groq Whisper 转写
- ✅ 🧠 文本情绪判断（追加【玩家情绪】表格）
- ✅ 👥 玩家档案库（跨局保留熟人玩家头像 + 风格标签）
- ✅ 教练分析（流式渲染）+ 终局复盘
- ✅ localStorage + 导出/导入（对局与档案库独立）
- ✅ 术语/FAQ 内置查阅

**工程：**
- ✅ 多 LLM 配置 + 双 Key 模式（自带 / 共享池）
- ✅ 🔐 访问码系统（生成 / 验证 / 撤销）
- ✅ Worker admin 自鉴权 + KV AES-GCM 加密
- ✅ CI 自动部署前端到 GitHub Pages（Worker 部署可选启用）
- ✅ 🎴 网易官方角色立绘 + 血月主题 UI

### 后续候选方向

- 实测线下对局体验，根据反馈调整卡片密度与交互节奏
- 「快速重开」（保留玩家档案库 + 板子配置，仅清空当前局）
- 玩家档案库加「上次对局」时间戳，方便识别生疏熟人
- 把 9 张网易立绘压成 webp（约 30KB/张），首屏流量从 1.8MB 降到 ~300KB
- 把访问码系统扩展为带有效期的临时码（目前为永久码）

## 🧭 项目状态

- **当前阶段**：MVP 完整可用 + UI 视觉打磨 + 双 Key 安全机制
- **线上访问**：<https://dingxinxu.github.io/wolf-coach-web/>
- **Worker 部署**：手动部署已就绪；CI 自动部署需同时配 `ENABLE_WORKER_DEPLOY=true` 变量 + `CF_API_TOKEN`/`CF_ACCOUNT_ID` Secret
- **最新 commits**：
  - `fix(code-review): 修复 5 项 code-review 发现`
  - `feat: 板子/身份卡换用网易官方角色立绘`
  - `ui: 视觉全面优化，参考网易狼人杀官方风格`
  - `feat: 录音暂停/继续 + 第1轮上警环节录入`
  - `feat: 访问码系统 + Worker admin 鉴权 + KV 加密`
  - `ci: 修复 pnpm 版本冲突并启用 GitHub Pages 部署`

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
