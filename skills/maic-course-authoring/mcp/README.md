<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 new-maic contributors
-->

# MAIC 课件自主编写 · MCP server

让外部 Agent 依据原始材料自主编写课件，并打包成可直接导入 OpenMAIC 的 `.maic.zip`。
**不调用 OpenMAIC 的内部生成流水线**——内容由 Agent 写，工具负责读材料、把关结构、打包。

TypeScript 源码 + tsdown 打成单文件产物；所有运行时依赖内联，除 `node:` 内置模块外
不需要任何 `node_modules`。

## 快速开始

```bash
npm install
npm run build          # → dist/server.mjs
npm test               # 构建 + 76 项冒烟测试
npm run typecheck      # tsc --noEmit
```

## 接入 Agent 工作台

```json
{
  "mcpServers": {
    "maic-course": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/dist/server.mjs"],
      "env": { "MAIC_MATERIALS_DIR": "/absolute/path/to/source-documents" }
    }
  }
}
```

`MAIC_MATERIALS_DIR` 递归扫描，支持 `md markdown txt json csv tsv html htm xml yaml yml log`。

未配置 `MAIC_MATERIALS_DIR` 时，材料工具返回明确错误。这样 Agent 会停下来
向用户要材料，而不是在缺少依据的情况下继续写作。

PDF / DOCX / PPTX 需要先转成文本再放进去。

## 工具

### 材料

| 工具 | 说明 |
| --- | --- |
| `material_list` | 列出材料与字节数 |
| `material_read` | 分页读（默认 8000 字符/页），用返回的 `nextOffset` 继续 |
| `material_search` | 字面量、大小写不敏感检索，返回命中位置与前后 200 字符 |

对应上游 `lib/server/agent-runtime/material-tools.ts` 的
`list_materials` / `read_material` / `search_material`（同样的分页窗口与命中上限）。

**写每个事实性断言之前都要调 `material_search` 确认出处。** 这是整套东西存在的理由。

### 契约

`dsl_schema_get` 返回：

- **各层各类型的必需字段表**——运行时不从硬编码，而是从上游 JSON Schema 推导
  （`requiredFields.scene/element/action/canvas`）。这是给 Agent 最有价值的一项输出：
  手写 DSL 最容易错的就是"这个类型到底要哪些字段"，而 schema 是闭合的，
  写错字段名会被判为未定义字段。
- `DSL_VERSION`、画布与对齐网格、mediaIndex 类型、导入侧的三项检查。
- 哪些字段是 manifest 层独有的（`audioRef` / `agentIndex`）。

### 校验与归一化

`draft_validate` —— 结构闸门，基于**上游 JSON Schema**（`@openmaic/dsl/schema/*`），
也就是上游写入路径同款的门。

**结构闸门是上游 JSON Schema**（`@openmaic/dsl/schema/*`）。上游文档对它的定位是
"the language-neutral mirror of the contract for non-TS consumers"，覆盖到字段值级别；
`validate*` 系列则是结构子集（存在性 + 判别式）。schema 不可用时降级到 `validate*`，
并在输出里如实标明。

为什么按判别式分派：`scene.schema.json` 的根是 `anyOf` 四个按类型分好的场景定义，
元素与动作各自又是十种 / 二十一种的 `anyOf`，而这些是 `$ref` 型 union——ajv 报错时
`schemaPath` 指向被引用定义自身、不带 `anyOf/N`，无法从错误还原是哪一支失败。直接跑
并集的结果是：一个「缺 defaultColor」膨胀成 58 条互相矛盾的错误，对 Agent 不可用。
所以我们先探明「类型值 → 定义名」的映射，再让每个场景 / 元素 / 动作只对自己那一支校验。

它抓什么：缺失字段、未定义字段、类型错误、`scene.type` 与 `content.type` 不一致、
动作缺 `id`、`order` 重复、悬空 `audioRef`、以及会永远显示骨架屏的占位符 `src`。

它抓不到：**事实错误与教学法问题**。那是 Agent 的责任。

`draft_normalize` —— 让上游补默认值：元素内容的必需默认值（`defaultFontName`、
`defaultColor`、`fill` 等）与可派生的几何（`line` 的 `start`/`end`、`shape` 的
`viewBox`/`path`）。元素级降级用 `normalizeSlideWith({ onInvalid: 'drop' })`，
丢掉的元素会被如实报告。**不填 `id`/`left`/`top`/`width`/`height`/`rotate`。**

### 复用版式

`scene_clone` —— 复制一页（连同它的全部版式）到新位置，只改写文字槽位。
多页课件的默认做法：先把一页做好，后续页面克隆它再换文字。

- `replacements: [{ find, replace }]`，每个 `find` 必须在该页内**恰好出现一次**，
  否则报错要求扩大锚点（对齐上游 `str_replace` 语义）。
- 某条旁白的文字被改写时，其 `audioRef` 会自动移除并告警——原音频已与新文字不匹配。
- 克隆页的元素 / 动作 / 表格单元格 id 自动加 `p{页码}_` 前缀并去重，
  `spotlight` / `laser` 引用同步改写——否则克隆页与源页必然撞 id。

### 版式与 id

这两个检查来自一次 45 页真实课件的实战：结构校验全绿的课件，仍可能因为
**同页 id 重复**（同一版式函数被调用两次）在渲染层报重复 key，或者存在
文本溢出、元素压盖。

`draft_layout` —— 越界（安全区 50–950 × 50–512.5）、文本盒高度不足、
单行超过 75% 行容量的折行风险、内容元素互相压盖、文字被后绘制的形状盖住。
全部是启发式风险提示，报出来后逐条判断。

`scene_normalize_ids` —— 给全部场景的元素 / 动作 / 题目 / 表格单元格 id 加
`p{页码}_` 前缀并保证页内唯一，`spotlight` / `laser` 的 `elementId` 同步改指。
幂等：已带前缀的页面会跳过。**长课程交付前必跑一次。**

`draft_validate` 现在也检查 id 唯一性（页内 + 全篇）与引用完整性
（`spotlight` / `laser` 的目标必须存在于同场景）。

### 打包

`course_pack_maic_zip`：

- 打包前先跑完整校验，不通过直接中止。
- `mediaIndex` 声明的每个条目都必须通过 `files[]` 提供字节，否则中止。
- `files[]` 里未在 `mediaIndex` 登记的路径同样中止。
- 产出的 `manifest.json` 补上 `formatVersion`、`exportedAt` 与 `_generator` 版本戳。

## CLI

```bash
node dist/server.mjs --check course.maic.zip    # 校验已打包的 zip
node dist/server.mjs --pack manifest.json out.maic.zip
node dist/server.mjs --tools                    # 列出工具
```

```bash
unzip -l course.maic.zip
unzip -p course.maic.zip manifest.json | head -40
```

## 源码结构

```text
src/
├── server.ts          入口：MCP stdio 传输 + CLI
├── tools.ts           10 个工具的定义与实现
├── validate.ts        校验与归一化流水线
├── validate-schema.ts 上游 JSON Schema 的定向校验（判别式分派）
├── layout.ts          版式检查（越界/溢出/压盖）与 id 归一
├── materials.ts       材料库的只读访问
├── contract.ts        契约常量（不可从 schema 推导的那部分）
└── zip.ts             最小 ZIP 读写（写入 + 读取）
```

## 设计取舍

**为什么自己写 ZIP。** 只依赖 `node:zlib`，不引入 `jszip`。这样单文件产物在离线环境
也能打包，而"能打包"是整条链路的地基。冒烟测试用系统 `unzip` 反向验证了兼容性。

**为什么全部内联。** `@openmaic/dsl` 与 `ajv` 都是运行时依赖，外置的话产物就不再是
单文件。`alwaysBundle` 要写正则——裸字符串匹配不到 `@openmaic/dsl/schema/*.json`
这类子路径；而 `neverBundle: []` 并不会关掉 tsdown 对 `package.json` dependencies 的
默认外置。细节见 `tsdown.config.ts` 的注释。

**为什么不用 tsdown 的 `exe`。** 它走 Node 的 SEA，需要 Node ≥ 25.7。这里用 banner 加
shebang，执行位由 `scripts/postbuild.mjs` 补。

**为什么工具不提供生成能力。** 内容由 Agent 决定是这套东西的前提。工具只回答
「原文里有没有这件事」「结构合不合法」「包能不能导入」——这三个问题一旦由工具代答，
就回到了"内容由流水线产生"的老路上。

## 许可证

本目录代码为本项目新增，MIT。相关文档与技能包取自
[THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC)（MIT），
见仓库根目录 [`NOTICE.md`](../NOTICE.md)。
