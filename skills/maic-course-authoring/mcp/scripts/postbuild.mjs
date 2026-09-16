/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 maic-course-gen-skills contributors
 */

/**
 * 构建后处理：给 bundle 置执行位。
 *
 * 单独放在这里而不是写进 npm script，是为了避免 JSON 里的多层引号转义，
 * 并且能在 Windows 上安全降级（chmod 失败不阻断构建）。
 */

import { chmodSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const target = join(dist, 'server.mjs');

if (!existsSync(target)) {
  console.error(`❌ 构建产物不存在：${target}`);
  process.exit(1);
}

const { size } = statSync(target);
try {
  chmodSync(target, 0o755);
} catch {
  // Windows 等平台没有 exec 位，不影响 `node dist/server.mjs` 使用
}

console.log(`✅ dist/server.mjs  ${(size / 1024).toFixed(1)} KB  可执行`);
