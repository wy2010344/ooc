import type { AstNode, ValidationAcceptor } from 'langium'
import {
  isAssignment,
  isBindBlock,
  isCastExpression,
  isLambdaDef,
  isMessage,
  isMethodAll,
  isMethodBind,
  isMethodBindMutable,
  isObjectDef,
  isRef,
} from './generated/ast.js'
import type {
  Assignment,
  BindBlock,
  LambdaDef,
  MethodAll,
  MethodBind,
  MethodBindMutable,
  Model,
  Ref,
} from './generated/ast.js'
import { diagnosticData } from './diagnostics-config.js'
import { holeDocOffset } from './template-offsets.js'

/**
 * 同作用域内的暂时性死区（TDZ）检查：直接引用出现在声明之前时报错。
 *
 * JS 的 let/const 在同一块内声明前不可访问；OOC 的所有绑定都是 const，
 * 因此 `x = y; y = 1` 和 `fun { y; y = 1 }` 都应报错。
 *
 * 作用域边界与方法/lambda/绑定块一致。函数体、lambda 体、绑定块属于
 * 延迟执行体：它们内部可以引用外层稍后声明的名字（闭包），所以不向
 * 上跨过这些边界检查；但边界内部自己的声明仍然检查。
 */
export function checkTemporalDeadZone(model: Model, accept: ValidationAcceptor): void {
  const top = new TdzScope()
  for (const stmt of model.expressions) {
    if (isAssignment(stmt)) top.declare(stmt)
  }
  for (const stmt of model.expressions) {
    if (isAssignment(stmt)) {
      walkExpression(stmt.expression, top, stmt, accept)
    } else if (!isImportOrType(stmt)) {
      walkExpression(stmt, top, undefined, accept)
    }
  }
}

/** #import / #type 不是运行时赋值，不参与 TDZ 顺序判断 */
function isImportOrType(node: AstNode): boolean {
  return node.$type === 'ImportStatement' || node.$type === 'TypeDef'
}

interface Declaration {
  offset: number
  node?: AstNode
}

/** TDZ 作用域：parent 为 undefined 表示函数/lambda/绑定块边界 */
class TdzScope {
  readonly declarations = new Map<string, Declaration>()

  constructor(readonly parent?: TdzScope) {}

  /** 记录一条赋值声明；同名重复声明由 scope-duplicates 负责报告 */
  declare(stmt: Assignment): void {
    const name = stmt.name
    if (!name || this.declarations.has(name)) return
    this.declarations.set(name, {
      offset: stmt.$cstNode?.offset ?? 0,
      node: stmt,
    })
  }

  /** 参数在函数体执行前已初始化，用 -1 表示不会触发 TDZ */
  reserve(name: string | undefined): void {
    if (name && !this.declarations.has(name)) {
      this.declarations.set(name, { offset: -1 })
    }
  }
}

function walkStatements(
  statements: readonly AstNode[],
  scope: TdzScope,
  accept: ValidationAcceptor,
): void {
  for (const stmt of statements) {
    if (isAssignment(stmt)) {
      walkExpression(stmt.expression, scope, stmt, accept)
    } else {
      walkExpression(stmt, scope, undefined, accept)
    }
  }
}

function walkExpression(
  node: AstNode | undefined,
  scope: TdzScope,
  self: Assignment | undefined,
  accept: ValidationAcceptor,
): void {
  if (!node) return

  if (isRef(node)) {
    checkRef(node, scope, self, accept)
    return
  }
  if (isLambdaDef(node)) {
    walkLambda(node, accept)
    return
  }
  if (isMethodAll(node)) {
    walkMethod(node, accept)
    return
  }
  if (isMethodBind(node) || isMethodBindMutable(node)) {
    walkMethodBind(node, accept)
    return
  }
  if (isBindBlock(node)) {
    walkBindBlock(node, accept)
    return
  }
  if (isObjectDef(node)) {
    // 对象成员值的初始化不执行方法体，逐个按方法/lambda 边界处理
    for (const method of node.methods) {
      walkExpression(method, scope, undefined, accept)
    }
    return
  }
  if (isMessage(node)) {
    // 消息名也是 Ref 节点，但它不是变量引用；只检查实参
    for (const arg of node.args) {
      walkExpression(arg.value, scope, self, accept)
    }
    return
  }
  if (isCastExpression(node)) {
    walkExpression(node.expression, scope, self, accept)
    return
  }
  // 方法名/类型名等不参与变量 TDZ
  if (node.$type === 'MethodCallName' || node.$type === 'MethodDefName') {
    return
  }

  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue
    if (key === 'name' || key === 'infix') continue
    // 类型注解里不是值引用
    if (key === 'typeAnnotation' || key === 'returnType' || key === 'typeArgs') continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) walkExpression(item, scope, self, accept)
      }
    } else if (isAstNode(value)) {
      walkExpression(value, scope, self, accept)
    }
  }
}

/** 方法体：参数已初始化，方法体语句与各分支分别建立作用域 */
function walkMethod(method: MethodAll, accept: ValidationAcceptor): void {
  const scope = new TdzScope()
  reserveParams(scope, method)
  if (!method.body) return

  const body = method.body
  for (const stmt of body.stmts) {
    if (isAssignment(stmt)) scope.declare(stmt)
  }
  walkStatements(body.stmts, scope, accept)

  for (const branch of body.guardBranches) {
    const branchScope = new TdzScope(scope)
    for (const stmt of branch.stmts) {
      if (isAssignment(stmt)) branchScope.declare(stmt)
    }
    walkExpression(branch.guardExpression, branchScope, undefined, accept)
    walkStatements(branch.stmts, branchScope, accept)
  }

  if (body.elseBranch) {
    const elseScope = new TdzScope(scope)
    for (const stmt of body.elseBranch.stmts) {
      if (isAssignment(stmt)) elseScope.declare(stmt)
    }
    walkStatements(body.elseBranch.stmts, elseScope, accept)
  }
}

/** lambda 体：参数已初始化，体语句按顺序声明 */
function walkLambda(lambda: LambdaDef, accept: ValidationAcceptor): void {
  const scope = new TdzScope()
  reserveParams(scope, lambda)
  for (const stmt of lambda.expressions) {
    if (isAssignment(stmt)) scope.declare(stmt)
  }
  walkStatements(lambda.expressions, scope, accept)

  for (const branch of lambda.guardBranches) {
    const branchScope = new TdzScope(scope)
    for (const stmt of branch.stmts) {
      if (isAssignment(stmt)) branchScope.declare(stmt)
    }
    walkExpression(branch.guardExpression, branchScope, undefined, accept)
    walkStatements(branch.stmts, branchScope, accept)
  }

  if (lambda.elseBranch) {
    const elseScope = new TdzScope(scope)
    for (const stmt of lambda.elseBranch.stmts) {
      if (isAssignment(stmt)) elseScope.declare(stmt)
    }
    walkStatements(lambda.elseBranch.stmts, elseScope, accept)
  }
}

/** 绑定块：延迟执行，内部自成一作用域 */
function walkBindBlock(block: BindBlock, accept: ValidationAcceptor): void {
  const scope = new TdzScope()
  for (const stmt of block.bindStmts) {
    if (isAssignment(stmt)) scope.declare(stmt)
  }
  walkStatements(block.bindStmts, scope, accept)
}

/** 方法绑定体（get = ...）：延迟执行，不检查外层声明顺序 */
function walkMethodBind(method: MethodBind | MethodBindMutable, accept: ValidationAcceptor): void {
  const body = method.bindBody
  if (!body) return
  if (isBindBlock(body)) {
    walkBindBlock(body, accept)
    return
  }
  // 单表达式绑定体是一个暴露给调用方的只读数据函数
  const scope = new TdzScope()
  walkExpression(body.expression, scope, undefined, accept)
}

function reserveParams(
  scope: TdzScope,
  owner: { params: Array<{ name: string }>; restParam?: { name: string } | null },
): void {
  for (const param of owner.params) scope.reserve(param.name)
  scope.reserve(owner.restParam?.name)
}

/** 沿作用域链解析引用；找到声明后比较源码位置 */
function checkRef(
  ref: Ref,
  scope: TdzScope,
  self: Assignment | undefined,
  accept: ValidationAcceptor,
): void {
  for (let current: TdzScope | undefined = scope; current; current = current.parent) {
    const declaration = current.declarations.get(ref.value)
    if (!declaration) continue
    // 自引用已由 scope-duplicates 报告，避免同级重复报错
    if (declaration.node === self) return
    // 模板洞内的子 AST 使用洞源码的相对偏移，需换算回文档绝对偏移，
    // 否则洞内引用会被误判成位于文首（声明之前）。
    const refOffset = holeDocOffset(ref) ?? ref.$cstNode?.offset ?? 0
    if (declaration.offset > refOffset) {
      accept(
        'error',
        `'${ref.value}' 在声明之前被使用（暂时性死区）；请把声明移到使用之前`,
        {
          node: ref,
          property: 'value',
          data: diagnosticData('temporalDeadZone'),
        },
      )
    }
    return
  }
}

function isAstNode(value: unknown): value is AstNode {
  return !!value && typeof value === 'object' && typeof (value as AstNode).$type === 'string'
}
