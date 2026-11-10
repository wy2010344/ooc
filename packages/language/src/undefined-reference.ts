// 模块内未定义引用检查：拼错的局部名 / 漏写的绑定，运行时必然抛
// `not found define for X`，但语法检查和类型推导都会静默退化成 any。
// 这里在校验期按「本模块有没有这个名字」保守判定，LSP 与 CLI type-check 共用。
//
// 与 temporal-dead-zone.ts 的区别：那边只管同层声明的先后顺序，这里管名字是否存在。

import { AstUtils, type ValidationAcceptor } from 'langium'
import { isRef, type Model, type Ref } from './generated/ast.js'
import { diagnosticData } from './diagnostics-config.js'

/** 语言内建 / JS 与浏览器运行时自带的名字：OOC 源码可直接引用，不算未定义 */
export const AMBIENT_NAMES: ReadonlySet<string> = new Set([
  'this', 'Array', 'Object', 'String', 'Number', 'Boolean', 'BigInt', 'Symbol',
  'Math', 'JSON', 'Date', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'RegExp', 'Error', 'TypeError', 'RangeError', 'Reflect', 'Proxy', 'Intl',
  'console', 'globalThis', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'queueMicrotask', 'structuredClone', 'URL', 'Infinity', 'NaN', 'undefined',
  // OOC 运行时注入的宿主无关内建（createInterpretAction 默认 globals）
  'storage', 'js', 'merge', 'union',
  'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage',
  'history', 'screen', 'fetch', 'performance', 'crypto', 'requestAnimationFrame',
  'cancelAnimationFrame', 'URLSearchParams', 'AbortController', 'Image', 'Blob',
])

function addName(names: Set<string>, name: unknown): void {
  if (typeof name === 'string' && name.length > 0) names.add(name)
}

/**
 * 本模块里「可能已绑定」的名字：顶层声明、#import 绑定、任意作用域的参数与赋值。
 *
 * 刻意不区分作用域：只要整个文件里出现过同名声明就放行。作用域错位由
 * scope-duplicates / TDZ 负责，这里只抓「压根没定义」的名字，避免把闭包、
 * 后置声明、模板洞里的引用误报成错误。宿主注入的 globals 由调用方补进集合。
 */
export function collectDefinedNames(model: Model): Set<string> {
  const names = new Set<string>()
  for (const node of AstUtils.streamAst(model)) {
    switch (node.$type) {
      case 'Assignment':
      case 'TypeDef':
        addName(names, (node as { name?: string }).name)
        break
      case 'ImportStatement': {
        const st = node as {
          name?: string
          named?: { items?: Array<{ name: string; alias?: string }> }
          types?: { items?: Array<{ name: string; alias?: string }> }
        }
        addName(names, st.name)
        for (const list of [st.named, st.types]) {
          for (const item of list?.items ?? []) addName(names, item.alias ?? item.name)
        }
        break
      }
      case 'NamedExpression':
        // 命名管道 `x | s -> …` 里的 s 也是绑定
        addName(names, (node as { param?: string }).param)
        break
      case 'LambdaDef':
      case 'MethodAll':
      case 'MethodBind':
      case 'MethodBindMutable': {
        const owner = node as {
          params?: Array<{ name: string }>
          restParam?: { name: string } | null
        }
        for (const p of owner.params ?? []) addName(names, p.name)
        addName(names, owner.restParam?.name)
        break
      }
    }
  }
  return names
}

/**
 * 找出所有未定义的变量引用。`extraGlobals` 是宿主注入 / 项目 config.ooc 声明的全局名。
 * 消息名（`obj method` 里的 method）与定义名不是变量引用，按 container 排除。
 */
export function findUndefinedReferences(
  model: Model,
  extraGlobals: Iterable<string> = [],
): Ref[] {
  const known = collectDefinedNames(model)
  for (const name of AMBIENT_NAMES) known.add(name)
  for (const name of extraGlobals) known.add(name)

  const out: Ref[] = []
  for (const node of AstUtils.streamAst(model)) {
    if (!isRef(node)) continue
    const owner = node.$container?.$type
    if (owner === 'MethodCallName' || owner === 'MethodDefName') continue
    if (!known.has(node.value)) out.push(node)
  }
  return out
}

/** 校验器入口：逐条报 error（这类引用运行必炸，不是风格提示）。 */
export function checkUndefinedReferences(
  model: Model,
  accept: ValidationAcceptor,
  extraGlobals: Iterable<string> = [],
): void {
  for (const ref of findUndefinedReferences(model, extraGlobals)) {
    accept(
      'error',
      `未定义引用 '${ref.value}'：本模块没有该声明，也不是 #import 绑定、宿主全局或 JS 内建`,
      { node: ref, property: 'value', data: diagnosticData('undefinedReference') },
    )
  }
}
