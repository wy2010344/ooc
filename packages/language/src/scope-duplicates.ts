import { AstUtils } from 'langium'
import type { AstNode, ValidationAcceptor } from 'langium'
import {
  isAssignment,
  isBindBlock,
  isImportStatement,
  isLambdaDef,
  isMethodAll,
  isMethodBody,
  isTypeDef,
} from './generated/ast.js'
import type { MethodBody, Model } from './generated/ast.js'
import { diagnosticData } from './diagnostics-config.js'

/**
 * 同层作用域内不允许同名重新声明（所有绑定都按 const 处理），包括顶层。
 * 作用域只有四层：
 *  - 模块顶层：#import 绑定 / #type 名 / 顶层赋值
 *  - 方法体：类型参数 + 参数 + 方法体语句；每个 #guard / #else 分支是独立子作用域
 *  - 绑定块 @{ ... }
 *  - lambda 体
 * 对象成员名唯一性由 validator 的 checkMemberNameUniqueness 单独负责。
 *
 * 自引用只检查立即求值的 RHS；lambda / 对象方法 / 绑定体要等到调用或读取时
 * 才执行，此时外层绑定已经初始化，属于合法闭包（如 `f = [f]`）。
 */
export function checkScopeDuplicates(model: Model, accept: ValidationAcceptor): void {
  checkTopLevel(model, accept)
  for (const node of AstUtils.streamAst(model)) {
    if (isMethodBody(node)) {
      checkMethodScope(node, accept)
      continue
    }
    if (isBindBlock(node)) {
      const scope = new ScopeReporter(accept)
      for (const stmt of node.bindStmts) {
        declareStatement(scope, stmt)
      }
      continue
    }
    if (isLambdaDef(node)) {
      const scope = new ScopeReporter(accept)
      reserveParams(scope, node)
      for (const stmt of node.expressions) {
        declareStatement(scope, stmt)
      }
      // 与对象方法一致：#guard / #else 分支各自是独立块作用域。
      for (const branch of node.guardBranches) {
        const branchScope = new ScopeReporter(accept)
        for (const stmt of branch.stmts) {
          declareStatement(branchScope, stmt)
        }
      }
      if (node.elseBranch) {
        const elseScope = new ScopeReporter(accept)
        for (const stmt of node.elseBranch.stmts) {
          declareStatement(elseScope, stmt)
        }
      }
    }
  }
}

/** 顶层：导入绑定、#type 名、顶层赋值共用一层作用域 */
function checkTopLevel(model: Model, accept: ValidationAcceptor): void {
  const scope = new ScopeReporter(accept)
  for (const stmt of model.expressions) {
    if (isImportStatement(stmt)) {
      // 默认导入（x = #import 'p'）
      scope.declare(stmt.name, stmt)
      // 命名导入 / 类型导入：别名优先，无别名为原名
      for (const item of stmt.named?.items ?? []) {
        scope.declare(item.alias ?? item.name, item, item.alias ? 'alias' : 'name')
      }
      for (const item of stmt.types?.items ?? []) {
        scope.declare(item.alias ?? item.name, item, item.alias ? 'alias' : 'name')
      }
      continue
    }
    if (isTypeDef(stmt)) {
      scope.declare(stmt.name, stmt)
      continue
    }
    declareStatement(scope, stmt)
  }
}

/** 方法体：类型参数 + 参数 + 语句（含 #guard / #else 分支，全部算同一层） */
function checkMethodScope(body: MethodBody, accept: ValidationAcceptor): void {
  const method = body.$container
  if (!isMethodAll(method)) {
    return
  }
  const scope = new ScopeReporter(accept)
  // 参数重名由 checkParamDuplicates 单独报告，这里先占位：
  // 类型参数/方法体与参数同名仍按重复声明报出
  reserveParams(scope, method)
  for (const param of method.typeParams) {
    scope.declare(param.name, param)
  }
  for (const stmt of body.stmts) {
    declareStatement(scope, stmt)
  }
  // 每个分支是独立块作用域：分支之间允许同名，分支内仍禁止重复
  for (const branch of body.guardBranches) {
    const branchScope = new ScopeReporter(accept)
    for (const stmt of branch.stmts) {
      declareStatement(branchScope, stmt)
    }
  }
  if (body.elseBranch) {
    const elseScope = new ScopeReporter(accept)
    for (const stmt of body.elseBranch.stmts) {
      declareStatement(elseScope, stmt)
    }
  }
}

/** 参数重名由 checkParamDuplicates 单独报告，这里只占位 */
function reserveParams(
  scope: ScopeReporter,
  owner: { params: Array<{ name: string }>; restParam?: { name: string } | null },
): void {
  for (const param of owner.params) {
    scope.reserve(param.name)
  }
  scope.reserve(owner.restParam?.name)
}

/**
 * RHS 是否直接引用了 name。
 *
 * 只检查立即求值的部分：lambda、对象方法、绑定体都要等到调用/读取时才执行，
 * `a = [a]` 与 `const a = () => a` 一样，调用时外层 a 已经初始化，是合法闭包。
 * 只有 `a = a + 1` 这类直接读取才判自引用。
 */
function referencesName(node: AstNode | undefined, name: string): boolean {
  if (!node) return false
  if (
    isLambdaDef(node) ||
    isMethodAll(node) ||
    isBindBlock(node) ||
    node.$type === 'MethodBind' ||
    node.$type === 'MethodBindMutable' ||
    node.$type === 'ObjectDef'
  ) {
    return false
  }
  // 消息名、对象成员名也是 Ref 节点，但不是变量引用；不要向下遍历
  if (node.$type === 'MethodCallName' || node.$type === 'MethodDefName') {
    return false
  }
  if (node.$type === 'Ref') {
    const parent: any = node.$container
    if (parent && parent.name === node) return false
    return (node as any).value === name
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue
    if (Array.isArray(value)) {
      if (value.some((v) => v && typeof v === 'object' && referencesName(v as AstNode, name))) {
        return true
      }
    } else if (value && typeof value === 'object') {
      if (referencesName(value as AstNode, name)) return true
    }
  }
  return false
}

/** 语句只在赋值时引入绑定；`x = x + 1` 这类自引用直接判非法（不再做 __v 兼容）。 */
function declareStatement(scope: ScopeReporter, stmt: AstNode): void {
  if (isAssignment(stmt)) {
    if (referencesName(stmt.expression, stmt.name)) {
      scope.reportSelfReference(stmt.name, stmt)
    }
    scope.declare(stmt.name, stmt)
  }
}

/** 单个作用域的已绑定名字集合 */
class ScopeReporter {
  private readonly seen = new Set<string>()

  constructor(private readonly accept: ValidationAcceptor) {}

  reserve(name: string | undefined): void {
    if (name) {
      this.seen.add(name)
    }
  }

  /** 自引用声明：`x = x + 1` 在 JS 里是 TDZ，OOC 直接判非法。 */
  reportSelfReference(name: string, node: AstNode): void {
    this.accept('error', `'${name}' 的初始化引用了自身：不允许同名遮蔽，请换一个新名字`, {
      node,
      property: 'name',
      data: diagnosticData('duplicateDeclaration'),
    })
  }

  declare(name: string | undefined, node: AstNode, property?: string): void {
    if (!name) {
      return
    }
    if (this.seen.has(name)) {
      this.accept('error', `'${name}' 已经声明过了：同层作用域不允许重复声明`, {
        node,
        property,
        data: diagnosticData('duplicateDeclaration'),
      })
      return
    }
    this.seen.add(name)
  }
}
