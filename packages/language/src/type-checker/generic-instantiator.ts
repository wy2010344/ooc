import {
  anyType,
  describeType,
  isSubtype,
  unionOf,
  type MethodSig,
  type ObjectTypeInfo,
  type TypeInfo,
} from '../type-system.js'

/**
 * 泛型实例化：把模板中的类型参数占位（{kind:'name', name:T}）递归替换为实参。
 */
export function instantiate(
  t: TypeInfo,
  params: string[],
  args: TypeInfo[],
): TypeInfo {
  switch (t.kind) {
    case 'name': {
      const idx = params.indexOf(t.name)
      return idx >= 0 ? args[idx] : t
    }
    case 'union':
      return unionOf(t.types.map((x) => instantiate(x, params, args)))
    case 'object': {
      const methods = new Map<string, MethodSig[]>()
      for (const [name, sigs] of t.methods) {
        methods.set(
          name,
          sigs.map((s) => ({
            params: s.params.map((p) =>
              p ? instantiate(p, params, args) : undefined,
            ),
            rest: s.rest ? instantiate(s.rest, params, args) : undefined,
            returns: instantiate(s.returns, params, args),
            typeParams: s.typeParams,
          })),
        )
      }
      if (t.extendsType) {
        const parent = instantiate(t.extendsType, params, args)
        if (parent.kind === 'object') {
          for (const [k, v] of parent.methods) {
            if (!methods.has(k)) {
              methods.set(k, v)
            }
          }
          return {
            kind: 'object',
            name: t.name,
            methods,
            parent: parent.name ?? describeType(parent),
            extendsType: parent,
          }
        }
        if (parent.kind === 'union') {
          const branches = parent.types.map((m) => {
            if (m.kind !== 'object') {
              return m
            }
            const branch: ObjectTypeInfo = {
              kind: 'object',
              name: t.name,
              methods: new Map(m.methods),
            }
            for (const [k, sigs] of methods) {
              branch.methods.set(k, sigs)
            }
            branch.parent = m.name ?? describeType(m)
            return branch
          })
          return unionOf(branches)
        }
        return {
          kind: 'object',
          name: t.name,
          methods,
          parent: describeType(parent),
          extendsType: parent,
        }
      }
      return { kind: 'object', name: t.name, methods }
    }
    default:
      return t
  }
}

/**
 * 用显式类型参数实例化方法签名（调用方显式标注 <T1, T2>）。
 * 与 instantiateGenericSig 不同，此方法直接用给定的类型实参替换占位符，不做推断。
 */
export function instantiateSigWithExplicitArgs(
  sig: MethodSig,
  explicitArgs: TypeInfo[],
): MethodSig {
  const typeParams = sig.typeParams!
  return {
    params: sig.params.map((p) =>
      p ? instantiate(p, typeParams, explicitArgs) : undefined,
    ),
    rest: sig.rest ? instantiate(sig.rest, typeParams, explicitArgs) : undefined,
    returns: instantiate(sig.returns, typeParams, explicitArgs),
  }
}

/**
 * 方法泛型实例化：（调用方视角）从实参类型推断签名里的占位类型参数。
 * 顶层占位参数直接绑定实参类型；占位也可能嵌在对象类型里（如 `Box<T>` 的
 * `value(): T`），此时从实参对象的对应方法签名递归反推；无法由实参推断出
 * 的占位按 any 处理（“未声明又不能推断，退回 any”）。
 */
export function instantiateGenericSig(
  sig: MethodSig,
  args: TypeInfo[],
): MethodSig {
  const typeParams = sig.typeParams!
  const mapping = new Map<string, TypeInfo>()
  for (let i = 0; i < sig.params.length && i < args.length; i++) {
    const p = sig.params[i]
    if (p) {
      inferTypeParams(p, args[i], typeParams, mapping)
    }
  }
  if (sig.rest) {
    const restArgs = args.slice(sig.params.length)
    if (restArgs.length > 0) {
      inferTypeParams(sig.rest, unionOf(restArgs), typeParams, mapping)
    }
  }
  const types = typeParams.map((t) => mapping.get(t) ?? anyType)
  return {
    params: sig.params.map((p) =>
      p ? instantiate(p, typeParams, types) : undefined,
    ),
    rest: sig.rest ? instantiate(sig.rest, typeParams, types) : undefined,
    returns: instantiate(sig.returns, typeParams, types),
  }
}

/**
 * 从实参类型反推占位类型参数（支持嵌套，如 `Box<T>`）。
 * pattern 是签名声明的类型（含占位），actual 是实参的推断类型；
 * 对象模式逐方法签名匹配，占位出现在参数/返回类型里时递归收集。
 */
export function inferTypeParams(
  pattern: TypeInfo,
  actual: TypeInfo,
  typeParams: string[],
  mapping: Map<string, TypeInfo>,
): void {
  switch (pattern.kind) {
    case 'name':
      if (typeParams.includes(pattern.name)) {
        const prev = mapping.get(pattern.name)
        mapping.set(
          pattern.name,
          prev ? unionOf([prev, actual]) : actual,
        )
      }
      return
    case 'object': {
      if (actual.kind !== 'object') {
        return
      }
      for (const [name, pSigs] of pattern.methods) {
        const aSigs = actual.methods.get(name)
        if (!aSigs || aSigs.length === 0) {
          continue
        }
        const pSig = pSigs[0]
        const aSig = aSigs[0]
        if (!pSig || !aSig) {
          continue
        }
        for (
          let i = 0;
          i < pSig.params.length && i < aSig.params.length;
          i++
        ) {
          const pp = pSig.params[i]
          const ap = aSig.params[i]
          if (pp && ap) {
            inferTypeParams(pp, ap, typeParams, mapping)
          }
        }
        if (pSig.rest) {
          inferTypeParams(
            pSig.rest,
            aSig.rest ?? anyType,
            typeParams,
            mapping,
          )
        }
        inferTypeParams(
          pSig.returns,
          aSig.returns,
          typeParams,
          mapping,
        )
      }
      return
    }
    case 'union':
      for (const sub of pattern.types) {
        inferTypeParams(sub, actual, typeParams, mapping)
      }
      return
    default:
      return
  }
}

export function argsCompatible(sig: MethodSig, args: TypeInfo[]): boolean {
  const { params, rest } = sig
  if (rest) {
    if (args.length < params.length) {
      return false
    }
    for (let i = 0; i < params.length; i++) {
      if (!argOk(args[i], params[i])) {
        return false
      }
    }
    const restArgs = args.slice(params.length)
    if (restArgs.length > 0 && !restArgs.every((a) => argOk(a, rest))) {
      return false
    }
    return true
  }
  if (args.length > params.length) {
    return false
  }
  for (let i = 0; i < args.length; i++) {
    if (!argOk(args[i], params[i])) {
      return false
    }
  }
  return true
}

function argOk(arg: TypeInfo, param: TypeInfo | undefined): boolean {
  if (!param || param.kind === 'any' || arg.kind === 'any') {
    return true
  }
  return isSubtype(arg, param)
}