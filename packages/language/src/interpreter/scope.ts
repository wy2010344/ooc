import { KVPair } from 'wy-helper'

export interface RootScope {
  get(key: string): any
}

export type Scope = KVPair<any> | undefined

export function addScope(scope: Scope, key: string, value: any) {
  return new KVPair(key, value, scope)
}

const scopeSymbol = Symbol('scope')

export function getScope(scope: Scope, key: string) {
  if (key == 'currentScope') {
    if (scope) {
      const temp = scope as any
      let old = temp[scopeSymbol]
      if (old) {
        return old
      }
      // currentScope 是作用域伪对象：消息名即待查变量名，按作用域链取值。
      // 用 JS Proxy 动态派发（旧写法靠 methodNotFound 兜底，解释器已不再隐式兜底）。
      old = new Proxy({} as Record<PropertyKey, unknown>, {
        get(_t, prop) {
          if (typeof prop !== 'string') {
            return undefined
          }
          // 返回值与旧 methodNotFound(name) 一致：消息调用后拿到原始值，
          // 值是函数也不二次调用（sendMessage 会对返回的包装函数 apply，
          // 包装函数在这里拿到 getScope 结果并原样返回）。
          return () => getScope(scope, prop)
        },
      })
      temp[scopeSymbol] = old
      return old
    }
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
