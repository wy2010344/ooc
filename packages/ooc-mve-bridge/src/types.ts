/**
 * 桥接类型定义：供 OOC 类型检查器使用。
 * 宿主（playground/example）调用 createBridgeGlobalsTypes() 生成 Map<string, TypeInfo>，
 * 传给 createObjectOrientedCServices 的 globalsTypes 参数。
 */
import type {
  TypeInfo,
  MethodSig,
} from 'object-oriented-c-language'
import {
  anyType,
  numberType,
} from 'object-oriented-c-language'

// DComponent 类型：(ctx) => unknown
const dcomponentType: TypeInfo = {
  kind: 'function',
}

// text.apply(value): DComponent
const textApplyMethod: MethodSig = {
  params: [anyType],
  returns: dcomponentType,
}

// forEach.apply(config): DComponent
const forEachApplyMethod: MethodSig = {
  params: [anyType],
  returns: dcomponentType,
}

// fc.apply(args): (ctx) => unknown
const fcApplyMethod: MethodSig = {
  params: [], // args 数组
  rest: anyType,
  returns: dcomponentType,
}

// storage ref 方法
const storageRefMethod: MethodSig = {
  params: [anyType],
  returns: anyType,
}

// storage ref 对象类型
const refType: TypeInfo = {
  kind: 'object',
  name: 'Ref',
  methods: new Map([
    ['get', [{ params: [], returns: anyType } as MethodSig]],
    ['set', [storageRefMethod]],
  ]),
}

// storage 类型
const storageType: TypeInfo = {
  kind: 'object',
  name: 'storage',
  methods: new Map([
    ['ref', [{ params: [anyType], returns: refType } as MethodSig]],
  ]),
}

// js 类型（简化）
const jsType: TypeInfo = {
  kind: 'object',
  name: 'js',
  methods: new Map([
    ['new', [{ params: [], rest: anyType, returns: anyType } as MethodSig]],
    ['send', [{ params: [anyType, anyType], rest: anyType, returns: anyType } as MethodSig]],
  ]),
}

// ObjectValue 类型
const objectValueType: TypeInfo = {
  kind: 'object',
  name: 'ObjectValue',
  methods: new Map([
    ['metaOf', [{ params: [anyType], returns: anyType } as MethodSig]],
  ]),
}

// createSignal 类型
const createSignalType: TypeInfo = {
  kind: 'object',
  name: 'createSignal',
  methods: new Map([
    ['apply', [{ params: [anyType], returns: anyType } as MethodSig]],
  ]),
}

// memo 类型
const memoType: TypeInfo = {
  kind: 'object',
  name: 'memo',
  methods: new Map([
    ['apply', [{ params: [anyType], returns: anyType } as MethodSig]],
  ]),
}

// addEffect 类型
const addEffectType: TypeInfo = {
  kind: 'function',
}

// createContext 类型
const createContextType: TypeInfo = {
  kind: 'function',
}

// dom 类型：每个标签名都是一个方法，签名即 (props?, ...children: DComponent[]) => DComponent
// 标签名来自 wy-dom-helper 的 domTagNames（此处静态内联，避免拖入带 window 副作用的运行时包）
const domTagNames = [
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo', 'big',
  'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'datalist',
  'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup',
  'hr', 'html', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'keygen', 'label', 'legend', 'li',
  'link', 'main', 'map', 'mark', 'menu', 'menuitem', 'meta', 'meter', 'nav', 'noindex', 'noscript', 'object',
  'ol', 'optgroup', 'option', 'output', 'p', 'param', 'picture', 'pre', 'progress', 'q', 'rp', 'rt',
  'ruby', 's', 'samp', 'slot', 'script', 'section', 'select', 'small', 'source', 'span', 'strong', 'style',
  'sub', 'summary', 'sup', 'table', 'template', 'tbody', 'td', 'textarea', 'tfoot', 'th', 'thead', 'time',
  'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr', 'webview',
] as const

// dom.<tag> 的共享签名：(props?, ...children[]) => DComponent
const domMethods = new Map<string, MethodSig[]>()
for (const tag of domTagNames) {
  domMethods.set(tag, [
    { params: [anyType], rest: anyType, returns: dcomponentType },
  ])
}

// dom 类型：dom div {...} 等消息调用即对应标签方法
const domType: TypeInfo = {
  kind: 'object',
  name: 'dom',
  methods: domMethods,
}

// forEach 类型
const forEachType: TypeInfo = {
  kind: 'object',
  name: 'forEach',
  methods: new Map([
    ['apply', [forEachApplyMethod]],
  ]),
}

// fc 类型
const fcType: TypeInfo = {
  kind: 'object',
  name: 'fc',
  methods: new Map([
    ['apply', [fcApplyMethod]],
  ]),
}

// text 类型
const textType: TypeInfo = {
  kind: 'object',
  name: 'text',
  methods: new Map([
    ['apply', [textApplyMethod]],
  ]),
}

// html 类型
const htmlType: TypeInfo = {
  kind: 'object',
  name: 'html',
  methods: new Map([
    ['apply', [textApplyMethod]],
  ]),
}

/**
 * 创建桥接对象的类型映射。
 * 返回 Map<string, TypeInfo>，可传给 createObjectOrientedCServices。
 */
export function createBridgeGlobalsTypes(): Map<string, TypeInfo> {
  const types = new Map<string, TypeInfo>()

  // 基础桥接
  types.set('storage', storageType)
  types.set('js', jsType)
  types.set('ObjectValue', objectValueType)
  types.set('createSignal', createSignalType)
  types.set('memo', memoType)
  types.set('addEffect', addEffectType)
  types.set('createContext', createContextType)

  // 视图桥接
  types.set('dom', domType)
  types.set('text', textType)
  types.set('html', htmlType)
  types.set('fc', fcType)
  types.set('forEach', forEachType)

  // 数组（globalThis.Array）
  const arrayType: TypeInfo = {
    kind: 'object',
    name: 'Array',
    methods: new Map([
      ['of', [{ params: [], rest: anyType, returns: anyType } as MethodSig]],
      ['at', [{ params: [numberType], returns: anyType } as MethodSig]],
      ['forEach', [{ params: [anyType], returns: anyType } as MethodSig]],
      ['filter', [{ params: [anyType], returns: anyType } as MethodSig]],
      ['map', [{ params: [anyType], returns: anyType } as MethodSig]],
      ['length', [{ params: [], returns: numberType } as MethodSig]],
      ['toSpliced', [{ params: [numberType, numberType], rest: anyType, returns: anyType } as MethodSig]],
    ]),
  }
  types.set('Array', arrayType)

  // console（简化）
  const consoleType: TypeInfo = {
    kind: 'object',
    name: 'console',
    methods: new Map([
      ['log', [{ params: [], rest: anyType, returns: anyType } as MethodSig]],
    ]),
  }
  types.set('console', consoleType)

  // Date
  const dateType: TypeInfo = {
    kind: 'object',
    name: 'Date',
    methods: new Map([
      ['now', [{ params: [], returns: numberType } as MethodSig]],
    ]),
  }
  types.set('Date', dateType)

  return types
}

/**
 * 常用的全局类型（数字、字符串等内置类型的方法）。
 * 这些已经内置在 TypeEnv 的 getBuiltinMethods 中，这里只是导出供参考。
 */
export const builtinTypeNames = ['number', 'string', 'boolean', 'nil'] as const
