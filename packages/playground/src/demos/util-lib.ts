import type { DemoEntry } from './types.js'

/** 工具库：被其它 demo `#import` 复用。导出值=模块最后一条表达式，所以返回对象 */
export const utilLib: DemoEntry = {
  name: '工具库.ooc',
  source: `// 工具库：被其它笔记 #import 复用。
// #import 的导出值 = 本模块最后一条表达式，所以这里把函数装进对象再作为最后一行。
// 被导入的笔记必须已存在（播种时一起放上）；临时改改这里 → 所有导入方立即用到新实现。
loop = #import 'loop';
math = {
    // 累加 1..n 的和。t = ... 在循环里是“新建绑定”不会改外层 t，
    // 可变累加必须用 storage ref（get/set 改的是引用里的值）
    sum(n) { t = storage ref 0; loop repeat n [i => t set ((t get) + i + 1)]; t get },
    // 偶偶/奇奇分类，演示方法参数与返回值
    parity(x) => x % 2 == 0 && 'even' || 'odd'
};
math
`,
}