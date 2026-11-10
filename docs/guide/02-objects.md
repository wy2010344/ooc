# 02 对象与方法

## 定义对象

```ooc
calc = {
    add(a, b) => a + b,      // 单表达式方法
    sub(a, b) { a - b },     // 方法体，最后一行是返回值
    cached = 1 + 2,          // 计算绑定：惰性求值，首次读取时算一次并缓存
    lazy = @{                // 多语句绑定块：用 @{ 引导（与对象字面量 { } 区分）
        a = 1;
        b = 2;
        a + b                // 最后一条是值
    }
};
```

## 绑定与多语句块

`name = 表达式`：**纯字面量**（str/num/bool/nil）在构造期直接写值；**计算式**是惰性绑定——首次读取这个名字时求值，结果缓存，之后再读不重算。所以绑定可以引用后面才定义的成员，也只会算一次。

需要多条语句时，用 `@{ ... }` 块（块内可用分号分隔多条语句、局部赋值，最后一条是值）：

```ooc
config = {
    base = 10,
    area = @{
        r = this radius;
        r * r * 3.14
    },
    radius => (this base) div 5
};
config area        // → 12.56
```

`@{` 引导是必需的——`name = { ... }` 只能解析为对象字面量，两者不混。

## 成员形状：绑定与方法

成员按形状分流（消息写法不变，都是空格发消息）：

- **常量绑定 `name = 值`**：**纯字面量**（str/num/bool/nil）编译成数据属性——构造期写值一次，`obj name` 恒定返回；**计算式**（含 `@{ }` 块）是惰性 getter——首次读取求值一次并缓存，之后不重算。绑定可以引用后面才定义的成员。绑定是**只读**的：`obj name x` 不会改写它（可变状态用宿主容器）。
- **方法 `name(...) => ...` / `name(...) { ... }`**：编译成带内部标记的数据函数，**每次发消息时执行**。零参成员（`kind { shapeName }`、`radius => side * 2`）同样是方法——`obj radius` 发消息才执行；事件/跟随信号用 `=>`，每次读取重算。

**纯字面量常量必须直接写绑定**（`kind = 'circle'`）：写成 `{ 'circle' }` / `=> 'circle'` 会被 validator 以 `constMethodBody` 报错——字面量恒定，绑定一次写值更省。

方法体返回 lambda 时，读取（发消息）拿到 lambda 本体（不会被隐式执行），要调用再显式 `$`：

```ooc
obj = { handler => [x => x + 1] };
h = obj handler;      // 发消息执行方法体，h 是返回的 lambda 本体
h $ 41                // 42
```

JS 侧对应形状：字面量绑定是数据属性（`.x` 直读值），计算绑定是 getter（`.x` 读取即求值、函数值原样返回），方法是函数（`.f(args)` 调用；零参方法 `.m()` 调用才执行）。

## 转发属性

`name <= delegate` 把**名字上的所有消息**原样转发给 `delegate` 的 `$` 执行（消息名不传给 `$`，只传实参）：

<!-- ooc-check: warning — 末行是故意的运行时错误演示，只要求不出现语法错误 -->
```ooc
double = { $(v) => v * 2 };
box = { value <= double };

box value 21;    // 42（→ double $ 21）
box value;       // undefined（→ double $，无参）
box value 1 2    // 2：实参按 $ 的形参位置匹配，多出的第二个被忽略（类型检查给参数数量告警）
```

- 委托对象必须含 `$`（像 lambda 或可调用对象）；没有时类型检查会报错。
- 名字唯一：`<=` 转发与同名 `=` / 方法体不能共存（重复定义报 `duplicateMethod`）。
- 实例/模块级可变状态不靠属性写入，改用宿主容器（`storage ref`、signal、数组等）。

## 对象展开

`...base` 把 `base` 的自有可枚举属性并入当前对象，按书写顺序后者覆盖前者（与 JS 对象展开一致）：

```ooc
base = { a = 1, b = 2, double(x) => x * 2 };
obj = { ...base, b = 9, c = 3 };

obj a;          // 1
obj b;          // 9（后写覆盖）
obj c;          // 3
obj double 4    // 8（展开的方法照常可调用）
```

- 展开可出现在任意位置（`{ a = 1, ...base }` 时 `base` 覆盖 `a`）。
- 读取源对象的属性值（计算绑定在展开时求值一次），`nil` / 数字等非对象值被忽略（`{...nil}` 即 `{}`）。
- 简洁对象字面量里不允许重复定义同名成员；展开与显式成员同名是覆盖，不算重复。

### 展开与 `this`（里氏替换）

展开会把来源对象的**方法（函数值）**复制过来，而方法调用时的 `this` 是**新对象**；计算绑定则是在展开时按来源对象的 `this` 求值一次、作为普通值复制，不随新对象重算。

因此新对象要在结构上可替代来源对象：类型检查会对被覆盖的同名成员做**子类型兼容检查**（实参/返回形状），不兼容时给 `spreadOverrideMismatch` warning，例如：

<!-- ooc-check: warning — 故意演示 n 从 number 覆盖成 string 的 warn -->
```ooc
base = { n = 1, double { this n * 2 } };
obj = { ...base, n = 'hi' };    // warning：n 从 number 变成 string
```

但这只是静态的**结构**检查。行为层面的里氏替换（成员间不变量、来源方法依赖的类型之外的约定、外部状态等）无法静态保证——来源方法里的 `this` 访问现在落到新对象上，是否仍成立需要作者自己保证。只想要数据合并、不想带方法时，用纯数据对象或显式写出需要的成员。

## this

方法体内 `this` 指向触发消息的对象（receiver）：

```ooc
calc = {
    cached = 5,
    inc(n) { this cached + n }
};
calc inc 3       // 8
```

`this` 后面跟的是**一条消息**，不是一条消息链：`this base div 5` 会被解析成「给 `this` 发 `base`，实参是
`div` 和 `5`」。取到成员后还想继续发消息，要加括号 `(this base) div 5`，或走级联 `this base / div 5`。

## 剩余参数

```ooc
obj = { $(a, ...rest) { rest } };
obj $ 1 2 3 4        // [2, 3, 4]
```

## 动态消息名（Object send）

消息名通常写在源码里，静态上完全可见。少数场景（事件转发、按配置查表）需要**运行时拼出来的名字**，这时用 `Object` 的专属消息 `send`：

```ooc
obj = { k = 42, add(a, b) => a + b };
Object send obj 'add' 1 2;     // 3
Object send obj 'k'            // 42（属性也按名字分发）
```

只有 `Object` 响应 `send`：动态派发是「关于消息」的操作，不属于对象自身的能力，所以 `obj send 'add' 1 2` 会抛「没有定义该方法 send」。实参列表可以整个作为唯一数组传进来（`Object send obj 'add' (Array of 1 2)`），便于把 `rest` 原样转发。

代价要说清：消息名一旦是运行时值，补全、悬停、跳转都退化为 unknown，类型检查也不参与——这条路是给「静态分析帮不上」的场景留的。

## 消息具象化（union / Object dispatch）

把对象能消化的消息看成一组联合 `(add, a, b) | (tag) | …`，方法名就是判别标识。有时你想**先把一条消息存下来**，稍后再交给某个对象处理——这就是 `union` 与 `Object dispatch`：

```ooc
calc = { add(a, b) { a + b } };
msg = union add 1 2;          // ['add', 1, 2]
Object dispatch calc msg;     // 3
Object send calc 'add' 1 2    // 3（原有写法不变）
```

`union` 是内建的通用构造器：向它发**任何**消息都返回一个普通数组元组 `[消息名, ...实参]`，自己不执行业务。元组不带接收者，可以存进信号、转发给别处、或稍后回放；`Object dispatch 对象 元组` 把它交回对象，走的仍是完整派发链（包括 `merge` 委托与「没有定义该方法」的出口）。元组首项必须是字符串，否则抛 `TypeError`。

消解不复用 `send` 这个名字是有原因的：`Object send` 把「唯一的数组实参」当成完整实参列表，方便转发 `rest`；而 `dispatch` 必须**逐字**回放元组，否则 `union echo (Array of 1 2)` 里那个数组实参会被摊成两个。两种语义不挤在一个消息名下，`Object send` 原样保留。

元组就是普通数组，所以手写的 `Array of 'add' 1 2` 一样能 `dispatch`。`union` 的名字集合是开放的，静态侧不枚举它（未知消息按 `any` 推定）；把它放进 `merge` 链会吞掉后继层，只适合放在链尾当消息记录器。

`union` 和 `storage` / `js` / `merge` 一样是宿主注入的内建全局：CLI 与 playground 的解释器路径直接可用；编译成 ES 模块（Vite / `ooc build`）时是自由标识符，需要在 `.ooc` 里显式 `#import { union } '.../bridge.ts'`（本仓库的 `example/src/ooc/bridge.ts` 已 re-export）。`Object dispatch` 属于运行时消息，不需要任何 import。

## 作用域作为消息中心（currentScope）

解释器把「当前作用域链」也包成了一个普通对象 `currentScope`：它能应答的消息就是链上可见的绑定名，消息名同样是判别标识。带实参的消息不会被引擎丢掉，而是**把实参原样作为 `$` 消息发给绑定值**：

```ooc
f = [a, b => a + b];
o = { $(x, y) { x + y } };
currentScope f 1 2;          // 3，等同于 f $ 1 2
currentScope o 3 4;          // 7，等同于 o $ 3 4
currentScope f               // 零实参＝读绑定，返回 lambda 本体，不调用
```

不带实参是「读绑定」：返回原始值，即使它是函数也不二次调用（想调用就接着写 `$`，如上例的 `f $ 1 2`）。名字没绑定则是一次 `unhandled` 应答：单独发送时抛「没有定义该方法」，放进 `merge` 链就会转交后继层：

```ooc
p = currentScope;
fb = { fallback(n) { n * 10 } };
m = merge $ p fb;
m fallback 7                 // 70：p 弃权，交给 fb
```

`currentScope` 与 `merge` 共用同一条消息路由链，所以弃权、命中即停、内建协议和结构化错误都一致；它也不是「隐式兜底」，只是第一层的名字恰好来自作用域。

> 只在解释器路径可用：那里的作用域是可查询的链，编译成 ES 模块后绑定就是真实 JS 词法变量，没有可反射的作用域对象。所以它没有列入项目 `config.ooc` 的 `globals`，Vite / `ooc build` 工程里引用会被构建期未定义引用检查拦下。`currentScope then` / `toJSON` / `constructor` 这类 JS 协议探针与原型名直通 Proxy，不按绑定名查找。

## 守卫 #guard

方法体用 `#guard` 分支链组织，就是 if / else-if / else：逐条 `#guard 条件; 语句`，条件为真就执行该段并返回；全不命中落入 `#else; 语句`（无 `#else` 返回 nil）。`#guard` 不参与消息派发——一个名字只有一个成员，没有同名重载。`#guard` 之前的语句**先执行**（赋值进作用域、表达式求值），之后才进入分支判别——条件与分支都能引用它们。

```ooc
f = {
    r(a) {
        #guard a > 5;
        'big'
        #guard a < 0;
        'neg'
        #else;
        'small'
    }
};
f r 9;         // 'big'
f r 2;         // 'small'
neg = 0 - 1;
f r neg        // 'neg'
```

> **没有一元负号**：`-1` 不是字面量，`f r -1` 会被解析成 `(f r) - 1`，静默得到 `NaN`。
> 负数写成 `0 - 1` 或先绑定再传。

`#guard` 前的语句对条件与分支可见：

```ooc
g = {
    r(a) {
        t = a * 2;
        #guard t > 10;
        t + 1
        #else;
        t
    }
};
g r 8;    // 17（t = 16，条件成立）
g r 3     // 6（t = 6，落入 else）
```

## 签名方法（TS 式签名类型标注）

方法可以不写 body：**签名方法**只在类型层声明「参数类型 → 返回类型」，运行时是纯契约（不烧录任何行为，调用点按签名做参数化分派）：

```ooc
calc = {
    area(radius: number): number,   // 签名（成员之间用 , 分隔，和普通方法一致）
    area(radius: string): string,   // 签名
    area(r) {                       // 实现（运行时按名字落到唯一实现）
        r
    }
};
```

- 调用点按签名推断返回类型：`calc area 3` → `number`，`calc area 'x'` → `string`。
- 签名方法之间返回类型不同**不告警**（TS 式豁免）；实现方法体与声明不符才告警。
- **签名方法必须有返回类型**（既无 body 又无返回类型会报错）；**无参方法不写括号**（`f()` 是语法错误，写 `f` 即可）。

## 委托组合 merge

OOC **没有继承**。复用与兜底交给 `merge` 委托（宿主端 `merge` 全局，调用形式 `merge $ overrides defaults`）：overrides 的方法优先，未知消息按 defaults 顺序查找。**命中即停**——某一层定义了该成员就由该层负责，即使方法返回 `nil` / `undefined` 也不再向后查；只有这一层没有这个成员、或该层显式返回 `merge unhandled` 弃权，才继续委托。对象被当作消息处理中心：方法名是消息联合类型的判别标识，「没有这个分支」与「显式弃权」在应答代数里都是同一个 `unhandled`，链的循环只有一个判据。

同名成员的覆盖同样受里氏替换约束：覆盖层必须能当作兜底层使用（参数不能收窄、返回不能放宽），不兼容时给 `mergeOverrideMismatch` warning。引擎只按兜底层的契约发消息，覆盖层签名对不上时运行时可能失效。

```ooc
defaults = { speak = 'voice', bark = 'wang' };
spec = { fly = 'fly' };
w = merge $ spec defaults;

w fly;     // 'fly'（spec 自有）
w speak    // 'voice'（转给 defaults）
```

spec 与 defaults 同名时 spec 优先：

```ooc
defaults = { speak = 'voice' };
spec2 = { speak = 'wang' };
w2 = merge $ spec2 defaults;
w2 speak   // 'wang'
```

`merge $` 的产物也是包装对象，可以再次拼进新链（`e = merge $ c d`），
已组合的链在组装期展平，原对象（spec/defaults）只读不写，可被多个包装安全共享。

### 显式弃权

链上任意一层（普通方法、数据成员、`js proxy` 的 handler）都能显式说「这条我不接」：返回 `merge unhandled`，委托链就继续查下一层。哨兵是唯一单例，只认严格相等——`nil` / `undefined` / `false` 都是正常应答，照旧命中即停。

```ooc
defaults = { speak = 'voice' };
spec = { speak = merge unhandled };
w = merge $ spec defaults;
w speak    // 'voice'（spec 显式弃权，透传给 defaults）
```

弃权是**返回值**而不是异常：方法抛出的真错误会原样冒出，不会被链吞成兜底。也因此普通方法在弃权之前已经产生的副作用不会回滚，弃权判断要写在方法体最前面（`#guard` 判别天然在语句之前）。`async` 方法返回的 Promise 在同步派发里看不到，弃权只在同步路径生效，不会为此把整条链改成异步。`js proxy` 的 handler 若没写弃权、直接返回 `undefined`，也按「这条我不接」处理——否则代理对任何名字都应答，会把后面的兜底对象全部吃掉；要返回「空但已处理」请显式返回 `nil`。

链的**最后一个后继是内建协议**（`+` / `||` / `if` / `include` …）。它从前藏在派发函数尾部，导致 `merge` 包装反而收不到这些消息；挂进链后包装与单对象结果一致，用户层同名成员仍可覆盖它。全链（含内建协议）都没接，出口才抛一次 `OocMethodNotFoundError`——解释器与编译产物抛的是同一个结构化错误（`receiver` / `methodName` / `argumentsList`）。桥接的 `sendTo` 是严格派发，同样会抛；只有 `trySendTo` 是能力查询，压根没人认领时返回 `undefined` 让宿主默认值生效（用于读可选钩子与值成员）。

`respondsTo` / 补全 / 桥接的 `hasMessage` 仍是按名字的**静态**能力查询，回答「有没有人可能接」，不预知运行时弃权，也不保证最终由谁应答。Proxy 不会为 `then` / `toJSON` / `includes` / `has` 这类 JS 协议探针伪造消息方法，避免 Promise、序列化与容器判定绕回消息链。

注意：`merge unhandled` 目前仍是一等值，可以被绑定、传参、参与表达式；语言缺省仍是「单对象未定义即抛」，只有进入 `merge` 链才把「没定义」当作 `unhandled`。把弃权收成只在路由上下文存在的控制标记，需要专门的语法符号与求值边界。

## 嵌套对象

```ooc
outer = { inner = { value = 42 } };
outer inner / value    // 42
```

`outer inner` 取到 inner 对象，`/ value` 继续给它发消息。
