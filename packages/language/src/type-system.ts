import type { Type, TypeName } from './generated/ast.js'

/**
 * 静态类型表示。类型只是装饰，运行时完全忽略。
 */
export type TypeInfo =
  | { kind: 'any' }
  | { kind: 'name'; name: string }
  | { kind: 'union'; types: TypeInfo[] }
  | ObjectTypeInfo
  | { kind: 'function' }

export interface ObjectTypeInfo {
  kind: 'object'
  name?: string
  methods: Map<string, MethodSig[]>
}

export interface MethodSig {
  params: (TypeInfo | undefined)[]
  rest?: TypeInfo
  returns: TypeInfo
}

export const anyType: TypeInfo = { kind: 'any' }
export const nilType: TypeInfo = { kind: 'name', name: 'nil' }
export const numberType: TypeInfo = { kind: 'name', name: 'number' }
export const stringType: TypeInfo = { kind: 'name', name: 'string' }
export const booleanType: TypeInfo = { kind: 'name', name: 'boolean' }

const builtinMethod = (
  params: (TypeInfo | undefined)[],
  returns: TypeInfo,
  rest?: TypeInfo,
): MethodSig => ({ params, returns, rest })

// 内置基础类型的方法签名表（对应运行时 JS/numDef/objectDefine）
const builtinMethods: Record<string, Map<string, MethodSig[]>> = {
  number: new Map([
    ['+', [builtinMethod([numberType], numberType)]],
    ['-', [builtinMethod([numberType], numberType)]],
    ['*', [builtinMethod([numberType], numberType)]],
    ['//', [builtinMethod([numberType], numberType)]],
    ['%', [builtinMethod([numberType], numberType)]],
    ['>', [builtinMethod([numberType], booleanType)]],
    ['<', [builtinMethod([numberType], booleanType)]],
    ['>=', [builtinMethod([numberType], booleanType)]],
    ['<=', [builtinMethod([numberType], booleanType)]],
    ['==', [builtinMethod([anyType], booleanType)]],
    ['!=', [builtinMethod([anyType], booleanType)]],
    ['&&', [builtinMethod([anyType], anyType)]],
    ['||', [builtinMethod([anyType], anyType)]],
  ]),
  string: new Map([
    ['length', [builtinMethod([], numberType)]],
    ['+', [builtinMethod([anyType], stringType)]],
    ['==', [builtinMethod([anyType], booleanType)]],
    ['!=', [builtinMethod([anyType], booleanType)]],
  ]),
  boolean: new Map([
    ['==', [builtinMethod([anyType], booleanType)]],
    ['!=', [builtinMethod([anyType], booleanType)]],
    ['&&', [builtinMethod([anyType], booleanType)]],
    ['||', [builtinMethod([anyType], booleanType)]],
  ]),
  nil: new Map([
    ['==', [builtinMethod([anyType], booleanType)]],
    ['!=', [builtinMethod([anyType], booleanType)]],
    ['!!', [builtinMethod([], booleanType)]],
    ['~!', [builtinMethod([], booleanType)]],
  ]),
}

// 所有对象通用的方法（objectDefine 提供的）
const commonMethods: Map<string, MethodSig[]> = new Map([
  ['==', [builtinMethod([anyType], booleanType)]],
  ['!=', [builtinMethod([anyType], booleanType)]],
  ['&&', [builtinMethod([anyType], anyType)]],
  ['||', [builtinMethod([anyType], anyType)]],
  ['!!', [builtinMethod([], booleanType)]],
  ['~!', [builtinMethod([], booleanType)]],
])

export function getBuiltinMethods(typeName: string): Map<string, MethodSig[]> {
  const table = builtinMethods[typeName as 'number']
  if (table) {
    return new Map([...commonMethods, ...table])
  }
  return commonMethods
}

/**
 * 类型环境：与解释器相同的链式作用域。
 */
export class TypeEnv {
  private readonly values = new Map<string, TypeInfo>()

  constructor(private readonly parent: TypeEnv | undefined = undefined) {}

  define(name: string, type: TypeInfo): void {
    this.values.set(name, type)
  }

  lookup(name: string): TypeInfo | undefined {
    const found = this.values.get(name)
    if (found) {
      return found
    }
    return this.parent?.lookup(name)
  }

  child(): TypeEnv {
    return new TypeEnv(this)
  }
}

/**
 * 兼容性判断：a 是否能赋给 b。any 通吃，nil 严格。
 */
export function isSubtype(a: TypeInfo, b: TypeInfo): boolean {
  if (a.kind === 'any' || b.kind === 'any') {
    return true
  }
  if (a.kind === 'union') {
    return a.types.every((t) => isSubtype(t, b))
  }
  if (b.kind === 'union') {
    return b.types.some((t) => isSubtype(a, t))
  }
  if (a.kind === 'name' && b.kind === 'name') {
    if (a.name === b.name) {
      return true
    }
    if (a.name === 'nil') {
      return b.name === 'nil'
    }
    return false
  }
  if (a.kind === 'object' && b.kind === 'object') {
    for (const [name, bSigs] of b.methods) {
      const aSigs = a.methods.get(name)
      if (!aSigs || aSigs.length === 0) {
        return false
      }
      if (!bSigs.every((bSig) => aSigs.some((aSig) => sigCompatible(aSig, bSig)))) {
        return false
      }
    }
    return true
  }
  return false
}

/**
 * 方法签名兼容性：a 的方法能被当作 b 的方法使用。
 * 无注解的参数/返回即 any，天然兼容；参数协变，返回协变。
 */
function sigCompatible(a: MethodSig, b: MethodSig): boolean {
  if (!a.rest && b.params.length > a.params.length) {
    return false
  }
  for (let i = 0; i < b.params.length; i++) {
    const pa = i < a.params.length ? a.params[i] : a.rest
    if (!pa) {
      return false
    }
    if (!isSubtype(pa, b.params[i] ?? anyType)) {
      return false
    }
  }
  return isSubtype(a.returns, b.returns)
}

export function unionOf(types: TypeInfo[]): TypeInfo {
  const flat = types.flatMap((t) => (t.kind === 'union' ? t.types : [t]))
  if (flat.length === 1) {
    return flat[0]
  }
  return { kind: 'union', types: flat }
}

export function describeType(t: TypeInfo): string {
  switch (t.kind) {
    case 'any':
      return 'any'
    case 'name':
      return t.name
    case 'union':
      return t.types.map(describeType).join(' | ')
    case 'object':
      return t.name ?? '对象'
    case 'function':
      return '函数'
  }
}

export function typeNameToString(typeName: TypeName): string {
  if (typeof typeName.name === 'string') {
    return typeName.name
  }
  return typeName.name.value
}

export function typeToString(type: Type): string {
  return type.parts.map(typeNameToString).join(' | ')
}
