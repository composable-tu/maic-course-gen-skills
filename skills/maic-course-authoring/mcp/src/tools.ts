/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 maic-course-gen-skills contributors
 */

/**
 * 工具定义与实现。
 *
 * 工具面刻意不包含任何"生成内容"的能力：内容由 Agent 写，工具只负责
 * 「读得到原文」「结构合法」「产出可导入的包」，以及两个**减少逐字生成**的辅助
 * （`draft_normalize` 补默认值、`scene_clone` 复用已有版式）。
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';

import {
  APP_AVATARS,
  CANVAS,
  CLASSROOM_ZIP_FORMAT_VERSION,
  CONTRACT_BASELINE,
  DISCUSSION_AGENT_FALLBACK,
  DSL_VERSION,
  IMPORT_CHECKS,
  MEDIA_INDEX_TYPES,
} from './contract.js';
import { listMaterials, readMaterialPage, searchMaterials, MaterialsError } from './materials.js';
import { checkSceneLayout, normalizeSceneIds, type LayoutIssue } from './layout.js';
import {
  normalizeManifest,
  requiredFieldsSummary,
  schemaInfo,
  validateManifest,
  type Issue,
  type Loose,
  type ManifestLike,
} from './validate.js';
import { buildZip, isSafeZipPath } from './zip.js';

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class ToolError extends Error {}

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });
const json = (value: unknown): ToolResult => text(JSON.stringify(value, null, 2));
const fail = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }], isError: true });

function readManifestArg(args: Record<string, unknown>): ManifestLike {
  if (args.manifest !== undefined) {
    if (typeof args.manifest !== 'object' || args.manifest === null || Array.isArray(args.manifest)) {
      throw new ToolError('manifest 必须是一个对象');
    }
    return args.manifest as ManifestLike;
  }
  if (typeof args.manifestPath === 'string' && args.manifestPath) {
    if (!existsSync(args.manifestPath)) throw new ToolError(`找不到文件：${args.manifestPath}`);
    try {
      return JSON.parse(readFileSync(args.manifestPath, 'utf8')) as ManifestLike;
    } catch (error) {
      throw new ToolError(`manifestPath 不是合法 JSON：${(error as Error).message}`);
    }
  }
  throw new ToolError('需要 manifest 对象或 manifestPath');
}

function formatIssues(label: string, issues: readonly Issue[], limit = 60): string[] {
  if (issues.length === 0) return [];
  const lines = ['', `${label}：`];
  for (const issue of issues.slice(0, limit)) lines.push(`  - ${issue.path}  ${issue.message}`);
  if (issues.length > limit) lines.push(`  …另有 ${issues.length - limit} 条`);
  return lines;
}

// ─────────────────────────────────────────────────────────────
// 工具实现
// ─────────────────────────────────────────────────────────────

function materialList(): ToolResult {
  const { dir, materials } = listMaterials();
  if (materials.length === 0) {
    return fail(
      `材料目录里没有可读的文本材料：${dir}\n` +
        '如果材料是 PDF / DOCX / PPTX，请先转成文本或 md 再放进该目录。',
    );
  }
  return json({
    materialsDir: dir,
    count: materials.length,
    totalBytes: materials.reduce((sum, m) => sum + m.bytes, 0),
    materials: materials.map((m) => ({ id: m.id, bytes: m.bytes })),
    next: '先读完全部材料并抽查 material_search，再开始规划。',
  });
}

function materialRead(args: Record<string, unknown>): ToolResult {
  const id = args.materialId;
  if (typeof id !== 'string' || !id) throw new ToolError('material_read 需要 materialId（先调 material_list）');
  const offset = typeof args.offset === 'number' ? args.offset : 0;
  const length = typeof args.length === 'number' ? args.length : undefined;
  const page = readMaterialPage(id, offset, length);
  return json(page);
}

function materialSearch(args: Record<string, unknown>): ToolResult {
  const query = args.query;
  if (typeof query !== 'string') throw new ToolError('material_search 需要 query');
  const materialId = typeof args.materialId === 'string' ? args.materialId : undefined;
  const maxHits = typeof args.maxHits === 'number' ? args.maxHits : undefined;
  const { hits, truncated } = searchMaterials(query, materialId, maxHits);
  return json({
    query,
    hits: hits.length,
    truncated,
    results: hits,
    ...(hits.length === 0 ? { note: '没有命中。换近义表述或用更短的锚点重试。' } : {}),
  });
}

function dslSchemaGet(): ToolResult {
  const schema = schemaInfo();
  const required = requiredFieldsSummary();
  return json({
    dslVersion: DSL_VERSION,
    contractBaseline: CONTRACT_BASELINE,
    validator: schema.available
      ? '上游 JSON Schema（@openmaic/dsl/schema/*，写入路径同款闸门）'
      : `@openmaic/dsl 结构子集（JSON Schema 不可用：${schema.error ?? '未知原因'}）`,
    requiredFields: {
      note:
        '以下是每层每类型的**必需字段**，直接从上游 schema 推导。' +
        '写任何结构前先查这里。schema 是闭合的，未定义的字段会被直接报出来。',
      scene: required.scene,
      element: required.element,
      action: required.action,
      canvas: {
        slide: required.slide,
        slideTheme: required.slideTheme,
        quizContent: required.quizContent,
        quizQuestion: required.quizQuestion,
      },
    },
    schemaDerived: {
      sceneTypes: schema.sceneTypes,
      elementTypes: schema.elementTypes,
      actionTypes: schema.actionTypes,
    },
    canvas: CANVAS,
    invariant: 'scene.content.type 必须等于 scene.type',
    manifestOnlyActionFields: ['audioRef', 'agentIndex'],
    manifestOnlyNote:
      'audioRef / agentIndex 是 ZIP 层的字段，DSL 的 Action 不认识它们。' +
      'audioRef 必须指向 ZIP 内路径，其存在性由 course_pack_maic_zip 与 draft_validate 的媒体检查负责。',
    mediaIndexTypes: MEDIA_INDEX_TYPES,
    appAvatars: {
      note:
        'agents[].avatar 写应用相对路径 /avatars/<文件名>，导入时原样透传、不拷贝字节；' +
        '路径无效不会报错，只会静默显示为空头像。也可用 http(s)/data 地址。清单是快照，' +
        '以实际部署的 OpenMAIC public/avatars/ 为准。',
      known: APP_AVATARS,
    },
    agentConventions: {
      roles: '官方课件用 teacher / assistant / student；导入时 discussion 兜底' + DISCUSSION_AGENT_FALLBACK,
      priority: '官方 CPR 课件用 10 / 7 / 5 / 4（teacher 最高），数值越大越靠前',
      optional: 'agents 数组整体可省略（官方 Python 课件就没有）；但用 discussion 就需要',
      voice: '可选 voiceConfig（{voiceId, providerId}）与 voiceDesign（texture/delivery/identity，官方用英文描述）',
    },
    zip: {
      manifestAtRoot: 'manifest.json',
      audioDir: 'audio/',
      mediaDir: 'media/',
      formatVersion: CLASSROOM_ZIP_FORMAT_VERSION,
      importChecks: IMPORT_CHECKS,
      importNote: '导入侧只做这三项检查，不校验任何字段——本地校验不可省。',
    },
    reduceTyping: {
      draft_normalize: '补上元素内容默认值、派生 line/shape 的几何（start/end、viewBox/path）',
      scene_clone: '复制已有页面的版式，只改写文字槽位',
      note: 'id / left / top / width / height / rotate 无法派生，必须显式写。',
    },
    next: '字段语义与取值细节读 references/skills/agent-runtime/slide-dsl 与 slide-craft。',
  });
}

function draftValidate(args: Record<string, unknown>): ToolResult {
  const manifest = readManifestArg(args);
  const result = validateManifest(manifest);
  const validatorLabel =
    result.validator === 'schema'
      ? '上游 JSON Schema（权威，写入路径同款闸门）'
      : '@openmaic/dsl 结构子集（已降级）';
  const lines = [
    result.valid
      ? '✅ 结构校验通过'
      : `❌ 结构校验失败：${result.errors.length} 个错误`,
    `校验器：${validatorLabel} · 契约 ${result.dslVersion}`,
    ...formatIssues('错误', result.errors),
    ...formatIssues('警告', result.warnings, 30),
    '',
    '注意：结构校验通过 ≠ 内容正确。事实保真与教学法质量由你负责，见 references/grounding.md。',
  ];
  return { content: [{ type: 'text', text: lines.join('\n') }], isError: !result.valid };
}

function draftNormalize(args: Record<string, unknown>): ToolResult {
  const manifest = readManifestArg(args);
  const outcome = normalizeManifest(manifest);
  const lines = [
    outcome.changed ? '✅ 已归一化（有字段被补上）' : '✅ 已归一化（无需改动，输入已经是完整的）',
    '归一会补上元素内容的必需默认值，并派生可派生的几何（line 的 start/end、shape 的 viewBox/path）。',
    '它**不会**填 id / left / top / width / height / rotate —— 这些必须由你写。',
    ...formatIssues('被丢弃的元素（形状不合法，已降级移除）', outcome.dropped, 30),
  ];
  return {
    content: [
      { type: 'text', text: lines.join('\n') },
      { type: 'text', text: '```json\n' + JSON.stringify(outcome.manifest, null, 2) + '\n```' },
    ],
    isError: outcome.dropped.length > 0,
  };
}

/**
 * 在场景内所有字符串字段上做「恰好一次」的替换，语义对齐上游 `str_replace`。
 *
 * 返回替换后的新场景（不改动入参），以及哪些动作的文字被动过——后者用来判断
 * 哪些旁白的 audioRef 已经与新文字不匹配。
 */
function applyReplacements(
  scene: Record<string, unknown>,
  replacements: { find: string; replace: string }[],
): { scene: Record<string, unknown>; touchedActionIndexes: Set<number> } {
  const counts = new Map<string, number>();
  const countIn = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const { find } of replacements) {
        if (!find) continue;
        let from = 0;
        for (;;) {
          const at = value.indexOf(find, from);
          if (at < 0) break;
          counts.set(find, (counts.get(find) ?? 0) + 1);
          from = at + find.length;
        }
      }
      return;
    }
    if (Array.isArray(value)) value.forEach(countIn);
    else if (value && typeof value === 'object') Object.values(value).forEach(countIn);
  };
  countIn(scene);

  for (const { find } of replacements) {
    const seen = counts.get(find) ?? 0;
    if (seen === 0) {
      throw new ToolError(`find "${find}" 在克隆出的页面里找不到。请先读该页确认原文。`);
    }
    if (seen > 1) {
      throw new ToolError(
        `find "${find}" 在克隆出的页面里出现了 ${seen} 次，替换会有歧义。` +
          '请扩大锚点让它唯一。',
      );
    }
  }

  const touchedActionIndexes = new Set<number>();

  /** actionIndex 非空表示当前正在遍历某个动作，用于追踪"这条旁白被改过"。 */
  const walk = (value: unknown, actionIndex: number | null): unknown => {
    if (typeof value === 'string') {
      let next = value;
      for (const { find, replace } of replacements) {
        if (find && next.includes(find)) {
          next = next.split(find).join(replace);
          if (actionIndex !== null) touchedActionIndexes.add(actionIndex);
        }
      }
      return next;
    }
    if (Array.isArray(value)) return value.map((item) => walk(item, actionIndex));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) out[key] = walk(item, actionIndex);
      return out;
    }
    return value;
  };

  const nextScene: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(scene)) {
    // actions 单独走一遍：要按索引追踪，且索引不能透传给其他字段
    if (key === 'actions') continue;
    nextScene[key] = walk(value, null);
  }
  if (Array.isArray(scene.actions)) {
    nextScene.actions = (scene.actions as unknown[]).map((action, index) => walk(action, index));
  }

  return { scene: nextScene, touchedActionIndexes };
}

function sceneClone(args: Record<string, unknown>): ToolResult {
  const manifest = readManifestArg(args);

  const fromOrder = args.fromOrder;
  if (typeof fromOrder !== 'number') throw new ToolError('scene_clone 需要 fromOrder（复制哪一页）');

  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
  if (scenes.length === 0) throw new ToolError('manifest.scenes 为空，没有可复制的页面');

  const source = scenes.find((s) => s?.order === fromOrder);
  if (!source) {
    throw new ToolError(
      `找不到 order=${fromOrder} 的页面。现有 order：${scenes.map((s) => s?.order).join(', ')}`,
    );
  }

  const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : null;
  if (!title) throw new ToolError('scene_clone 需要 title（新页面的标题，不能为空）');

  const rawReplacements = Array.isArray(args.replacements) ? args.replacements : [];
  const replacements = rawReplacements
    .filter((r): r is { find: string; replace: string } =>
      Boolean(r) && typeof (r as never as Record<string, unknown>).find === 'string',
    )
    .map((r) => ({ find: r.find, replace: typeof r.replace === 'string' ? r.replace : '' }));

  const cloneScene = JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
  const warnings: Issue[] = [];

  const { scene: rewritten, touchedActionIndexes } = applyReplacements(cloneScene, replacements);

  // 文字改了，原音频就配不上了——丢掉 audioRef，避免播放错误的旁白。
  if (Array.isArray(rewritten.actions)) {
    (rewritten.actions as Record<string, unknown>[]).forEach((action, i) => {
      if (touchedActionIndexes.has(i) && typeof action.audioRef === 'string') {
        delete action.audioRef;
        warnings.push({
          path: `/actions/${i}`,
          message: '该动作的文字被改写，原有 audioRef 已移除（否则会播放与新文字不符的旁白）。需要旁白请重新生成音频。',
        });
      }
    });
  }

  rewritten.title = title;

  const total = scenes.length;
  const targetOrder =
    typeof args.newOrder === 'number' && Number.isInteger(args.newOrder) && args.newOrder >= 1
      ? Math.min(args.newOrder, total + 1)
      : total + 1;

  // 克隆出的页面与源页共享同一批元素 id，会造成跨页 id 重复（渲染层重复 key）。
  // 这里对克隆页做 id 归一：加页前缀、页内去重，并同步改写 spotlight / laser 引用。
  const { scene: normalizedScene, renamed: normalizedIds } = normalizeSceneIds(
    rewritten,
    targetOrder,
  );

  const shifted = scenes.map((scene) => {
    const order = typeof scene?.order === 'number' ? scene.order : 0;
    return order >= targetOrder ? { ...scene, order: order + 1 } : scene;
  });

  const nextScenes = [...shifted, { ...normalizedScene, order: targetOrder }].sort(
    (a, b) => (a?.order ?? 0) - (b?.order ?? 0),
  );

  const nextManifest: ManifestLike = { ...manifest, scenes: nextScenes };
  const result = validateManifest(nextManifest);

  const lines = [
    `✅ 已克隆 order=${fromOrder} 的页面到 order=${targetOrder}`,
    `新标题：${title}`,
    `替换了 ${replacements.length} 处文字；克隆页 ${normalizedIds} 个 id 已加页前缀并去重`,
    ...formatIssues('警告', warnings, 30),
    ...formatIssues(
      '克隆后的结构校验错误（请修复后再打包）',
      result.errors,
      30,
    ),
    '',
    '下一步：用 replacements 逐条改写文字槽位，或先 draft_validate 看还有哪些槽位没换。',
  ];

  return {
    content: [
      { type: 'text', text: lines.join('\n') },
      { type: 'text', text: '```json\n' + JSON.stringify(nextManifest, null, 2) + '\n```' },
    ],
    isError: !result.valid,
  };
}

function draftLayout(args: Record<string, unknown>): ToolResult {
  const manifest = readManifestArg(args);
  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
  const issues: LayoutIssue[] = [];

  scenes.forEach((scene, i) => {
    checkSceneLayout(scene as Loose, `/scenes/${i}`, issues);
  });

  const lines = [
    issues.length === 0
      ? '✅ 未发现版式风险'
      : `[!] 发现 ${issues.length} 处版式风险（越界 / 溢出 / 折行 / 压盖）`,
    '这些是启发式判断，不是结构错误——逐条看，确认是不是有意为之。',
    '',
    '安全区：画布 1000 × 562.5，四周 50px（内容区 50–950 × 50–512.5）。',
    ...issues.slice(0, 60).map((x) => `  - ${x.path}  ${x.message}`),
    ...(issues.length > 60 ? [`  …另有 ${issues.length - 60} 处`] : []),
  ];
  return { content: [{ type: 'text', text: lines.join('\n') }], isError: issues.length > 0 };
}

function sceneNormalizeIds(args: Record<string, unknown>): ToolResult {
  const manifest = readManifestArg(args);
  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
  if (scenes.length === 0) throw new ToolError('manifest.scenes 为空，没有可归一化的页面');

  let renamed = 0;
  const nextScenes = scenes.map((scene, i) => {
    const result = normalizeSceneIds(scene as Loose, typeof scene?.order === 'number' ? scene.order : i + 1);
    renamed += result.renamed;
    return result.scene;
  });

  const nextManifest: ManifestLike = { ...manifest, scenes: nextScenes };
  const result = validateManifest(nextManifest);

  const lines = [
    `✅ 已归一化 ${renamed} 个 id（元素 / 动作 / 题目 / 表格单元格）`,
    '规则：全部加 `p{页码}_` 前缀，页内重复的追加 `_2`、`_3`；',
    'spotlight / laser 的 elementId 已同步改指新 id。',
    ...formatIssues('归一化后的校验错误', result.errors, 30),
  ];
  return {
    content: [
      { type: 'text', text: lines.join('\n') },
      { type: 'text', text: '```json\n' + JSON.stringify(nextManifest, null, 2) + '\n```' },
    ],
    isError: !result.valid,
  };
}

function coursePack(args: Record<string, unknown>): ToolResult {
  const manifest = readManifestArg(args);
  const outputPath = args.outputPath;
  if (typeof outputPath !== 'string' || !outputPath) {
    throw new ToolError('course_pack_maic_zip 需要 outputPath（.maic.zip 的绝对路径）');
  }

  const result = validateManifest(manifest);
  if (!result.valid) {
    return fail(
      `打包前校验失败，已中止（${result.errors.length} 个错误）。先修好再打包：\n` +
        result.errors.slice(0, 30).map((e) => `  - ${e.path}  ${e.message}`).join('\n'),
    );
  }

  const files = Array.isArray(args.files) ? (args.files as Record<string, unknown>[]) : [];
  const provided = new Map<string, Buffer>();

  for (const file of files) {
    const zipPath = file?.zipPath;
    if (typeof zipPath !== 'string') throw new ToolError('files[] 条目需要 zipPath');
    if (!isSafeZipPath(zipPath)) throw new ToolError(`非法的 zipPath：${zipPath}`);

    let data: Buffer;
    if (typeof file.base64 === 'string') data = Buffer.from(file.base64, 'base64');
    else if (typeof file.text === 'string') data = Buffer.from(file.text, 'utf8');
    else if (typeof file.filePath === 'string') {
      if (!existsSync(file.filePath)) throw new ToolError(`找不到文件：${file.filePath}`);
      if (!statSync(file.filePath).isFile()) throw new ToolError(`不是文件：${file.filePath}`);
      data = readFileSync(file.filePath);
    } else {
      throw new ToolError(`files[] 条目 "${zipPath}" 需要 filePath / base64 / text 之一`);
    }
    provided.set(zipPath, data);
  }

  const mediaIndex = manifest.mediaIndex && typeof manifest.mediaIndex === 'object' ? manifest.mediaIndex : {};
  const declared = new Set(Object.keys(mediaIndex));

  const missing = [...declared].filter((p) => !provided.has(p));
  if (missing.length > 0) {
    return fail(
      '以下 mediaIndex 条目声明了但没有提供字节，导入后媒体会缺失：\n' +
        missing.map((p) => `  - ${p}`).join('\n') +
        '\n请通过 files[] 提供 filePath / base64 / text；如果这一页不需要媒体，把对应元素与 mediaIndex 条目一起删掉。',
    );
  }
  const undeclared = [...provided.keys()].filter((p) => !declared.has(p));
  if (undeclared.length > 0) {
    return fail(
      '以下 files[] 路径没有在 mediaIndex 里登记，导入时不会被索引：\n' +
        undeclared.map((p) => `  - ${p}`).join('\n') +
        '\n请在 mediaIndex 里补上条目（键与 sourceRef 都用该 ZIP 路径最省事）。',
    );
  }

  const stamped: ManifestLike = {
    ...manifest,
    formatVersion:
      typeof manifest.formatVersion === 'number' ? manifest.formatVersion : CLASSROOM_ZIP_FORMAT_VERSION,
    exportedAt: typeof manifest.exportedAt === 'string' ? manifest.exportedAt : new Date().toISOString(),
    _generator: {
      name: 'maic-course-authoring',
      dslVersion: DSL_VERSION,
    },
  };

  const entries = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(stamped, null, 2), 'utf8') },
    ...[...provided.entries()].map(([name, data]) => ({ name, data })),
  ].sort((a, b) => (a.name === 'manifest.json' ? -1 : b.name === 'manifest.json' ? 1 : 0));

  const zip = buildZip(entries);
  writeFileSync(outputPath, zip);

  return json({
    ok: true,
    outputPath,
    bytes: zip.length,
    entries: entries.map((e) => ({ name: e.name, bytes: e.data.length })),
    warnings: result.warnings,
    next: '请用户到 OpenMAIC 首页 → 导入课堂 → 选择该 .maic.zip。',
  });
}

// ─────────────────────────────────────────────────────────────
// 工具注册表
// ─────────────────────────────────────────────────────────────

export const TOOLS: ToolDefinition[] = [
  {
    name: 'material_list',
    description:
      '列出材料目录下的全部源材料及其字节数。写作前的第一步——保真要求必须先读材料。未配置材料目录时会明确报错。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'material_read',
    description:
      '分页读取一份源材料的文本。用返回的 nextOffset 继续读，直到它为 null。',
    inputSchema: {
      type: 'object',
      properties: {
        materialId: { type: 'string', description: 'material_list 返回的 id' },
        offset: { type: 'integer', minimum: 0, description: '字符偏移，默认 0' },
        length: { type: 'integer', minimum: 1, description: '本次返回的字符数，默认 8000' },
      },
      required: ['materialId'],
      additionalProperties: false,
    },
  },
  {
    name: 'material_search',
    description:
      '在源材料里做字面量、不区分大小写的检索，返回命中位置与前后 200 字符。写每个事实性断言（数字、公式、专有名词、引文）之前都要用它确认出处。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200, description: '要查找的字面文本' },
        materialId: { type: 'string', description: '可选，限定在某一份材料内检索' },
        maxHits: { type: 'integer', minimum: 1, maximum: 30, description: '最多返回条数，默认 30' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'dsl_schema_get',
    description:
      '返回课件结构契约摘要：DSL 版本、场景类型、画布与对齐网格、各层必需字段、manifest 结构、mediaIndex 类型、以及导入侧的三项检查。写作时随时参照。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'draft_validate',
    description:
      '结构校验（硬闸门，走上游权威校验器）。抓缺失字段、类型错误、scene.type 与 content.type 不一致、动作缺 id、order 重复、悬空 audioRef、以及会永远显示骨架屏的占位符 src。每写完一页就调用一次。它抓不到事实错误与教学法问题。',
    inputSchema: {
      type: 'object',
      properties: {
        manifest: { type: 'object', description: 'manifest 对象（与 manifestPath 二选一）' },
        manifestPath: { type: 'string', description: 'manifest.json 的本地绝对路径' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'draft_normalize',
    description:
      '归一化：补上元素内容的必需默认值、派生可派生的几何（line 的 start/end、shape 的 viewBox/path），返回归一化后的 manifest。形状不合法的元素会被逐条丢弃并如实报告。**不填 id / left / top / width / height / rotate**，这些必须显式写。用法：先写最小必需字段，再归一化，少写很多字。',
    inputSchema: {
      type: 'object',
      properties: {
        manifest: { type: 'object', description: 'manifest 对象（与 manifestPath 二选一）' },
        manifestPath: { type: 'string', description: 'manifest.json 的本地绝对路径' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'scene_clone',
    description:
      '克隆一页：复制指定 order 的页面（连同它的全部版式），插入到新位置，只改写文字槽位。这是「不逐字重画版式」的主力工具——先克隆一个已有的好版面，再用 replacements 换掉文案。克隆页的元素 / 动作 / 表格单元格 id 会自动加 `p{页码}_` 前缀并去重，spotlight / laser 引用同步改写，避免与源页撞 id。若某条旁白的文字被改写，其 audioRef 会被自动移除并告警。',
    inputSchema: {
      type: 'object',
      properties: {
        manifest: { type: 'object', description: 'manifest 对象（与 manifestPath 二选一）' },
        manifestPath: { type: 'string', description: 'manifest.json 的本地绝对路径' },
        fromOrder: { type: 'integer', minimum: 1, description: '要复制的源页面 order' },
        title: { type: 'string', description: '新页面的标题，不能为空' },
        newOrder: {
          type: 'integer',
          minimum: 1,
          description: '插入位置；省略则追加到末尾。原有 order 会自动后移。',
        },
        replacements: {
          type: 'array',
          description:
            '文字替换列表。每个 find 必须在该页内恰好出现一次（对齐上游 str_replace 语义）；出现 0 次或多次都会报错，要求你扩大锚点。',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', description: '要被替换的原文（唯一）' },
              replace: { type: 'string', description: '替换成的新文字' },
            },
            required: ['find'],
            additionalProperties: false,
          },
        },
      },
      required: ['fromOrder', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'draft_layout',
    description:
      '版式检查：元素越出安全区、文本盒高度不足导致溢出、单行接近折行（>75% 行容量）、内容元素互相压盖、文字被后绘制的形状盖住。这些是结构校验抓不到的启发式风险；报出来后逐条判断是否需要调整。每写完一页、以及交付前，都应跑一次。',
    inputSchema: {
      type: 'object',
      properties: {
        manifest: { type: 'object', description: 'manifest 对象（与 manifestPath 二选一）' },
        manifestPath: { type: 'string', description: 'manifest.json 的本地绝对路径' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'scene_normalize_ids',
    description:
      'id 归一：给全部场景的元素 / 动作 / 题目 / 表格单元格 id 加 `p{页码}_` 前缀并保证页内唯一（页内重复的追加 `_2`、`_3`），spotlight 与 laser 的 elementId 同步改指新 id。**长课程交付前必跑**——同一页调用两次同一个版式函数会让两批元素 id 从同一起点开始，渲染层出现重复 key。id 改写会改变身份，请在打包前跑一次即可。',
    inputSchema: {
      type: 'object',
      properties: {
        manifest: { type: 'object', description: 'manifest 对象（与 manifestPath 二选一）' },
        manifestPath: { type: 'string', description: 'manifest.json 的本地绝对路径' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'course_pack_maic_zip',
    description:
      '校验通过后打出 .maic.zip。mediaIndex 里声明的每个条目都必须通过 files[] 提供字节，否则中止；files[] 里未登记在 mediaIndex 的路径同样中止。',
    inputSchema: {
      type: 'object',
      properties: {
        manifest: { type: 'object', description: 'manifest 对象（与 manifestPath 二选一）' },
        manifestPath: { type: 'string', description: 'manifest.json 的本地绝对路径' },
        files: {
          type: 'array',
          description: 'ZIP 内每个文件的内容。zipPath 必须与 mediaIndex 的键一致。',
          items: {
            type: 'object',
            properties: {
              zipPath: { type: 'string', description: 'ZIP 内路径，如 media/asset-1.jpg' },
              filePath: { type: 'string', description: '本地文件绝对路径' },
              base64: { type: 'string', description: 'base64 内容（与 filePath 二选一）' },
              text: { type: 'string', description: '纯文本内容（与 filePath 二选一）' },
            },
            required: ['zipPath'],
            additionalProperties: false,
          },
        },
        outputPath: { type: 'string', description: '.maic.zip 的输出绝对路径' },
      },
      required: ['outputPath'],
      additionalProperties: false,
    },
  },
];

type Handler = (args: Record<string, unknown>) => ToolResult;

const HANDLERS: Record<string, Handler> = {
  material_list: materialList,
  material_read: materialRead,
  material_search: materialSearch,
  dsl_schema_get: dslSchemaGet,
  draft_validate: draftValidate,
  draft_normalize: draftNormalize,
  draft_layout: draftLayout,
  scene_clone: sceneClone,
  scene_normalize_ids: sceneNormalizeIds,
  course_pack_maic_zip: coursePack,
};

export function callTool(name: string, args: Record<string, unknown> | undefined): ToolResult {
  const handler = HANDLERS[name];
  if (!handler) return fail(`未知工具：${name}`);
  try {
    return handler(args ?? {});
  } catch (error) {
    if (error instanceof MaterialsError || error instanceof ToolError) return fail(error.message);
    const message = error instanceof Error ? error.message : String(error);
    return fail(`工具 ${name} 执行失败：${message}`);
  }
}
