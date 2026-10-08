import { EmptyFileSystem } from 'langium'
import type { LangiumCoreServices } from 'langium'
import {
  coreBridgeGlobals,
  createObjectOrientedCServices,
  loadGlobalsTypesFromSource,
  type TypeInfo,
} from 'object-oriented-c-language'
import { createBridgeGlobalsTypes } from 'ooc-mve-bridge'

/**
 * playground 宿主全局类型（Route A）：由各宿主包自持的 .ooc 类型源合并而来。
 * - language 内置：storage / js / delegate / ObjectValue
 * - ooc-mve-bridge：dom / text / html / fc / forEach
 * - 项目本地：createSignal / memo / addEffect / createContext / console
 *   （运行时来自 wy-helper / mve-core；Array/Date 等 globalThis 直发消息不列名）
 */
export const EXTRA_HOST_SOURCE = `// playground 本地宿主类型源（响应式原语与 console）
// 运行时实现来自 wy-helper / mve-core，这里只声明类型。
Signal #type {
    get(): any,
    set(value): any,
    update(fn): any
};

createSignal = {
    apply(initial): Signal
};

memo = {
    apply(fn): any
};

addEffect = {
    apply(fn): any
};

createContext = {
    apply(...args): any
};

console = {
    log(...args): any,
    error(...args): any
};

config = {
    globals = {
        createSignal = createSignal,
        memo = memo,
        addEffect = addEffect,
        createContext = createContext,
        console = console
    }
};

config
`

/**
 * 把各宿主包类型源合并成一份全局类型 Map 注入引擎类型检查。
 * 可传已有 services 复用同一棵服务树（否则自建一份读专用服务）。
 */
export function buildEngineGlobals(
  services?: LangiumCoreServices,
): Map<string, TypeInfo> {
  const svc =
    services ?? createObjectOrientedCServices(EmptyFileSystem).ObjectOrientedC
  const out = new Map<string, TypeInfo>()
  const parts = [
    coreBridgeGlobals(svc),
    createBridgeGlobalsTypes(svc),
    loadGlobalsTypesFromSource(EXTRA_HOST_SOURCE, svc),
  ]
  for (const part of parts) {
    if (part) {
      for (const [name, type] of part) {
        out.set(name, type)
      }
    }
  }
  return out
}