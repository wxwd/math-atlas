# MathAtlas

MathAtlas 是一个面向高中数学题库管理与讲义制作的本地 Web 工具。项目以 Obsidian Vault 中的 Markdown 文件作为数据源，通过浏览器完成题目检索、预览、批量维护和讲义导出；原始题目仍然保存在普通的 Markdown/YAML 文件中，便于长期整理、版本管理和在 Obsidian 中继续编辑。

项目基于 Next.js 16、React 19 和 TypeScript 开发，公式使用 KaTeX 渲染，并内置一套 Markdown 到 LaTeX 的讲义转换与排版样式。

> MathAtlas 会直接读取、创建、修改和删除本机 Vault 中的文件。目前接口没有用户认证，适合个人电脑或可信局域网环境，不要直接暴露到公网。首次使用自己的题库前，建议先备份 Vault。

## 主要功能

- **题库浏览**：表格和卡片两种视图，按年级、来源类型、年份、来源名称、知识模块、题号、难度、技能、标签或 qid 组合筛选。
- **题目预览**：按需加载题干、选项、答案、解析和备注，支持 KaTeX 数学公式、Markdown 内容及题目图片。
- **选题与排序**：勾选指定题目生成讲义；未勾选时，对当前筛选结果整体操作。支持按来源、题号、难度、创建/修改时间等字段排序。
- **批量入库**：粘贴一道或多道带 YAML frontmatter 的题目，实时预览后写入 Vault；支持统一覆盖来源、年份、模块、题型、年级等属性，并在同名文件冲突时选择跳过或覆盖。
- **图片管理**：上传或粘贴图片后按 SHA-256 内容哈希保存，Markdown 中自动插入图片引用。
- **批量维护**：批量修改题目元数据，删除前预览影响范围；删除题目时只清理不再被其他题目引用的图片。
- **讲义导出**：复制 Markdown/LaTeX，或下载包含正文、样式和图片的 ZIP；也可将 LaTeX 讲义直接写入项目的 `LATEX/` 目录。
- **Obsidian 联动**：从题目列表直接通过 `obsidian://` 链接打开对应笔记。
- **界面主题**：支持浅色、深色模式切换。

仓库自带 `demo-vault/` 示例题库，无需额外配置即可体验主要功能。

## 环境要求

- Node.js **20.9 或更高版本**（建议使用当前 LTS 版本）
- npm（随 Node.js 一同安装）
- 现代浏览器，如 Chrome、Edge 或 Firefox
- Obsidian（可选，仅在需要跳转到原始题目时使用）
- LaTeX 发行版（可选，仅在需要把导出的 `.tex` 编译为 PDF 时使用；建议使用 TeX Live + XeLaTeX）

可先在终端检查环境：

```bash
node --version
npm --version
```

## 快速开始

### Windows 一键启动

1. 下载或克隆本项目，并解压到本地目录。
2. 双击项目根目录中的 `start.bat`。
3. 脚本会检查 Node.js、执行 `npm install`，随后启动开发服务器。
4. 服务就绪后浏览器会自动打开 <http://localhost:3000>。

启动窗口需要保持打开。停止服务时，在窗口中按 `Ctrl+C`，或直接关闭窗口。

> `start.bat` 每次启动都会执行一次 `npm install`。若安装依赖失败，请检查 Node.js 版本、网络连接和终端中的 npm 错误信息。

### 使用命令行启动

Windows、macOS 和 Linux 均可使用以下方式：

```bash
npm install
npm run dev
```

然后访问 <http://localhost:3000>。

如果 npm 官方源访问较慢，可为本次安装临时指定镜像：

```bash
npm install --registry=https://registry.npmmirror.com
```

### 生产模式运行

```bash
npm run build
npm run start
```

生产模式默认同样监听 <http://localhost:3000>。这不会改变“仅限本机或可信网络使用”的安全边界。

## 配置自己的 Obsidian Vault

不配置环境变量时，MathAtlas 默认读取项目中的 `demo-vault/`。若要使用自己的题库，请在项目根目录手动新建 `.env.local`：

```dotenv
VAULT_PATH=D:\Obsidian\高中数学
NEXT_PUBLIC_VAULT_PATH=D:\Obsidian\高中数学
```

- `VAULT_PATH`：服务端实际读写的 Vault 根目录，可以使用绝对路径；相对路径以项目根目录为基准。
- `NEXT_PUBLIC_VAULT_PATH`：用于生成 Obsidian 跳转链接。它会暴露给浏览器，通常与 `VAULT_PATH` 填写相同路径。
- 修改 `.env.local` 后需要重启开发服务器。
- 路径不需要额外加引号。Windows 路径可直接使用反斜杠。

Vault 至少应包含下面两个目录：

```text
高中数学/                  # Vault 根目录，环境变量填写这一层
├─ 题库/                   # 必需；MathAtlas 只扫描其中的题目 Markdown
│  ├─ 2025-全国卷一/
│  │  ├─ 2025-全国卷一-T1.md
│  │  └─ 2025-全国卷一-T2.md
│  └─ 2025-校联考/
└─ images/                 # 建议创建；存放题目图片
```

`题库` 下的直接子目录用于组织不同来源，题目文件使用 `.md` 扩展名；以 `.bak` 结尾的文件不会被扫描。Web 端入库时会按“来源年份 + 来源名称”自动创建目录和文件名。

若要使用 Obsidian 跳转：

1. 在 Obsidian 中将上述根目录作为 Vault 打开。
2. 保持 `.env.local` 中的 `NEXT_PUBLIC_VAULT_PATH` 指向该 Vault。
3. 浏览题目时点击 Obsidian 图标；浏览器首次调用 `obsidian://` 时需要允许打开外部应用。

## 题目文件格式

每道题是一个带 YAML frontmatter 的 Markdown 文件。推荐格式如下：

```markdown
---
qid: 202607131200001
grade: 高三
source_type: 高考真题
source_year: 2025
source_name: 全国卷一
source_qno: T1
module:
  - 集合与常用逻辑用语
type: 单选题
difficulty: 0.82
skill:
  - 集合运算
tags:
  - 基础题
---

## 题目

已知集合 $A=\{1,2\}$，则下列结论正确的是（　）

## 选项

A. $1\in A$

B. $3\in A$

## 备注

### 我的备注

用于课前检测。

### AI备注


## 答案

A

## 解析

由集合元素可直接判断。
```

### YAML 字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `qid` | number | 题目唯一标识。通过网页入库时自动生成；手工创建时必须保证唯一。 |
| `grade` | string | 年级，如 `高一`、`高二`、`高三`、`竞赛`。 |
| `source_type` | string | 来源类型，如 `高考真题`、`模拟题`、`教材`。 |
| `source_year` | number | 来源年份；网页入库时为必填项。 |
| `source_name` | string | 试卷或资料名称；网页入库时为必填项，并参与目录/文件名生成。 |
| `source_qno` | string | 原题号，建议统一使用 `T1`、`T2` 等格式；参与文件名生成。 |
| `module` | string[] | 知识模块，可填写多个。 |
| `type` | string | 题型，如 `单选题`、`多选题`、`填空题`、`解答题`；网页入库时必须提供。 |
| `difficulty` | number/null | 0～1 的难度得分率，值越小代表题目越难。未知时使用 `null`。 |
| `skill` | string[] | 解题技能或方法。 |
| `tags` | string[] | 自定义标签。 |

正文使用二级标题划分内容。常用标题为 `## 题目`、`## 选项`、`## 备注`、`## 答案`、`## 解析`；备注下可使用 `### 我的备注` 和 `### AI备注`。数学公式采用 `$...$` 或 `$$...$$`，图片支持以下两种相对路径写法：

```markdown
![示意图](images/图片文件名.png)
![[images/图片文件名.png|360]]
```

可参考 [Obsidian 题目录入模板](docs/Obsidian题目录入模板.md) 和 [AI 排版提示词](docs/AI排版提示词.md)。

## 使用方法

### 1. 浏览和筛选题目

打开首页后，使用顶部筛选器组合筛选题库。表格模式每页显示 25 道题，适合快速检索和批量选择；浏览模式每页显示 10 道题，适合连续阅读题干并展开答案、解析。

点击表格行可加载题目详情。筛选器之间会联动，只显示在当前其他条件下仍然可用的选项；“清空筛选”可恢复全部题目。

### 2. 选择、批量修改和删除

勾选题目前的复选框后，可以：

- 批量覆盖年级、来源、年份、知识模块、题型、难度、技能或标签；
- 生成仅包含已选题目的讲义；
- 批量删除题目。

删除操作会先显示预览，包括将删除的题目、可清理图片以及仍被其他题目共享的图片。确认后才会写入磁盘。批量修改和删除均不可在网页中撤销，操作前请保留 Vault 备份或使用 Git 管理题库。

### 3. 从网页批量入库

#### 使用 AI 完成题目结构化（推荐）

如果手头是 OCR 文本、试卷识别结果或格式不统一的 Markdown，可以先使用项目提供的 [AI 题目排版提示词](docs/AI排版提示词.md)，让 ChatGPT、Claude、Gemini 等支持长文本和 Markdown 输出的 AI 将原始内容整理成 MathAtlas 可识别的结构，再粘贴到入库页面。

具体流程如下：

1. 打开 `docs/AI排版提示词.md`，复制其中的**全部内容**，不要只复制目标模板。
2. 修改提示词开头的“统一填写”一行，填入本批题目的公共信息，例如：

   ```text
   【统一填写】grade: 高中  source_type: 高考真题  source_year: 2025  source_name: 全国卷一
   ```

3. 将 OCR 或原始题目文本粘贴到提示词最后的“`## OCR输出如下：`”之后。如果原文带有图片引用，应一并保留图片 Markdown 或 HTML 标签。
4. 把完整提示词发送给 AI。AI 会按照项目模板统一公式、选项、题号和章节结构，判断 `source_qno`、`module`、`type`，并用 `==========` 分隔多道题。
5. AI 返回后，只复制统一 `markdown` 代码块内部的内容，不要复制代码块外框或额外说明。
6. 将结果粘贴到 MathAtlas“添加题目”页面，逐题检查右侧预览，确认题目数量、题号、题型、公式、选项、图片、答案和解析没有遗漏，再执行入库。

这份提示词刻意限制 AI **不解题、不补写答案或解析、不改动原文内容**，只负责结构化排版，并且只推断 `source_qno`、`module`、`type` 三个属性。`grade`、`source_type`、`source_year`、`source_name` 只会复制“统一填写”行中的内容；`qid` 留空，由 MathAtlas 入库时自动生成；`difficulty` 等其余属性可在入库后通过批量设置补充。

> AI 输出仍可能存在 OCR 错字、公式转写错误、漏题或图片路径变化。它只能辅助整理，不能替代人工校对。尤其应核对题干与答案是否对应、选择题是否带 `[选]`、填空题是否带 `[填]`，以及图片引用是否仍指向 Vault 的 `images/` 目录。

#### 使用模板手动录入题目

题目数量较少，或者需要完全按原题逐字校对时，可以使用 [Obsidian 题目录入模板](docs/Obsidian题目录入模板.md) 手动填写。模板已经包含 MathAtlas 所需的 YAML 字段以及题目、选项、备注、答案、解析等章节。

手动录入步骤如下：

1. 打开 `docs/Obsidian题目录入模板.md`，复制全部内容，作为一道新题的起始模板。
2. 填写 YAML 元数据，至少确认 `grade`、`source_type`、`source_year`、`source_name`、`source_qno`、`module` 和 `type`：

   ```yaml
   grade: 高三
   source_type: 高考真题
   source_year: 2025
   source_name: 全国卷一
   source_qno: T1
   module: [复数]
   type: 单选题
   difficulty: 0.85
   ```

   `module`、`skill`、`ai_tags`、`tags` 必须使用 YAML 数组格式；`difficulty` 使用 0～1 的数字，未知时可以留空。通过网页入库时 `qid` 会自动生成，无需手动填写。
3. 在 `## 题目` 下填写题干，数学公式使用 `$...$` 或 `$$...$$`。选择题的作答位置使用 `[选]`，填空题使用 `[填]`。
4. 单选题或多选题保留 `## 选项`，每个选项单独一行；填空题和解答题可以删除整个选项章节。
5. 将原题答案和解析分别填写到 `## 答案`、`## 解析`；没有内容时保留“（无）”，不要自行补写。
6. 在 MathAtlas“添加题目”页面粘贴填写完成的内容，检查右侧预览后入库。连续录入多道题时，每道题都从完整模板开始，并在题目之间加入单独一行 `==========`。

也可以在 Obsidian 中启用核心插件“模板”，将该文件复制到 Vault 的模板目录，并把模板目录位置配置到插件中。此后使用“插入模板”命令创建题目，`{{date:YYYYMMDDHHmmss}}` 会生成数字时间戳作为 `qid`。如果不经过网页、直接在 Obsidian 中保存题目，需要注意：

- 每道题的 `qid` 必须是唯一数字；
- 文件应保存在当前 Vault 的 `题库/来源目录/` 下，不能只放在模板目录；
- 图片应放在 Vault 的 `images/` 目录并使用相对路径引用；
- 保存后刷新 MathAtlas 页面，即可看到新题目。

无论使用 AI 结构化还是手动填写模板，都可以在网页中按以下步骤入库：

1. 点击首页标题旁的“添加题目”。
2. 在左侧粘贴题目 Markdown；多道题之间使用单独一行 `==========` 分隔。
3. 根据需要填写顶部“批量覆盖”栏。已填写的值会覆盖每道题 YAML 中的对应字段，留空则保留题目原值。
4. 在右侧检查解析结果和公式预览。
5. 点击入库。若目标文件已存在，选择“跳过已存在的”或“覆盖全部”。

输入区支持选择图片文件，也支持直接粘贴剪贴板图片。上传后图片保存在 Vault 的 `images/` 中，并在光标位置插入 Markdown 引用。

### 4. 生成 Markdown 讲义

先筛选并勾选需要的题目，然后选择：

- **复制为 Markdown**：将完整讲义复制到剪贴板；
- **打包下载 Markdown (.zip)**：下载 `讲义.md` 及其引用的图片。

如果没有勾选任何题目，导出范围是当前全部筛选结果，而不是当前页。

### 5. 生成 LaTeX 讲义

- **复制为 LaTeX**：复制生成的完整 `.tex` 内容；
- **打包下载 LaTeX (.zip)**：下载 `讲义.tex`、`mathatlas.sty` 和引用图片；
- **LaTeX 导出到本地**：在项目 `LATEX/导出_时间戳/` 下生成同样的文件。

MathAtlas 只负责生成 LaTeX 源文件，不会在网页中编译 PDF。导出后可在对应目录运行：

```bash
xelatex 讲义.tex
```

样式依赖 `ctex`、`exam-zh-choices`、`fontawesome5`、`circledsteps` 等宏包；若提示缺少宏包，请使用较完整的 TeX Live 安装或通过发行版包管理器补装。

## 可用脚本

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Next.js 开发服务器。 |
| `npm run build` | 创建生产构建。 |
| `npm run start` | 运行已完成的生产构建。 |
| `npm run lint` | 运行 ESLint 检查。 |

## 项目结构

```text
math-atlas/
├─ src/app/                 # Next.js 页面与服务端 API
│  ├─ add/                  # 批量添加题目页面
│  └─ api/                  # 题目、图片、批量维护和导出接口
├─ src/components/          # 筛选表格、浏览视图、公式和主题组件
├─ src/lib/                 # 题库扫描、模块解析、LaTeX 转换
├─ public/mathatlas.sty     # LaTeX 讲义样式
├─ demo-vault/              # 开箱即用的示例 Vault
├─ docs/                    # 录入模板与 AI 排版说明
├─ LATEX/                   # “导出到本地”的输出目录
├─ start.bat                # Windows 一键启动脚本
└─ package.json             # 依赖和 npm 脚本
```

## 数据与缓存说明

- 题库是文件系统中的 Markdown，不使用数据库。
- 首页每次请求都会检查题目文件的大小和修改时间；内容发生变化后会自动刷新元数据缓存。
- 通过 Web 接口新增、修改或删除题目时，会在 Vault 根目录更新 `.mathatlas-cache-version` 以通知其他服务进程失效缓存。
- 直接在 Obsidian 中保存、创建、重命名或删除题目后，刷新 MathAtlas 页面即可看到变化。
- `LATEX/` 中的本地导出结果不会自动清理，可按需手动归档或删除。

## 常见问题

### 首页启动时报找不到 `题库` 目录

确认 `VAULT_PATH` 指向 Vault 根目录，而不是直接指向 `题库`；并确认根目录下存在名称完全一致的 `题库` 文件夹。

### 修改 `.env.local` 后仍显示示例题库

停止并重新启动开发服务器。Next.js 只会在启动时加载环境变量。

### Obsidian 链接没有反应

确认 Obsidian 已安装、对应目录已作为 Vault 打开，并允许浏览器调用 `obsidian://` 外部协议。Vault 文件夹名称应与 `NEXT_PUBLIC_VAULT_PATH` 的最后一级目录一致。

### 图片无法显示

确认图片位于当前 Vault 的 `images/` 目录，并使用 `images/文件名` 相对引用。不要引用 Vault 外部的绝对图片路径。

### LaTeX 无法编译

优先使用 XeLaTeX，并确认 `.tex`、`mathatlas.sty` 和 `images/` 位于同一导出目录结构中。若日志显示宏包缺失，请补装对应 TeX Live 包。

## 技术栈

- Next.js 16（App Router）
- React 19 + TypeScript
- KaTeX / marked
- gray-matter（YAML frontmatter）
- JSZip（浏览器端讲义打包）

## 许可证

本项目采用 [MIT License](LICENSE)。
