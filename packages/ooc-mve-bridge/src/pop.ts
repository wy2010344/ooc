import type { StateHolderWithNode } from 'mve-core'
import { hookCurrentStateHolder } from 'mve-core'
import { createPop as createPopImpl, renderPop } from 'mve-helper'

import type { DComponent } from './dom.js'
import type { SetValue } from 'wy-helper'

/**
 * Portal / 弹层：内容渲染到 `renderPop()` 维护的弹层列表里（main.ts 在根渲染流程中调用
 * `renderPop()`，列表挂在同一 root 下，从而脱离组件级的 overflow / transform 裁剪——
 * 下拉菜单、Select、Dialog、Sheet 用）。
 *
 * createPop(render) → close：
 * - render(ctx, close) 在 pop 行的构建窗口内执行，用 createPop 拿到的 ctx 应用组件；
 * - close(value) 关闭该弹层（同一弹层可被多次打开时用 value 传递结果）。
 */
export { renderPop }

export type PopProvide = (holder: unknown) => void

export function createPop<T>(
  render: (
    ctx: StateHolderWithNode<Node, readonly Node[]>,
    close: SetValue<T>,
  ) => DComponent,
) {
  return createPopImpl<T>((close: SetValue<T>) => {
    const holder = hookCurrentStateHolder(
      true,
    ) as unknown as StateHolderWithNode<Node, readonly Node[]>
    render(holder, close)
  })
}
