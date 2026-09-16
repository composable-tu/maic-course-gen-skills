/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 maic-course-gen-skills contributors
 */

/**
 * 基于上游 JSON Schema 的结构校验。
 *
 * 结构闸门用上游 JSON Schema（`@openmaic/dsl/schema/*`）。上游文档对它的定位是
 * "the language-neutral mirror of the contract for non-TS consumers"，覆盖到字段值级别；
 * `validate*` 系列是结构子集（存在性 + 判别式）。上游写入路径的闸门正是 schema。
 *
 * 为什么按判别式分派：
 * `scene.schema.json` 的根是 `anyOf` 四个按类型分好的场景定义，元素与动作各自又是
 * 十种 / 二十一种的 `anyOf`。而这些都是 `$ref` 型 union，ajv 报错时给出的
 * `schemaPath` 是**被引用定义自己的路径**，不带 `anyOf/N`，因此无法从错误里还原
 * 是哪一支失败。直接跑并集的结果是：一个「缺 defaultColor」会膨胀成 58 条互相
 * 矛盾的错误（每个元素分支都报一遍）。对 Agent 来说这是不可用的输出。
 *
 * 所以我们自己做分派：先从 schema 里推导出「类型值 → 定义名」的映射，再让每个
 * 场景 / 元素 / 动作只对它自己那一支校验。错误因此是干净的、可执行的。
 * 映射完全从 schema 读取，不硬编码，上游加类型时自动跟上。
 */

import Ajv, { type ValidateFunction } from 'ajv';

import sceneSchemaJson from '@openmaic/dsl/schema/scene.schema.json';
import stageSchemaJson from '@openmaic/dsl/schema/stage.schema.json';

export interface SchemaIssue {
  path: string;
  message: string;
}

type JsonSchema = Record<string, any>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sceneSchema = sceneSchemaJson as JsonSchema;
const stageSchema = stageSchemaJson as JsonSchema;

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** 解析 `#/definitions/X` 到 schema 里的定义（$ref 段是百分号编码的）。 */
function resolveDefinition(schema: JsonSchema, ref: string): JsonSchema | undefined {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  return ref
    .slice(2)
    .split('/')
    .map(decodeSegment)
    .reduce<JsonSchema | undefined>((acc, key) => acc?.[key], schema);
}

/** 从 union 定义推导「判别式取值 → 定义名」。 */
function buildDiscriminatedMap(schema: JsonSchema, unionName: string): Record<string, string> {
  const union = schema.definitions?.[unionName] as JsonSchema | undefined;
  const branches: JsonSchema[] = union?.anyOf ?? union?.oneOf ?? [];
  const map: Record<string, string> = {};
  for (const branch of branches) {
    if (typeof branch?.$ref !== 'string') continue;
    const name = decodeSegment(branch.$ref.replace('#/definitions/', ''));
    const def = schema.definitions?.[name] as JsonSchema | undefined;
    const discriminator = def?.properties?.type;
    const value = discriminator?.const ?? discriminator?.enum?.[0];
    if (typeof value === 'string') map[value] = name;
  }
  return map;
}

function branchRef(schema: JsonSchema, unionName: string, definitionName: string): JsonSchema {
  void unionName;
  // 直接引用定义；根 schema 的 definitions 保证 $ref 可解析
  return { ...schema, $ref: `#/definitions/${encodeURIComponent(definitionName)}` };
}

// ─────────────────────────────────────────────────────────────
// 编译
// ─────────────────────────────────────────────────────────────

interface Compiled {
  stage?: ValidateFunction;
  sceneByType: Record<string, ValidateFunction>;
  sceneUnion?: ValidateFunction;
  elementByType: Record<string, ValidateFunction>;
  actionByType: Record<string, ValidateFunction>;
  sceneDefinitionByType: Record<string, string>;
  elementDefinitionByType: Record<string, string>;
  actionDefinitionByType: Record<string, string>;
  error?: string;
}

let compiled: Compiled | undefined;

function compileAll(): Compiled {
  const result: Compiled = {
    sceneByType: {},
    elementByType: {},
    actionByType: {},
    sceneDefinitionByType: {},
    elementDefinitionByType: {},
    actionDefinitionByType: {},
  };

  try {
    const ajv = new Ajv({ allErrors: true, strict: false });

    result.stage = ajv.compile(branchRef(stageSchema, 'Stage', 'Stage'));

    // 场景：根是 #/definitions/SerializedScene，其 anyOf 的每一支是一个场景类型
    const sceneMap = buildDiscriminatedMap(sceneSchema, 'SerializedScene');
    result.sceneDefinitionByType = sceneMap;
    for (const [typeValue, definitionName] of Object.entries(sceneMap)) {
      result.sceneByType[typeValue] = ajv.compile(
        branchRef(sceneSchema, 'SerializedScene', definitionName),
      );
    }
    // 场景类型非法时的兜底：跑并集，只用来报「类型不认识」
    result.sceneUnion = ajv.compile(sceneSchema);

    // 元素：从 slide 场景推导出 elements.items 指向的 union
    const slideDefinition =
      sceneMap.slide ?? findSlideDefinitionName(sceneSchema);
    const slideDef = slideDefinition
      ? (sceneSchema.definitions?.[slideDefinition] as JsonSchema | undefined)
      : undefined;
    const elementsRef = slideDef?.properties?.content?.$ref;
    const slideContent = resolveDefinition(sceneSchema, elementsRef ?? '');
    const elementUnionRef = slideContent?.properties?.canvas?.$ref;
    const canvasDef = resolveDefinition(sceneSchema, elementUnionRef ?? '');
    const elementUnionName = String(canvasDef?.properties?.elements?.items?.$ref ?? '')
      .replace('#/definitions/', '')
      .trim();

    if (elementUnionName) {
      const elementMap = buildDiscriminatedMap(
        sceneSchema,
        decodeSegment(elementUnionName),
      );
      result.elementDefinitionByType = elementMap;
      for (const [typeValue, definitionName] of Object.entries(elementMap)) {
        result.elementByType[typeValue] = ajv.compile(
          branchRef(sceneSchema, elementUnionName, definitionName),
        );
      }
    }

    // 动作：从场景定义推导出 actions.items 指向的 union
    const actionsRef = slideDef?.properties?.actions?.items?.$ref;
    const actionUnionName = String(actionsRef ?? '').replace('#/definitions/', '').trim();
    if (actionUnionName) {
      const decoded = decodeSegment(actionUnionName);
      const actionMap = buildDiscriminatedMap(sceneSchema, decoded);
      result.actionDefinitionByType = actionMap;
      for (const [typeValue, definitionName] of Object.entries(actionMap)) {
        result.actionByType[typeValue] = ajv.compile(
          branchRef(sceneSchema, decoded, definitionName),
        );
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

function findSlideDefinitionName(schema: JsonSchema): string | undefined {
  return Object.keys(schema.definitions ?? {}).find((name) => name.startsWith('Scene<'));
}

function getCompiled(): Compiled {
  if (!compiled) compiled = compileAll();
  return compiled;
}

/**
 * manifest 层独有、DSL 契约不认识的字段。
 *
 * 依据：`ManifestAction = Omit<Action, 'audioId'> & { audioRef?, agentIndex? }`
 * （上游 `lib/export/classroom-zip-types.ts`）。也就是说 `audioRef` / `agentIndex`
 * 是 ZIP 这一层的字段，DSL 的 `Action` 里没有它们，而 schema 是闭合的
 * （`additionalProperties: false`）。所以校验动作前必须先把它们摘掉，
 * 否则每个带旁白的 speech 动作都会被误报成"未定义的字段 audioRef"。
 *
 * `audioRef` 的引用完整性由 `validateMedia` 单独负责，不会因此漏检。
 */
const MANIFEST_ONLY_ACTION_FIELDS = ['audioRef', 'agentIndex'] as const;

function toProbeAction(action: unknown): unknown {
  if (typeof action !== 'object' || action === null) return action;
  const probe = { ...(action as Record<string, unknown>) };
  for (const field of MANIFEST_ONLY_ACTION_FIELDS) delete probe[field];
  return probe;
}

/**
 * 从 schema 推导各层的必需字段表。
 *
 * 这是给 Agent 最有价值的一项输出：手写 DSL 时最容易出错的就是"这个类型到底要哪些
 * 字段"，而这份表完全来自上游 schema，不会随上游更新而失准。
 * 我们不再手工维护任何一份必需字段清单——那样必然漂移。
 */
export interface RequiredFieldsSummary {
  scene: Record<string, string[]>;
  element: Record<string, string[]>;
  action: Record<string, string[]>;
  slide: string[];
  slideTheme: string[];
  quizContent: string[];
  quizQuestion: string[];
}

function requiredOf(schema: JsonSchema, name: string): string[] {
  const def = schema.definitions?.[name] as JsonSchema | undefined;
  return Array.isArray(def?.required) ? [...def.required].sort() : [];
}

export function requiredFieldsSummary(): RequiredFieldsSummary {
  const c = getCompiled();
  const collect = (
    map: Record<string, string>,
    schema: JsonSchema,
  ): Record<string, string[]> =>
    Object.fromEntries(
      Object.entries(map).map(([typeValue, definitionName]) => [
        typeValue,
        requiredOf(schema, definitionName),
      ]),
    );

  return {
    scene: collect(c.sceneDefinitionByType, sceneSchema),
    element: collect(c.elementDefinitionByType, sceneSchema),
    action: collect(c.actionDefinitionByType, sceneSchema),
    slide: requiredOf(sceneSchema, 'Slide'),
    slideTheme: requiredOf(sceneSchema, 'SlideTheme'),
    quizContent: requiredOf(sceneSchema, 'QuizContent'),
    quizQuestion: requiredOf(sceneSchema, 'QuizQuestion'),
  };
}

export function schemaInfo(): {
  available: boolean;
  error?: string;
  sceneTypes: string[];
  elementTypes: string[];
  actionTypes: string[];
} {
  const c = getCompiled();
  return {
    available: Boolean(c.stage && !c.error),
    ...(c.error ? { error: c.error } : {}),
    sceneTypes: Object.keys(c.sceneDefinitionByType),
    elementTypes: Object.keys(c.elementDefinitionByType),
    actionTypes: Object.keys(c.actionDefinitionByType),
  };
}

// ─────────────────────────────────────────────────────────────
// 校验
// ─────────────────────────────────────────────────────────────

function toIssues(
  validate: ValidateFunction,
  basePath: string,
  prefix = '',
): SchemaIssue[] {
  return (validate.errors ?? []).map((error) => {
    const params = (error.params ?? {}) as Record<string, unknown>;
    const detail = params.missingProperty
      ? `（缺 ${String(params.missingProperty)}）`
      : params.additionalProperty
        ? `（未定义的字段 ${String(params.additionalProperty)}）`
        : params.allowedValues
          ? `（允许的值：${(params.allowedValues as unknown[]).join(' | ')}）`
          : '';
    return {
      path: `${basePath}${prefix}${error.instancePath || ''}` || '/',
      message: `${error.message ?? '校验失败'}${detail}`,
    };
  });
}

/** 这些路径由定向分派的那几趟负责，场景级那一趟不再重复报。 */
function ownedByTargetedPass(instancePath: string): boolean {
  return (
    /^(?:\/content\/canvas|\/whiteboards\/\d+)\/elements(?:\/|$)/.test(instancePath) ||
    /^\/actions(?:\/|$)/.test(instancePath)
  );
}

function dedupe(issues: SchemaIssue[]): SchemaIssue[] {
  const seen = new Set<string>();
  const out: SchemaIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.path}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

export interface SchemaValidationResult {
  available: boolean;
  errors: SchemaIssue[];
  error?: string;
}

/**
 * 对一个文档做定向 schema 校验。
 *
 * @param stage      合成后的 stage 对象
 * @param scenes     合成后的 scene 数组（已补 id / stageId）
 * @param scenePrefixes 每个 scene 在 manifest 里的路径前缀，如 `/scenes/0`
 */
export function validateWithSchema(
  stage: Record<string, unknown> | undefined,
  scenes: Record<string, unknown>[],
  scenePrefixes: string[],
): SchemaValidationResult {
  const c = getCompiled();
  if (!c.stage || c.error) {
    return { available: false, errors: [], ...(c.error ? { error: c.error } : {}) };
  }

  const errors: SchemaIssue[] = [];

  if (stage) {
    if (!c.stage(stage)) errors.push(...toIssues(c.stage, '/stage'));
  }

  scenes.forEach((scene, index) => {
    const base = scenePrefixes[index] ?? `/scenes/${index}`;
    const typeValue = typeof scene.type === 'string' ? scene.type : '';
    const sceneValidator = c.sceneByType[typeValue];

    if (!sceneValidator) {
      if (c.sceneUnion && !c.sceneUnion(scene)) {
        errors.push(...toIssues(c.sceneUnion, base));
      }
      return;
    }
    if (!sceneValidator(scene)) {
      errors.push(...toIssues(sceneValidator, base).filter((i) => !ownedByTargetedPass(i.path.slice(base.length))));
    }

    // 元素：画布 + 白板，逐个按类型分派
    const elementGroups: { path: string; elements: unknown }[] = [
      { path: '/content/canvas/elements', elements: (scene.content as JsonSchema)?.canvas?.elements },
    ];
    const whiteboards = (scene as JsonSchema).whiteboards;
    if (Array.isArray(whiteboards)) {
      whiteboards.forEach((board: JsonSchema, boardIndex: number) => {
        elementGroups.push({
          path: `/whiteboards/${boardIndex}/elements`,
          elements: board?.elements,
        });
      });
    }

    for (const group of elementGroups) {
      if (!Array.isArray(group.elements)) continue;
      group.elements.forEach((element: JsonSchema, elementIndex: number) => {
        const elementPath = `${base}${group.path}/${elementIndex}`;
        const validator = c.elementByType[String(element?.type ?? '')];
        if (!validator) {
          errors.push({
            path: `${elementPath}/type`,
            message: `未定义的元素类型 ${JSON.stringify(element?.type)}（允许：${Object.keys(
              c.elementByType,
            ).join(' | ')}）`,
          });
          return;
        }
        if (!validator(element)) errors.push(...toIssues(validator, elementPath));
      });
    }

    // 动作：逐个按类型分派。先摘掉 manifest 层独有的字段（见上）。
    const actions = (scene as JsonSchema).actions;
    if (Array.isArray(actions)) {
      actions.forEach((action: JsonSchema, actionIndex: number) => {
        const actionPath = `${base}/actions/${actionIndex}`;
        const validator = c.actionByType[String(action?.type ?? '')];
        if (!validator) {
          errors.push({
            path: `${actionPath}/type`,
            message: `未定义的动作类型 ${JSON.stringify(action?.type)}（允许：${Object.keys(
              c.actionByType,
            ).join(' | ')}）`,
          });
          return;
        }
        if (!validator(toProbeAction(action))) errors.push(...toIssues(validator, actionPath));

        // manifest 里出现 audioId 是可疑的：导入侧只认 audioRef
        if (isObject(action) && action.audioId !== undefined) {
          errors.push({
            path: `${actionPath}/audioId`,
            message:
              'manifest 里请用 audioRef（指向 ZIP 内路径），而不是 audioId。' +
              'audioId 是文档层字段，导出成 ZIP 时会被换成 audioRef。',
          });
        }
      });
    }
  });

  return { available: true, errors: dedupe(errors) };
}
