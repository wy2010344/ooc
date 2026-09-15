import type { DemoEntry } from './types.js'

/** 宿主桥接：调注入的全局对象做事（storage ref / loop repeat），不像旧 demo 依赖不存在的 ui/db */
export const host: DemoEntry = {
  name: '宿主.ooc',
  source: `// 借助注入的宿主对象做事（类似 Smalltalk）：
// storage ref 造可变引用（get/set）；loop repeat 定点循环；数组用 JS 生态的 Array
n = storage ref 0;
loop repeat 10 [x => n set ((n get) + x)];
n get
`,
}