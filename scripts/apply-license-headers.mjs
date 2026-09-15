#!/usr/bin/env node
/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 new-maic contributors
 */

/**
 * 幂等地给文件加上许可头。
 *
 * 两类目标：
 *   1. skills/maic-course-authoring/references/skills 下的上游内容 ——
 *      加 OpenMAIC 的归属声明（Markdown 用 HTML 注释；必须插在
 *      YAML frontmatter 之后，否则技能加载器解析不了 frontmatter）
 *   2. 本仓库自研源码（skills 目录下的 mcp/src、mcp/scripts、scripts）——
 *      加 SPDX 行
 *
 * JSON 不支持注释，因此跳过；其归属见 NOTICE.md。
 *
 * 用法：node scripts/apply-license-headers.mjs [--check]
 *   --check  只报告缺哪些头，不做修改，非零退出码表示有缺失
 *
 * SPDX-License-Identifier: MIT
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Skill 目录在仓库里的固定位置（本仓库可能容纳多个技能）
const SKILL_DIR = 'skills/maic-course-authoring';

const CHECK_ONLY = process.argv.includes('--check');

const UPSTREAM_MARKER = 'SPDX-FileCopyrightText: 2026 THU-MAIC';
const OWN_MARKER = 'SPDX-License-Identifier: MIT';

const UPSTREAM_HEADER = `<!--
${UPSTREAM_MARKER}
SPDX-License-Identifier: MIT

来源：THU-MAIC/OpenMAIC  https://github.com/THU-MAIC/OpenMAIC
路径：skills/  同步 commit：3edaa499
本文件为上游原文，按 MIT 许可分发；许可证全文见仓库根目录 LICENSE-openmaic。
-->`;

const OWN_HEADER = `/**
 * ${OWN_MARKER}
 * Copyright (c) 2026 new-maic contributors
 */`;

function walk(dir, extensions, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries.sort()) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, extensions, acc);
    else if (extensions.has(extname(name))) acc.push(full);
  }
  return acc;
}

/** frontmatter 必须留在文件最前，所以注释要插在它之后。 */
function insertMarkdownHeader(text, header) {
  if (text.startsWith('---\n') || text.startsWith('---\r\n')) {
    const lines = text.split('\n');
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === '---') {
        const head = lines.slice(0, i + 1).join('\n');
        const tail = lines.slice(i + 1).join('\n').replace(/^\n+/, '');
        return `${head}\n${header}\n\n${tail}`;
      }
    }
  }
  return `${header}\n\n${text}`;
}

function insertCodeHeader(text, header) {
  // 已有 shebang 的脚本，注释要插在 shebang 之后，否则 shebang 失效
  if (text.startsWith('#!')) {
    const nl = text.indexOf('\n');
    return `${text.slice(0, nl + 1)}${header}\n${text.slice(nl + 1)}`;
  }
  return `${header}\n${text}`;
}

let changed = 0;
let missing = 0;

// ── 1. 上游内容 ──────────────────────────────────────────────

const upstreamFiles = walk(
  join(ROOT, SKILL_DIR, 'references', 'skills'),
  new Set(['.md']),
).filter((p) => !p.endsWith('INDEX.md'));

for (const file of upstreamFiles) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  if (text.includes(UPSTREAM_MARKER)) continue;

  if (CHECK_ONLY) {
    console.error(`缺少许可头：${rel}`);
    missing += 1;
    continue;
  }
  writeFileSync(file, insertMarkdownHeader(text, UPSTREAM_HEADER), 'utf8');
  changed += 1;
}

// ── 2. 本仓库自研源码 ────────────────────────────────────────

const ownFiles = [
  ...walk(join(ROOT, SKILL_DIR, 'mcp', 'src'), new Set(['.ts', '.mts'])),
  ...walk(join(ROOT, SKILL_DIR, 'mcp', 'scripts'), new Set(['.mjs'])),
  ...walk(join(ROOT, 'scripts'), new Set(['.mjs'])),
  join(ROOT, SKILL_DIR, 'mcp', 'tsdown.config.ts'),
  join(ROOT, SKILL_DIR, 'mcp', 'test', 'smoke.mjs'),
].filter((file, index, all) => all.indexOf(file) === index && existsSync(file));

for (const file of ownFiles) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  if (text.includes(OWN_MARKER)) continue;

  if (CHECK_ONLY) {
    console.error(`缺少许可头：${rel}`);
    missing += 1;
    continue;
  }
  writeFileSync(file, insertCodeHeader(text, OWN_HEADER), 'utf8');
  changed += 1;
}

// ── 报告 ─────────────────────────────────────────────────────

if (CHECK_ONLY) {
  if (missing === 0) {
    console.log('✅ 所有文件都带有许可头。');
  } else {
    console.error(`\n❌ ${missing} 个文件缺少许可头。运行 node scripts/apply-license-headers.mjs 修复。`);
    process.exitCode = 1;
  }
} else {
  console.log(
    changed === 0
      ? '✅ 无需改动，所有文件已带许可头。'
      : `✅ 已为 ${changed} 个文件添加许可头。`,
  );
  console.log(`   上游内容：${upstreamFiles.length} 个 Markdown（JSON 不支持注释，归属见 NOTICE.md）`);
  console.log(`   自研源码：${ownFiles.length} 个`);
}
