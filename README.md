<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 maic-course-gen-skills contributors
-->

# maic-course-gen-skills

用**你自己的 Agent** 依据原始材料撰写 OpenMAIC 课件，打包成可直接导入的 `.maic.zip`；
OpenMAIC 负责它最擅长的部分：渲染与预览。

本仓库目前包含一个技能：**`maic-course-authoring`**。

---

## 它是什么

一个 [Agent Skills](https://agentskills.io/specification) 格式的技能，外加一个配套的
MCP server。两者合起来回答一个问题：

> 手里有材料，怎么让 Agent 写出一份**结构合法、可导入 OpenMAIC、并且每个断言都能
> 回指到原文**的课件？

- **Skill**（`skills/maic-course-authoring/SKILL.md`）承载写法知识：工作流、保真规则、
  以及从 [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) 原样复用的 25 个技能包
  （含 900 行的幻灯片字段手册与设计法则）。
- **MCP**（`skills/maic-course-authoring/mcp/`）提供手：读材料、按上游 JSON Schema
  校验结构、归一化补默认值、克隆已有版式、打包 `.maic.zip`。

工具面里**没有任何生成内容的能力**——内容由 Agent 决定，工具只负责
「读得到原文」「结构合法」「包能导入」。

## 与 OpenMAIC 的关系

OpenMAIC 自带的生成流水线为吞吐与一致性做了取舍：材料文本在大纲阶段读一次，之后
各阶段基于大纲继续展开。本仓库走另一个方向——Agent 全程依据原文。

OpenMAIC 已有的「外部 Agent 驱动」路径是 `POST /api/generate-classroom`：提交需求文本，
由 **OpenMAIC 服务端**调模型生成。本仓库的不同点在于**模型、材料、写作过程都在你自己的
Agent 手里**，产出物是一个静态包，OpenMAIC 只负责装载与渲染。

课件格式、渲染、预览完全由 OpenMAIC 提供。上游尚未实现的打包侧（`@openmaic/exporter`
仍是保留项）由本仓库的 `course_pack_maic_zip` 提供。

## 快速开始

把技能装进你的 Agent 工作台：将 `skills/maic-course-authoring/` 目录导入对应工作台，
或直接指向本仓库。

MCP 配置（stdio）：

```json
{
  "mcpServers": {
    "maic-course": {
      "command": "node",
      "args": ["<仓库路径>/skills/maic-course-authoring/mcp/dist/server.mjs"],
      "env": { "MAIC_MATERIALS_DIR": "/absolute/path/to/your/documents" }
    }
  }
}
```

`dist/server.mjs` 是**已构建好的单文件**（除 `node:` 内置模块外零依赖），无需
`npm install` 即可运行。想从源码构建：

```bash
cd skills/maic-course-authoring/mcp
npm install
npm run build      # → dist/server.mjs
npm test           # 79 项冒烟测试
```

材料目录支持 `md markdown txt json csv tsv html htm xml yaml yml log`；
**PDF / DOCX / PPTX 请先转成文本**再放进去——这里刻意不引入文档解析依赖，
因为「先读原文」这一步不该被工具链的复杂度掩盖。

拿到 `.maic.zip` 后，在 OpenMAIC 首页选「导入课堂」即可预览。

## MCP 工具（10 个）

| 工具 | 作用 |
| --- | --- |
| `material_list` `material_read` `material_search` | 读原始材料——保真的根 |
| `dsl_schema_get` | **权威必需字段表** + 契约摘要（运行时从上游 schema 推导） |
| `draft_normalize` | 让上游补默认值、派生几何，少写一批字段 |
| `draft_validate` | 结构闸门（上游 JSON Schema）+ id 唯一性 + 引用完整性 |
| `draft_layout` | 版式检查：越界 / 文本溢出 / 折行 / 元素压盖 |
| `scene_clone` | 复制已有页面的版式，只改写文字槽位（自动处理 id） |
| `scene_normalize_ids` | 全篇 id 归一：加页前缀并去重，同步改写 spotlight 引用 |
| `course_pack_maic_zip` | 打出 `.maic.zip` |

CLI 也有对应的非交互入口：`--validate <manifest.json>`（结构 + id）、
`--check <x.maic.zip>`（校验已打包的 zip）、`--pack`、`--tools`。

## 仓库布局

```text
maic-course-gen-skills/
├── skills/
│   └── maic-course-authoring/
│       ├── SKILL.md               技能入口：路由 + 工作流 + 硬规则
│       ├── references/
│       │   ├── grounding.md       保真规则（写作前必读）
│       │   ├── workflow.md        从材料到交付的 SOP
│       │   ├── structure.md       文档结构 + 权威必需字段表
│       │   ├── maic-zip.md        .maic.zip 格式规范
│       │   └── skills/            上游 25 个技能包（原样复用，MIT）
│       │       └── INDEX.md       本仓库新增：要做什么 → 读哪个技能
│       ├── mcp/                   MCP server（TS 源码 + 单文件构建产物）
│       └── examples/
│           ├── README.md          三个示例的索引与覆盖点说明
│           ├── minimal-course/    2 页最小骨架
│           ├── element-cookbook/  十种画布元素逐个样例
│           └── full-course/       完整课程（互动 + 白板 + 双智能体）
├── scripts/
│   └── apply-license-headers.mjs  许可头注入（幂等）
├── LICENSE                        本仓库许可（MIT）
├── LICENSE-openmaic               上游许可全文副本
└── NOTICE.md                      第三方内容归属
```

## 校验为什么可信

结构闸门用的是上游自己发布的 JSON Schema（`@openmaic/dsl/schema/*.json`）。上游文档
对它的定位是「the language-neutral mirror of the contract for non-TS consumers」；
`draft_normalize` 用的 `normalize*` 系列在上游文档里明确面向
「producers normalizing wild-world input (imported decks, model output)」。
这两个闸门是上游为外部生产者预留的官方接口。

## 已验证

- `npm test`：**94 项全绿**，通过真实 MCP stdio 协议驱动构建产物，以上游 JSON Schema
  为闸门。
- 自建 ZIP 写入器（`node:zlib` + 手写容器 + CRC32）产出的包能被系统 `unzip` 读取；
  产物除 `node:` 内置模块外无任何运行时 import。
- `examples/` 下三个示例 manifest 全部通过校验。
- 一份 **45 页 / 700 个 id 的真实课件**（由本技能驱动另一个 Agent 产出）通过全部
  校验；其暴露出的 id 重复与版式缺陷已回填为本仓库的检查工具。

**尚未验证**：把包真正导入一个运行中的 OpenMAIC 实例并渲染。导入行为是从源码读出来的
（`lib/import/use-import-classroom.ts`），还没端到端跑过。

## 已知取舍

**媒体最可靠的来源是源材料本身。** 从 PDF 里按页提取系统截图（逐张核对内容后配图、
压缩到 1440px 宽）比让 Agent 画示意图可靠得多，也避免了"图是真的、配文是编的"。
不用内部生成器就没有 AI 配图与 TTS；`media/` 与 `audio/` 需要真实字节，
占位符 `src` 会永远显示骨架屏。

**`DSL_VERSION` 会漂。** 导入侧不校验格式版本，上游改了 DSL 时旧包会静默出错。
`dsl_schema_get` 会在检测到版本不一致时告警，包里也自带版本戳。

**技能发现。** `references/skills/` 内嵌了上游的 24 个 `SKILL.md`。把宿主指向仓库的
`skills/` 根时，会递归扫描的加载器可能把它们也发现为技能——这种情况下请把宿主指向
`skills/maic-course-authoring/` 本身。

## 许可证

本仓库新增内容：MIT（见 [`LICENSE`](LICENSE)）。

`skills/maic-course-authoring/references/skills/` 下的 53 个文件取自
[THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC)（MIT），版权归原项目所有，
见 [`NOTICE.md`](NOTICE.md) 与 [`LICENSE-openmaic`](LICENSE-openmaic)。
"OpenMAIC" 等名称的使用仅用于指明互操作对象与内容出处。
