/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 new-maic contributors
 */

/**
 * 版式检查与 id 归一。
 *
 * 上游 JSON Schema 是**结构**闸门：它保证文档能被导入与解析，但不判断版式。
 * 一份"字段全对"的课件仍然可能有元素越出安全区、文本盒高度不够导致溢出、
 * 或者同一页里两个元素 id 相同——最后这一类会让 React 以重复 key 渲染，
 * 用户看到的是控制台刷警告与页面反复重渲染。
 *
 * 这两块检查与归一逻辑的算法来自一次 45 页真实课件的实战
 * （合同管理系统操作手册培训课件，700 个 id），在那里它们抓到了
 * 结构校验抓不到的三类真实缺陷：同页 id 重复、内容溢出底衬、元素压盖。
 * 行高表与折行阈值沿用该次实战验证过的取值（与 slide-craft 的高度表一致）。
 *
 * 边界：这些都是启发式。重叠检查放过了"文字压在先绘制的浅色底衬上"这种
 * 刻意的卡片做法；折行估算对中英文都按 1em 估宽。报出来的是**风险**，
 * 不是裁决——Agent 应当逐条判断。
 */

import type { Loose } from './validate.js';

/** 安全区：画布 1000 × 562.5，四周 50px 边距（见 slide-craft）。 */
export const LIVE_AREA = { left: 50, right: 950, top: 50, bottom: 512.5 } as const;

/**
 * 字号 → 各行数下的文本盒高度（行高 1.5，含上下 10px 内边距）。
 * 索引 0 对应 1 行。与 slide-craft 的高度对照表一致。
 */
const H_TABLE: Record<number, number[]> = {
  14: [43, 64, 85, 106, 127],
  16: [46, 70, 94, 118, 142],
  18: [49, 76, 103, 130, 157],
  20: [52, 82, 112, 142, 172],
  24: [58, 94, 130, 166, 202],
  28: [64, 106, 148, 190, 232],
  32: [70, 118, 166, 214, 262],
  36: [76, 130, 184, 238, 292],
};

const isObject = (v: unknown): v is Loose =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function stripHtml(html: string): string {
  return String(html).replace(/<[^>]+>/g, '');
}

/**
 * 按显示宽度估算文本长度，单位是 em（一个全角字符的宽度）。
 *
 * 最初按「字符数」估，等于把拉丁字母也当成 1em 宽——但拉丁字母实际约 0.5em。
 * 一次 49 页的实战里，`UNIT 01`～`UNIT 05` 这类纯拉丁标签因此全部被误报为
 * 「单行余量 ≥95%」，共 32 处假阳性，只能逐条人工排除。按字宽折算后这类
 * 提示会自行消失。
 */
export function displayWidthEm(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
      (code >= 0x2e80 && code <= 0x303f) || // CJK 部首扩展 / 标点
      (code >= 0x3040 && code <= 0x30ff) || // 平假名 / 片假名
      (code >= 0x3130 && code <= 0x318f) || // 谚文兼容字母
      (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
      (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意文字
      (code >= 0xac00 && code <= 0xd7a3) || // 谚文音节
      (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意文字
      (code >= 0xff00 && code <= 0xffef) || // 全角形式
      (code >= 0x20000 && code <= 0x3fffd); // CJK 扩展 B-F
    width += wide ? 1 : 0.5;
  }
  return width;
}

/** 估算文本在给定宽度下的行数（按显示宽度折算，中英文混排分别计宽）。 */
export function estimateLines(text: string, fontSize: number, width: number): number {
  const emPerLine = (width - 20) / fontSize;
  if (emPerLine <= 0) return 1;
  return Math.max(1, Math.ceil(displayWidthEm(stripHtml(text)) / emPerLine));
}

/** 取一个文本元素里的最大字号；没写 font-size 时按 18px 估。 */
function dominantFontSize(content: string): number {
  const sizes = [...String(content).matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) =>
    Number(m[1]),
  );
  return sizes.length > 0 ? Math.max(...sizes) : 18;
}

export interface LayoutIssue {
  path: string;
  message: string;
}

/** 单段文本的折行风险：最长行已用掉超过 75% 的行容量。 */
const WRAP_RISK_RATIO = 0.75;

function checkTextBox(el: Loose, path: string, issues: LayoutIssue[]): void {
  const content = typeof el.content === 'string' ? el.content : '';
  if (!content) return;
  const width = typeof el.width === 'number' ? el.width : 0;
  const height = typeof el.height === 'number' ? el.height : 0;
  if (width <= 0 || height <= 0) return;

  const fontSize = dominantFontSize(content);
  const emPerLine = (width - 20) / fontSize;

  // 按 <p> 分段估算总行数，比"总字符数 / 每行容量"更接近真实折行
  const paragraphs = content
    .split(/<\/p>/i)
    .map((p) => stripHtml(p).trim())
    .filter((p) => p.length > 0);
  const lines =
    paragraphs.length > 0
      ? paragraphs.reduce(
          (sum, p) => sum + Math.max(1, Math.ceil(displayWidthEm(p) / emPerLine)),
          0,
        )
      : 1;

  const table = H_TABLE[fontSize];
  const needed = table?.[lines - 1] ?? Math.round(fontSize * 1.5 * lines) + 20;

  if (needed > height) {
    issues.push({
      path: `${path}/height`,
      message:
        `文本可能溢出：约 ${lines} 行 × ${fontSize}px 需要约 ${needed}px，声明高度 ${height}px。` +
        '加高文本盒或减少内容。',
    });
  } else {
    const firstLine = paragraphs[0];
    const firstLineEm = firstLine !== undefined ? displayWidthEm(firstLine) : 0;
    if (lines === 1 && firstLineEm > 0 && emPerLine > 0 && firstLineEm > emPerLine * WRAP_RISK_RATIO) {
      issues.push({
        path,
        message:
          `折行风险：该行显示宽度约 ${firstLineEm.toFixed(1)}em，已用掉行容量 ` +
          `${((firstLineEm / emPerLine) * 100).toFixed(0)}%（宽 ${width}，${fontSize}px，` +
          `${emPerLine.toFixed(1)}em/行）。离折行只差一点，高度预算可能不保。`,
      });
    }
  }
}

/** 内容元素两两重叠；text 被后绘制的 shape 盖住也报。 */
function checkOverlaps(elements: Loose[], base: string, issues: LayoutIssue[]): void {
  const boxesOverlap = (a: Loose, b: Loose): boolean => {
    const pad = 1;
    return (
      Number(a.left) + pad < Number(b.left) + Number(b.width) &&
      Number(b.left) + pad < Number(a.left) + Number(a.width) &&
      Number(a.top) + pad < Number(b.top) + Number(b.height) &&
      Number(b.top) + pad < Number(a.top) + Number(a.height)
    );
  };
  const label = (el: Loose): string => `${el.type}#${el.id}`;

  const content = elements.filter((e) => ['text', 'image', 'table'].includes(String(e.type)));
  for (let i = 0; i < content.length; i += 1) {
    for (let j = i + 1; j < content.length; j += 1) {
      const a = content[i]!;
      const b = content[j]!;
      if (boxesOverlap(a, b)) {
        issues.push({
          path: `${base}/elements/${a.id}`,
          message: `与 ${label(b)} 重叠。内容元素互相压盖通常意味着其中一个需要挪位或缩放。`,
        });
      }
    }
  }

  const index = new Map(elements.map((e, i) => [String(e.id), i]));
  const shapes = elements.filter((e) => String(e.type) === 'shape');
  for (const text of elements.filter((e) => String(e.type) === 'text')) {
    for (const shape of shapes) {
      if (isObject(shape.text)) continue; // 形状自带的标签，属于形状的一部分
      const shapeIndex = index.get(String(shape.id)) ?? -1;
      const textIndex = index.get(String(text.id)) ?? -1;
      // 先画底衬、后画文字是刻意的卡片做法；反过来才是把文字盖住
      if (shapeIndex < textIndex) continue;
      if (boxesOverlap(text, shape)) {
        issues.push({
          path: `${base}/elements/${text.id}`,
          message: `被 ${label(shape)} 盖住（该形状绘制在文字之后）。调整元素顺序或位置。`,
        });
      }
    }
  }
}

/**
 * 版式检查：越界、文本溢出/折行、元素压盖。
 * 这些是启发式风险提示，不是结构错误。
 */
export function checkSceneLayout(
  scene: Loose,
  scenePath: string,
  issues: LayoutIssue[],
): void {
  if (!isObject(scene)) return;

  const groups: { base: string; elements: unknown }[] = [
    { base: `${scenePath}/content/canvas`, elements: scene.content?.canvas?.elements },
  ];
  if (Array.isArray(scene.whiteboards)) {
    scene.whiteboards.forEach((board: Loose, i: number) => {
      groups.push({ base: `${scenePath}/whiteboards/${i}`, elements: board?.elements });
    });
  }

  for (const group of groups) {
    if (!Array.isArray(group.elements)) continue;
    group.elements.forEach((raw: Loose, k: number) => {
      if (!isObject(raw)) return;
      const path = `${group.base}/elements/${k}`;
      const isLine = String(raw.type) === 'line';
      const left = Number(raw.left);
      const top = Number(raw.top);
      const width = Number(raw.width);
      const height = Number(raw.height ?? 0);

      if (Number.isFinite(left) && (left < LIVE_AREA.left || top < LIVE_AREA.top)) {
        issues.push({
          path: `${path}/left`,
          message: `越出安全区上/左边距（left=${left}, top=${top}，安全区从 ${LIVE_AREA.left} 起）。`,
        });
      }
      if (!isLine && Number.isFinite(width) && left + width > LIVE_AREA.right + 0.5) {
        issues.push({
          path: `${path}/width`,
          message: `右边界 ${(left + width).toFixed(1)} 超出安全区右缘 ${LIVE_AREA.right}。`,
        });
      }
      if (!isLine && Number.isFinite(height) && top + height > LIVE_AREA.bottom + 0.5) {
        issues.push({
          path: `${path}/height`,
          message: `底边 ${(top + height).toFixed(1)} 超出安全区下缘 ${LIVE_AREA.bottom}（内容会溢出画布）。`,
        });
      }

      if (String(raw.type) === 'text') checkTextBox(raw, path, issues);
    });

    checkOverlaps(group.elements as Loose[], group.base, issues);
  }
}

// ─────────────────────────────────────────────────────────────
// id 归一
// ─────────────────────────────────────────────────────────────

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * id 归一：给一页的所有 id 加页前缀并保证页内唯一。
 *
 * 背景：长课程里同一页常会调用两次同一个版式函数，两批元素的 id 会从同一个
 * 起点开始（如两处都是 el_step1），渲染层因此出现重复 key。
 *
 * 规则：
 *   - 元素 id → `p{order}_{原id}`，页内重复的追加 `_2`、`_3`
 *   - 白板元素 id → `p{order}_wb{白板序号}_{原id}`
 *   - 表格单元格 id → `{新元素id}_c{行}_{列}`
 *   - 动作 id → `p{order}_{原id}`；spotlight / laser 的 elementId 改指新元素 id
 *   - quiz 题目 id → `p{order}_{原id}`
 *
 * 返回改写后的场景与改名数量。
 */
export function normalizeSceneIds(scene: Loose, order: number): { scene: Loose; renamed: number } {
  if (!isObject(scene)) return { scene, renamed: 0 };
  const prefix = `p${pad2(order)}`;

  // 幂等保护：这一页的元素 id 已经全部带页前缀时跳过，
  // 避免重复调用把 id 越叠越长（p01_p01_el_1 之类）。
  const canvasElements = isObject(scene.content?.canvas)
    ? (scene.content.canvas.elements as unknown)
    : undefined;
  const alreadyPrefixed =
    Array.isArray(canvasElements) &&
    canvasElements.length > 0 &&
    canvasElements.every(
      (el) => isObject(el) && typeof el.id === 'string' && el.id.startsWith(`${prefix}_`),
    );
  if (alreadyPrefixed) return { scene, renamed: 0 };

  const seen = new Map<string, number>();
  const remap = new Map<string, string>();
  let renamed = 0;

  /** 在页内为 base 生成唯一 id；同一 base 第二次出现时追加序号。 */
  const uniqueId = (base: string): string => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base}_${n}` : base;
  };

  const renameElements = (elements: unknown, keyPrefix: string): unknown => {
    if (!Array.isArray(elements)) return elements;
    return elements.map((raw: Loose) => {
      if (!isObject(raw) || typeof raw.id !== 'string') return raw;
      const nextId = uniqueId(`${keyPrefix}${raw.id}`);
      remap.set(raw.id, nextId);
      renamed += 1;
      const next: Loose = { ...raw, id: nextId };
      if (next.type === 'table' && Array.isArray(next.data)) {
        next.data = (next.data as unknown[]).map((row: unknown, r: number) =>
          Array.isArray(row)
            ? (row as Loose[]).map((cell: Loose, c: number) => ({
                ...cell,
                id: `${nextId}_c${r}_${c}`,
              }))
            : row,
        );
      }
      return next;
    });
  };

  const next: Loose = { ...scene };

  next.content = isObject(scene.content)
    ? {
        ...scene.content,
        ...(isObject(scene.content.canvas)
          ? {
              canvas: {
                ...scene.content.canvas,
                elements: renameElements(scene.content.canvas.elements, `${prefix}_`),
              },
            }
          : {}),
      }
    : scene.content;

  if (Array.isArray(scene.whiteboards)) {
    next.whiteboards = (scene.whiteboards as Loose[]).map((board, i) =>
      isObject(board)
        ? { ...board, elements: renameElements(board.elements, `${prefix}_wb${i + 1}_`) }
        : board,
    );
  }

  if (Array.isArray(scene.actions)) {
    next.actions = (scene.actions as Loose[]).map((action) => {
      if (!isObject(action)) return action;
      const out: Loose = { ...action };
      if (typeof out.id === 'string') out.id = uniqueId(`${prefix}_${out.id}`);
      if (
        (out.type === 'spotlight' || out.type === 'laser') &&
        typeof out.elementId === 'string' &&
        remap.has(out.elementId)
      ) {
        out.elementId = remap.get(out.elementId);
      }
      return out;
    });
  }

  if (
    isObject(scene.content) &&
    scene.content.type === 'quiz' &&
    Array.isArray(scene.content.questions)
  ) {
    next.content = {
      ...next.content,
      questions: (scene.content.questions as Loose[]).map((question) => {
        if (!isObject(question) || typeof question.id !== 'string') return question;
        return { ...question, id: uniqueId(`${prefix}_${question.id}`) };
      }),
    };
  }

  return { scene: next, renamed };
}
