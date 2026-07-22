# AGENTS.md - wolf-coach-web

狼人杀制胜教练 H5。pnpm monorepo：`skill-source/`（技能真相源）-> `web/`（Vue 3 前端）+ `worker/`（Cloudflare Worker 代理）。代码注释用中文，沿用既有风格。

## 仓库布局

```
skill-source/        # ← 唯一真相源（SKILL.md + references/{rules,strategy,glossary}.md）
web/                 # Vue 3 + Vite + Tailwind 前端，部署到 GitHub Pages
  src/views/         #   Play / Settings / Admin
  src/components/    #   SetupWizard / SeatGrid / RoundInput / AnalysisPanel / VoiceRecorder ...
  src/stores/        #   Vue reactive() stores（非 Pinia）：worker / settings / game / players-roster / access
  src/lib/           #   llm / md（marked+DOMPurify）/ stt
  src/lib/*.test.js  #   Vitest 单测
  public/skill/      #   ← 自动生成（sync-skill.js），勿手改
  public/role-art/   #   9 张网易官方角色立绘：原 PNG（版权证据）+ webp（实际使用，~50KB/张）
worker/              # Cloudflare Worker：OpenAI 兼容转发 + 访问码 + AES-GCM
  src/index.js       #   路由 + 鉴权 + 加密 + LLM/STT 转发 + CORS 白名单 + KV 限流
  src/skill-loader.js
  skill/             #   ← 自动生成（sync-skill.js），勿手改
  skill-bundle.js    #   ← 自动生成（inline-skill.js），勿手改
scripts/
  sync-skill.js      # skill-source/ -> web/public/skill/ + worker/skill/
  inline-skill.js    # worker/skill/*.md -> worker/skill-bundle.js（wrangler 无法 import md）
  convert-art.js     # 一次性脚本：role-art/*.png -> webp（原 PNG 保留作版权证据）
.github/workflows/deploy.yml
```

## 常用命令（在仓库根目录运行）

```bash
pnpm install
pnpm sync-skill            # 同步技能 md（改 skill-source/ 后必跑）
node scripts/inline-skill.js  # 重新打包 worker skill-bundle.js（改 skill-source/ 后必跑）
pnpm dev:web               # 前端 http://localhost:5173（自动代理 /api /admin -> 8787）
pnpm dev:worker            # Worker http://localhost:8787（需 worker/.dev.vars）
pnpm build:web             # 生产构建（base path = GH_PAGES_BASE，默认 /wolf-coach-web/）
pnpm deploy:worker         # wrangler deploy
pnpm test                  # Vitest 单测（46 用例）
pnpm test:watch            # Vitest watch 模式
node scripts/convert-art.js --force  # 重新生成 webp（改了原 PNG 后跑）
```

本地开发需两个终端同时跑 `dev:worker` 和 `dev:web`。Worker `.dev.vars`（不入库）从 `worker/.dev.vars.example` 复制，至少配 `ADMIN_PASSWORD` + `KV_ENC_KEY`。

## 编辑规则（重要）

- **技能内容只改 `skill-source/`**：编辑后必须依次跑 `pnpm sync-skill` 和 `node scripts/inline-skill.js`。`web/public/skill/`、`worker/skill/`、`worker/skill-bundle.js` 都是自动生成的，CI 也会在构建前重跑这两个脚本。
- **前端 base path**：`web/vite.config.js` 的 `GH_PAGES_BASE`（默认 `/wolf-coach-web/`）必须与 GitHub 仓库名一致。改名要同步。
- **worker 敏感值**：`ADMIN_PASSWORD`、`KV_ENC_KEY`、`DEFAULT_*_API_KEY` 只能走 `wrangler secret put` 或 `worker/.dev.vars`，绝不写进 `wrangler.toml` 或代码。
- **stores 不用 Pinia**：`src/stores/*.js` 用 Vue `reactive()` + 命名导出函数；localStorage 持久化散落在各 store。
  - 依赖图（无环）：`access.js` -> `worker.js` <- `settings.js`
  - `worker.js` 是抽出来的底层模块（workerUrl + workerBase()），`settings.js` re-export `workerBase` 仅作过渡兼容
- **`web/dist/` 是构建产物**：勿手动改。
- **CORS 白名单**：`worker/wrangler.toml` 的 `ALLOWED_ORIGINS` 变量（逗号分隔，不含尾斜杠）。自部署必须补你的前端域名，否则跨域请求被拒。
- **测试**：改 `web/src/lib/*.js` 或 `web/src/stores/*.js` 后跑 `pnpm test`。改 md.js 的渲染行为时，编辑 `md.test.js` 验证预期。

## 前端约定

- **技术栈**：Vue 3（`<script setup>` 为主）+ vue-router（hash 模式，`createWebHashHistory`）+ Tailwind 3。
- **主题色（Tailwind 自定义）**：`night`（午夜墨蓝底）、`wolf`/`blood`（血月红）、`gold`（古金）、`parchment`（羊皮米）、`steel`（冷钢蓝/好人）。display 用 `font-serif`（宋体），body 用 `font-sans`。新增 UI 优先复用 `web/src/style.css` 里的 `.btn*` / `.card` / `.grad-*` / `.border-gold-*` 等 `@layer components`，避免散落 inline style。
- **markdown 渲染**：`web/src/lib/md.js` 用 `marked` + `DOMPurify`（P1-10 起替换自写正则）。自定义 renderer 给元素注入主题 class；`AnalysisPanel.vue` 的 `postProcess` 给情绪表 cell 染色。改渲染器行为同步更新 `md.test.js`。
- **动效**：装饰性动画必须用 `@media (prefers-reduced-motion)` 包裹（见现有血月脉动 / 狼眼按钮）。iOS 用 `100dvh` + `env(safe-area-inset-*)`。
- **录音**：依赖 HTTPS 或 localhost；iOS Safari 录音是 `audio/mp4`，已在 `VoiceRecorder.vue` 适配。120s 上限按净录音时长（暂停段不计）。
- **路由**：`/`（Play）、`/settings`、`/admin`（受 `X-Admin-Key` 保护；底部入口已移除，知者自知）。
- **板子预设**：`web/src/stores/game.js` 的 `BOARDS` 含 6 个主流板子 + 自定义板子入口（`"自定义："` 前缀）。每个板子有 `roles` 数组用于 Step 2 身份过滤防矛盾组合。新增板子必须补 `roles`。
- **setup 可编辑**：仅第 1 轮且当前轮无 analysis 时允许（`canEditSetup()` 守卫）。改板子请用「重开」。
- **PWA**：`web/vite.config.js` 配了 `vite-plugin-pwa`，预缓存 App Shell + 9 webp + 4 skill md。LLM/SSE/STT 接口不缓存。改缓存策略同步调整 `globPatterns`。

## Worker 约定

- 入口 `worker/src/index.js`。OpenAI 兼容 Chat Completions + Whisper 透传。
- 鉴权头：`X-Admin-Key`（admin 路由 `/admin/api/*`）、`X-Access-Code`（共享池用户 `/api/*`）。
- 共享池 apiKey 进 KV 时必须 AES-GCM 加密（`KV_ENC_KEY` 派生）；访问码只存 SHA-256 哈希。
- Key 优先级：request body 的 `userLLM.apiKey` -> KV `LLM_POOL.active` -> Worker secret `DEFAULT_LLM_API_KEY`。
- **CORS**：`cors(request, env, res)` 函数读 `request.headers.Origin` 与 `env.ALLOWED_ORIGINS` 白名单匹配，命中才设 `Access-Control-Allow-Origin`。所有响应必须经 `cors()` 包裹。
- **访问码防滥用**：
  - 每访问码每日用量计数（`entry.usage = { day, count }`，按 UTC 日期重置），超出 `entry.dailyLimit`（默认 100）返回 429
  - `entry.expiresAt`（admin 生成时设，默认 30 天，0=永久），过期返回 `access_code_expired`
  - admin UI 可设「每日上限」和「有效期(天)」
- **system prompt 稳定性**：`buildSystemPrompt` 输出固定字符串（无时间戳/随机），让 DeepSeek/OpenAI prompt cache 命中。修改此函数或 `skill-source/*.md` 会让所有用户 cache 失效。`handleChat` 每次请求打 `console.debug` 输出 system prompt 长度 + SHA-256 前缀，便于运维查 cache 稳定性。
- **SSE 错误处理**：前端 `chatWithCoach` 捕获上游 `data:{"error":...}` 事件 + HTTP 状态码映射（401/403/429/502 -> 友好提示）+ partial 标记 + 30s stall 超时 + AbortSignal 用户取消。

## 已知坑

- 仓库名 / `GH_PAGES_BASE` / 前端路由 base 必须三者一致，否则 GitHub Pages 刷新 404。
- Worker CI 自动部署受仓库 Variable `ENABLE_WORKER_DEPLOY == 'true'` 显式开关控制，且需 `CF_API_TOKEN` + `CF_ACCOUNT_ID` Secret。三者全配齐才会自动部署；未启用时 `deploy-worker` job 直接 skipped（不是 failed）。
- `role-art/` 立绘版权归网易，仅非商业演示用；商业部署须替换。原 PNG 保留作版权证据，webp 是实际使用格式。
- 访问码 `wolf-coach-access-code`（老明文永久 key）已被新版本一次性清理，老用户首次访问需重输访问码（换取 sessionStorage + 7天TTL 保护）。
- **访问码用量计数的公平性 bug（defer）**：`requireAccessCode` 在调 LLM 前就自增 count 并写回 KV。若 LLM 调用失败（502/超时），用户仍被扣一次额度。半公开场景下可忍；等有人投诉再修（修法：在 handleChat 失败路径回滚 count，或改用"成功才计数"模式）。
- **admin 限流非原子（defer）**：`requireAdmin` 的失败计数是 read-modify-write，高并发下可绕过（多个请求同时读到旧 count）。KV 最终一致性放大此问题。半公开场景下作"业余字典爆破防御"够用；真要防并发爆破需 Durable Object 原子计数或 CF Turnstile。按 IP 分桶也会让 NAT 后多用户共享限额。

## 测试

`pnpm test` 跑 Vitest（web + worker 两包），覆盖：
- `web/src/lib/md.test.js`（13）：markdown 渲染 baseline，保护 marked+DOMPurify 重构不回归
- `web/src/stores/game.test.js`（30）：BOARDS/ROLES 常量 + 自定义板子 + importGame 校验 + startGame + canEditSetup/updateSetup + resetGame(keepSetup)
- `web/src/stores/players-roster.test.js`（10）：lastPlayedAt 默认值 + 相对时间格式化 + 按 lastPlayedAt 排序
- `web/src/stores/worker.test.js`（7）：workerUrl localStorage 迁移逻辑
- `worker/src/index.test.js`（38）：AES-GCM 加解密往返 + hashAccessCode 稳定性 + generateAccessCode 字符集 + maskKey 边界 + resolveLLMConfig 优先级 + requireAccessCode 全分支（无码/无效/过期/超限/通过/跨天重置）+ requireAdmin 失败限流（5 次锁 10 分钟）+ checkInputSize 阈值与边界

改 `lib/*.js` 或 `stores/*.js` 后必跑。改 md.js 渲染行为同步更新 `md.test.js`。

人工验证仍需：跑 `pnpm dev:web` + `pnpm dev:worker`，验证关键流程：板子->身份->座位->录音->教练分析；访问码登录；`/admin` 配置。
