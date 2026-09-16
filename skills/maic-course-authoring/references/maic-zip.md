# `.maic.zip` 格式规范

OpenMAIC 的课件交换格式。**纯浏览器即可导入，不需要数据库、不需要后端服务。**

## 这份文档的定位

上游没有为这个格式发布过任何人类可读的规范：README 只用一句话描述它
（"Full classroom export for backup or sharing"），形式定义只存在于 TypeScript 接口
（`lib/export/classroom-zip-types.ts`），没有 JSON Schema、没有独立校验器、
没有发布过的 fixture。`@openmaic/exporter` 在上游仍是保留项（未实现）。

因此本文档是**依据源码反推的第一份规范**，覆盖 `formatVersion = 1` 的实际行为。
上游对第三方生成的包**没有做出兼容承诺**——`formatVersion` 字段存在，
但没有迁移阶梯；上游升级格式时，本文档需要随之更新。
这也是为什么包里会写 `_generator.dslVersion` 版本戳：出问题时能定位到是哪个契约版本。

契约来源：`lib/export/classroom-zip-types.ts`、`lib/export/classroom-zip-utils.ts`、
`lib/import/use-import-classroom.ts`。
`CLASSROOM_ZIP_FORMAT_VERSION = 1`，扩展名 `.maic.zip`。

## ZIP 内部布局

```text
manifest.json                  ← 必需，位于 ZIP 根
audio/audio-1.mp3              ← 可选，讲解音频（按 mediaIndex 索引）
audio/legacy-1.mp3             ← 可选，历史遗留音频
media/asset-1.jpg              ← 可选，图片或视频
media/asset-1.poster.png       ← 可选，视频封面（与视频同序号）
```

路径扩展名必须是允许列表内的（未知后缀会回退为默认值）：

- 音频：`aac flac m4a mp3 mp4 mpeg ogg opus wav webm`
- 媒体：`avif gif jpeg jpg m4v mov mp4 ogv png svg webm webp`

## manifest.json

```jsonc
{
  "formatVersion": 1,            // 导出侧写入；导入侧【完全不读】
  "exportedAt": "2026-09-15T00:00:00.000Z",
  "appVersion": "0.3.2",

  "stage": {                     // 必需
    "name": "课程名称",           // 缺失时回退为 "Imported Classroom"
    "description": "可选",
    "language": "可选，映射到 stage.languageDirective",
    "style": "可选",
    "videoManifest": {},         // 可选
    "createdAt": 0,              // 可省，缺失回退为导入时刻
    "updatedAt": 0               // 可省
  },

  "agents": [                    // 可省略，缺省为 []
    {
      "name": "AI 老师",
      "role": "teacher",         // teacher | student | ...
      "persona": "人设描述",
      "avatar": "头像 id 或 URL",
      "color": "#4F8EF7",
      "priority": 1,
      "voiceConfig": { "providerId": "openai", "voiceId": "alloy" },   // 可选
      "voiceDesign": { "identity": "...", "texture": "...", "delivery": "..." } // 可选
    }
  ],

  "scenes": [                    // 必需，必须是数组
    {
      "type": "slide",           // slide | quiz | interactive | pbl
      "title": "第一页",
      "order": 1,                // 1 起始；缺失回退为数组下标
      "content": { "type": "slide", "canvas": { /* 见 structure.md */ } },
      "actions": [               // 可选
        {
          "id": "a1",            // 必需：每个动作都要有非空 id
          "type": "speech",
          "text": "讲解词",
          "audioRef": "audio/audio-1.mp3"   // 必须是 ZIP 内路径
        }
      ],
      "whiteboards": [],         // 可选
      "multiAgent": {            // 可选
        "enabled": true,
        "agentIndices": [0],     // agents[] 的下标（不是 id）
        "directorPrompt": "可选"
      }
    }
  ],

  "mediaIndex": {                // 可选但媒体必需，键 = ZIP 内路径
    "media/asset-1.jpg": {
      "type": "image",           // audio | image | generated
      "sourceRef": "media/asset-1.jpg",
      "mimeType": "image/jpeg",
      "size": 12345,
      "prompt": "可选，生成该图的提示词"
    },
    "audio/audio-1.mp3": {
      "type": "audio",
      "sourceRef": "audio/audio-1.mp3",
      "format": "mp3",
      "mimeType": "audio/mpeg",
      "duration": 3.2,
      "voice": "alloy"
    }
  }
}
```

## 导入侧的真实校验（全部）

导入只检查三件事（`lib/import/use-import-classroom.ts`）：

1. ZIP 里存在 `manifest.json`
2. 该文件能 `JSON.parse`
3. `manifest.stage` 存在，且 `manifest.scenes` 是数组

**此外没有任何 schema 校验。** `formatVersion` 从不读取，未知字段不报错，
非法元素不会被告知。超过 200MB 只打一条 warning，不阻断。

导入时还会做这些事，所以你不必写：

- stage id、每个 scene 的 id/stageId **全部用 `nanoid()` 重新分配**
- `createdAt` / `updatedAt` 统一写入当前时刻
- scene 的 `order` 缺失时回退为数组下标
- 音频/视频/图片字节写进 **IndexedDB**（`db.audioFiles` / `db.mediaFiles`）

## 媒体引用规则（最容易写错的部分）

`mediaIndex` 的**键是 ZIP 内路径**，`sourceRef` 是**幻灯片元素里写的那个字符串**。
导入时按 `sourceRef → 新分配的资产 id` 建映射，再回写元素的 `src`。

因此最省事、且必然自洽的约定是**让 ZIP 路径本身充当 sourceRef**：

| 位置 | 写法 |
| --- | --- |
| `mediaIndex` 键 | `media/asset-1.jpg` |
| `mediaIndex[...].sourceRef` | `media/asset-1.jpg`（同一个字符串） |
| 图片元素 `src` | `media/asset-1.jpg` |
| 视频元素 `src` / `mediaRef` | `media/asset-1.jpg` |
| 视频元素 `poster` | 同一 sourceRef 体系下的另一个条目 |
| `mediaIndex[...].type` | 图片/视频用 `image` 或 `generated`（两者都被接受）；音频必须用 `audio` |
| `mediaIndex[...].mimeType` | 决定图/视频：`video/*` 是视频。缺省为 `image/jpeg` |
| speech 动作 `audioRef` | **必须是 ZIP 路径**（如 `audio/audio-1.mp3`） |
| 幻灯片 audio 元素 `src` | 用该音频条目的 `sourceRef` |

补充规则：

- `meta.missing: true` 的条目会被跳过（导出时抓不到字节的资源会这样标记）。
  **官方示范课件 CPR 的 52 条音频全部是 `missing: true` 且包内没有字节**——
  这是格式允许的状态，导入后这些旁白不会发声。自产课件不要走到这一步：
  要么给字节，要么删掉 `audioRef`，不要交付一门"没有声音却以为有"的课。
- `sourceRef` 缺失时会从 ZIP 路径推导（去掉 `audio/` 前缀、去掉扩展名）。
- 视频封面：按 `media/asset-N.poster.<ext>` 的兄弟路径查找。
- 同一个 `sourceRef` 出现多次时，字典序靠前的 ZIP 路径获胜。

### `sourceRef` 的两种形态（官方示范课件用的是第二种）

| 形态 | `sourceRef` 的值 | 元素 `src` 的值 | 出现于 |
| --- | --- | --- | --- |
| 自洽简并 | ZIP 内路径（`media/asset-1.png`） | 同一字符串 | 本仓库示例 |
| 资产库 ID | `ast_09r55bkxjd6tc0y38m0bv4j030` | 同一资产 ID | 官方导出的课件 |

两者导入后都能解析（导入按 `sourceRef → 新资产 id` 建映射，再回写 `src`）。
自产课件用第一种最省事；从 OpenMAIC 导出的课件是第二种。
**校验时以"元素 `src` 是否落在 `sourceRef` 集合里"为准**，两种形态都合法。

### `generated` 媒体类型与 `prompt`

`mediaIndex` 条目 `type` 可以是 `generated`（AI 生成图/视频），此时条目里带一个
**`prompt` 字段**记录生成时的提示词。这是有价值的溯源信息：配图与正文不符时，
能看出当初想生成什么。自产课件若引用外部生成服务，建议同样把提示词记进去。

### 智能体的头像：应用相对路径，导入时不校验

`agents[].avatar` 写**应用内置资源的应用相对路径**（如 `/avatars/teacher.png`）。
导入时**原样透传、不拷贝字节**（`agentConfigFromManifest` 逐字段照搬），
渲染时才由应用按路径解析——**路径写错不会有任何报错，只会静默显示为空头像**。

应用内置头像在 OpenMAIC 仓库 `public/avatars/` 下（32 个，`teacher.png`、
`note-taker.png`、`instructor.png`、`scholar.svg`、`curious.png`、`reader.svg` 等），
**包内不带头像字节，也不应该带**。`dsl_schema_get` 会返回已知清单（快照）；
`draft_validate` 对不在清单里的路径发警告。也可以用 `http(s)` / `data` 地址。

其他约定（来自官方 CPR 课件）：

- `role` 用 `teacher` / `assistant` / `student`；导入侧给 `discussion` 找兜底发言人时
  **优先取 role 为 student 的，其次取第一个非 teacher 的**——所以配一个 student 角色是惯例。
- `priority` 官方用 10 / 7 / 5 / 4（teacher 最高）。
- `persona` 是完整段落（性格 + 讲课习惯 + 学员常见误区），不是一句话。
- `voiceDesign` 的 texture / delivery / identity 官方用**英文**描述。

### 智能体的 TTS 音色字段

`agents[]` 条目可选 `voiceConfig` 与 `voiceDesign`（官方 CPR 课件在用）：

```json
{
  "name": "李教授",
  "role": "teacher",
  "persona": "…",
  "voiceConfig": { "voiceId": "dylan", "providerId": "qwen3-tts" },
  "voiceDesign": {
    "texture": "deep warm authoritative",
    "delivery": "calm measured reassuring",
    "identity": "middle-aged male teacher"
  }
}
```

`agents` 整个数组可以省略（官方 Python 课件就没有 `agents`）；
但一旦用了 `discussion` / 多智能体对白，就需要它。

### `stage.language` 是"语言指令"，不是 ISO 代码

官方 CPR 课件里这个字段是一整段指令：

> 全程使用中文授课，涉及专业术语（如心肺复苏、AED）时需用中文表述并提供英文对照
> （CPR、AED）。面向普通公众，语言应通俗易懂，重要操作要点需反复强调。

它会被拼进生成提示词（映射到 `stage.languageDirective`）。所以这里写的应当是
**对语气、术语对照、受众的具体要求**，而不是 `"zh-CN"` 这种代码。

## 播放语义：导入之后，应用怎么消费这些字段

导入只是把数据搬进 IndexedDB。真正的契约是**播放路径怎么读它们**——以下结论来自
逐行核对播放引擎（`lib/playback/engine.ts`、`lib/action/engine.ts`）与渲染组件，
每条都标注了出处。这一节是"字段合法但行为不符"问题的最终依据。

### speech：没有 audioRef 不等于出错，等于"静默阅读"

播放引擎不做服务端 TTS。`speech` 动作先尝试 `audioId`（导入改写后的音频），
失败则回落到两条路：

1. 用户显式开启了 `browser-native-tts`（Web Speech API）→ 浏览器现场朗读；
2. 否则走**阅读计时器**：按文本长度估算时长静默推进，文本仍以字幕显示。

所以：**要保证出声，就必须预生成音频并挂 `audioRef`**。"没挂 audioRef 的课件"
在没开浏览器 TTS 的用户那里是一门哑课。音频字节缺失也不报错
（`audio-player.ts` "skip silently"）。

### spotlight / laser：元素不存在时完全静默

执行只是把 `elementId` 写进 canvas store；渲染组件用
`document.getElementById(prefix + elementId)` 找 DOM 节点，找不到就不渲染高亮层。
**不报错、不跳过整个播放**，效果 5 秒后自动清除。可选字段：`spotlight.dimOpacity`
（默认 0.5）、`laser.color`（默认 `#ff0000`）。

### discussion：agentIndex 越界会被静默兜底

导入时 `agentIndex → agentId`：越界或缺失就回落到**兜底发言人（优先 student 角色，
其次第一个非 teacher）**；播放时还会按用户在设置里勾选的智能体过滤，被勾掉的
整条跳过。所以 `agentIndex` 要对着 `agents[]` 下标数清楚。

### widget_*：动作只是 postMessage，监听器是你自己的 HTML 写的

宿主把 `SET_WIDGET_STATE`（带 `state`）、`HIGHLIGHT_ELEMENT` /
`ANNOTATE_ELEMENT` / `REVEAL_ELEMENT`（带 `target`）postMessage 进 iframe。
**接收端不是平台注入的，是 interactive 的 HTML 必须自己写的**——上游生成模板的
原话："Your HTML MUST register this listener, or those actions silently do nothing"。
手写 HTML 时必须在末尾加这个 `window.addEventListener('message', …)`。

其他要点：

- `widgetConfig` **不会**以任何形式传进 iframe——它只在生成期作为提示词材料。
  `state` 的键的语义完全由你自己的监听器代码定义。
- iframe sandbox 是 `allow-scripts allow-forms allow-popups`，**刻意不带
  `allow-same-origin`**（null origin）；平台注入了 localStorage 内存垫片，但
  不要依赖持久存储。
- `widgetConfig.variables[].name` 与 `widget_setState.state` 的键名应一致——
  运行时不校验，但对不上就打不中（`draft_validate` 会提示）。

### 白板：`scene.whiteboards` 播放时不渲染

**播放画板是 stage 级的运行时白板，白板内容只能由 `wb_*` 动作序列现场构建。**
manifest 里的 `whiteboards` 字段只参与媒体引用改写与导出 round-trip，
把画面数据塞在那里不会出现在播放白板上。写白板页的正确方式是
`wb_open → wb_draw_* → wb_close` 的动作序列。

`wb_*` 的坐标是 **1000 × 563 像素坐标系**（x 从 0 到 1000），不是 0–1 归一化坐标
——写成 `x: 0.2` 会把内容画到白板左上角。`wb_draw_text` 对非 `<` 开头的内容自动包
`<p style="font-size:…">`，疑似 LaTeX 会自动改路由成 `wb_draw_latex`；
省略 width/height 时默认 400×100、18px、`#333333`。

### quiz：判分读什么

- `answer` 是 **option.value 的数组**（`["A"]` 或多选 `["A","C"]`）；
  兼容"恰好唯一匹配某个 option.label"的旧写法。对不上的答案判错。
- `points` 缺省按 1 分计；`hasAnswer` **只是元数据，判分完全不读**（判分只看 `type`）；
  `analysis` 仅在回顾阶段展示。
- `short_answer` 走 `/api/quiz-grade` AI 判分，失败兜底给一半分；
  `commentPrompt` 是传给评分器的指引，写清给分点能显著提升判分质量。

### 其他播放期事实

- `canvas.theme` 里播放真正生效的只有 **`fontColor` 和 `fontName`**；
  `backgroundColor` 由 slide 级 `background` 承担，`themeColors` 只影响编辑器新建形状的默认色。
- `scene.multiAgent` 只做导入/导出 round-trip，**播放与讨论都不读它**。
- 没有 `actions` 的场景不会被跳过——会得到一个"合成停留拍"。
- `avatar` 有两条渲染路径：顶栏是 `<img>` 直出（无效路径 = 空圆圈）；
  聊天/揭示卡则是"URL 否则当 **emoji**"——所以 `avatar: "🧑"`（单码位 emoji，
  不含零宽连接符）也是合法写法。
- `video/audio` 的 `src`：`https?/data/blob/` 与相对路径直接当 URL 用；
  资产池 ID 则按任务解析，解析失败显示占位。`play_video` 最多等 5 分钟。
- 播放引擎对每个动作有固定耗时（开板 2s、绘制 0.8s、widget 0.3s、效果 5s 自动清除），
  写动作序列时按此估算一页的实际时长。

## 硬规则

- `manifest.json` 必须在 ZIP 根，不能放在子目录。
- 每个 scene 必须有 `type`、`title`、`content`，且 `content.type` 必须等于 `type`。
- **每个 action 必须有非空 `id`**，以及该动作类型的额外必需字段（`speech` → `text`，
  `spotlight`/`laser` → `elementId`）。导入路径不会补这些字段。
- `order` 从 1 开始且不重复；缺失会退化为数组下标（0 起始），导致页码错位，**务必显式写**。
- scene 里的 `id` 和 `stageId` 不要写（导入时会被重新分配覆盖）。
- **不要写占位符 `src`**。`src` 值如果不是 `http` / `data` / `blob` 形式，渲染器会把它
  当成"待生成媒体"并永远显示骨架屏。要么给真实字节并在 `mediaIndex` 里登记，
  要么整个字段留空。
- ZIP 内路径不要以 `/` 开头，不要包含 `..`。
- **在包内自带版本号。** 因为导入侧不校验版本，将来 DSL 变更会让你的 zip 静默出错。
  建议在 manifest 里保留 `formatVersion`，并额外写一个自定义字段（如
  `"_generator": { "dslVersion": "0.3.0" }`）方便自己排查。

## 快捷验证

```bash
# 结构是否正确（本目录的 MCP）
node mcp/server.mjs --check path/to/course.maic.zip

# 看内部布局
unzip -l course.maic.zip
unzip -p course.maic.zip manifest.json | head -40
```

导入验证：打开 OpenMAIC → 首页「导入课堂」→ 选择 `.maic.zip`。
