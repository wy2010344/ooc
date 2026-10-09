import './style.css'
import { sendMessage } from 'object-oriented-c-language'
import { createBridgeGlobals } from 'ooc-mve-bridge'
import { createRoot } from 'mve-dom'
// .ooc 是一等源码模块：vite-plugin-ooc 在内存 transform 成 JS（默认导出 run(globals)），
// 无 prebuild、无磁盘中间产物；文件改动走 vite 热更新直接重解析。
import app from './ooc/app.ooc'

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