// ===== 统一导入示例集 =====
// 本文件演示 OOC 的所有导入特性与浏览器 API 调用

// ===== 1. 模块整体导入 =====
// 导入整个 math.ooc 模块，返回带方法的对象
math = #import 'math';
sum = math add 2 3;
doubled = math double sum;

// ===== 2. 选择性导入类型 =====
// 从 typedef.ooc 导入 Point 类型用于类型注解
typedefs = #import 'typedef' { Point, Dog };

// 使用导入的类型定义变量
p: Point = {
    x = 3,
    y = 4,
    dist() { (this x) * (this x) + (this y) * (this y) }
};

// ===== 3. 本地类型定义 =====
// 在当前文件中定义的类型
Color #type { r: number, g: number, b: number };
Shape #type { area(): number, name(): string };

// ===== 4. 使用本地类型 =====
red: Color = { r = 255, g = 0, b = 0 };
green: Color = { r = 0, g = 255, b = 0 };

// ===== 5. 浏览器 API 调用 =====
// 通过 JS 桥接访问浏览器全局对象

// 5.1 window.alert 弹窗
// 注意：仅在浏览器环境可用，Node.js 会报错
showAlert = js fn [msg -> window alert msg];

// 5.2 document 操作
// 获取文档标题
docTitle = js fn [] -> document title;

// 5.3 计算并返回结果
calcInfo = {
    description() {
        'Point at (' + (p x) + ', ' + (p y) + ') dist=' + (p dist)
    }
};

// ===== 6. 空对象示例 =====
// 空对象 {} 现在被语法支持，可共享单例
emptyObj = {};

// ===== 7. 导入后组合使用 =====
// 用导入的模块方法 + 本地类型 + 浏览器 API
circleArea = {
    calc(radius: number) {
        // 用 Math.PI 和乘法计算圆面积
        Math PI * radius * radius
    }
};

// 最终返回所有示例结果
{
    // 模块导入结果
    sum = sum,
    doubled = doubled,

    // 类型导入使用
    pointX = p x,
    pointY = p y,

    // 本地类型
    redR = red r,
    greenG = green g,

    // 浏览器 API
    // alertResult = showAlert apply 'Hello from OOC!',
    // title = docTitle apply,

    // 空对象
    empty = emptyObj,

    // 组合计算
    area = circleArea calc 5
}