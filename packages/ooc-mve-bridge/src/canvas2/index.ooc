// canvas2 入口：每个组件都是一个 lambda 工厂，按需具名导入。
// 用法：`#import { rect, textNode, scrollBox, stage } './canvas2/index.ooc'`
//       `(rect $ {…} children…) ctx`
// 没有门面对象：组件不被包成 canvas2 的方法，扩展 / 替换都只改自己的文件。

#import { node2 } './node.ooc';
#import { rect } './rect.ooc';
#import { scrollBox } './scroll-box.ooc';
#import { stage } './stage.ooc';
#import { textNode } './text.ooc';
#import { editable } './editable.ooc';

{
    node = node2,
    rect = rect,
    scroll = scrollBox,
    stage = stage,
    text = textNode,
    editable = editable
}
