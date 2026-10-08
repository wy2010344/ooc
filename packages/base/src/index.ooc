// index.ooc —— base 包入口（#import '@base'）
// 聚合导出标准库工具，最外层对象即包导出值。
// 子模块也可单独引用：base/loop.ooc 经 #import '@base/loop'。
{
    loop = #import './loop'
}