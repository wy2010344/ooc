// STRING 终结符的自定义词法匹配。
//
// 正则做不到「洞内可以再出现单引号」的配对：`'… ${when $ v '' 'hidden'}'` 在第一个
// 未转义 `'` 处就收尾，后面整段源码被切碎（表现为 `hidden is not defined` 之类的怪错）。
// 模版跟 JS 的 `` ` `` 模版是同一套语义、只是引号换成单引号，所以边界该由能感知 `${}`
// 深度的扫描器决定。自定义 matcher 与 splitTemplate 共用 template.ts 里的同一份规则。
import { DefaultTokenBuilder, type GrammarAST } from 'langium'
import type { TokenType } from 'chevrotain'
import { scanQuotedString } from './template.js'

export class ObjectOrientedCTokenBuilder extends DefaultTokenBuilder {
  protected override buildTerminalToken(
    terminal: GrammarAST.TerminalRule,
  ): TokenType {
    if (terminal.name !== 'STRING') {
      return super.buildTerminalToken(terminal)
    }
    return {
      name: 'STRING',
      // 返回 [匹配到的原文]；收尾位置由扫描器给出（-1 表示这一段不是合法字符串）
      PATTERN: (text: string, offset: number) => {
        const end = scanQuotedString(text, offset)
        return end < 0 ? null : ([text.slice(offset, end)] as [string])
      },
      LINE_BREAKS: true,
    }
  }
}
