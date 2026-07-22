/**
 * Worker 常量（纯值）。
 *
 * 为什么单独成一个模块：
 *   Cloudflare Workers runtime (workerd) 会扫描入口模块的顶层 named export，
 *   期望它们是 function 或 ExportedHandler。纯值（number/string）的顶层 export
 *   会触发 "Incorrect type for map entry 'X': the provided value is not of type
 *   'function or ExportedHandler'" 启动崩溃（wrangler dev 本地复现）。
 *
 *   把纯值常量挪到这个非入口模块，index.js 仅 import 它们（不再 re-export），
 *   入口模块就只剩下合法的 function / default ExportedHandler，workerd 不再报错。
 *
 *   函数（encryptApiKey / checkInputSize 等）是合法 entry，仍留在 index.js。
 *   生产部署 (wrangler deploy) 行为与 dev 一致，改动对线上无影响。
 *
 *   测试从这里 import 常量，从 index.js import 函数（单一真相源不变）。
 */

// C3：单次请求 input 字符上限（system + user 合计）。
// system prompt ~48K（skill+rules+strategy+glossary+wrapper）+ user 侧 ~12K = 60K 字符。
// C3 裁剪 strategy 后 system 略降；多轮对话靠 buildMessages 的历史摘要压缩控制 user 侧长度。
export const MAX_INPUT_CHARS = 60000;

// D1：admin 登录失败限流。连续失败 5 次锁 10 分钟。
export const ADMIN_FAIL_LIMIT = 5;
export const ADMIN_LOCK_MS = 10 * 60 * 1000;

// P1-7：verify-code 公开端点 IP 日限，防高频枚举访问码（非原子，半公开场景够用）
export const VERIFY_DAILY_LIMIT = 50;

// P1-9：SSE 透传 stall 超时（与前端 llm.js STALL_MS 一致），上游无 chunk 超此时长则注入 error
export const SSE_STALL_MS = 30000;
