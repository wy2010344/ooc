import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node.js';
import {
  createObjectOrientedCServices,
  type TypeInfo,
  type MethodSig,
} from 'object-oriented-c-language';

/** 创建桥接对象类型映射，供 OOC 类型检查器识别宿主注入的全局对象 */
function createBridgeGlobalsTypes(): Map<string, TypeInfo> {
  const t = <T extends TypeInfo>(x: T): T => x
  const m = (params: (TypeInfo | undefined)[], returns: TypeInfo, rest?: TypeInfo): MethodSig => ({ params, returns, rest })
  const any_: TypeInfo = { kind: 'any' }
  const num: TypeInfo = { kind: 'name', name: 'number' }

  const dcomp: TypeInfo = t({ kind: 'function' })
  const textApply: MethodSig = m([any_], dcomp)
  const forEachApply: MethodSig = m([any_], dcomp)
  const fcApply: MethodSig = m([], dcomp, any_)

  const ref: TypeInfo = t({ kind: 'object', name: 'Ref', methods: new Map([
    ['get', [m([], any_)]],
    ['set', [m([any_], any_)]],
  ]) })

  const types = new Map<string, TypeInfo>()

  // storage / js / ObjectValue
  types.set('storage', t({ kind: 'object', name: 'storage', methods: new Map([
    ['ref', [m([any_], ref)]],
  ]) }))
  types.set('js', t({ kind: 'object', name: 'js', methods: new Map([
    ['new', [m([], any_, any_)]],
    ['send', [m([any_, any_], any_, any_)]],
  ]) }))
  types.set('ObjectValue', t({ kind: 'object', name: 'ObjectValue', methods: new Map([
    ['metaOf', [m([any_], any_)]],
  ]) }))

  // dom / text / html / fc / forEach
  types.set('dom', t({ kind: 'object', name: 'dom', methods: new Map() }))
  types.set('text', t({ kind: 'object', name: 'text', methods: new Map([['apply', [textApply]]]) }))
  types.set('html', t({ kind: 'object', name: 'html', methods: new Map([['apply', [textApply]]]) }))
  types.set('fc', t({ kind: 'object', name: 'fc', methods: new Map([['apply', [fcApply]]]) }))
  types.set('forEach', t({ kind: 'object', name: 'forEach', methods: new Map([['apply', [forEachApply]]]) }))

  // 响应式信号
  types.set('createSignal', t({ kind: 'object', name: 'createSignal', methods: new Map([['apply', [m([any_], any_)]]]) }))
  types.set('memo', t({ kind: 'object', name: 'memo', methods: new Map([['apply', [m([any_], any_)]]]) }))
  types.set('addEffect', t({ kind: 'function' }))
  types.set('createContext', t({ kind: 'function' }))

  // Array（globalThis）
  types.set('Array', t({ kind: 'object', name: 'Array', methods: new Map([
    ['of', [m([], any_, any_)]],
    ['at', [m([num], any_)]],
    ['forEach', [m([any_], any_)]],
    ['filter', [m([any_], any_)]],
    ['map', [m([any_], any_)]],
    ['length', [m([], num)]],
    ['toSpliced', [m([num, num], any_, any_)]],
  ]) }))

  // console / Date
  types.set('console', t({ kind: 'object', name: 'console', methods: new Map([
    ['log', [m([], any_, any_)]],
  ]) }))
  types.set('Date', t({ kind: 'object', name: 'Date', methods: new Map([
    ['now', [m([], num)]],
  ]) }))

  return types
}

// Create a connection to the client
const connection = createConnection(ProposedFeatures.all);

// Inject the shared services and language-specific services, with bridge types for type checking
const { shared } = createObjectOrientedCServices(
  { connection, ...NodeFileSystem },
  undefined,
  createBridgeGlobalsTypes(),
);

// Start the language server with the shared services
startLanguageServer(shared);
