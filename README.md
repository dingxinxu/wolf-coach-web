# 🐺 狼人杀制胜教练 · Web

> 把 wolf-game-coach 技能封装为 H5 应用，
> 让你在线下对局时随时拿出手机访问，实时获得教练级建议。

[![Deploy](https://github.com/dingxinxu/wolf-coach-web/actions/workflows/deploy.yml/badge.svg)](./.github/workflows/deploy.yml)

> 🌐 **线上访问**：<https://dingxinxu.github.io/wolf-coach-web/>
> 📦 **源码仓库**：<https://github.com/dingxinxu/wolf-coach-web>

## ✨ 特性

### 对局体验
- **极简卡片选择**：板子、身份、座位、票型全部点击选择，几乎不用打字。
- **🎴 网易官方立绘卡牌**：板子/身份选项卡使用《狼人杀》官方角色立绘（webp 优化版，~50KB/张），按阵营配色（神职金/平民钢蓝/狼人血月红）。
- **🎴 6 板子预设 + 自定义板子**：9 预女猎 / 12 预女猎守 / 12 预女猎白 / 12 狼王 / 12 白狼王 / 9 狼王，外加「自定义板子」入口（textarea 描述狼美人/守墓人/丘比特等罕见板）。
- **🛡 身份自洽过滤**：选完板子后，身份卡按该板子的 `roles` 数组过滤，防止矛盾组合（如 9 预女猎板不显示狼王）。
- **🔴 夜晚 / 🟣 上警 / 🟡 发言 / 🔴 票型**：第 1 轮自动显示上警环节（上警玩家、退水、警上发言、当选警长、警徽流），与"无警长"规则联动。
- **⚙️ setup 可编辑**：仅第 1 轮且当前轮无 analysis 时允许改身份/座位（`canEditSetup()` 守卫）。改板子请用「重开」。
- **🧠 跨轮记忆**：每轮分析时，前端自动把历史已知事实（累积死亡/警长警徽流/我的夜间技能史/历轮票型）抽取成紧凑清单随请求发送，教练能联动多轮信息推理，且不破坏 prompt cache 命中率。
- **🔄 快速重开**：线下面杀连开下一局时，模态选择「同配置重开」保留板子/身份/座位/熟人绑定，一键开局；「完全重开」回 SETUP 向导。
- **🎙 录音 + 暂停/继续**：每个玩家发言一段录音，Groq Whisper large-v3 自动转写；录音中可暂停思考再继续，有效时长不含暂停段，120s 上限按净录音计算。
- **🧠 教练级分析**：注入 wolf-game-coach 全套规则+策略文档作为 system prompt，LLM 按 6 段格式输出（追问/态势/发言/决策/风险/下轮），并追加【玩家情绪】表格。实测 **prompt cache 命中率 99.84%**（DeepSeek，system prompt ~32K tokens）。
- **🛡 SSE 健壮性**：上游错误事件捕获 + HTTP 状态码映射（401/403/429/502 友好提示）+ 流式中断 partial 标记 + 30s stall 超时 + 用户取消支持。
- **👥 玩家档案库**：跨局保存熟人玩家头像 + 风格标签（悍跳狼/倒钩狼/新手等），开新局一键关联座位。

### 视觉风格
- **血月主题**：tinted 深夜蓝黑底 + 血月红 + 古金 + 羊皮米，参考网易《狼人杀》官方站。
- **签名元素**：header 的纯 CSS 血月（脉动光晕）+ "让教练分析"按钮的狼眼静默脉动。
- **字体**：系统宋体做 display（标题、品牌名、卡牌名字条），系统 sans 做 body。
- **prefers-reduced-motion**：检测系统减少动效偏好，自动关闭装饰性动画。

### 工程
- **OpenAI 兼容**：默认 DeepSeek（国内原生访问），可改 Claude / OpenAI / Groq 等。
- **双 Key 模式**：用你自己的 API Key（游客模式），或用管理员维护的共享池（持访问码解锁）。
- **🔐 访问码系统**：管理员批量生成（可设「每日用量上限」+「有效期天数」）、可撤销；持码用户才能用共享池；AES-GCM 加密存储 apiKey。访问码前端 sessionStorage + 7 天 TTL，Worker 端 KV 校验过期/用量。
- **🌐 CORS 白名单**：Worker `cors(request, env, res)` 中间件按 `ALLOWED_ORIGINS` 白名单放行，非白名单 origin 被拒（防 admin 密码被跨站爆破）。
- **🚦 KV 限流**：每访问码每日用量计数，超出 `dailyLimit`（默认 100）返回 429，防账单被滥用刷爆。
- **🛡 input size 预检**：Worker 端对 system+user 合计 >60K 字符的请求直接 400 拒绝，防超大 message 单次烧账单。
- **🔒 admin 失败限流**：连续 5 次密码错误锁 10 分钟（按 IP，KV 计数），防在线字典爆破 admin 密码。
- **📝 marked + DOMPurify**：教练分析 markdown 渲染用 `marked` + `DOMPurify`（XSS 防护），替代了早期自写正则。
- **⚡ prompt cache 优化**：`buildSystemPrompt` 输出固定字符串（无时间戳/随机），实测 DeepSeek prompt cache 命中率 99.84%，每次调用省 ~90% input token 成本。
- **📦 PWA 离线缓存**：`vite-plugin-pwa` 预缓存 App Shell + 9 webp + 4 skill md；离线可查术语/FAQ/历史对局（LLM/STT 接口不缓存）。
- **✅ Vitest 单测**：93 用例覆盖 markdown 渲染 baseline + game/roster store + worker 加密往返/访问码全分支/admin 限流/input size 阈值。
- **离线持久化**：每局进度 + 玩家档案库 自动存 localStorage，一键导出/导入 JSON（导入含白名单字段过滤防原型链污染）。
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
│   │   ├── stores/            # worker / settings / game / players-roster / access（访问码+admin key）
│   │   ├── lib/               # llm（含 SSE 错误处理）/ md（marked+DOMPurify）/ stt（含 pause/resume Recorder）
│   │   └── lib/*.test.js      # Vitest 单测（46 用例）
│   └── public/
│       ├── skill/             # ← 由 scripts/sync-skill.js 同步过来
│       └── role-art/          # 9 张网易官方角色立绘：原 PNG（版权证据）+ webp（实际使用，~50KB/张）
├── worker/                    # Cloudflare Worker 后端代理
│   ├── src/index.js           # 主入口（路由 + OpenAI 兼容转发 + Whisper 透传 + admin 自鉴权 + 访问码 + AES-GCM + CORS 白名单 + KV 限流）
│   ├── src/skill-loader.js    # 加载技能 md 并组装 system prompt（固定输出以命中 prompt cache）
│   ├── skill/                 # ← 由 sync-skill.js 同步过来
│   └── skill-bundle.js        # ← 由 inline-skill.js 生成（md → JS 模块）
├── scripts/
│   ├── sync-skill.js          # 从 skill-source/ 同步到 web/worker
│   ├── inline-skill.js        # 把 md 打包成 worker 可 import 的 JS
│   └── convert-art.js         # 一次性脚本：role-art/*.png → webp（原 PNG 保留作版权证据）
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
│  /admin 页  │ ─────────────────────────────▶│  - CORS 白名单│
└─────────────┘   配置/访问码 CRUD              │  - KV 限流    │
                                                │  - TTL 过期   │
                                                └──────────────┘
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
2. 在 LLM 配置填 baseUrl（如 `https://api.deepseek.com/v1`）/ model / apiKey。
3. 在 STT 配置填 baseUrl（`https://api.groq.com/openai/v1`）/ model（`whisper-large-v3`）/ apiKey。
4. 在访问码管理批量生成几个码，分发给用户。
5. 用户在前端顶部【🔒 访问码】栏输入码 → 解锁共享池 → 在【设置】选「管理员共享池」即可用。

## 🔒 隐私与安全

| 数据 | 存储 | 备注 |
|---|---|---|
| 用户自带 LLM/STT Key | 浏览器 localStorage | 每次请求透传给 Worker，Worker 不存储，转发后丢弃 |
| 管理员共享池 apiKey | Worker KV（**AES-GCM 加密**） | 明文用 `KV_ENC_KEY` 加密后入库，GET 时解密展示、PUT 时加密入库 |
| 访问码 | Worker KV（**SHA-256 哈希**） | 仅存 `code:<hash>`，明文只在生成时返回一次；含 `usage`（每日计数）、`dailyLimit`、`expiresAt` 字段 |
| 访问码（前端缓存） | sessionStorage + localStorage（7 天 TTL） | session 级副本 + 7 天 TTL 长期副本；老明文永久 key 已被一次性清理 |
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
- ✅ 🔐 访问码系统（生成 / 验证 / 撤销 / 每日上限 / 有效期）
- ✅ Worker admin 自鉴权 + KV AES-GCM 加密
- ✅ CI 自动部署前端到 GitHub Pages（Worker 部署可选启用）
- ✅ 🎴 网易官方角色立绘 + 血月主题 UI（webp 优化版）
- ✅ 🌐 CORS 白名单 + 🚦 KV 限流 + 🔐 访问码 TTL（sessionStorage + 7 天）
- ✅ 📝 marked + DOMPurify markdown 渲染（XSS 防护）
- ✅ ⚡ prompt cache 稳定性优化（实测命中率 99.84%）
- ✅ 📦 PWA 离线缓存（App Shell + 立绘 + skill md）
- ✅ ✅ Vitest 93 用例单测（md/game/worker-roster store + worker 加密/鉴权/限流）
- ✅ 🛡 SSE 错误处理（错误码映射 + partial 标记 + 30s 超时）
- ✅ 🛡 导入 JSON 白名单字段过滤（防原型链污染）
- ✅ 6 板子预设 + 自定义板子 + 身份自洽过滤
- ✅ setup 可编辑（第 1 轮无 analysis 时）
- ✅ 破坏性操作 confirm 守卫（重开/结束/下一轮条件触发）
- ✅ 🧠 跨轮记忆：前端抽取历史已知事实（累积死亡/警长警徽流/我的夜间技能史/历轮票型），随每轮 user message 发送，不破坏 prompt cache
- ✅ 🛡 input size 预检（>60K 字符拒绝，防超大 message 烧账单）
- ✅ 🔒 admin 失败限流（连续 5 次锁 10 分钟，防字典爆破）
- ✅ 🔄 快速重开（模态选择「同配置重开」保留 setup 或「完全重开」回向导）
- ✅ 👥 玩家档案库 last-seen 时间戳（「N天前」chip + >30天标「生疏」+ 按上次同玩排序）

### 后续候选方向

- 实测线下对局体验，根据反馈调整卡片密度与交互节奏
- 共享池预算熔断（admin 设 $/day 上限，耗尽自动停）—— 当前已有 input size 预检 + 每访问码每日次数限额，半公开场景够用；更细的 token 计量等真出现账单问题再做
- 跨轮记忆架构（LLM 摘要/滚动窗口）—— 当前用前端结构化事实抽取（knownFacts）覆盖 80% 跨轮场景，效果瓶颈证伪后再引入

## 🧭 项目状态

- **当前阶段**：MVP 完整可用 + UI 视觉打磨 + 双 Key 安全机制 + 25 项工程改进（CORS 白名单 / KV 限流 / 访问码 TTL / SSE 健壮性 / marked+DOMPurify / prompt cache 优化 / 立绘 webp / 扩板子 / PWA / Vitest / 跨轮记忆 / input size 预检 / admin 限流 / 快速重开 / last-seen）
- **线上访问**：<https://dingxinxu.github.io/wolf-coach-web/>
- **Worker 部署**：CI 自动部署已启用（`ENABLE_WORKER_DEPLOY=true` + `CF_API_TOKEN`/`CF_ACCOUNT_ID`），push main 自动跑 `wrangler deploy`

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
