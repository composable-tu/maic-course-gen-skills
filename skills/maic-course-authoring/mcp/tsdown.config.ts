/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 maic-course-gen-skills contributors
 */

import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/server.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  // 单文件产物：没有 .d.ts 消费者，不需要生成声明
  dts: false,
  minify: false,
  sourcemap: false,
  report: false,
  // 注：不用 tsdown 的 `exe`（它走 Node 的 SEA，需要 Node >= 25.7）。
  // 这里用 banner 加 shebang，执行位由 scripts/postbuild.mjs 补上。
  banner: { js: '#!/usr/bin/env node' },
  outExtensions: () => ({ js: '.mjs' }),
  // @openmaic/dsl 是权威校验器，必须进 bundle —— 这样产物无需 node_modules，
  // 且"结构闸门是权威的"这件事不依赖安装状态。这也是把它列为硬依赖的方式：
  // 依赖在构建期解析，解析不到就构建失败。
  // 单文件产物：除了 node: 内置模块，其余运行时依赖全部内联。
  //
  // 两个原因：
  //   1. @openmaic/dsl 是权威校验器（JSON Schema + validate*），必须进 bundle，
  //      这样"结构闸门是权威的"不依赖运行环境装没装依赖；
  //   2. ajv 与两个 schema JSON 也是运行时依赖，外置的话产物就不再是单文件。
  //
  // 坑：`alwaysBundle: ['@openmaic/dsl']` 只匹配裸标识符，匹配不到
  // `@openmaic/dsl/schema/*.json` 这类子路径导入；而 `neverBundle: []`
  // 并不会关掉 tsdown 对 package.json dependencies 的默认外置。
  // 所以这里显式列出需要内联的包（含 ajv 的传递依赖）。
  deps: {
    alwaysBundle: [
      /^@openmaic\//,
      /^(?:ajv|fast-deep-equal|fast-uri|json-schema-traverse|require-from-string)(?:\/|$)/,
    ],
    onlyBundle: false,
  },
});
