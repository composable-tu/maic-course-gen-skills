# 文档结构参考（stage / scene / content）

本文件说明 OpenMAIC 课件文档的**结构契约**。字段级别的详细规则在同目录的
`skills/agent-runtime/` 下（`slide-dsl`、`stage-dsl/references/quiz.md`、
`widget.md`、`pbl.md`、`actions.md`），路由见 `skills/INDEX.md`。

**需要某个类型要哪些字段时，先调 MCP 的 `dsl_schema_get`** —— 那里的必需字段表
是运行时从上游 schema 读的，永远与上游一致；本文件的表格是它的静态快照，便于离线阅读。

契约来源：`@openmaic/dsl`，当前 `DSL_VERSION = '0.3.0'`（见 `@openmaic/dsl/src/version.ts`）。

## 文档模型

```text
stage
├── outline                     （可选、opaque、不校验、不迁移；渲染不依赖它）
└── scenes[]                    按 scene.order 排序，呈现为第 1..N 页
    ├── id                      场景稳定标识
    ├── stageId                 父 stage 的 id（结构契约要求，且必须与 stage.id 一致）
    ├── order                   1 起始的页码
    ├── title                   页面标题
    ├── type                    slide | quiz | interactive | pbl
    ├── content                 shape 由 scene.type 决定
    │   ├── slide.canvas        幻灯片画布
    │   ├── quiz.questions[]    测验题目
    │   ├── interactive.html / widgetConfig
    │   └── pbl.projectV2
    └── actions[]               有序的播放动作
```

**核心不变量：`scene.type` 必须与 `scene.content.type` 一致。** 这是真实的运行时
不变量（消费方先分支 `scene.type`，再按对应 shape 读 `content`），不是风格建议。

## Stage

```ts
interface Stage {
  id: string;                 // 必需
  name: string;               // 必需
  createdAt: number;          // 必需（毫秒时间戳）
  updatedAt: number;          // 必需
  description?: string;
  languageDirective?: string; // 教学语言指令
  style?: string;             // 视觉风格
  whiteboard?: Whiteboard[];
  videoManifest?: VideoManifest;          // 以 PPTVideoElement 的 mediaRef 为键
  agentIds?: string[];
  generatedAgentConfigs?: GeneratedAgentConfig[];
  interactiveMode?: boolean;              // 只在 Interactive Mode 分支生成时为 true
  taskEngineMode?: boolean;
}
```

`generatedAgentConfigs` 的每项：

```ts
{ id, name, role, persona, avatar, color, priority, voiceConfig?, voiceDesign? }
```

## Scene

```ts
interface SceneCore {
  id: string;                 // 必需
  stageId: string;            // 必需，必须等于父 stage 的 id
  title: string;              // 必需
  order: number;              // 必需，1 起始
  actions?: Action[];         // 播放动作，见下节与 skills/agent-runtime/stage-dsl/references/actions.md
  whiteboards?: Slide[];      // 深度讲解用的白板页（结构同 canvas）
  multiAgent?: { enabled: boolean; agentIds: string[]; directorPrompt?: string };
  createdAt?: number;
  updatedAt?: number;
}
```

`Scene = SceneCore & { type: SceneType; content: 对应 shape }`。

## SlideContent

```ts
interface SlideContent {
  type: 'slide';
  schemaVersion?: number;     // 可选，历史兼容
  canvas: Slide;              // 必需
}
```

`canvas`（即 `Slide`）必需字段：

```ts
{
  id: string;
  viewportSize: number;       // 设计尺寸，固定 1000
  viewportRatio: number;      // 固定 0.5625（=> 画布 1000 × 562.5）
  theme: {
    backgroundColor: string;  // 必需
    themeColors: string[];    // 必需
    fontColor: string;        // 必需
    fontName: string;         // 必需
    outline?: PPTElementOutline;
    shadow?: PPTElementShadow;
  };
  elements: PPTElement[];     // 必需，可为空数组
  background?: SlideBackground;
  animations?: PPTAnimation[];
  turningMode?: TurningMode;
  sectionTag?: SectionTag;
  type?: SlideType;
  script?: string;            // 演讲者备注
}
```

每个元素都继承 `PPTBaseElement`，其中 **`rotate` 是必需字段**（常被漏写）：

```ts
interface PPTBaseElement {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  rotate: number;             // 必需，不旋转写 0
  lock?: boolean;
  groupId?: string;
  link?: PPTElementLink;
  name?: string;
}
```

### 十种元素各自的必需字段（权威，来自上游 schema）

元素 schema 是**闭合的**（`additionalProperties: false`）：写错字段名或塞一个
未定义的键，会被直接判为"未定义的字段"。写之前查 `dsl_schema_get` 的必需字段表。

| 元素类型 | 必需字段 | 备注 |
| --- | --- | --- |
| `text` | `id` `type` `left` `top` `width` `height` `rotate` `content` `defaultFontName` `defaultColor` | |
| `image` | `id` `type` `left` `top` `width` `height` `rotate` `src` `fixedRatio` | `fixedRatio` 极易漏写 |
| `shape` | `id` `type` `left` `top` `width` `height` `rotate` `path` `viewBox` `fill` `fixedRatio` | `path`/`viewBox` 可由归一化派生 |
| `line` | `id` `type` `left` `top` `width` `start` `end` `points` `color` `style` | **没有 `height` / `rotate`**，起点终点由归一化派生 |
| `chart` | `id` `type` `left` `top` `width` `height` `rotate` `chartType` `data` `themeColors` | |
| `table` | `id` `type` `left` `top` `width` `height` `rotate` `data` `colWidths` `cellMinHeight` `outline` | |
| `latex` | `id` `type` `left` `top` `width` `height` `rotate` `latex` | |
| `video` | `id` `type` `left` `top` `width` `height` `rotate` `autoplay` | |
| `audio` | `id` `type` `left` `top` `width` `height` `rotate` `src` `fixedRatio` `autoplay` `loop` `color` | |
| `code` | `id` `type` `left` `top` `width` `height` `rotate` `language` `lines` | |

上面这张表可以直接从 MCP 的 `dsl_schema_get` 取到（`requiredFields.element`），
那里是运行时从 schema 读的，永远与上游一致。

### 画布的必需字段

```text
Slide        必需：id viewportSize viewportRatio theme elements
SlideTheme   必需：backgroundColor themeColors fontColor fontName
QuizContent  必需：type questions
QuizQuestion 必需：id type question        （options / answer 可选）
```

## QuizContent

```ts
interface QuizContent {
  type: 'quiz';
  questions: QuizQuestion[];  // 必需
}

interface QuizQuestion {
  id: string;
  type: 'single' | 'multiple' | 'short_answer';
  question: string;
  options?: { label: string; value: string }[];  // value 用 "A" "B" "C" "D"
  answer?: string[];          // 正确选项的 value，如 ["A"]、["A","C"]；简答题留空
  analysis?: string;          // 判分后展示的解析
  commentPrompt?: string;     // 简答题的判分指引
  hasAnswer?: boolean;        // 是否可自动判分
  points?: number;            // 每题分值，默认 1
}
```

选项字段的完整规则与判分语义见 `skills/agent-runtime/stage-dsl/references/quiz.md`。

## InteractiveContent / PBLContent

交互式（HTML 或强类型 widget）见 `skills/agent-runtime/stage-dsl/references/widget.md`；PBL `projectV2` 见该目录的 `pbl.md`。
两者的校验边界不同：交互式内容在其 content 根闭合，但历史 `widgetConfig` 在根之下
有意保持宽容；PBL 在其 content 根闭合，而 `projectV2` 校验器要求核心容器、
对历史运行时扩展字段有意宽容。

## Actions

见 `references/skills/agent-runtime/stage-dsl/references/actions.md`。要点：

- `actions` 是有序的播放动词数组。
- **每个动作都必须有非空 `id`**。这是个容易踩的坑：导入路径的
  `canonicalizeLegacyScene` **不会**补 action id。
- **动作 schema 是闭合的**，除了下列必需字段外不要塞其他键。
- `audioRef` 与 `agentIndex` 是 **ZIP 层**的字段，DSL 的 `Action` 不认识它们
  （见 `maic-zip.md`）。校验时会先把它们摘掉，所以 `audioRef` 不会被误报成未定义字段；
  它们的引用完整性由媒体检查单独负责。

### 各动作的必需字段（权威，来自上游 schema）

| 动作 | 必需字段 |
| --- | --- |
| `spotlight` / `laser` / `play_video` / `wb_delete` | `id` `type` `elementId` |
| `speech` | `id` `type` `text` |
| `wb_open` / `wb_clear` / `wb_close` | `id` `type` |
| `wb_draw_text` | `id` `type` `content` `x` `y` |
| `wb_draw_shape` | `id` `type` `shape` `x` `y` `width` `height` |
| `wb_draw_chart` | `id` `type` `chartType` `data` `x` `y` `width` `height` |
| `wb_draw_latex` | `id` `type` `latex` `x` `y` |
| `wb_draw_table` | `id` `type` `data` `x` `y` `width` `height` |
| `wb_draw_line` | `id` `type` `startX` `startY` `endX` `endY` |
| `wb_draw_code` | `id` `type` `code` `language` `x` `y` |
| `wb_edit_code` | `id` `type` `elementId` `operation` |
| `discussion` | `id` `type` `topic` |
| `widget_highlight` / `widget_annotation` / `widget_reveal` | `id` `type` `target` |
| `widget_setState` | `id` `type` `state` |

`widget_*` 动作作用于 **interactive 场景**，`target` 是**该场景 HTML 里的 CSS 选择器**
（官方 CPR 课件里是 `#stat-depth`、`#main-btn` 这类），`content` 是讲解词；
`widget_setState` 的 `state` 是一个变量对象（如 `{"depth": 6, "frequency": 100}`），
会直接改写模拟器的变量。所以写 interactive 页时，要在 HTML 里给需要讲解的元素
**显式起 id / class**，动作才能指得到。

### 形状元素的归一化坐标技巧

`viewBox` + `path` 描述的是相对坐标。官方导出的课件里，简单矩形常用 **`[1, 1]` 的
viewBox** 搭配 `M 0 0 L 1 0 L 1 1 L 0 1 Z`——形状的实际尺寸完全由
`left/top/width/height` 决定。这比按真实像素写 viewBox 更简洁，也更好复用。
需要圆角、斜角等复杂轮廓时才写真实比例的 viewBox。

`wb_draw_line` 的定位字段是 `startX`/`startY`/`endX`/`endY`，
`widget_*` 系列的定位字段是 `target`。

## 校验边界（重要）

- **幻灯片**：使用闭合的元素 schema——拒绝未知字段、错误类型、缺失必需字段、
  以及修改 `id` 或改变元素 `type`。
- **"通过校验"只意味着结构契约接受这个 shape，不代表每个值在教学法上合理，
  也不代表每个渲染器都会消费它。** 字段手册会把「硬边界」和「已知语义边界」分开写。
- 我们的 MCP `draft_validate` 做的是结构校验；**它抓不到教学法问题**。

## 与 `.maic.zip` 的映射

`.maic.zip` 的 `manifest.scenes[]` 是**文档 scene 的子集**：

| 文档 scene | manifest scene | 说明 |
| --- | --- | --- |
| `id` | 无 | 导入时用 `nanoid()` 重新分配 |
| `stageId` | 无 | 导入时用新 stage id 填充 |
| `title` | `title` | 直接对应 |
| `order` | `order` | 缺失时回退为数组下标 |
| `type` | `type` | 直接对应 |
| `content` | `content` | 直接对应（slide 会额外重写媒体引用） |
| `actions` | `actions` | `speech.audioId` 换成 `audioRef`（ZIP 路径） |
| `whiteboards` | `whiteboards` | 直接对应 |
| `multiAgent` | `multiAgent` | `agentIds` 换成 `agentIndices`（`agents[]` 的下标） |
| `createdAt` / `updatedAt` | 无 | 导入时统一写入 |

**所以手写 zip 时不需要写 scene 的 `id` 和 `stageId`**，但要写 `stage.name`、
`stage.createdAt`（可省，缺失回退为导入时刻）以及每个 scene 的 `title`、`order`、
`type`、`content`。

## JSON Pointer 路径 ↔ 文件路径

上游的字段手册用 `patch_stage` 的 JSON Pointer 写路径，例如
`/content/canvas/elements/0/content`。因为我们是**直接写文件**，把这个前缀去掉即可：

| 手册里的路径 | 在我们的 manifest 里 |
| --- | --- |
| `/content/canvas/elements/0/content` | `scenes[i].content.canvas.elements[0].content` |
| `/content/questions/1/options/0/label` | `scenes[i].content.questions[1].options[0].label` |
| `/content/widgetConfig/description` | `scenes[i].content.widgetConfig.description` |
| `/content/projectV2/milestones/0/title` | `scenes[i].content.projectV2.milestones[0].title` |
| `/actions/2/text` | `scenes[i].actions[2].text` |

数组下标在源 JSON 里是 **0 起始**；scene 的 `order` 是 **1 起始**。两者不要混用。
