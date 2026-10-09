import './style.css'
import { sendMessage } from 'object-oriented-c-language'
import { createBridgeGlobals } from 'ooc-mve-bridge'
import { createRoot } from 'mve-dom'
import app from './ooc-gen/src/ooc/app.ts'

// OOC 入口在构建期编译：predev/prebuild 跑 `ooc build src/ooc/app.ooc -o src/ooc-gen`
// 整棵依赖图（含 .ooc_modules 包）编译成普通 ES 模块 + 共享 _ooc_runtime.ts，
// 浏览器直接加载 ES import 即可，不再需要解释器/虚拟文件系统/raw loader。
// 编译产物：OOC 入口导出 run(globals)，宿主注入 bridge globals → 拿最后一条表达式值。

// 宿主桥接 globals：一行注入 language 原生原语（storage/js/delegate）、
// 视图组件（dom/text/html/fc/forEach）与响应式信号（createSignal/memo/addEffect），
// 类型侧对应 createBridgeGlobalsTypes()（与 config.ooc globals 清单一致）。
const container = document.getElementById('app')!
const errBox = document.getElementById('error')!

async function boot() {
  try {
    const value = await app(createBridgeGlobals())
    container.replaceChildren()
    errBox.textContent = ''
    createRoot(container, function (this) {
      sendMessage(value, 'preview', [this])
    })
  } catch (err) {
    errBox.textContent = String(err)
  }
}

boot()