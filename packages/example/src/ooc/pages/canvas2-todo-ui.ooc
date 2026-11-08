// canvas2 绘制小工具：只保留非文字类的基础图元（文字已交给 text 组件）。
#import { canvasDraw } '../bridge.ts';

// 圆角填充（canvasDraw.fillRound 无 node 参数）；参数多，统一走对象
paintRound = [op =>
    canvasDraw fillRound (op ctx2) (op x) (op y) (op w) (op h) (op r) (op color)
];

{ paintRound = paintRound }
