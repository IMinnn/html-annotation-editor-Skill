# HTML Annotation Editor Skill

为 HTML 原型生成可追溯的产品注记，并嵌入可离线使用的注记编辑器。

该 Skill 会先分析页面结构、菜单、交互事件和用户提供的需求材料，生成 Markdown 注记清单，再输出一个保留原业务逻辑的已标注 HTML 副本。打开副本即可查看、添加、编辑、删除和导出注记，无需浏览器扩展、CDN 或后端服务。

## 核心能力

- 自动检查页面、页签、弹窗、筛选、排序、分页、表单和状态变化
- 从产品经理视角生成字段说明、交互逻辑、业务规则和修改原型四类注记
- 按真实菜单层级组织注记，支持跨页面定位和动态页面适配
- 在页面中手动选择 DOM 区域，新增、改号、编辑或删除注记
- 将已确认修改自动保存在浏览器 `localStorage`
- 导出简洁或详细版 Markdown / Excel 注记清单
- 始终保留输入 HTML，生成新的 `*-已标注.html`
- 标注运行时完全内联，不发起网络请求

## 安装

使用 Agent Skills CLI：

```bash
npx skills add IMinnn/html-annotation-editor-Skill -g -a codex -y
```

或手动安装到 Codex：

```bash
git clone https://github.com/IMinnn/html-annotation-editor-Skill.git ~/.codex/skills/html-annotation-editor
```

安装后重启 Codex，使其重新发现 Skill。

## 使用

在对话中说明目标 HTML 和注记范围：

```text
使用 $html-annotation-editor 为 ./prototype.html 增加产品经理视角的完整注记。
```

也可以指定需求材料或继续处理已标注文件：

```text
使用 $html-annotation-editor，结合 ./requirements.md 为 ./prototype.html 增加注记。
```

```text
使用 $html-annotation-editor 继续编辑 ./prototype-已标注.html 中的注记。
```

Skill 默认生成：

```text
prototype-注记清单.md
prototype-已标注.html
```

打开已标注 HTML 后，页面右侧工具栏提供添加、目录、显示/隐藏和设置入口。注记的增删改会保存在当前浏览器；需要跨浏览器、跨设备或文件交付时，请导出 Markdown 或 Excel 清单。

## 工作方式

1. 确认目标 HTML 和注记范围，避免误改同名文件。
2. 读取真实页面结构和交互代码，不把静态展示误写成已实现功能。
3. 先生成五列 Markdown 注记清单。
4. 为每条注记解析稳定页面、上下文和 CSS 定位。
5. 将离线编辑器注入新的 HTML 副本。
6. 校验清单、注记数据、脚本和源文件完整性。

自动清单包含：编号、菜单路径、目标区域、注记类型、注记内容。页面 ID、上下文、选择器和来源等技术信息保留在 HTML 内部数据中，并可通过“详细”清单导出。

## 项目结构

```text
.
|-- SKILL.md
|-- README.md
|-- assets/
|   `-- editor.js
|-- references/
|   `-- data-and-integration.md
`-- scripts/
    |-- inject.py
    `-- self-check.cjs
```

- `SKILL.md`：Skill 入口、决策规则和完整工作流
- `assets/editor.js`：注入 HTML 的离线编辑器运行时
- `references/data-and-integration.md`：数据结构、动态页面和迁移说明
- `scripts/inject.py`：使用 Python 标准库生成已标注 HTML
- `scripts/self-check.cjs`：运行时、注入和导出回归检查

## 要求与验证

- 使用 Skill：支持 Agent Skills 的编码代理
- 生成 HTML：Python 3
- 运行自检：Node.js
- 查看和编辑注记：现代桌面浏览器

```bash
node scripts/self-check.cjs
```

自检覆盖注记增删改、编号、菜单、导航适配、清单导出、源码保留和重复注入。浏览器布局、指针选区和原型业务交互仍应在真实目标页面中验证。

## 边界

- 通用选区不能进入 iframe、closed Shadow DOM 或 Canvas 内部。
- 严格 CSP、特殊模板语法和非 UTF-8 页面需要单独适配。
- 输入页面引用的外部 CSS、脚本或图片不会自动内联。
- 浏览器本地存储不会自动写回磁盘文件；跨环境交付请导出清单。
- 页面未体现或资料未定义的规则会明确标注，不按常见产品习惯补写。

## 设计原则

- 源文件只读，所有结果写入新文件
- 注记正文按纯文本处理，不执行其中的 HTML 或脚本
- 优先使用稳定 ID、`data-*` 属性和真实业务键定位
- 定位失效时提示未匹配，不静默绑定到相似元素
- 不覆盖现有成果，不安装运行时依赖，不上传业务原型

详细约束和数据格式见 [SKILL.md](./SKILL.md) 与 [数据和接入说明](./references/data-and-integration.md)。
