/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 new-maic contributors
 */

/**
 * 校验与归一化。
 *
 * **结构校验的权威来源是上游的 JSON Schema**（`@openmaic/dsl/schema/*`）——
 * 那是上游写入路径真正的闸门，覆盖到字段值级别。理由见 `validate-schema.ts`
 * 的模块注释：`validate*` 对 slide 只检查 `content.canvas` 是对象，不足以当闸门。
 *
 * 若 schema 因故不可用，降级到 `@openmaic/dsl` 的 `validateStage` / `validateScene`
 * 结构子集，并在输出里如实标明降级（不静默）。
 *
 * 归一化走 `normalizeSlideWith` / `normalizeScene`：validate 报告文档，normalize
 * 修复文档。上游对模型输出明确推荐 `onInvalid: 'drop'` 的逐元素降级策略。
 *
 * 在此之上，本模块补两类上游管不到的检查：
 *   1. 媒体引用完整性（`audioRef` / 元素 `src` 必须落在 mediaIndex 里）
 *   2. 骨架屏陷阱（`src` 既不是 http/data/blob 又不在 mediaIndex 里）
 * 以及对 typo 的轻量提示（manifest 上出现了导入侧会忽略的未知键）。
 */

import {
  DSL_VERSION,
  normalizeScene,
  normalizeSlideWith,
  validateScene,
  validateStage,
} from '@openmaic/dsl';

import {
  AUDIO_EXTENSIONS,
  CONTRACT_BASELINE,
  MEDIA_EXTENSIONS,
  MEDIA_INDEX_TYPES,
} from './contract.js';
import { requiredFieldsSummary, schemaInfo, validateWithSchema } from './validate-schema.js';
import { isSafeZipPath } from './zip.js';

// ─────────────────────────────────────────────────────────────
// 宽松的 manifest 类型（手写输入，不假设形状）
// ─────────────────────────────────────────────────────────────

export type Loose = Record<string, any>;

export interface ManifestLike extends Loose {
  stage?: Loose;
  scenes?: Loose[];
  mediaIndex?: Record<string, Loose>;
}

export interface Issue {
  path: string;
  message: string;
}

export type ValidatorKind = 'schema' | 'structural-subset';

export interface ValidateOutcome {
  valid: boolean;
  errors: Issue[];
  warnings: Issue[];
  dslVersion: string;
  validator: ValidatorKind;
}

const isObj = (v: unknown): v is Loose =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function dslVersionNotice(): Issue | null {
  if (DSL_VERSION === CONTRACT_BASELINE) return null;
  return {
    path: '/',
    message:
      `上游 DSL_VERSION 现在是 ${DSL_VERSION}，本 MCP 编写时对齐的基线是 ` +
      `${CONTRACT_BASELINE}。references/ 下的参考文档可能需要重新同步。`,
  };
}

/**
 * 把 manifest 还原成文档形状。
 *
 * 只取导入侧真正会读的字段（`lib/import/use-import-classroom.ts` 的构造逻辑），
 * 并补齐导入时会重新分配的 `stage.id` 与每个 scene 的 `id` / `stageId`。
 * 刻意不把 manifest 上的未知字段带进来——导入侧会忽略它们，带进来只会造出
 * 与真实导入行为不符的误报。
 */
export function manifestToDocument(manifest: ManifestLike): { stage: Loose; scenes: Loose[] } {
  const stageId = typeof manifest.stage?.id === 'string' ? manifest.stage.id : 'stage_validation';
  const stage: Loose = {
    id: stageId,
    name: typeof manifest.stage?.name === 'string' ? manifest.stage.name : 'Untitled',
    createdAt: typeof manifest.stage?.createdAt === 'number' ? manifest.stage.createdAt : 0,
    updatedAt: typeof manifest.stage?.updatedAt === 'number' ? manifest.stage.updatedAt : 0,
    ...(manifest.stage?.description ? { description: manifest.stage.description } : {}),
    ...(manifest.stage?.language ? { languageDirective: manifest.stage.language } : {}),
    ...(manifest.stage?.style ? { style: manifest.stage.style } : {}),
  };
  const scenes = (Array.isArray(manifest.scenes) ? manifest.scenes : []).map((s, i) => ({
    id: typeof s?.id === 'string' ? s.id : `scene_${i + 1}`,
    stageId,
    title: s?.title,
    order: typeof s?.order === 'number' ? s.order : i,
    type: s?.type,
    content: s?.content,
    ...(s?.actions !== undefined ? { actions: s.actions } : {}),
    ...(s?.whiteboards !== undefined ? { whiteboards: s.whiteboards } : {}),
    ...(s?.multiAgent !== undefined ? { multiAgent: s.multiAgent } : {}),
  }));
  return { stage, scenes };
}

/** 归一化后把合成字段剥掉，回到 manifest 形状。 */
function documentScenesToManifest(scenes: Loose[], original: Loose[]): Loose[] {
  return scenes.map((scene, i) => {
    const source = original[i] ?? {};
    const next: Loose = { ...source };
    next.title = scene.title;
    next.order = scene.order;
    next.type = scene.type;
    next.content = scene.content;
    if (scene.actions !== undefined) next.actions = scene.actions;
    if (scene.whiteboards !== undefined) next.whiteboards = scene.whiteboards;
    if (scene.multiAgent !== undefined) next.multiAgent = scene.multiAgent;
    if (typeof source.id === 'string') next.id = source.id;
    return next;
  });
}

// ─────────────────────────────────────────────────────────────
// 结构校验
// ─────────────────────────────────────────────────────────────

const MANIFEST_STAGE_KEYS = new Set([
  'id',
  'name',
  'description',
  'language',
  'style',
  'videoManifest',
  'createdAt',
  'updatedAt',
]);

const MANIFEST_SCENE_KEYS = new Set([
  'id',
  'title',
  'order',
  'type',
  'content',
  'actions',
  'whiteboards',
  'multiAgent',
]);

function unknownKeyWarnings(manifest: ManifestLike): Issue[] {
  const warnings: Issue[] = [];
  if (isObj(manifest.stage)) {
    for (const key of Object.keys(manifest.stage)) {
      if (!MANIFEST_STAGE_KEYS.has(key)) {
        warnings.push({
          path: `/stage/${key}`,
          message: `导入侧不读这个键，写在这里不会生效（可能是拼写错误）`,
        });
      }
    }
  }
  if (Array.isArray(manifest.scenes)) {
    manifest.scenes.forEach((scene, i) => {
      if (!isObj(scene)) return;
      for (const key of Object.keys(scene)) {
        if (!MANIFEST_SCENE_KEYS.has(key)) {
          warnings.push({
            path: `/scenes/${i}/${key}`,
            message: `导入侧不读这个键，写在这里不会生效（可能是拼写错误）`,
          });
        }
      }
    });
  }
  return warnings;
}

export function validateManifestStructure(manifest: ManifestLike): {
  errors: Issue[];
  warnings: Issue[];
  validator: ValidatorKind;
} {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  if (!isObj(manifest)) {
    return {
      errors: [{ path: '/', message: 'manifest 必须是对象' }],
      warnings,
      validator: 'structural-subset',
    };
  }

  // 导入侧的三项硬检查（上游 import 只做这些，所以要在这里先兜住）
  if (!isObj(manifest.stage)) {
    errors.push({ path: '/stage', message: '缺少 stage（导入侧必需）' });
  }
  if (!Array.isArray(manifest.scenes)) {
    errors.push({ path: '/scenes', message: '缺少 scenes，且必须是数组（导入侧必需）' });
  } else if (manifest.scenes.length === 0) {
    warnings.push({ path: '/scenes', message: 'scenes 为空，导入后会是一门空课' });
  }

  warnings.push(...unknownKeyWarnings(manifest));

  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
  const { stage, scenes: documentScenes } = manifestToDocument(manifest);
  const prefixes = scenes.map((_, i) => `/scenes/${i}`);

  const schema = validateWithSchema(stage, documentScenes, prefixes);
  if (schema.available) {
    errors.push(...schema.errors);
    return { errors, warnings, validator: 'schema' };
  }

  // schema 不可用 → 降级到 @openmaic/dsl 的结构子集，并如实告知
  warnings.push({
    path: '/',
    message:
      '上游 JSON Schema 不可用，已降级为 @openmaic/dsl 的结构子集（只查存在性与判别式，' +
      `不查元素与题目的字段值）。原因：${schema.error ?? '未知'}`,
  });
  const stageResult = validateStage(stage);
  if (!stageResult.valid) {
    errors.push(...stageResult.errors.map((e) => ({ path: `/stage${e.path}`, message: e.message })));
  }
  documentScenes.forEach((scene, i) => {
    const result = validateScene(scene);
    if (!result.valid) {
      errors.push(...result.errors.map((e) => ({ path: `/scenes/${i}${e.path}`, message: e.message })));
    }
  });
  return { errors, warnings, validator: 'structural-subset' };
}

// ─────────────────────────────────────────────────────────────
// 媒体检查（上游契约管不到的部分）
// ─────────────────────────────────────────────────────────────

export function validateMedia(manifest: ManifestLike): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  if (manifest.mediaIndex !== undefined && !isObj(manifest.mediaIndex)) {
    errors.push({ path: '/mediaIndex', message: 'mediaIndex 必须是对象' });
    return { errors, warnings };
  }
  const mediaIndex: Record<string, Loose> = isObj(manifest.mediaIndex) ? manifest.mediaIndex : {};

  for (const [zipPath, meta] of Object.entries(mediaIndex)) {
    const p = `/mediaIndex/${zipPath}`;
    if (!isSafeZipPath(zipPath)) {
      errors.push({ path: p, message: 'ZIP 路径不安全（不能以 / 开头、不能含 .. 或反斜杠）' });
      continue;
    }
    if (!isObj(meta)) {
      errors.push({ path: p, message: '条目必须是对象' });
      continue;
    }
    if (!(MEDIA_INDEX_TYPES as readonly string[]).includes(String(meta.type))) {
      errors.push({
        path: p,
        message: `非法 type：${String(meta.type)}（应为 ${MEDIA_INDEX_TYPES.join(' | ')}）`,
      });
      continue;
    }
    const ext = zipPath.split('.').pop()?.toLowerCase() ?? '';
    if (meta.type === 'audio' && !AUDIO_EXTENSIONS.has(ext)) {
      warnings.push({ path: p, message: `音频扩展名 ".${ext}" 不在允许列表内，导入时会回退` });
    }
    if (meta.type !== 'audio' && !MEDIA_EXTENSIONS.has(ext)) {
      warnings.push({ path: p, message: `媒体扩展名 ".${ext}" 不在允许列表内，导入时会回退` });
    }
  }

  const audioPaths = new Set(
    Object.entries(mediaIndex)
      .filter(([, m]) => m?.type === 'audio')
      .map(([k]) => k),
  );
  const mediaRefs = new Set(
    Object.values(mediaIndex)
      .map((m) => m?.sourceRef)
      .filter((v): v is string => typeof v === 'string'),
  );

  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
  const seenOrders = new Map<number, number>();

  scenes.forEach((scene, i) => {
    const base = `/scenes/${i}`;
    if (!isObj(scene)) return;

    if (typeof scene.order === 'number') {
      if (seenOrders.has(scene.order)) {
        errors.push({ path: `${base}/order`, message: `order ${scene.order} 与其他页重复` });
      }
      seenOrders.set(scene.order, i);
      if (!Number.isInteger(scene.order) || scene.order < 1) {
        errors.push({ path: `${base}/order`, message: 'order 必须是从 1 开始的整数' });
      }
    } else {
      warnings.push({
        path: `${base}/order`,
        message: '缺少 order，导入时会回退为数组下标（0 起始），页码会错位',
      });
    }

    for (const [j, action] of (Array.isArray(scene.actions) ? scene.actions : []).entries()) {
      const p = `${base}/actions/${j}`;
      if (!isObj(action) || action.audioRef === undefined) continue;
      if (typeof action.audioRef !== 'string') {
        errors.push({ path: `${p}/audioRef`, message: 'audioRef 必须是字符串' });
      } else if (!audioPaths.has(action.audioRef)) {
        errors.push({
          path: `${p}/audioRef`,
          message: `audioRef "${action.audioRef}" 不在 mediaIndex 里（audioRef 必须是 ZIP 内路径）`,
        });
      }
    }

    const elementGroups: { path: string; elements: unknown }[] = [
      { path: `${base}/content/canvas/elements`, elements: scene.content?.canvas?.elements },
    ];
    if (Array.isArray(scene.whiteboards)) {
      scene.whiteboards.forEach((board: Loose, bi: number) => {
        elementGroups.push({ path: `${base}/whiteboards/${bi}/elements`, elements: board?.elements });
      });
    }

    for (const group of elementGroups) {
      if (!Array.isArray(group.elements)) continue;
      group.elements.forEach((el: Loose, k: number) => {
        if (!isObj(el)) return;
        const p = `${group.path}/${k}`;
        if (el.type !== 'image' && el.type !== 'video' && el.type !== 'audio') return;

        const src = el.src;
        if (typeof src !== 'string' || !src) {
          if (el.type !== 'audio') {
            warnings.push({ path: `${p}/src`, message: `${el.type} 元素没有 src` });
          }
          return;
        }
        if (/^(https?:|data:|blob:)/.test(src)) return; // 外部资源，导入后仍需联网
        if (!mediaRefs.has(src)) {
          errors.push({
            path: `${p}/src`,
            message:
              `src "${src}" 既不是 http/data/blob，也不在 mediaIndex 的 sourceRef 里。` +
              '导入后会被当作"待生成媒体"，永远显示骨架屏。',
          });
        }
      });
    }
  });

  return { errors, warnings };
}

export function validateManifest(manifest: ManifestLike): ValidateOutcome {
  const structure = validateManifestStructure(manifest);
  const media = validateMedia(manifest);
  const references = validateReferences(manifest);
  const warnings = [...structure.warnings, ...media.warnings, ...references.warnings];
  const versionNotice = dslVersionNotice();
  if (versionNotice) warnings.push(versionNotice);
  const errors = [...structure.errors, ...media.errors, ...references.errors];
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    dslVersion: DSL_VERSION,
    validator: structure.validator,
  };
}

// ─────────────────────────────────────────────────────────────
// 引用完整性：id 唯一性与 spotlight 目标
// ─────────────────────────────────────────────────────────────

/**
 * 上游 schema 只要求 id 是非空字符串，不要求唯一。但渲染层把元素放进同一个
 * 列表里以 id 作 key：同一页两个元素同 id，React 会报重复 key 并反复重渲染。
 * 这在长课程里真实发生过——同一页调了两次同一个版式函数，两批元素 id 从同一
 * 个起点开始，结构校验全绿，渲染却坏掉。
 *
 * 所以这里检查：页内唯一、全篇唯一（元素 / 动作 / 题目 / 表格单元格）、
 * 以及 spotlight / laser 的 elementId 必须能解析到同场景元素。
 */
export function validateReferences(manifest: ManifestLike): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];

  const globalIds = new Map<string, number>();
  const noteGlobal = (id: string, order: number, kind: string, path: string): void => {
    const seenAt = globalIds.get(id);
    if (seenAt !== undefined) {
      errors.push({
        path,
        message: `${kind} id "${id}" 全篇重复（order ${seenAt} 与 ${order}）。` +
          '渲染层以 id 作 key，重复会导致重复 key 警告与页面重渲染。用 scene_normalize_ids 归一。',
      });
    } else {
      globalIds.set(id, order);
    }
  };

  scenes.forEach((scene, i) => {
    if (!isObj(scene)) return;
    const order = typeof scene.order === 'number' ? scene.order : i + 1;
    const base = `/scenes/${i}`;

    const groups: { base: string; elements: unknown }[] = [
      { base: `${base}/content/canvas/elements`, elements: scene.content?.canvas?.elements },
    ];
    if (Array.isArray(scene.whiteboards)) {
      scene.whiteboards.forEach((board: Loose, bi: number) => {
        groups.push({ base: `${base}/whiteboards/${bi}/elements`, elements: board?.elements });
      });
    }

    const sceneIds = new Set<string>();
    for (const group of groups) {
      if (!Array.isArray(group.elements)) continue;
      const pageIds = new Map<string, number>();
      group.elements.forEach((el: Loose, k: number) => {
        if (!isObj(el) || typeof el.id !== 'string') return;
        const p = `${group.base}/${k}/id`;
        if (pageIds.has(el.id)) {
          errors.push({
            path: p,
            message: `元素 id "${el.id}" 在本页重复（第 ${pageIds.get(el.id)} 个与第 ${k} 个）。` +
              '同页两次调用同一个版式函数时会出现这种情况。',
          });
        } else {
          pageIds.set(el.id, k);
        }
        noteGlobal(el.id, order, '元素', p);
        sceneIds.add(el.id);

        if (el.type === 'table' && Array.isArray(el.data)) {
          const cellIds = new Map<string, string>();
          (el.data as unknown[]).forEach((row: unknown, r: number) => {
            if (!Array.isArray(row)) return;
            (row as Loose[]).forEach((cell: Loose, c: number) => {
              if (!isObj(cell) || typeof cell.id !== 'string') return;
              if (cellIds.has(cell.id)) {
                errors.push({
                  path: `${p}`,
                  message: `表格单元格 id "${cell.id}" 重复（r${r}c${c} 与第 ${cellIds.get(cell.id)} 处）。`,
                });
              } else {
                cellIds.set(cell.id, `${r},${c}`);
              }
            });
          });
        }
      });
    }

    for (const [j, action] of (Array.isArray(scene.actions) ? scene.actions : []).entries()) {
      if (!isObj(action)) continue;
      const p = `${base}/actions/${j}`;
      if (typeof action.id === 'string') {
        noteGlobal(action.id, order, '动作', `${p}/id`);
      }
      if (
        (action.type === 'spotlight' || action.type === 'laser') &&
        typeof action.elementId === 'string' &&
        !sceneIds.has(action.elementId)
      ) {
        errors.push({
          path: `${p}/elementId`,
          message: `${action.type} 指向的元素 "${action.elementId}" 在本页不存在。` +
            '重命名元素后忘记同步动作引用是最常见的原因。',
        });
      }
    }

    if (isObj(scene.content) && scene.content.type === 'quiz' && Array.isArray(scene.content.questions)) {
      scene.content.questions.forEach((question: Loose, q: number) => {
        if (isObj(question) && typeof question.id === 'string') {
          noteGlobal(question.id, order, '题目', `${base}/content/questions/${q}/id`);
        }
      });
    }
  });

  return { errors, warnings };
}

// ─────────────────────────────────────────────────────────────
// 归一化
// ─────────────────────────────────────────────────────────────

export interface NormalizeOutcome {
  manifest: ManifestLike;
  changed: boolean;
  dropped: Issue[];
}

/**
 * 归一化整个 manifest。
 *
 * 用 `onInvalid: 'drop'` 逐元素降级而不是整篇抛错——上游对这个策略的定位
 * 正是"归一化不可靠的野生输入（导入的 deck、模型输出）"。
 * 丢弃的元素会被如实报告，绝不静默。
 */
export function normalizeManifest(manifest: ManifestLike): NormalizeOutcome {
  const dropped: Issue[] = [];
  // `stage` 只是 manifestToDocument 的必需产物，归一化不处理它
  const { scenes } = manifestToDocument(manifest);

  const normalizeSlide = normalizeSlideWith({
    onInvalid: 'drop',
    onDropped: (element, error) => {
      const id = isObj(element) && typeof element.id === 'string' ? element.id : '(无 id)';
      dropped.push({
        path: `/content/canvas/elements/${id}`,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const normalized = scenes.map((scene) => {
    // slide 场景的 canvas 先过带降级策略的版本，再交给 normalizeScene
    if (scene.content?.type === 'slide' && Array.isArray(scene.content.canvas?.elements)) {
      scene = {
        ...scene,
        content: { ...scene.content, canvas: normalizeSlide(scene.content.canvas) },
      };
    }
    return normalizeScene(scene as never) as Loose;
  });

  const changed = JSON.stringify(scenes) !== JSON.stringify(normalized);

  return {
    manifest: {
      ...manifest,
      scenes: documentScenesToManifest(normalized, manifest.scenes ?? []),
    },
    changed,
    dropped,
  };
}

export { schemaInfo, requiredFieldsSummary };
