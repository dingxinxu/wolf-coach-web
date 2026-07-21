#!/usr/bin/env node
/**
 * 把 web/public/role-art/*.png 转为 webp（P1-8）。
 *
 * 保留原 PNG 作为版权证据（README 声明网易素材）。
 * webp 质量 80，宽度 resize 到 600px（移动端足够，原 1000+ px 过大）。
 *
 * 依赖系统 cwebp（macOS: brew install webp）。
 * 跑一次：node scripts/convert-art.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ART_DIR = path.resolve(__dirname, '../web/public/role-art');

if (!fs.existsSync(ART_DIR)) {
  console.error(`❌ 目录不存在: ${ART_DIR}`);
  process.exit(1);
}

const pngs = fs.readdirSync(ART_DIR).filter((f) => f.endsWith('.png'));
if (pngs.length === 0) {
  console.log('（无 PNG 需要转换）');
  process.exit(0);
}

let okCount = 0;
let skipCount = 0;
for (const png of pngs) {
  const src = path.join(ART_DIR, png);
  const dst = path.join(ART_DIR, png.replace(/\.png$/, '.webp'));
  // 已存在则跳过（除非加 --force）
  if (fs.existsSync(dst) && !process.argv.includes('--force')) {
    console.log(`[skip] ${png} -> webp 已存在`);
    skipCount++;
    continue;
  }
  try {
    // -q 80：质量 80（视觉无损，体积约 1/6）
    // -resize 600 0：宽度 600px，高度按比例
    execSync(`cwebp -q 80 -resize 600 0 "${src}" -o "${dst}"`, { stdio: 'pipe' });
    const srcSize = fs.statSync(src).size;
    const dstSize = fs.statSync(dst).size;
    const ratio = ((1 - dstSize / srcSize) * 100).toFixed(1);
    console.log(`[ok] ${png} -> ${path.basename(dst)}  ${srcSize}B -> ${dstSize}B  (-${ratio}%)`);
    okCount++;
  } catch (e) {
    console.error(`[fail] ${png}: ${e.message}`);
  }
}

console.log(`\n✅ 转换完成：${okCount} 张转 webp，${skipCount} 张跳过`);
console.log(`原 PNG 保留在 ${ART_DIR}（版权证据，勿删）`);
