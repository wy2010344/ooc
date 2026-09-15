import type { DemoEntry } from './types.js'

/** hello：基础语法——注释、顶层语句用 ; 分隔、字符串方法 */
export const hello: DemoEntry = {
  name: 'hello.ooc',
  source: `// OOC 记事本：像记事一样写代码，点"运行"看结果
// 注意：// 是注释，不是除法；除法写 12 div 3

msg = 'hello ooc';
msg / toUpperCase
`,
}