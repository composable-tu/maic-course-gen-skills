<!--
Skill 索引 · 同步自 THU-MAIC/OpenMAIC (MIT)
来源目录：skills/agent-runtime/、skills/openmaic/
本文件为新增（索引），其余技能文件为上游原文。
-->

# 技能索引

本目录是 **THU-MAIC/OpenMAIC 上游 `skills/` 的完整同步**，原样保留。
上游把课件编写的领域知识拆成了 25 个技能包，每个都以 Agent 可读的形式写成。

**不要一次读完。** 按下面「你现在要做什么」查表，只加载需要的那一份。
每份文件顶部的 `description` 会说明它的适用边界与不该用它的情况。

---

## 一、契约与数据结构（写作前必读）

| 技能 | 用途 |
| --- | --- |
| [`slide-dsl`](agent-runtime/slide-dsl/SKILL.md) | **幻灯片字段手册**（约 900 行）。画布、背景、十种元素的逐字段说明、单位、默认值、合法取值、渲染器实际行为。写任何不熟悉的元素类型前先读它 |
| [`stage-dsl`](agent-runtime/stage-dsl/SKILL.md) | **课程文档地图**。stage / outline / scene / content / action 的层级结构，以及去哪一章查细节 |
| [`slide-craft`](agent-runtime/slide-craft/SKILL.md) | **设计法则**。画布几何、字号↔行数↔高度对照表、字号层级、对比度、间距节奏、富文本的渲染陷阱 |

> 这三份是硬知识，不是建议。本仓库的 `../structure.md` 与 `../maic-zip.md`
> 是把它们映射到"直接写 JSON 文件"这一形态后的补充。

---

## 二、少写字的机制（强烈建议先读）

这两份是上游对「不要逐字生成」这个问题的正面回答。

| 技能 | 用途 |
| --- | --- |
| [`page-clone`](agent-runtime/page-clone/SKILL.md) | **让新页面继承已有页面的设计**：复制那一页，然后只改写它的文字槽位，不重画版式。对应本仓库 MCP 的 `scene_clone` |
| [`style-clone`](agent-runtime/style-clone/SKILL.md) | 课程级工作：**盘点课程里已有哪些版式，然后给每个大纲条目分配一个**。决定了克隆链的起点 |

---

## 三、决定"讲什么"（规划类）

| 技能 | 用途 |
| --- | --- |
| [`curriculum-planner`](agent-runtime/curriculum-planner/SKILL.md) | 系列课规划。用 `ask_user` 与用户确认课时数、概念顺序、深度 |
| [`stage-design`](agent-runtime/stage-design/SKILL.md) | 单节课的页面计划。先与用户敲定计划再动手创建 |
| [`spiral-curriculum`](agent-runtime/spiral-curriculum/SKILL.md) | 螺旋式课程设计：同一概念在不同课时递进复现 |
| [`understanding-by-design`](agent-runtime/understanding-by-design/SKILL.md) | 理解本位设计（UbD）：先定预期结果与评估证据，再设计活动 |
| [`k12-core-literacy-planning`](agent-runtime/k12-core-literacy-planning/SKILL.md) | 核心素养教学设计（含 `references/subjects/` 的分学科参考） |
| [`zone-of-proximal-development`](agent-runtime/zone-of-proximal-development/SKILL.md) | 最近发展区（ZPD）理论落地，含理论参考与练习课范例 |

---

## 四、决定"怎么讲"（教学法 / 风格类）

| 技能 | 用途 |
| --- | --- |
| [`lecture-style`](agent-runtime/lecture-style/SKILL.md) | 大师讲授式 |
| [`workshop-style`](agent-runtime/workshop-style/SKILL.md) | 互动工作坊式 |
| [`feynman-learning`](agent-runtime/feynman-learning/SKILL.md) | 费曼学习法 |
| [`learning-to-learn`](agent-runtime/learning-to-learn/SKILL.md) | 学习策略嵌入学科概念课 |
| [`social-emotional-learning`](agent-runtime/social-emotional-learning/SKILL.md) | 社会情感学习（SEL）嵌入学科课 |
| [`vocational`](agent-runtime/vocational/SKILL.md) | 职业实训路径（对应上游的 task engine 分支） |
| [`deep-interactive`](agent-runtime/deep-interactive/SKILL.md) | 深度交互页：3D、模拟、游戏、思维导图、在线编程 |
| [`deep-research`](agent-runtime/deep-research/SKILL.md) | 生成前的深度调研 |

---

## 五、保真与核查（与本仓库的 grounding.md 直接相关）

| 技能 | 用途 |
| --- | --- |
| [`fact-check`](agent-runtime/fact-check/SKILL.md) | **事实核查**。当输入材料内部冲突、或结论与材料不符时的处理路径，包括如何用 `ask_user` 把冲突摊给用户，以及在页面上标注警示 |

> 上游在 Pro 运行时里用 `ask_user` 承载"发现冲突就停下来问"。
> 非 Pro 形态下没有这条通路，所以我们把它落成了 `../grounding.md` 的四条硬规则
> 与交付前自检清单。

---

## 六、素材来源与编辑

| 技能 | 用途 |
| --- | --- |
| [`pptx-import`](agent-runtime/pptx-import/SKILL.md) | 把已有 `.pptx` 导入为页面（保版式），而不是让 AI 重画。**这是"结构来自既有产物"的最强形式** |
| [`pro-editing`](agent-runtime/pro-editing/SKILL.md) | 修订一个已经就是你要的样子的页面 |
| [`teacher-style-clone`](agent-runtime/teacher-style-clone/SKILL.md) | 复刻某位教师的教学风格 |
| [`build-personal-skill`](agent-runtime/build-personal-skill/SKILL.md) | 把用户的教学偏好沉淀成个人技能包 |

---

## 七、OpenClaw / 工作台集成

| 技能 | 用途 |
| --- | --- |
| [`openmaic`](openmaic/SKILL.md) | 上游给 Agent 工作台用的引导式 SOP：在线体验、本地部署、课堂生成、基于 `@openmaic/*` SDK 二次开发。含 `references/` 的分段文档，其中 `extend-sdk.md` 是「用 SDK 构建独立应用」的官方指引，`generate-flow.md` 是「外部 Agent 提交生成任务」的官方流程 |

---

## 八、结构约束机制

`skills/agent-runtime/*/outline-constraints.json` 是一套**机器可查的结构约束**：
每个技能声明允许的场景类型、首场景类型、以及各类型的数量配比（如 lecture-style
要求 slide 占比 ≥ 0.65、quiz 1–3 个、interactive ≤ 2 个）。

上游把它**渲染进大纲 prompt，并对模型输出做校验**，违规作为工具结果诊断回传给
Agent 触发重规划（见 `lib/server/agent-runtime/skills.ts`）。文件顶部的 `$comment`
字段说明了设计意图：风格里"可机器检查的那一半"放在这里，"无法机器检查的那一半"
（如叙述语气的长短）才交给 prompt。

这是上游对「给 Agent 可校验的结构骨架」这一问题的又一层回答，
与 `page-clone`（版式复用）和 `normalize*`（默认值补全）互补。

---

## 溯源

所有文件取自 [THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) 的
`skills/` 目录，按 MIT 许可使用，版权归原项目所有。详见仓库根目录的
[`NOTICE.md`](../../../NOTICE.md) 与 [`LICENSE-openmaic`](../../../LICENSE-openmaic)。

同步基线：仓库 commit `3edaa499`（`@openmaic/dsl@0.11.1`，`DSL_VERSION = 0.3.0`）。
上游更新后需重新同步本目录。
