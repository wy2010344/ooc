import { KVPair } from 'wy-helper'

export interface RootScope {
  get(key: string): any
}

export type Scope = KVPair<any> | undefined

export function addScope(scope: Scope, key: string, value: any) {
  return new KVPair(key, value, scope)
}

export function getScope(scope: Scope, key: string) {
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
    if (key in global) {
      return global[key as 'Object']
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
