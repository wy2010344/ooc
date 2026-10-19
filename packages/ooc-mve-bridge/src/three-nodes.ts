/**
 * three 3D 节点（Mesh / Group / Light / Sprite 标签）：
 * 与 canvas 桥同一套模式——标签函数返回惰性组件，挂载期以当前 holder 执行，
 * 子节点挂在 mve 的 holder 树上（mve-three 的 renderChildren 负责增删）。
 *
 * 变换/材质属性写成 lambda 就响应式：trackProp 走带跟踪的读取，
 * lambda 里读到的信号变化会重新写回物体（动画循环随即呈现）。
 * 几何体参数是静态的（建一次）；命中检测需要自己上 Raycaster（暂未桥接）。
 */
import * as THREE from 'three'
import { hookAddResult } from 'mve-core'
import {
  hookDispose,
  hookRemoveFromParent,
  renderChildren as renderObjectChildren,
} from 'mve-three'
import { collectProps, renderChildrenList, trackProp } from './args.js'

/** 3D 节点组件：与 canvas/dom 一样是惰性组件，挂载期以当前 holder 执行 */
export type ThreeComponent = (ctx: unknown) => unknown

/** 3D 标签工厂：props 可省，其余是子组件（数组会被摊平） */
export type ThreeTagFactory = (
  props?: unknown,
  ...children: unknown[]
) => ThreeComponent

/** 变换属性：位置/旋转/缩放/可见性，值写 lambda 即可响应式 */
export function applyTransform(
  o: THREE.Object3D,
  props: Record<string, unknown>,
): void {
  trackProp(props, 'x', v => {
    o.position.x = v
  })
  trackProp(props, 'y', v => {
    o.position.y = v
  })
  trackProp(props, 'z', v => {
    o.position.z = v
  })
  trackProp(props, 'rotationX', v => {
    o.rotation.x = v
  })
  trackProp(props, 'rotationY', v => {
    o.rotation.y = v
  })
  trackProp(props, 'rotationZ', v => {
    o.rotation.z = v
  })
  trackProp(props, 'scale', v => {
    o.scale.setScalar(v)
  })
  trackProp(props, 'visible', v => {
    o.visible = v
  })
  const order = props['renderOrder']
  if (typeof order === 'number') {
    o.renderOrder = order
  }
}

/** 标准材质属性：颜色/粗糙度/金属度/线框/透明度/自发光 */
function applyMaterial(
  m: THREE.MeshStandardMaterial,
  props: Record<string, unknown>,
): void {
  trackProp(props, 'color', v => {
    m.color.set(v as THREE.ColorRepresentation)
  })
  trackProp(props, 'roughness', v => {
    m.roughness = v
  })
  trackProp(props, 'metalness', v => {
    m.metalness = v
  })
  trackProp(props, 'wireframe', v => {
    m.wireframe = v
  })
  trackProp(props, 'opacity', v => {
    m.opacity = v
    m.transparent = v < 1
  })
  trackProp(props, 'emissive', v => {
    m.emissive.set(v as THREE.ColorRepresentation)
  })
}

/** 网格标签工厂：几何体由 props 建一次，材质与变换响应式 */
function makeMeshTag(
  createGeometry: (props: Record<string, unknown>) => THREE.BufferGeometry,
): ThreeTagFactory {
  return function (arg?: unknown, ...children: unknown[]): ThreeComponent {
    return function (this: unknown) {
      const props = collectProps(arg)
      const material = new THREE.MeshStandardMaterial({
        color: '#94a3b8',
        roughness: 0.35,
        metalness: 0.15,
      })
      applyMaterial(material, props)
      const mesh = new THREE.Mesh(createGeometry(props), material)
      applyTransform(mesh, props)
      hookAddResult(mesh)
      // Mesh 自身没有 dispose：拆开释放几何体与材质，并摘出父节点
      hookRemoveFromParent(mesh)
      hookDispose(mesh.geometry)
      hookDispose(material)
      renderObjectChildren(mesh, function () {
        renderChildrenList(children, this)
      })
      return mesh
    }
  }
}

/** 灯光标签工厂：强度/颜色/位置；灯光无资源，不需要 dispose */
function makeLightTag(
  create: (props: Record<string, unknown>) => THREE.Light,
): ThreeTagFactory {
  return function (arg?: unknown, ...children: unknown[]): ThreeComponent {
    return function (this: unknown) {
      const props = collectProps(arg)
      const light = create(props)
      trackProp(props, 'color', v => {
        light.color.set(v as THREE.ColorRepresentation)
      })
      applyTransform(light, props)
      hookAddResult(light)
      renderObjectChildren(light, function () {
        renderChildrenList(children, this)
      })
      return light
    }
  }
}

/** 普通 Object3D 标签（Group / helper）：无资源释放，子节点照常挂载 */
function makeObjectTag(
  create: (props: Record<string, unknown>) => THREE.Object3D,
): ThreeTagFactory {
  return function (arg?: unknown, ...children: unknown[]): ThreeComponent {
    return function (this: unknown) {
      const props = collectProps(arg)
      const node = create(props)
      applyTransform(node, props)
      hookAddResult(node)
      renderObjectChildren(node, function () {
        renderChildrenList(children, this)
      })
      return node
    }
  }
}

/**
 * 文字标签：把文字画进 canvas 贴图，做成 Sprite（永远面向相机）。
 * value 写 lambda 就是响应式读数；size 是贴图里的字号，scale 是世界尺寸。
 */
function makeLabelTag(): ThreeTagFactory {
  return function (arg?: unknown): ThreeComponent {
    return function (this: unknown) {
      const props = collectProps(arg)
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 128
      const c = canvas.getContext('2d')!
      const draw = (text: string) => {
        const fontSize = (props['size'] as number | undefined) ?? 56
        const color = (props['color'] as string | undefined) ?? '#0f172a'
        c.clearRect(0, 0, canvas.width, canvas.height)
        c.font = `700 ${fontSize}px ui-sans-serif, system-ui, sans-serif`
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillStyle = color
        c.fillText(text, canvas.width / 2, canvas.height / 2)
      }
      draw('')
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
      })
      const sprite = new THREE.Sprite(material)
      sprite.renderOrder = 10
      trackProp(props, 'value', v => {
        draw(String(v ?? ''))
        texture.needsUpdate = true
      })
      const s = (props['scale'] as number | undefined) ?? 1
      sprite.scale.set(s * 2, s, 1)
      applyTransform(sprite, props)
      hookAddResult(sprite)
      hookRemoveFromParent(sprite)
      hookDispose(material)
      hookDispose(texture)
      return sprite
    }
  }
}

/** 3D 节点集合（不含舞台，舞台见 three.ts） */
export const threeNodes = {
  group: makeObjectTag(() => new THREE.Group()),
  box: makeMeshTag(p => {
    const size = (p['size'] as number | undefined) ?? 1
    return new THREE.BoxGeometry(
      (p['width'] as number | undefined) ?? size,
      (p['height'] as number | undefined) ?? size,
      (p['depth'] as number | undefined) ?? size,
    )
  }),
  sphere: makeMeshTag(
    p =>
      new THREE.SphereGeometry(
        (p['radius'] as number | undefined) ?? 0.6,
        (p['segments'] as number | undefined) ?? 32,
        16,
      ),
  ),
  cylinder: makeMeshTag(
    p =>
      new THREE.CylinderGeometry(
        (p['radius'] as number | undefined) ?? 0.4,
        (p['radius'] as number | undefined) ?? 0.4,
        (p['height'] as number | undefined) ?? 1.2,
        32,
      ),
  ),
  torus: makeMeshTag(
    p =>
      new THREE.TorusGeometry(
        (p['radius'] as number | undefined) ?? 0.6,
        (p['tube'] as number | undefined) ?? 0.2,
        16,
        48,
      ),
  ),
  plane: makeMeshTag(
    p =>
      new THREE.PlaneGeometry(
        (p['width'] as number | undefined) ?? 2,
        (p['height'] as number | undefined) ?? 2,
      ),
  ),
  ambient: makeLightTag(
    p =>
      new THREE.AmbientLight(
        '#ffffff',
        (p['intensity'] as number | undefined) ?? 0.6,
      ),
  ),
  directional: makeLightTag(
    p =>
      new THREE.DirectionalLight(
        '#ffffff',
        (p['intensity'] as number | undefined) ?? 1.4,
      ),
  ),
  point: makeLightTag(
    p =>
      new THREE.PointLight(
        '#ffffff',
        (p['intensity'] as number | undefined) ?? 12,
      ),
  ),
  grid: makeObjectTag(
    p =>
      new THREE.GridHelper(
        (p['size'] as number | undefined) ?? 8,
        (p['divisions'] as number | undefined) ?? 8,
        (p['color'] as string | undefined) ?? '#cbd5e1',
        (p['color'] as string | undefined) ?? '#e2e8f0',
      ),
  ),
  axes: makeObjectTag(
    p => new THREE.AxesHelper((p['size'] as number | undefined) ?? 1),
  ),
  label: makeLabelTag(),
}
