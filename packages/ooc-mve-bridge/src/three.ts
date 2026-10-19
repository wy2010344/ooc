/**
 * three 桥接：把 mve-three（three.js）的组件模型暴露成 OOC 可调用的对象。
 *
 * 与 canvas 桥同一套模式：
 * - 舞台是 DOM 容器 + WebGLRenderer（mve-three 的 renderThreeView），可选 OrbitControls；
 * - 子节点是 THREE.Object3D（Mesh/Group/Sprite/Light），照旧挂在 mve 的 holder 树上；
 * - 变换/材质属性写成 lambda 就响应式跟随信号（`rotationY = [angle $]`）。
 * 节点工厂（几何体/灯光/标签）见 three-nodes.ts。
 */
import * as THREE from 'three'
import { renderFDom, renderChildren as renderDomChildren } from 'mve-dom'
import {
  getPerspectiveCamera,
  hookOrbitControls,
  renderThreeView,
} from 'mve-three'
import { createSignal } from 'wy-helper'
import { collectProps, renderChildrenList } from './args.js'
import { fc } from './fc.js'
import { threeNodes } from './three-nodes.js'

export type { ThreeComponent, ThreeTagFactory } from './three-nodes.js'

/**
 * 3D 舞台：<div> 里放 WebGLRenderer 的 canvas（mve-three 负责），
 * 尺寸随容器（ResizeObserver + 信号），默认带 OrbitControls（拖拽旋转/滚轮缩放）。
 */
export const threeStage = fc(function (
  ctx: { addDestroy(fn: () => void): void },
  arg?: unknown,
  ...children: unknown[]
) {
  const props = collectProps(arg)
  const el = renderFDom('div', {
    id: props['id'] as string | undefined,
    className: props['className'] as string | undefined,
    style: props['style'] as any,
  } as any) as HTMLElement
  const w = createSignal(el.clientWidth || 1)
  const h = createSignal(el.clientHeight || 1)
  const observer = new ResizeObserver(() => {
    w.set(el.clientWidth || 1)
    h.set(el.clientHeight || 1)
  })
  observer.observe(el)
  ctx.addDestroy(() => observer.disconnect())
  const camera =
    (props['camera'] as THREE.Camera | undefined) ??
    getPerspectiveCamera(w.get, h.get)
  const background = props['background']
  renderDomChildren(el, function () {
    renderThreeView({
      camera,
      width: w.get,
      height: h.get,
      notRender: props['notRender'] as boolean | undefined,
      args: {
        antialias: true,
        alpha: true,
        ...(props['args'] as object | undefined),
      },
      render(scene) {
        if (background !== undefined) {
          scene.background =
            background instanceof THREE.Color
              ? background
              : new THREE.Color(background as THREE.ColorRepresentation)
        }
        renderChildrenList(children, this)
      },
    })
    if (props['controls'] !== false) {
      hookOrbitControls()
    }
  })
  return el
})

/** 3D 组件集合：舞台 + 几何体/灯光/helper/标签，与 canvas 命名空间同构 */
export const three = {
  stage: threeStage,
  ...threeNodes,
}
