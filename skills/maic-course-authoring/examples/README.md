<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 new-maic contributors
-->

# 示例

三个示例，按复杂度递增。**全部通过了上游 JSON Schema 的结构校验**
（`node mcp/dist/server.mjs --validate <manifest.json>` 可复核）。

| 示例 | 用途 | 何时看它 |
| --- | --- | --- |
| [`minimal-course`](minimal-course/manifest.json) | 2 页最小可用课件 | 第一次接触格式，想知道最少要写哪些字段 |
| [`element-cookbook`](element-cookbook/manifest.json) | 5 页，覆盖全部十种画布元素 | 要写某个不熟悉的元素类型时，对照抄结构 |
| [`full-course`](full-course/manifest.json) | 4 页 + 双智能体 + 互动 + 白板 + 旁白音频 | 想看一门真实课程怎么把各部分拼起来 |

## 校验与打包

```bash
M=skills/maic-course-authoring/mcp/dist/server.mjs

# 结构校验
node $M --validate skills/maic-course-authoring/examples/element-cookbook/manifest.json

# 打包（minimal-course 的媒体在 mediaIndex 里，需要先提供字节）
node $M --pack skills/maic-course-authoring/examples/minimal-course/manifest.json out.maic.zip \
  --files 2>/dev/null || echo "打包需要 mediaIndex 声明的字节，见下"
```

打包时 `mediaIndex` 声明的每个条目都要通过 `files[]` 提供字节（见
[`../references/maic-zip.md`](../references/maic-zip.md)）。

## 各示例覆盖了什么

### minimal-course — 最小骨架

- `stage` 必填字段、`agents`、两个 scene
- 一个 speech 动作带 `audioRef`（指向 ZIP 内路径）
- `mediaIndex` 同时登记 audio 与 image

### element-cookbook — 十种元素逐个样例

| 页 | 元素 | 看点 |
| --- | --- | --- |
| 1 | `text` ×4 | 字号层级 36/24/18/14；多行用多个 `<p>` 而不是 `<ul>` |
| 2 | `shape` ×2、`line` ×1、`text` ×2 | `viewBox`+`path` 画轮廓；**线条元素没有 `height`/`rotate` 字段** |
| 3 | `chart` ×1、`table` ×1 | `data` 是 `labels`/`legends`/`series` 三件套；单元格必须带 `id`/`colspan`/`rowspan` |
| 4 | `latex` ×1、`code` ×1 | `code` 的 `lines` 是 `{id, content}` 数组 |
| 5 | `image`/`video`/`audio` | 用 `https://` 外链，所以**不需要** `mediaIndex` |

### full-course — 完整能力拼装

- 双智能体（teacher + student），`discussion` 动作用 `agentIndex` 指向学生
- `interactive` 场景：内嵌 `html` + `widgetType` + `widgetConfig`（simulation）
- `whiteboards` 字段：一块白板页，内含 `line` 与文字元素
- `wb_open` / `wb_draw_text` / `wb_close` 白板动作序列
- `quiz` 同时含 `single`（自动判分）与 `short_answer`（`hasAnswer: false`）

## 注意事项

- 示例里的 `audioRef`（full-course）与 `mediaIndex` 条目是**格式演示**：
  打包时需要真实字节，否则 `course_pack_maic_zip` 会中止。
- element-cookbook 的第 5 页用 `https://` 外链，因此**不进** `mediaIndex`，
  校验与打包都不需要字节；导入后的渲染依赖外网可达。
- `full-course` 的第 3 页 interactive 用内嵌 `html`。`widgetConfig` 在
  `widget.md`（`references/skills/agent-runtime/stage-dsl/references/`）里有
  各类型的字段说明。
- **没有 PBL 示例。** `projectV2` 依赖应用侧播种的 canonical 运行时字段
  （`uiPhase`、`status`、空的 `threads`/`submissions` 等），手写极易产生
  渲染异常的 PBL 场景。需要时参考上游 PBL v2 planner 的输出，或
  `references/skills/agent-runtime/stage-dsl/references/pbl.md` 的字段说明。
