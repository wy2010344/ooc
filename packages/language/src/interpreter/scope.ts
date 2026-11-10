import { KVPair } from 'wy-helper'
// scope ↔ bridges ↔ runtime 是函数级环依赖：三个模块都不在初始化期调用彼此，
// ESM 的函数声明绑定在实例化期就绪，调用时才取用，安全（与 evaluate ↔ runtime 同理）。
import { createMessageChain, UNHANDLED } from './bridges.js'
import { proxyCatchAll } from './proxy.js'
import { sendMessage } from './runtime.js'

export interface RootScope {
  get(key: string): any
}

export type Scope = KVPair<any> | undefined

export function addScope(scope: Scope, key: string, value: any) {
  return new KVPair(key, value, scope)
}

const scopeSymbol = Symbol('scope')

/** 名字在作用域链上可见（含 globalThis 与伪对象自身），不触发 globalRoot 的抛错。 */
function hasBinding(scope: Scope, key: string): boolean {
  return key === 'currentScope' || Boolean(scope?.get(key)) || key in globalThis
}

/**
 * currentScope 是**作用域作为消息处理中心**的那个对象，不是语法糖。
 * 它能应答的消息联合就是当前作用域链上可见的绑定：
 *   `(nameA, arg1, arg2…) | (nameB, arg1, …) | …`
 * 消息名是判别标识；收到 `(name, ...args)` 时按链查到绑定值，把 args 原样
 * 作为 `$` 消息发给它——即 `currentScope f 1 2` ≡ `f $ 1 2`（lambda 直接调用，
 * 带 `$` 方法的对象走完整派发）。不带实参是「读绑定」：返回原始值，函数也
 * 不二次调用（旧语义保留）。
 *
 * 未绑定的名字是一次合法的 `unhandled` 应答：放进 merge 链会转交后继层；
 * 单独发送时由链尾出口抛结构化 `OocMethodNotFoundError`（A 路线统一出口）。
 * 实现与 `merge $` 共用同一条消息路由链（createMessageChain），因此
 * respondsTo / 弃权 / 内建协议 / 错误形状都不另立规则。
 */
function createScopeRouter(scope: Scope): unknown {
  const layer = proxyCatchAll({}, (name: string, ...args: unknown[]) => {
    if (!hasBinding(scope, name)) {
      return UNHANDLED
    }
    const value = getScope(scope, name)
    return args.length > 0 ? sendMessage(value, '$', args) : value
  })
  return createMessageChain([layer])
}

/** 还没有任何绑定层时的共享路由对象（恒弃权），避免每次引用都换一个身份。 */
let emptyScopeRouter: unknown

/** 每个作用域链头缓存一份：同一层的 currentScope 是同一个对象。 */
function scopeRouter(scope: Scope): unknown {
  if (!scope) {
    emptyScopeRouter ??= createScopeRouter(undefined)
    return emptyScopeRouter
  }
  const temp = scope as unknown as Record<symbol, unknown>
  let cached = temp[scopeSymbol]
  if (!cached) {
    cached = createScopeRouter(scope)
    temp[scopeSymbol] = cached
  }
  return cached
}

export function getScope(scope: Scope, key: string) {
  if (key == 'currentScope') {
    return scopeRouter(scope)
  }
  if (scope) {
    const kv = scope.get(key)
    if (kv) {
      return kv.value
    }
  }
  return globalRoot.get(key)
}

export const globalRoot: RootScope = {
  get(key: string): any {
    if (key in globalThis) {
      return globalThis[key as 'Object']
    }
    throw new Error(`not found define for ${key}`)
  },
}

/**
 * 宿主注入的 JS 全局对象（如 storage），OOC 源码直接按名字引用，无需 #import。
 */
export type Globals = Record<string, unknown>

/**
 * 注入的全局对象作为最外层作用域：getScope 优先在作用域链里命中，
 * 找不到再回退到 globalRoot。
 */
export function withGlobals(scope: Scope, globals: Globals): Scope {
  let s = scope
  for (const key of Object.keys(globals)) {
    s = addScope(s, key, globals[key])
  }
  return s
}
