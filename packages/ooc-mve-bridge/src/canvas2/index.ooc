// canvas2 入口：每个组件都是一个 lambda 工厂，按需具名导入。
// 用法：`#import { rect, textNode, scrollBox, stage } './canvas2/index.ooc'`
//       `(rect $ {…} children…) ctx`
//
// `#import {…}` 绑定的是本文件的顶层声明（含下面的 #import 转发），
// 所以具名导入必须用组件本名；末尾对象只是默认导出的镜像，键名保持一致，
// 避免 `textNode` / `text`、`scrollBox` / `scroll` 两套名字并存。

#import { node2 } './node.ooc';
#import { rect } './rect.ooc';
#import { scrollBox } './scroll-box.ooc';
#import { stage } './stage.ooc';
#import { textNode } './text.ooc';
#import { editable } './editable.ooc';

{
    node2 = node2,
    rect = rect,
    scrollBox = scrollBox,
    stage = stage,
    textNode = textNode,
    editable = editable
}
