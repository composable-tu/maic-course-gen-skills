/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 new-maic contributors
 */

/**
 * 入口：MCP stdio 传输 + CLI。
 *
 * 用法：
 *   node dist/server.mjs                           MCP stdio 模式
 *   node dist/server.mjs --check <x.maic.zip>      校验已打包的 zip
 *   node dist/server.mjs --pack <manifest.json> <out.maic.zip>
 *   node dist/server.mjs --tools                   列出工具（调试用）
 *
 * 环境变量：
 *   MAIC_MATERIALS_DIR   源材料目录（material_* 工具必需）
 */

import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';

import { DSL_VERSION } from './contract.js';
import { TOOLS, callTool, type ToolResult } from './tools.js';
import { validateManifest, type ManifestLike } from './validate.js';
import { listZipEntries, readZipEntry } from './zip.js';

const SERVER_NAME = 'maic-course-authoring';
const SERVER_VERSION = '0.2.0';

/** 协议版本：回显客户端请求的版本，否则用本实现支持的第一个。 */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

// ─────────────────────────────────────────────────────────────
// MCP stdio 传输
// ─────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id: JsonRpcRequest['id'], result: unknown): void {
  send({ jsonrpc: '2.0', id, result });
}

async function handleMessage(message: JsonRpcRequest): Promise<void> {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;

  try {
    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion as string | undefined;
        sendResult(id, {
          protocolVersion: (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(
            requested ?? '',
          )
            ? requested
            : SUPPORTED_PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        });
        return;
      }
      case 'notifications/initialized':
      case 'initialized':
        return;
      case 'ping':
        if (isRequest) sendResult(id, {});
        return;
      case 'tools/list':
        sendResult(id, { tools: TOOLS });
        return;
      case 'tools/call': {
        const name = params?.name as string;
        const args = params?.arguments as Record<string, unknown> | undefined;
        sendResult(id, callTool(name, args));
        return;
      }
      default:
        if (isRequest) {
          send({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `不支持的方法：${String(method)}` },
          });
        }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isRequest) {
      const failure: ToolResult = { content: [{ type: 'text', text: message }], isError: true };
      sendResult(id, failure);
    } else {
      process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
    }
  }
}

function runStdio(): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: JsonRpcRequest;
    try {
      message = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      process.stderr.write(`[${SERVER_NAME}] 忽略无法解析的输入行\n`);
      return;
    }
    void handleMessage(message);
  });
  process.stderr.write(
    `[${SERVER_NAME}] 已启动（stdio）。契约版本 ${DSL_VERSION}，${TOOLS.length} 个工具。\n`,
  );
}

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────

function formatIssues(label: string, issues: { path: string; message: string }[]): void {
  if (issues.length === 0) return;
  const stream = label === '错误' ? console.error : console.log;
  // 警告标记用 U+26A0 本体，不带 U+FE0F 变体选择符：
  // 后者属于 default-ignorable 区段，会被文本审查工具标为需人工复核
  const mark = label === '错误' ? '[x]' : '[!]';
  stream(`\n${mark} ${issues.length} 个${label}：`);
  for (const issue of issues) stream(`  - ${issue.path}  ${issue.message}`);
}

function cliCheck(zipPath: string | undefined): void {
  if (!zipPath) {
    console.error('用法：node server.mjs --check <x.maic.zip>');
    process.exitCode = 1;
    return;
  }

  let entries;
  try {
    entries = listZipEntries(readFileSync(zipPath));
  } catch (error) {
    console.error(`❌ 无法读取 ZIP：${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const names = entries.map((e) => e.name);
  console.log(`ZIP 条目（${entries.length}）:`);
  for (const name of names) console.log(`  ${name}`);

  if (!names.includes('manifest.json')) {
    console.error('\n❌ 根目录缺少 manifest.json —— 导入会直接失败');
    process.exitCode = 1;
    return;
  }

  const manifestEntry = entries.find((e) => e.name === 'manifest.json')!;
  let manifest: ManifestLike;
  try {
    manifest = JSON.parse(readZipEntry(readFileSync(zipPath), manifestEntry).toString('utf8'));
  } catch (error) {
    console.error(`\n❌ manifest.json 解析失败：${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const missing = Object.keys(
    manifest.mediaIndex && typeof manifest.mediaIndex === 'object' ? manifest.mediaIndex : {},
  ).filter((p) => !names.includes(p));
  if (missing.length > 0) {
    console.error(`\n❌ mediaIndex 声明但 ZIP 内缺失：${missing.join(', ')}`);
  }

  const result = validateManifest(manifest);
  console.log(
    `\n校验器：${
      result.validator === 'schema'
        ? '上游 JSON Schema（权威）'
        : '@openmaic/dsl 结构子集（已降级）'
    } · 契约 ${result.dslVersion}`,
  );
  formatIssues('错误', result.errors);
  formatIssues('警告', result.warnings);

  if (missing.length > 0 || result.errors.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log('\n✅ 通过。可以导入 OpenMAIC 预览。');
}

function cliPack(manifestPath: string | undefined, outputPath: string | undefined): void {
  if (!manifestPath || !outputPath) {
    console.error('用法：node server.mjs --pack <manifest.json> <out.maic.zip>');
    process.exitCode = 1;
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestLike;
  const result = callTool('course_pack_maic_zip', { manifest, outputPath });
  const body = result.content.map((c) => c.text).join('\n');
  if (result.isError) {
    console.error(body);
    process.exitCode = 1;
    return;
  }
  console.log(body);
}

function cliTools(): void {
  console.log(`${TOOLS.length} 个工具：\n`);
  for (const tool of TOOLS) {
    console.log(`  ${tool.name}`);
    console.log(`      ${tool.description.split('\n')[0]}\n`);
  }
}

// ─────────────────────────────────────────────────────────────
// 分发
// ─────────────────────────────────────────────────────────────

function cliValidate(manifestPath: string | undefined): void {
  if (!manifestPath) {
    console.error('用法：node server.mjs --validate <manifest.json>');
    process.exitCode = 1;
    return;
  }
  let manifest: ManifestLike;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestLike;
  } catch (error) {
    console.error(`❌ 读取失败：${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  const result = validateManifest(manifest);
  console.log(
    `校验器：${
      result.validator === 'schema'
        ? '上游 JSON Schema（权威）'
        : '@openmaic/dsl 结构子集（已降级）'
    } · 契约 ${result.dslVersion}`,
  );
  formatIssues('错误', result.errors);
  formatIssues('警告', result.warnings);
  if (result.errors.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log('\n✅ 结构校验通过。');
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case '--check':
    cliCheck(rest[0]);
    break;
  case '--validate':
    cliValidate(rest[0]);
    break;
  case '--pack':
    cliPack(rest[0], rest[1]);
    break;
  case '--tools':
    cliTools();
    break;
  case '--version': {
    const { version } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    writeFileSync(process.stdout.fd, `${SERVER_NAME} ${version} (dsl ${DSL_VERSION})\n`);
    break;
  }
  case '--help':
  case '-h':
    console.log(
      [
        `${SERVER_NAME} — MAIC 课件自主编写 MCP`,
        '',
        '  node server.mjs                            MCP stdio 模式',
        '  node server.mjs --check <x.maic.zip>       校验已打包的 zip',
        '  node server.mjs --validate <manifest.json> 校验草稿 manifest',
        '  node server.mjs --pack <m.json> <out.zip>  从 manifest 打包',
        '  node server.mjs --tools                    列出工具',
        '',
        '环境变量：MAIC_MATERIALS_DIR=源材料目录',
      ].join('\n'),
    );
    break;
  default:
    runStdio();
}
