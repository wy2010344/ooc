# OOC Playground

移动端优先的 OOC 记事本：像写记事一样记代码，点「运行」看结果——结果还会改变这个 App 本身。

## 特点

- **记事本形态**：笔记列表 + 编辑页，无 IDE 概念；「执行历史 / 重命名 / 删除」都是菜单功能。
- **真实语言**：跑的是本仓库 `packages/language` 的解释器——除法 `12 / 3`、消息无括号调用 `msg |> toUpperCase`、`#import` 跨笔记模块化全支持。
- **行为式结果**：代码里可以直接操作宿主对象改页面（`ui add 'p' '你好'`）或读写笔记（`db notes`），执行即改变，像 Smalltalk 一样持久。
- **诊断提示**：运行前就地做类型检查，错误红显、类型告警黄显，但绝不阻断运行。
- **数据在本地**：所有笔记存在浏览器 IndexedDB，无需后端。
- **中文交互**：界面为中文，面向移动端触控（safe-area、底部 sheet 等）。

## 运行

```bash
# 根目录（npm workspaces）
npm install
npm run dev -w packages/playground    # 本地开发，手机同网可访问
```

生产构建：

```bash
npm run build -w packages/playground  # 产物在 packages/playground/dist
npm run preview -w packages/playground
```

## 怎么玩

内置三条演示笔记（首次打开自动播种）：

| 笔记 | 演示 |
| --- | --- |
| `hello.ooc` | 注释（`//`）、`;` 分隔、消息链 `|>` |
| `算术.ooc` | 无优先级左结合、除法 `12 / 3`、取余 `7 % 3` |
| `playground.ooc` | 宿主对象：`ui add 'p' '文字'` 在页面加元素、`db notes` 列出笔记 |

## 宿主桥接对象

执行环境里预置以下对象，可直接当消息发：

- `storage`：`ref get 'x'` / `ref set 'x' 值` —— 会话内持久变量。
- `loop`：`apply 次数 代码` / `repeat 次数 ('消息')` —— 循环执行。
- `js`：`throw 'msg'`、`new 'Date'`、`fn 'fnName' arguments` —— 借用 JS 宿主能力。
- `db`：`notes` / `read '笔记名'` —— 读写本地笔记本（数据持久）。
- `ui`：`add '标签' '内容'` —— 往页面追加 HTML 元素。

> `ui` / `db` 依赖浏览器（DOM / IndexedDB），只会在被调用时生效。

## 技术说明

- 复用本仓库 `packages/language`（包名 `object-oriented-c-language`）的 `createInterpretAction` / `createTypeCheckAction`，它们是纯 JS，可在浏览器直接跑。
- 每次运行使用独立文档 URI（`__ooc-run-N/<name>.ooc`），避免 Langium 文档注册表重复注册同名文件。
- 依赖的原生构建工具（Vite/Rolldown）仅用于打包，不进入产物运行时。

## 测试

```bash
npm test -w packages/playground   # node:test，覆盖解释 + 类型诊断 + 跨笔记 import
```