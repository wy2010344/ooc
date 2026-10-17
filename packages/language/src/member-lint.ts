// 对象成员书写检查：零参成员体只返回纯原始字面量时，必须写 '=' 常量绑定。
//
// 为什么是 error（语法层禁止）：
// - `name { 'x' }` / `name => 'x'` 编译成 prop getter，每次读取都执行一遍函数；
//   `name = 'x'` 是常量绑定（运行时 type:'bind'，惰性求值一次缓存）——纯字面量
//   改写成语义完全等价（值恒定、无副作用），且更省、意图更明确；
// - meta 反射契约是「call=事件、bind=常量」，常量成员写成方法体会让反射误判。
//
// 判定边界（全部满足才报）：
// - MethodAll（`{ }` 方法体与 `=>` 单行都算；`=` / `<=` 不查）；
// - 零参、无 rest、无泛型——带参成员无法改写成 '='，不禁；
// - 体是恰好一条语句、无 #guard/#else 分支；
// - 该语句是「无消息的 MessageOrChain + 纯原始字面量」（str/num/bool/nil）。
//   Pipling/Cast/Assignment/对象/lambda 一律不剥——`{ xs { [] } }` 之类每次读取
//   是**新引用**，改写成 '=' 会共享引用，语义变化，绝不能禁。
import type { ValidationAcceptor } from 'langium'
import type { Method } from './generated/ast.js'
import { extractMethodDefName } from './completion-type-utils.js'
import { diagnosticData } from './diagnostics-config.js'
import { literalOfExpression, literalToText } from './member-kind.js'

/** 零参成员只返回纯字面量 → error：改用 '=' 常量绑定 */
export function checkConstMethodBodies(
  methods: Method[],
  accept: ValidationAcceptor,
): void {
  for (const method of methods) {
    // 只查 MethodAll：`=` 是推荐写法本身，`<=` 是转发语义
    if (method.$type !== 'MethodAll') continue
    if (!method.body) continue // 签名方法（纯类型契约）
    if ((method.params?.length ?? 0) > 0 || method.restParam) continue
    if ((method.typeParams?.length ?? 0) > 0) continue
    const body = method.body
    if (body.guardBranches?.length || body.elseBranch) continue // 有分支逻辑
    const stmts = body.stmts ?? []
    if (stmts.length !== 1) continue // 多语句：不是「只返回常量」
    const lit = literalOfExpression(stmts[0])
    if (lit === undefined) continue
    const name = extractMethodDefName(method.name)
    if (!name) continue
    accept(
      'error',
      `零参成员 '${name}' 只返回常量，应使用 '=' 常量绑定：${name} = ${literalToText(lit)}`,
      {
        node: method,
        property: 'name',
        data: diagnosticData('constMethodBody'),
      },
    )
  }
}
