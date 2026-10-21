/**
 * canvas 桥接：把 mve-dom-helper 的 canvasRender 组件模型暴露成 OOC 可直接调用的对象。
 *
 * 复用而不是重写：
 * - 节点工厂等价于 renderNode/renderRect/...（同一 StateHolder 组合模型，children 在子 holder 里展开）
 * - 布局/绘制原语（flex/grow/align、fill 与 stroke 系列）直接透传，OOC 侧在 draw 里以 `this`（节点）为 receiver 调用
 *
 * 与 dom 的差异：canvas 的属性对象不 bind 方法——Node 构造时把 draw/mouseXxx 挂到自身，
 * 调用时 `this` 必须是节点（draw 里要读 outerWidth/outerHeight）。属性展开见 args.ts。
 */
import type { StateHolderWithNode } from 'mve-core'
import { renderFDom } from 'mve-dom'
import { collectProps, readValue, renderChildrenList } from './args.js'
import { fc } from './fc.js'
import {
  align,
  colorToCSS,
  fillInnerRect,
  fillInnerRoundRect,
  fillOuterOval,
  fillOuterRect,
  fillOuterRoundRect,
  flex,
  grow,
  ignoreFlex,
  layoutSize,
  layoutSizeDirection,
  outerSize,
  renderCanvas,
  renderEditableText,
  renderImage,
  renderNode,
  renderRect,
  renderRichText,
  renderScrollContent,
  renderWrappedText,
  rgba,
  roundRectPath,
  strokeInnerRect,
  strokeInnerRoundRect,
  strokeOuterOval,
  strokeOuterRect,
  strokeOuterRoundRect,
  strokeOuterRing,
} from 'mve-dom-helper/canvasRender'

/** 画布节点组件：与 DComponent 一样是惰性组件，挂载期以当前 holder 执行 */
export type CanvasComponent = (ctx: unknown) => unknown

/** 画布标签工厂：props 可省，其余是子组件（数组会被摊平） */
export type CanvasTagFactory = (
  props?: unknown,
  ...children: unknown[]
) => CanvasComponent

/**
 * draw 合成：先跑用户的 draw（背景、文本等），再调原型上的 draw（canvasRender 负责画子节点）。
 * 用户 draw 的 this 就是节点本身，可直接 `canvasDraw fill this ctx …`。
 */
function composeDraw(props: Record<string, unknown>): void {
  const userDraw = props['draw']
  if (typeof userDraw !== 'function') {
    return
  }
  props['draw'] = function (this: unknown, ctx: CanvasRenderingContext2D) {
    ;(userDraw as (this: unknown, ctx: CanvasRenderingContext2D) => void).call(this, ctx)
    const proto = Object.getPrototypeOf(this) as
      | { draw?: (this: unknown, ctx: CanvasRenderingContext2D) => void }
      | null
    proto?.draw?.call(this, ctx)
  }
}

function makeTag(render: (props: any) => unknown): CanvasTagFactory {
  return function (arg?: unknown, ...children: unknown[]): CanvasComponent {
    return function (this: unknown) {
      const props = collectProps(arg)
      composeDraw(props)
      props['children'] = function (this: unknown) {
        renderChildrenList(children, this)
      }
      return render(props)
    }
  }
}

/**
 * 画布舞台：建 <canvas> 挂到当前 DOM holder，再交给 renderCanvas 建 Renderer。
 * 默认纵向 flex、交叉轴拉伸；尺寸由 className/style 控制（CSS 生效后 ResizeObserver 同步）。
 * renderCanvas 只注册重绘回调、不做首帧渲染，这里补一次。
 */
/**
 * mve-dom-helper 的 Renderer.render 固定先铺白底。这里按 stage 的 backgroundColor
 * 重新实现同一段渲染：复用它的 signal.collect，draw 期间读到的主题/状态信号仍会被订阅。
 * backgroundColor 支持普通 ColorInt 或 lambda（lambda 内读 dark 信号即可跟随主题重绘）。
 */
function bindStageBackground(renderer: any, background: unknown) {
  const signal = renderer.signal as { collect(fn: () => void): void }
  renderer.render = function (canvas: CanvasRenderingContext2D) {
    renderer.scheduled = true
    try {
      signal.collect(() => {
        const w = outerSize.call(renderer, 'x')
        const h = outerSize.call(renderer, 'y')
        const value = readValue(background)
        canvas.fillStyle =
          typeof value === 'string'
            ? value
            : colorToCSS((value as number | undefined) ?? rgba(255, 255, 255))
        canvas.fillRect(0, 0, w, h)
        renderer.draw(canvas)
      })
    } catch (err) {
      console.error('渲染出错', err)
    }
    renderer.scheduled = false
  }
}

export const canvasStage = fc(function (
  ctx: StateHolderWithNode<Node, readonly Node[]>,
  arg?: unknown,
  ...children: unknown[]
) {
  const props = collectProps(arg)
  const el = renderFDom('canvas', {
    id: props['id'] as string | undefined,
    className: props['className'] as string | undefined,
    style: props['style'] as any,
  } as any) as HTMLCanvasElement
  const renderer = renderCanvas(el, {
    padding: props['padding'] as any,
    layout:
      (props['layout'] as any) ??
      flex({ direction: 'y', alignItem: 'stretch', alignFix: true }),
    children() {
      renderChildrenList(children, this)
    },
  } as any)
  const background = props['backgroundColor']
  if (background !== undefined) {
    bindStageBackground(renderer, background)
  }
  const ctx2d = el.getContext('2d')
  if (ctx2d) {
    renderer.render(ctx2d)
  }
  ctx.addDestroy(() => renderer.destroy())
  return renderer
})

/** 各节点类型：props 与 canvasRender 的 *NodeArg 一一对应（children 由桥接接管） */
export const canvas = {
  stage: canvasStage,
  node: makeTag(renderNode),
  rect: makeTag(renderRect),
  rich: makeTag(renderRichText),
  wrapped: makeTag(renderWrappedText),
  editable: makeTag(renderEditableText),
  image: makeTag(renderImage),
  scroll: makeTag(renderScrollContent),
}

/**
 * 绘制原语：首参是节点（canvasRender 的工具函数都是 this 调用），其余参数对齐原函数。
 * 供 OOC 在 draw 里写 `canvasDraw fill this ctx color`。
 */
export const canvasDraw = {
  fill(node: any, ctx: CanvasRenderingContext2D, color?: number) {
    fillOuterRect.call(node, ctx, color)
  },
  fillInner(node: any, ctx: CanvasRenderingContext2D, color?: number) {
    fillInnerRect.call(node, ctx, color)
  },
  stroke(node: any, ctx: CanvasRenderingContext2D, color?: number, width?: number) {
    strokeOuterRect.call(node, ctx, color, width)
  },
  strokeInner(node: any, ctx: CanvasRenderingContext2D, color?: number, width?: number) {
    strokeInnerRect.call(node, ctx, color, width)
  },
  round(node: any, ctx: CanvasRenderingContext2D, radius: number, color?: number) {
    fillOuterRoundRect.call(node, ctx, radius, color)
  },
  roundInner(node: any, ctx: CanvasRenderingContext2D, radius: number, color?: number) {
    fillInnerRoundRect.call(node, ctx, radius, color)
  },
  strokeRound(
    node: any,
    ctx: CanvasRenderingContext2D,
    radius: number,
    color?: number,
    width?: number,
  ) {
    strokeOuterRoundRect.call(node, ctx, radius, color, width)
  },
  strokeRoundInner(
    node: any,
    ctx: CanvasRenderingContext2D,
    radius: number,
    color?: number,
    width?: number,
  ) {
    strokeInnerRoundRect.call(node, ctx, radius, color, width)
  },
  oval(node: any, ctx: CanvasRenderingContext2D, color?: number) {
    fillOuterOval.call(node, ctx, color)
  },
  strokeOval(node: any, ctx: CanvasRenderingContext2D, color?: number, width?: number) {
    strokeOuterOval.call(node, ctx, color, width)
  },
  ring(
    node: any,
    ctx: CanvasRenderingContext2D,
    gap: number,
    radius: number,
    color?: number,
    width?: number,
  ) {
    strokeOuterRing.call(node, ctx, gap, radius, color, width)
  },
  /** 圆角矩形填充（不依赖节点尺寸）：进度条、局部高亮等自定义绘制用。
   *  与其它原语不同：它没有首参 node（纯坐标绘制），写 `canvasDraw fillRound ctx x y w h r color`。 */
  fillRound(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
    color?: number,
  ) {
    ctx.fillStyle = colorToCSS(color ?? rgba(0, 0, 0))
    roundRectPath(ctx, x, y, w, h, radius)
    ctx.fill()
  },
  /**
   * 文本：坐标是节点本地坐标（父节点 draw 前已 translate 到节点原点）。
   * 不依赖 CanvasKit——fillText 足够画简单标签。
   */
  text(
    _node: any,
    ctx: CanvasRenderingContext2D,
    value: unknown,
    x: number,
    y: number,
    style?: unknown,
  ) {
    const p = collectProps(style)
    const size = (p['size'] as number | undefined) ?? 14
    const weight = (p['weight'] as number | string | undefined) ?? 400
    const family =
      (p['font'] as string | undefined) ??
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
    ctx.save()
    ctx.font = `${weight} ${size}px ${family}`
    ctx.fillStyle = colorToCSS((p['color'] as number | undefined) ?? rgba(17, 24, 39))
    ctx.textAlign = (p['align'] as CanvasTextAlign | undefined) ?? 'left'
    ctx.textBaseline = (p['baseline'] as CanvasTextBaseline | undefined) ?? 'alphabetic'
    ctx.fillText(String(readValue(value) ?? ''), x, y)
    ctx.restore()
  },
}

// 布局与颜色工具：OOC 侧直接 import（与 dom 桥的用法一致）
export {
  align,
  colorToCSS,
  flex,
  grow,
  ignoreFlex,
  layoutSize,
  layoutSizeDirection,
  rgba,
}
