/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 maic-course-gen-skills contributors
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
import { APP_AVATARS } from './contract.js';
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
  const errors = [...structure.errors, ...media.errors, ...references.errors];  return {
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
 * 引用完整性检查。严重度经过校准（用两个官方示范课件核对过）：
 *
 * - **元素 / 动作 / 题目 id 的"页内唯一"是错误**：渲染层把这些元素放进同一个
 *   列表并以 id 作 key，同页重复会产生重复 key 警告并反复重渲染。
 *   真实发生过：同一页调用两次同一个版式函数，两批元素 id 从同一个起点开始。
 * - **跨页重复只是警告**：课件按场景渲染，不同页的元素不会同时挂载；
 *   官方示范课件也确实跨页复用了 `q1` / `q2` 这类题目 id。
 *   但全局唯一仍然值得做（便于排查、便于工具改写），官方课件本身就是全局唯一的。
 * - **spotlight / laser 的目标存在性是错误**：重命名元素后忘记同步动作引用，
 *   会让聚光灯静默失效。
 * - **audioRef 必须落在 mediaIndex**：缺了就没有旁白。
 */
export function validateReferences(manifest: ManifestLike): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];

  const globalIds = new Map<string, number>();
  const noteGlobal = (id: string, order: number, kind: string, path: string): void => {
    const seenAt = globalIds.get(id);
    if (seenAt !== undefined) {
      warnings.push({
        path,
        message: `${kind} id "${id}" 跨页重复（order ${seenAt} 与 ${order}）。` +
          '不同页不会同时渲染，所以这只影响排查与工具改写；' +
          '建议跑 scene_normalize_ids 归一，官方示范课件本身也是全局唯一的。',
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
              '同页两次调用同一个版式函数时会出现这种情况，渲染层会报重复 key。',
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

    const actionIds = new Map<string, number>();
    for (const [j, action] of (Array.isArray(scene.actions) ? scene.actions : []).entries()) {
      if (!isObj(action)) continue;
      const p = `${base}/actions/${j}`;
      if (typeof action.id === 'string') {
        if (actionIds.has(action.id)) {
          errors.push({
            path: `${p}/id`,
            message: `动作 id "${action.id}" 在本页重复。`,
          });
        } else {
          actionIds.set(action.id, j);
        }
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
      const questionIds = new Map<string, number>();
      scene.content.questions.forEach((question: Loose, q: number) => {
        if (!isObj(question) || typeof question.id !== 'string') return;
        const p = `${base}/content/questions/${q}/id`;
        if (questionIds.has(question.id)) {
          errors.push({ path: p, message: `题目 id "${question.id}" 在本页重复。` });
        } else {
          questionIds.set(question.id, q);
        }
        noteGlobal(question.id, order, '题目', p);
      });
    }
  });

  checkAgentAvatars(manifest, warnings);
  validateActionSemantics(manifest, errors, warnings);

  return { errors, warnings };
}

/**
 * 动作与场景的语义检查——这些字段的值 schema 都认（类型对、无未知字段），
 * 但取值本身会让动作**静默失效**，只能靠播放路径的知识来判断。
 * 全部是警告：运行时的兜底行为各不相同，Agent 应当逐条判断。
 */
function validateActionSemantics(
  manifest: ManifestLike,
  errors: Issue[],
  warnings: Issue[],
): void {
  const agents = Array.isArray(manifest.agents) ? manifest.agents : [];

  // ── 白板绘制坐标：1000×563 像素坐标系，不是 0–1 归一化 ──
  // 实战里真实踩过：把 x 写成 0.2，文字被画到白板左上角。
  const WB_W = 1000;
  const WB_H = 563;
  const drawTypes = new Set([
    'wb_draw_text',
    'wb_draw_latex',
    'wb_draw_shape',
    'wb_draw_chart',
    'wb_draw_table',
    'wb_draw_code',
  ]);

  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
  scenes.forEach((scene, i) => {
    if (!isObj(scene)) return;
    const actions = Array.isArray(scene.actions) ? scene.actions : [];
    const where = (j: number): string => `/scenes/${i}/actions/${j}`;

    actions.forEach((action, j) => {
      if (!isObj(action)) return;
      const type = String(action.type);

      if (drawTypes.has(type)) {
        const x = typeof action.x === 'number' ? action.x : undefined;
        const y = typeof action.y === 'number' ? action.y : undefined;
        if (x !== undefined && y !== undefined && x >= 0 && x <= 1 && y >= 0 && y <= 1) {
          warnings.push({
            path: `${where(j)}/x`,
            message:
              `x=${x}, y=${y} 落在 0–1 区间——白板坐标是 **${WB_W}×${WB_H} 像素坐标系**，` +
              '不是归一化坐标，这样写会把内容画到白板左上角。按像素写（如 x: 180, y: 300）。',
          });
        } else if (
          (x !== undefined && (x < 0 || x > WB_W)) ||
          (y !== undefined && (y < 0 || y > WB_H))
        ) {
          warnings.push({
            path: `${where(j)}/x`,
            message: `白板坐标 (${x}, ${y}) 超出画布 ${WB_W}×${WB_H}，内容会画到板外。`,
          });
        }
      }

      if (type === 'wb_draw_line') {
        const coords = ['startX', 'startY', 'endX', 'endY']
          .map((k) => ({ k, v: typeof action[k] === 'number' ? (action[k] as number) : undefined }))
          .filter((c): c is { k: string; v: number } => c.v !== undefined);
        const offBoard = coords.filter(
          ({ k, v }) => (k === 'startX' || k === 'endX' ? v < 0 || v > WB_W : v < 0 || v > WB_H),
        );
        if (offBoard.length > 0) {
          warnings.push({
            path: `${where(j)}/startX`,
            message: `白板线段坐标超出画布 ${WB_W}×${WB_H}：${offBoard
              .map(({ k, v }) => `${k}=${v}`)
              .join(', ')}。白板坐标系是 ${WB_W}×${WB_H} 像素。`,
          });
        }
      }

      if (type === 'discussion' && typeof action.agentIndex === 'number') {
        const idx = action.agentIndex;
        if (!Number.isInteger(idx) || idx < 0 || idx >= agents.length) {
          const tail =
            agents.length === 0
              ? '而本课件没有 agents 数组，讨论将没有明确的发言者。'
              : '不一定是你要点名的人。请核对下标。';
          warnings.push({
            path: `${where(j)}/agentIndex`,
            message:
              `agentIndex ${idx} 越界（agents 共 ${agents.length} 个）。` +
              '导入时会静默回落到兜底发言人（优先 student 角色，其次第一个非 teacher），' +
              tail,
          });
        }
      }

      // quiz 答案值应能对应到选项
      if (
        isObj(scene.content) &&
        scene.content.type === 'quiz' &&
        Array.isArray(scene.content.questions)
      ) {
        scene.content.questions.forEach((question: Loose, q: number) => {
          if (!isObj(question)) return;
          const options = Array.isArray(question.options) ? question.options : [];
          const answers = Array.isArray(question.answer) ? question.answer : [];
          if (options.length === 0 || answers.length === 0) return;
          const values = options
            .map((o: Loose) => (isObj(o) && typeof o.value === 'string' ? o.value : undefined))
            .filter((v): v is string => v !== undefined);
          const labels = options
            .map((o: Loose) => (isObj(o) && typeof o.label === 'string' ? o.label : undefined))
            .filter((v): v is string => v !== undefined);
          const p = `/scenes/${i}/content/questions/${q}/answer`;
          for (const ans of answers) {
            if (typeof ans !== 'string') continue;
            const byValue = values.includes(ans);
            // 兼容旧写法：答案键恰好唯一匹配某个 option 的 label
            const byLabel = labels.filter((l) => l === ans).length === 1;
            if (!byValue && !byLabel) {
              warnings.push({
                path: p,
                message:
                  `答案 "${ans}" 既不是任何 option 的 value，也不是唯一匹配的 label。` +
                  '判分按 option.value 全等比较，对不上的答案会被判为错。检查是否该写 "A"/"B" 这类选择键。',
              });
            }
          }
        });
      }

      // widget_setState 的键与 widgetConfig.variables 脱节 → 大概率打不中
      if (type === 'widget_setState' && isObj(action.state)) {
        const interactive = isObj(scene.content) && scene.content.type === 'interactive'
          ? scene.content
          : undefined;
        const variables = Array.isArray(interactive?.widgetConfig?.variables)
          ? (interactive!.widgetConfig!.variables as Loose[])
          : undefined;
        const names = (variables ?? [])
          .map((v) => (isObj(v) && typeof v.name === 'string' ? v.name : undefined))
          .filter((v): v is string => v !== undefined);
        const stateKeys = Object.keys(action.state);
        if (names.length > 0 && !stateKeys.some((k) => names.includes(k))) {
          warnings.push({
            path: `${where(j)}/state`,
            message:
              `state 的键（${stateKeys.join(', ')}）与 widgetConfig.variables 的变量名` +
              `（${names.join(', ')}）没有任何交集。运行时没有校验——set_state 只是向 iframe` +
              'postMessage，键的语义由 HTML 里自己的 message 监听器定义；键名不一致动作会静默无效。',
          });
        }
      }
    });
  });

  void errors;
}

/**
 * `agents[].avatar` 写的是**应用相对路径**（如 `/avatars/teacher.png`），导入时
 * 原样透传、不拷贝字节，渲染时才由应用解析——路径写错不会有任何报错，
 * 只会静默显示为空头像。实战中真实发生过（示例初版写了不存在的 `teacher-1`）。
 *
 * 内置路径按已知清单核对（快照，可能过期，所以只发警告）；
 * `http(s)` / `data` 地址放行；留空也放行（应用有缺省头像）。
 */
function checkAgentAvatars(manifest: ManifestLike, warnings: Issue[]): void {
  const agents = Array.isArray(manifest.agents) ? manifest.agents : [];
  agents.forEach((agent, i) => {
    if (!isObj(agent)) return;
    const avatar = typeof agent.avatar === 'string' ? agent.avatar.trim() : '';
    const p = `/agents/${i}/avatar`;
    if (avatar === '' || /^(https?:|data:|blob:)/.test(avatar)) return;

    const fileName = avatar.startsWith('/avatars/') ? avatar.slice('/avatars/'.length) : avatar;
    if (avatar.startsWith('/avatars/') && APP_AVATARS.includes(fileName)) return;

    warnings.push({
      path: p,
      message:
        `头像 "${avatar}" 不是已知的应用内置头像（/avatars/<文件名>，清单见 dsl_schema_get 的 ` +
        `appAvatars），也不是 http(s)/data 地址。导入时原样透传、不校验，路径无效会静默显示为空头像。` +
        `内置头像共 ${APP_AVATARS.length} 个（以实际部署的 public/avatars/ 为准）。`,
    });
  });
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
