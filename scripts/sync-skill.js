#!/usr/bin/env node
/**
 * 同步脚本：把仓库内 skill-source/ 同步到前端 public 和 Worker。
 *
 * 源：    <repo>/skill-source/{SKILL.md, README.md, references/*.md}
 * 目标 1：<repo>/web/public/skill/      （供浏览器 fetch 展示术语/FAQ）
 * 目标 2：<repo>/worker/skill/          （Worker 注入 system prompt）
 *
 * 设计原则（Q10 决策 A）：前后端都拷贝 md，CI 在构建前执行一次。
 * 原因：前端纯展示、Worker 真注入；Git Action 保证两边一致。
 *
 * 注：技能源已内联到本仓库 skill-source/，废弃原 test-gpt 仓库的外部引用。
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SKILL_SRC = path.join(REPO_ROOT, 'skill-source');
const WEB_DST = path.join(REPO_ROOT, 'web', 'public', 'skill');
const WORKER_DST = path.join(REPO_ROOT, 'worker', 'skill');

const FILES = ['SKILL.md', 'README.md'];
const REF_FILES = ['rules.md', 'strategy.md', 'glossary.md'];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dst) {
  if (!fs.existsSync(src)) {
    console.warn(`[skip] 源不存在: ${src}`);
    return false;
  }
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  console.log(`[ok] ${path.relative(REPO_ROOT, dst)}  ←  ${path.relative(REPO_ROOT, src)}`);
  return true;
}

function syncTo(dstRoot) {
  ensureDir(dstRoot);
  ensureDir(path.join(dstRoot, 'references'));
  for (const f of FILES) {
    copyFile(path.join(SKILL_SRC, f), path.join(dstRoot, f));
  }
  for (const f of REF_FILES) {
    copyFile(path.join(SKILL_SRC, 'references', f), path.join(dstRoot, 'references', f));
  }
}

function main() {
  if (!fs.existsSync(SKILL_SRC)) {
    console.error(`❌ 技能源不存在: ${SKILL_SRC}`);
    process.exit(1);
  }
  console.log('→ 同步技能文档到 web/public/skill 和 worker/skill ...\n');
  syncTo(WEB_DST);
  syncTo(WORKER_DST);
  console.log('\n✅ 同步完成');
}

main();
