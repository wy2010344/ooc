import type { StateHolder } from 'mve-core'
import { renderFSvg } from 'mve-dom'
import { IconContext } from 'mve-icons'
import type { IconInfo, SvgAttrInfo } from 'mve-icons'
import { IoCheckmark, IoChevronDown, IoClose } from 'mve-icons/io5'

import type { DComponent } from './dom.js'

export interface IconProps {
  className?: string | (() => string) | null
}

/** 图标渲染器签名（io5 的图标函数都接受 renderRoot + 可选 value） */
type IconImpl = (
  renderRoot: (
    fun: IconInfo,
    attrs: SvgAttrInfo,
    children: () => void,
  ) => void,
  value?: unknown,
) => void

/**
 * 把 mve-icons 的图标函数包成 OOC 可用的组件工厂：
 *   iconCheck $ { className = 'size-4' }   // 返回 DComponent，作为子节点渲染
 */
export function createIcon(fun: IconImpl) {
  return function iconComponent(props?: IconProps): DComponent {
    return function () {
      fun((_fun, attrs, children) => {
        renderFSvg('svg', {
          ...attrs,
          fill: 'currentColor',
          stroke: 'currentColor',
          strokeWidth: '0',
          className: props?.className ?? undefined,
          children,
        })
      })
    }
  }
}

export const iconCheck = createIcon(IoCheckmark as unknown as IconImpl)
export const iconChevronDown = createIcon(IoChevronDown as unknown as IconImpl)
export const iconX = createIcon(IoClose as unknown as IconImpl)

/**
 * 在某个 root holder 上提供 IconContext（app 和 pop 是两个独立 root，
 * 都要提供，否则弹层里的图标找不到渲染器）。
 */
export function provideIconContext(holder: StateHolder<any, any>) {
  holder.provide(IconContext, {
    renderItem(tag: string, attrs: Record<string, string>, children: () => void) {
      renderFSvg(tag as any, { ...attrs, children })
    },
    renderRoot(_fun: IconInfo, attrs: SvgAttrInfo, children: () => void) {
      renderFSvg('svg', {
        ...attrs,
        fill: 'currentColor',
        stroke: 'currentColor',
        strokeWidth: '0',
        children,
      })
    },
  })
}
