/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 new-maic contributors
 */

/**
 * MAIC 课件契约的常量知识。
 *
 * 这些值的唯一权威来源是 `@openmaic/dsl`；本模块只是把工具运行时需要反复用到的
 * 一部分显式列出（供 `dsl_schema_get` 返回给 Agent，避免它去猜）。
 * 凡是可以从 `@openmaic/dsl` 读到的，一律从那里读，不在这里硬编码第二份。
 */

import {
  DSL_VERSION,
  SCENE_TYPES,
  isSceneType,
  type SceneType,
} from '@openmaic/dsl';

export { DSL_VERSION, SCENE_TYPES, isSceneType };
export type { SceneType };

/** 本 MCP 编写时对齐的上游契约版本。与 `DSL_VERSION` 不一致时告警。 */
export const CONTRACT_BASELINE = '0.3.0';

/** ZIP 格式版本，与上游 `CLASSROOM_ZIP_FORMAT_VERSION` 一致。 */
export const CLASSROOM_ZIP_FORMAT_VERSION = 1;

/** 画布常量（来自 slide-craft：1000 × 562.5，四周 50px 边距）。 */
export const CANVAS = {
  viewportSize: 1000,
  viewportRatio: 0.5625,
  liveArea: { left: [50, 950] as const, top: [50, 512.5] as const },
  alignmentGrid: { leftAligned: [60, 80], centered: '(1000 - width) / 2' },
};

/** 上游契约拥有默认值的元素类型。其余类型 `normalizeElement` 原样透传。 */
export const NORMALIZABLE_ELEMENT_TYPES = ['text', 'image', 'shape', 'line'] as const;

/** 导入侧的媒体索引条目类型（`lib/import/use-import-classroom.ts`）。 */
export const MEDIA_INDEX_TYPES = ['audio', 'image', 'generated'] as const;

export const AUDIO_EXTENSIONS = new Set([
  'aac',
  'flac',
  'm4a',
  'mp3',
  'mp4',
  'mpeg',
  'ogg',
  'opus',
  'wav',
  'webm',
]);

export const MEDIA_EXTENSIONS = new Set([
  'avif',
  'gif',
  'jpeg',
  'jpg',
  'm4v',
  'mov',
  'mp4',
  'ogv',
  'png',
  'svg',
  'webm',
  'webp',
]);

/** 材料目录里被扫描的文本后缀。 */
export const MATERIAL_EXTENSIONS = new Set([
  'md',
  'markdown',
  'txt',
  'json',
  'csv',
  'tsv',
  'html',
  'htm',
  'xml',
  'yaml',
  'yml',
  'log',
]);

/** 材料读取的分页大小，与上游 `read_material` 的 8000 字符窗口一致。 */
export const MATERIAL_READ_PAGE = 8000;
export const SEARCH_CONTEXT_CHARS = 200;
export const SEARCH_MAX_HITS_PER_MATERIAL = 10;
export const SEARCH_MAX_HITS_TOTAL = 30;

/**
 * 导入侧的三个结构校验条件（`lib/import/use-import-classroom.ts`）。
 * 除此之外导入不校验任何东西——所以本地校验是不可省的。
 */
export const IMPORT_CHECKS = [
  'ZIP 根存在 manifest.json',
  'manifest.json 可 JSON.parse',
  'manifest.stage 存在且 manifest.scenes 是数组',
] as const;
