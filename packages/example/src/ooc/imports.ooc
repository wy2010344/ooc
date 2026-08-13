// ===== 跨文件类型导入 =====
// 从 math.ooc 导入模块（返回带方法的对象）
math = #import 'math';
result = math add 2 3;

// ===== 从 typedef.ooc 导入类型（IDE 校验时自动关联） =====
// 注意：#import 加载的是模块（值），类型定义在同文件或导入文件中均可
// 这里演示在本文件中新定义类型 + 导入值的组合

// 本地类型定义
Color #type { r: number, g: number, b: number };
red: Color = { r = 255, g = 0, b = 0 };

// 导入 math 模块的计算结果
{
    mathResult = result,
    red = red
}