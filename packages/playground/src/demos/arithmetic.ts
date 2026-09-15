import type { DemoEntry } from './types.js'

/** 算术：运算符无优先级、左结合；/ 级联；div 除法 */
export const arithmetic: DemoEntry = {
  name: '算术.ooc',
  source: `// 运算符无优先级，左结合；顶层语句用 ; 分隔
// / 是级联（结果继续发消息），除法用 div：12 div 3
1 + 2 * 3;      // (1+2)*3 = 9
(1 + 2) * 3;    // 9
12 div 3;       // 4
7 % 3           // 1
`,
}