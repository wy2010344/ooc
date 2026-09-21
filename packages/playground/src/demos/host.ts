import type { DemoEntry } from './types.js'

/** 宿主桥接 + OOC 标准库：storage ref 造可变引用；循环用 base 包的 loop（#import 'loop'） */
export const host: DemoEntry = {
  name: '宿主.ooc',
  source: `// 借助注入的宿主对象做事（类似 Smalltalk）：
// storage ref 造可变引用（get/set）；loop（base 包）#import 复用，定点循环；数组用 JS 生态的 Array
loop = #import 'loop';
n = storage ref 0;
loop repeat 10 [x => n set ((n get) + x)];
n get
`,
}