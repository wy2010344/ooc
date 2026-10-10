import './style.css'
import { sendMessage } from 'object-oriented-c-language'
import { createRoot } from 'mve-dom'
// .ooc 是一等源码模块：vite-plugin-ooc 在内存 transform 成纯 ES 模块
//（默认导出 = 模块最后一条表达式，所有顶层声明都是 export），
// 宿主依赖（dom/text/fc/storage/信号）由 OOC 侧 #import './ooc/bridge.ts' 显式导入，
// 无 prebuild、无磁盘中间产物；文件改动走 vite 热更新直接重解析。
import app from './ooc/app.ooc'

const container = document.getElementById('app')!
const errBox = document.getElementById('error')!

async function boot() {
  try {
    container.replaceChildren()
    errBox.textContent = ''
    createRoot(container, function (this) {
      sendMessage(app, 'preview', [this])
    })
  } catch (err) {
    errBox.textContent = String(err)
  }
}

boot()
