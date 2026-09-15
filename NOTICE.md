<!--
本文件列出本仓库中来自第三方的内容及其许可。
-->

# NOTICE · 第三方内容归属

本仓库包含来自 [THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) 的内容，
按 **MIT 许可**使用。

OpenMAIC 是一个开源的 AI 互动课堂平台（Next.js + 多智能体编排），
本项目构建在它的课件契约与预览能力之上。感谢清华 MAIC 团队的开源工作。

---

## 1. 逐字复制的文档

以下目录与文件**逐字复制自上游**，未作修改（仅在文件顶部添加了许可头注释）：

| 本仓库路径 | 上游路径 | 许可 |
| --- | --- | --- |
| `skills/maic-course-authoring/references/skills/agent-runtime/` | `skills/agent-runtime/` | MIT |
| `skills/maic-course-authoring/references/skills/openmaic/` | `skills/openmaic/` | MIT |

共 53 个文件（44 个 Markdown + 9 个 JSON）。

许可证全文：见 [`LICENSE-openmaic`](LICENSE-openmaic)。
上游版权：`Copyright (c) 2026 THU-MAIC`。

**许可头说明：** 44 个 Markdown 文件已在顶部加入归属注释。为不破坏技能加载器
对 YAML frontmatter 的解析，注释插在 frontmatter **之后**。9 个 JSON 文件因格式
不支持注释而未加头，其归属由本文件与 `LICENSE-openmaic` 覆盖。校验与补写：

```bash
node scripts/apply-license-headers.mjs --check   # 检查（在仓库根运行）
node scripts/apply-license-headers.mjs           # 补写（幂等）
```

`references/skills/INDEX.md` 是**本仓库新增**的索引文件，不属于上游内容。

同步基线：commit `3edaa499`。

### 重新同步的方式

```bash
# 1. 复制上游最新内容
rsync -a --delete \
  /path/to/OpenMAIC/skills/agent-runtime/ \
  skills/maic-course-authoring/references/skills/agent-runtime/
rsync -a --delete \
  /path/to/OpenMAIC/skills/openmaic/ \
  skills/maic-course-authoring/references/skills/openmaic/

# 2. 重新加上许可头（幂等）
node scripts/apply-license-headers.mjs
```

---

## 2. 运行时依赖

| 包 | 许可 | 用途 |
| --- | --- | --- |
| [`@openmaic/dsl`](https://www.npmjs.com/package/@openmaic/dsl) | MIT | 课件结构契约：校验器（`validate*`）与归一化器（`normalize*`） |

这是 `mcp/` 的**运行时依赖**，通过 npm 安装引用，未复制其源码。

---

## 3. 本仓库新增的内容

以下内容为本仓库原创，按 [`LICENSE`](LICENSE)（MIT）分发：

```text
README.md
LICENSE            （本仓库自身许可）
LICENSE-openmaic   （上游许可全文副本，为分发完整性而附）
NOTICE.md          （本文件）
.gitignore
skills/
└── maic-course-authoring/
    ├── SKILL.md
    ├── references/
├── grounding.md
├── workflow.md
├── structure.md
├── maic-zip.md
│   ├── skills/INDEX.md
│   ├── mcp/
│   │   ├── src/**
│   │   ├── test/**
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── tsdown.config.ts
│   │   └── tsconfig.json
│   └── examples/
│       ├── README.md
│       ├── minimal-course/manifest.json
│       ├── element-cookbook/manifest.json
│       └── full-course/manifest.json
scripts/
└── apply-license-headers.mjs
```

这些文件中凡是描述 OpenMAIC 契约、格式或行为的部分，都是基于上游源码的
**阅读与验证**得出的，属于事实性引用，不构成对上游代码的复制。

---

## 4. 商标与名称

"OpenMAIC"、"MAIC" 及上游项目的标识归 THU-MAIC 所有。
本仓库对其名称的使用仅用于**指明互操作对象与内容出处**，不表示任何形式的
赞助、认可或官方关联。
