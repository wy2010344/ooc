// 矩形节点（对应 canvasRender2/RectNode.ts）。
// 绘制语义：背景铺满（含 padding 区），边框沿盒子外沿、线宽居中，radius > 0 走圆角。
// 装配三步：p = props + 矩形兜底；自有 draw 先画盒子，再把 p.draw 交给用户回调。

#import { fc, merge, drawRectBox } './host.ts';
#import { nodeDefaults } './messages.ooc';
#import { buildNode, rendererOf } './node.ooc';

// 矩形自己的参数消息兜底（纯字面量用 = 绑定，省一次惰性求值）
rectDefaults = {
    background = nil,
    borderColor = nil,
    borderWidth = 1,
    radius = 0,
    // 用户自己的绘制回调（默认什么都不画）
    draw(ctx2, node) { nil }
};

// 节点自有消息：先画盒子，再把用户 draw 当回调发出去（不判断有没有，兜底已给）
rectOwn = [p => {
    draw(ctx2, node) {
        drawRectBox $ {
            ctx2 = ctx2,
            w = (node width),
            h = (node height),
            bw = (p borderWidth),
            bg = (p background),
            bc = (p borderColor),
            r = (p radius)
        };
        p draw ctx2 node
    }
}];

// 矩形工厂：p 只喂自有 draw；节点消息仍是「props > 矩形兜底 > 基础兜底」
rect = fc $ [ctx, props, ...children =>
    p = merge $ props rectDefaults;
    node = buildNode $ {
        ctx = ctx,
        parent = (ctx getParent),
        strategy = (merge $ (rectOwn $ p) p nodeDefaults),
        props = props,
        children = children,
        renderer = (rendererOf $ ctx)
    };
    ctx addNode node;
    node
];

{ rect = rect, rectDefaults = rectDefaults }
