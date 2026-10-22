import './style.css'
import { createRoot } from 'mve-dom'
import { createHashHistory } from 'history'
import { renderOneKey } from 'mve-helper'
import { hookCurrentStateHolder } from 'mve-core'
import { provideIconContext, renderPop, routerProvide } from 'ooc-mve-bridge'
import home from './ooc/pages/home.ooc'
import components from './ooc/pages/components.ooc'
import componentsBasic from './ooc/pages/components-basic.ooc'
import componentsForms from './ooc/pages/components-forms.ooc'
import componentsData from './ooc/pages/components-data.ooc'
import componentsOverlays from './ooc/pages/components-overlays.ooc'
import componentsVisual from './ooc/pages/components-visual.ooc'
import financeDashboard from './ooc/pages/finance-dashboard.ooc'

// .ooc 是一等源码模块：vite-plugin-ooc 在内存里 transform 成纯 ES 模块。
// hash 路由只负责选页，每个页面仍是普通的 OOC fc 组件。
// .ooc 默认导出是 fc 工厂：调用一次得到真正的组件函数。
type PageFactory = () => (ctx: unknown) => void

const routes: Record<string, PageFactory> = {
  '/': home,
  '/components': components,
  '/components/basic': componentsBasic,
  '/components/forms': componentsForms,
  '/components/data': componentsData,
  '/components/overlays': componentsOverlays,
  '/components/visual': componentsVisual,
  '/dashboard': financeDashboard,
}

const container = document.getElementById('app')!
const errBox = document.getElementById('error')!

async function boot() {
  try {
    container.replaceChildren()
    errBox.textContent = ''
    createRoot(container, function (this) {
      provideIconContext(this)
      const { getHistoryState } = routerProvide(createHashHistory())

      renderOneKey(
        () => {
          const path = getHistoryState().pathname
          return routes[path] ? path : '/'
        },
        (path) => path,
        function (_path, getPath) {
          const page = routes[getPath()] ?? home
          // .ooc 默认导出是 fc 工厂：先取组件函数，再挂到当前路由子 holder。
          page()(hookCurrentStateHolder(true))
        },
      )

      renderPop()
    })
  } catch (err) {
    errBox.textContent = String(err)
  }
}

boot()
