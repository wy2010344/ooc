import { EmptyFileSystem } from 'langium'
import type { LangiumCoreServices } from 'langium'
import { createObjectOrientedCServices } from './object-oriented-c-module.js'
import type { ObjectOrientedCServices } from './object-oriented-c-module.js'
import { collectConfigGlobalsFromText } from './diagnostics-config.js'
import type { TypeInfo } from './type-system.js'

/**
 * Route A：宿主包自持 .ooc 类型源（相当于 TS 的 lib.d.ts），loader 把类型源
 * 文本解析成 Map<name, TypeInfo>，供 LSP / CLI / playground 注入为全局类型。
 *
 * 类型源与 config.ooc 的 globals 段同构：最后一条表达式是
 * `config = { globals = { 名字 = 名字, ... } }`，各名字在本文件顶层声明形状。
 * 复用 collectConfigGlobals 管线解析，不引入新的解析路径。
 */

/** 语言内置桥接的类型源：storage / js / ObjectValue / delegate（运行时实现见 interpreter/bridges.ts） */
export const coreBridgeTypesSource = `// 语言内置桥接类型源（storage / js / ObjectValue / delegate）
// 运行时实现见 interpreter/bridges.ts，这里只声明类型（签名方法不落地）。
Ref #type {
    get(): any,
    set(value): any
};

storage = {
    ref(initial): Ref
};

js = {
    new(...args): any,
    send(receiver, name, ...args): any,
    proxy(obj, handler): any,
    throw(message): any
};

delegate = {
    withDefault(...all): any
};

ObjectValue = {
    metaOf(value): any
};

config = {
    globals = {
        storage = storage,
        js = js,
        delegate = delegate,
        ObjectValue = ObjectValue
    }
};

config
`

/** 模块级共享的默认服务（仅在调用方不传 services 时启用，只读用法，无共享状态污染） */
let defaultServices: ObjectOrientedCServices | undefined

function loadServices(): ObjectOrientedCServices {
  defaultServices ??= createObjectOrientedCServices(EmptyFileSystem).ObjectOrientedC
  return defaultServices
}

/**
 * 从 .ooc 类型源文本解析全局类型 Map（Route A loader）。
 * 复用 config.ooc 的 collectConfigGlobals 管线：解析 Model → 收集最后一条
 * 表达式的 globals 成员。可传已有 services 复用同一套解析器/校验器。
 */
export function loadGlobalsTypesFromSource(
  source: string,
  services?: LangiumCoreServices,
): Map<string, TypeInfo> | undefined {
  return collectConfigGlobalsFromText(source, services ?? loadServices())
}

/** 语言内置桥接类型（storage/js/ObjectValue）的快捷 loader */
export function coreBridgeGlobals(
  services?: LangiumCoreServices,
): Map<string, TypeInfo> | undefined {
  return loadGlobalsTypesFromSource(coreBridgeTypesSource, services)
}