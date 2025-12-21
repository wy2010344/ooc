# Object-Oriented C (OOC) 语言设计文档

## 核心理念

OOC 是一门受 JavaScript 启发的简化对象消息传递语言。它移除了 JavaScript 的类、函数、原型等复杂概念，采用纯粹的**消息发送 + 管道处理 + 闭包共享**的三层设计。

**三大核心特性：**

1. **消息发送**：只有对象和方法，没有函数调用
2. **管道处理**：使用 `/` 和 `|` 进行链式操作和数据流转
3. **闭包共享**：通过闭包环境替代对象字段，实现数据共享

---

## 基础概念

### 变量与赋值

```js
ab = 9;      // 常量赋值（类似 const），值不可重新赋值
bc := 99;    // 可变赋值（类似 let），值可重新赋值
```

**特点：**

- 没有对象字段，只有闭包中的变量
- 两种赋值方式在对象方法内部和模块中都适用

---

## 对象定义与方法

### 基础方法定义

```js
abc = {
  // 标准方法：接收参数，执行多条语句，最后一条语句返回值
  bb(a, b) {
    f = b add 5;      // 常量赋值
    a sub f           // 最后一条语句作为返回值（可选分号）
  },

  // 无参方法：可访问闭包变量 ab
  aa {
    98 add ab
  },

  // 单语句糖衣：参数写在 => 右边
  af(a, b) => a sub b,

  // 无参单语句糖衣
  gc => ab add bc,

  // 缓存赋值：第一次调用后缓存结果，后续返回缓存值，每次都是无参方法调用。
  abc = ab sub bc,

  // 可变赋值示例：修改闭包变量 bc
  am(z) => bc =: z
};
```

**方法特性：**

- 对象内不存放字段，只有方法
- 无 `this` 概念，通过闭包访问外部变量
- 支持参数、无参、单语句等多种糖衣语法
- `=` 修饰的方法只执行一次（缓存机制）

---

## 消息发送与管道

### 1. 普通消息链（`/` 中缀）

类似 JavaScript 链式调用：`obj.method(a).method(b)` 转换为消息形式

```js
// 等价于：'abcdef'.slice(1, 4).slice(1, 3)
'abcdef' slice 1 4 / slice 1 3;
```

- 左边的结果接收消息 `slice 1 3`
- `/` 是中缀符号，用来连接消息链

### 2. 参数代入（`|` 中缀）

将左边表达式的结果作为右边消息的**第一个参数**

```js
// 等价于：1 add ('abcdef' length)
'abcdef' length | 1 add;

// 即：先计算 'abcdef' length，结果作为 1 add 的第一个参数
// result = 'abcdef' length
// 1 add result
```

### 3. 表达式代入（`|` + `.`）

当 `|` 右边是 `x . expression` 形式时，左边结果绑定为 `x`，代入表达式中

```js
// 将左边结果绑定为 x，代入右边表达式
'abcdef' length | x . 1 add x;

// 即：
// x = 'abcdef' length
// 1 add x
```

**管道特性：**

- `/` 和 `|` 平级，可混合使用
- 管道是语言的核心特性，让数据流清晰可见
- 替代了传统的函数调用和临时变量

---

## 模块系统

模块即文件，导出多个方法供外部调用。导入时，模块以对象的形式存在。

### 模块定义

```js
// 导入另一个模块
import ab 'abc';

// 模块级别的变量
bc := 9;

// 方法定义（与对象方法类似）

// 标准方法导出
export af(f, g) {
  z = f add 89;
  f add z | ab call
};

// 无参单语句糖衣导出
export zz => bc;

// 缓存导出：始终返回第一次计算的值
export am = bc;
```

### 模块的使用

导入模块后，通过消息发送调用导出的方法：

```js
import math 'math';

// 向 math 模块发送消息 add，传入参数 5 和 3
math add 5 3;

// 与对象方法调用完全相同
```

**模块特性：**

- 一个文件一个模块
- 导出的方法即模块对外的接口
- 导入得到对象，用消息发送调用方法
- 模块级变量可被方法访问（闭包）

---

## 基础类型

### 字符串

- 只支持单引号
- 字符串是对象，支持消息发送

```js
'abcdef' length;     // 获取长度
'abcdef' slice 1 4;  // 截取
```

### 布尔值

```js
true
false
```

### 数字

```js
9
99
3.14
```

### 空

只有 nil，类似 js 的 null/undefined.

### 枚举/联合类型

使用 `$` 作为特殊对象，构建枚举值

```js
// 构建枚举值
$ success 8 7
$ error 87

// 模式匹配
union call data {
  success(a, b) {
    // data 是 $ success a b 的形式
  },
  error(value) {
    // data 是 $ error value 的形式
  }
}
```

---

## 控制流

### 条件语句（`#if...#else`）

`#if` 是宏消息，可用于语句和表达式上下文

```js
// 作为表达式
ab = #if(x largeThan b) a #else b;

// 作为语句
zb = #if(x largeThan b) {
  a add b
} #else {
  b sub c
};
```

### 循环语句（`#while`）

```js
#while(condition) {
  // 语句体
  // 可包含 #return 提前返回
}
```

### 提前返回（`#return`）

```js
fun(a, c, d) {
  #if (a) {
    #return          // 无值返回
  }
  #if (c) {
    #return 99       // 返回指定值
  }
  // 剩余语句
}
```

---

## 异步与异常

### 异步方法

使用 `#async` 宏将方法标记为异步，使用 `#await` 展开 Promise

```js
abc = {
  abc(xx) #async {
    import of 'abc' | #await
  }
}
```

**流程：**

1. `import of 'abc'` 向 import 对象发送 `of` 消息，获得 Promise
2. `#await` 在异步方法中展开这个 Promise，等待其完成
3. 方法返回最终值

### 异常处理

使用逗号分割的赋值捕获异常

```js
// 左边是异常，右边是值
exception, value = x send y;

// 也适用于可变赋值
exc, val := x send y;
```

**语义：**

- 表达式执行可能产生异常和值
- 异常被绑定到左边，值被绑定到右边
- 如果无异常，左边绑定为空/null

---

## 语法约定

### 注释

```js
// 单行注释（类似 JavaScript）
/**
 * 多行注释
 */
```

### 运算符

- **消息发送**：`object message arg1 arg2 ...`
- **管道链接**：`expr / message` 或 `expr | expression`
- **赋值**：`var = value`（常量）或 `var := value`（可变）
- **可变赋值**：`var =: value`（在表达式右边使用）

### 无 `+-*/` 支持

- 不支持算术运算符 `+`, `-`, `*`, `/`
- 使用消息发送替代：`a add b`, `a sub b`
- 方法名必须是标识符（ID）

---

## 设计总结

| 特性     | OOC                        | JavaScript         |
| -------- | -------------------------- | ------------------ |
| 基本单位 | 对象 + 消息                | 函数 + 对象        |
| 字段存储 | 闭包环境                   | 对象属性           |
| 方法调用 | 消息发送                   | 函数调用           |
| 数据流   | 管道（`/`, `\|`）          | 临时变量或链式调用 |
| 继承     | 无                         | 原型链/Class       |
| 异步     | `#async`/`#await`          | async/await        |
| 控制流   | `#if`, `#while`, `#return` | if, while, return  |

---

## 示例：完整程序

```js
// 模块：counter.ooc
count := 0;

export increment() {
  count =: count add 1
};

export decrement() {
  count =: count sub 1
};

export current => count;

// 主程序：main.ooc
import counter 'counter';

counter increment;
counter increment;
counter increment | x . counter decrement / x;  // (increment twice, then decrement once)
counter current;  // 返回 2
```

---

## 核心优势

1. **简洁性**：无类、无函数、无复杂原型机制
2. **一致性**：对象方法、模块方法、控制流都遵循统一的消息发送范式
3. **可读性**：管道操作让数据流清晰可见，避免深度嵌套
4. **可追溯性**：闭包替代字段，变量修改更显式
5. **异步友好**：原生支持异步操作和异常处理
