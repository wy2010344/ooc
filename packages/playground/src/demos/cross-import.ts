import type { DemoEntry } from './types.js'

/** 跨笔记导入：演示 #import 复用其它笔记（工具库.ooc），播种/测试共用 */
export const crossImport: DemoEntry = {
  name: '跨笔记导入.ooc',
  // 依赖 工具库.ooc，播种时两者都要存在，否则 #import 解析失败
  source: `// 跨笔记导入：笔记天然是 .ooc 模块，#import 其它笔记按名复用。
// 需先存在「工具库.ooc」（播种时一并有）；导出值=该模块最后一条表达式。
m = #import '工具库.ooc';
m parity 7;          // 7 % 2 != 0 → 'odd'
m sum 4              // 1+2+3+4 = 10
`,
}