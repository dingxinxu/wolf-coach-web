/**
 * 公共请求工具：供 llm.js / stt.js 共用的鉴权头构造等纯函数。
 */

/**
 * 构造请求头：基础 Content-Type + 访问码（仅 admin-pool 模式且持码时）。
 * @param {string} keyMode - 'user' | 'admin-pool'
 * @param {string} accessCode - 访问码（可能为空）
 * @returns {Record<string, string>}
 */
export function buildAuthHeaders(keyMode, accessCode) {
  const headers = { 'Content-Type': 'application/json' };
  if (keyMode === 'admin-pool' && accessCode) {
    headers['X-Access-Code'] = accessCode;
  }
  return headers;
}
