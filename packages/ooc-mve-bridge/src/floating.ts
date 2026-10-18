import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  type Placement,
  type ReferenceElement,
} from '@floating-ui/dom'
import type { StateHolderWithNode } from 'mve-core'
import { renderFDom } from 'mve-dom'

import { renderComponents, type DComponent } from './dom.js'

export interface FloatingProps {
  /** 参照元素（通常是触发按钮），读取时返回当前 DOM 节点 */
  reference?: () => HTMLElement | null | undefined
  /** 光标坐标参照（右键菜单）：与 reference 二选一，用虚拟元素喂给 computePosition */
  point?: () => { x: number; y: number } | null | undefined
  /** 首选方位；碰撞时由 flip 回退到相反方向 */
  placement?: Placement
  /** 与参照元素的间距 */
  offset?: number
  /** 弹层最小宽度跟随参照元素（Select 用） */
  matchWidth?: boolean
  /** 点外部 / Esc 时回调（菜单、Select 用）；弹层销毁时自动解绑 */
  onDismiss?: () => void
  /** dismiss 时忽略的元素（触发按钮：点它不该先关再被自身 click 重开） */
  dismissIgnore?: () => Element | null | undefined
  className?: string | (() => string)
}

/** 解析浮层参照：point（光标处虚拟元素）优先，否则取 reference 元素 */
function resolveReference(props: FloatingProps): ReferenceElement | null {
  if (props.point) {
    const p = props.point()
    if (!p) return null
    return {
      getBoundingClientRect: () => ({
        x: p.x,
        y: p.y,
        top: p.y,
        left: p.x,
        right: p.x,
        bottom: p.y,
        width: 0,
        height: 0,
      }),
    }
  }
  return props.reference?.() ?? null
}

/**
 * 浮层定位组件：absolute 定位 + @floating-ui 的 autoUpdate（滚动/尺寸变化自动重算），
 * 配合 flip/shift 做位置回退，避免贴边溢出。内容由 pop（portal）承载时可跨 overflow。
 *
 * 必须是 `position: absolute`：@floating-ui 默认 strategy 就是 `absolute`，算出的 x/y 以
 * 弹层的 offsetParent 为基准；若 CSS 写成 `fixed`，坐标会被当成视口坐标用，弹层会跑到屏外。
 *
 *   floating $ { reference = [...], placement = 'bottom-start' } ...children
 */
export function floating(props: FloatingProps, ...children: DComponent[]) {
  return function (ctx?: StateHolderWithNode<Node, readonly Node[]>) {
    const node = renderFDom('div', {
      className: props.className ?? 'absolute z-50',
      children(this: any) {
        renderComponents(children, this)
      },
    }) as unknown as HTMLElement
    node.style.position = 'absolute'
    node.style.left = '0px'
    node.style.top = '0px'

    // 点外部 / Esc 关闭：注册在 document 上，先于打开事件之后生效（打开手势的 pointerdown 早已派发完）
    const onDismiss = props.onDismiss
    if (onDismiss) {
      const onDown = (e: PointerEvent) => {
        const t = e.target as Node | null
        if (t && (node.contains(t) || props.dismissIgnore?.()?.contains(t))) return
        onDismiss()
      }
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onDismiss()
      }
      document.addEventListener('pointerdown', onDown)
      document.addEventListener('keydown', onKey)
      ctx?.addDestroy(() => {
        document.removeEventListener('pointerdown', onDown)
        document.removeEventListener('keydown', onKey)
      })
    }

    const ref = resolveReference(props)
    if (!ref) {
      return node
    }
    if (props.matchWidth && props.reference) {
      const el = props.reference()
      if (el) {
        node.style.minWidth = `${el.getBoundingClientRect().width}px`
      }
    }
    const stop = autoUpdate(ref, node, async () => {
      const { x, y } = await computePosition(ref, node, {
        placement: props.placement ?? 'bottom-start',
        middleware: [
          offset(props.offset ?? 4),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
        ],
      })
      node.style.left = `${x}px`
      node.style.top = `${y}px`
    })
    ctx?.addDestroy(stop)
    return node
  }
}
