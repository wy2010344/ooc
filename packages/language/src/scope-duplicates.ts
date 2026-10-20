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
 *  - 方法体：类型参数 + 参数 + 方法体语句（#guard / #else 分支不另开作用域）
 *  - 绑定块 @{ ... }
 *  - lambda 体
 * 对象成员名唯一性由 validator 的 checkMemberNameUniqueness 单独负责。
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
  for (const branch of body.guardBranches) {
    for (const stmt of branch.stmts) {
      declareStatement(scope, stmt)
    }
  }
  for (const stmt of body.elseBranch?.stmts ?? []) {
    declareStatement(scope, stmt)
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

/** 语句只在赋值时引入绑定 */
function declareStatement(scope: ScopeReporter, stmt: AstNode): void {
  if (isAssignment(stmt)) {
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
