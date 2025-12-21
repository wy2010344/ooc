这在个 langium 中，我想实现这样一门语言。

没有函数与调用，只有对象定义与向对象发送消息。

# 定义对象

```js
//类似js中 const ab=9
ab = 9;
//类似js中 let bc = 99
bc := 99;
//定义一个对象abc
abc={
  //最基础的方法定义形式，接受两个参数a b，花括号里多条语句，以`;`分割，最后一条语句返回，可以不加`;`
  bb(a,b){
    //类似于js中const f=b.add(5)
    f = b add 5;
    a sub f
  },
  //语法糖，没有参数，访问了闭包上的常量ab
  aa{
    98 add ab
  },
  //语法糖，如果body只有一条语句，可以这样简写，注意，对象下key是不能重复的，这里只是举例
  af(a,b) => a sub b,
  //语法糖叠加，无参且为单条语句
  gc => ab add bc,
  //语法糖， 返回ab call cd的结果(只执行一次，下次执行abc返回缓存的结果)
  abc = ab sub bc,
  // 这里主要演示赋值，使用`=:`符号，赋值给闭包变量bc
  am(z) => bc =: z
};

//pipline方法，类似js中 'abcdef'.slice(1,4).slice(1,3)
'abcdef' slice 1 4 / slice 1 3;


//使用|，将左边的结果，放进右边消息的第一个参数参数，其结果类似于 1 add ('abcdef' length)
'abcdef' length | 1 add;

//pipline进阶, 如果右边的表达式类似于 `x . balabala`，则是将左边结果命名为x，代入点右的表达式中执行
'abcdef' length | x . 1 add x;


```

对象上不能存放字段，没有 this，没有继承。

共享的字段放在闭包环境中。

不支持`+-*/`，目前只有 ID 作为方法名。

即`/`与`|`是一种中缀符号，而且它们是平级的。`|`右边的表达式，如果中以`.`为中缀的表达式，则是命名代入。

## 如果在模块中：

```js

import ab 'abc';

//类似js中let bc = 9
bc:=9;

//最基础的方法定义
export af(f,g){
  z = f add 89;
  f add z | ab call
};

//无参+单条语句的语法糖,返回bc的最新值
export zz => bc;

//始终返回第一次的值
export am = bc;

```

模块是导出多个方法，模块以对象的方式发送消息来调用。

这里 export 都是模块的方法，与对象的方法定义很类似。

## 异步

```js

abc={
 abc(xx)#async{
   import of 'abc' | #await
 }
}
```

通过这个`#async`将消息 abc 变成异步方法。特殊的`#await`宏消息是展开 promise。`import of 'abc'`是动态导入模块，意义即是向 import 对象发送 of 消息，传递'abc'这个路径参数，此时得到 promise 对象。

即向这个 promise 对象发送 `#await` 消息，在异步方法中展开这个 promise

## 异常

```js
ab,bc = x send y

```

当`=`与`:=`左边是逗号分割时，逗号左边是异常，右边是值。

## 提前返回的

```js
abc = {
  fun(a, c, d) {
    #if (a) {
      #return
    }
    #if (c) {
      #return 99
    }
    //剩下语句
  },
}
```

用#if 宏与#return 提前返回

## 基础类型

字符串 'abc' 只支持单引号。

布尔 true/false

数字 类似 js

枚举联合， 向`$`发送消息，类似`$ success 8 7`，`$ error 87`

可通过

```js
union call data {
  success(a,b){
    //data为 $ success a b
  },
  error(value){
    //data为 $ error
  }
}
```

## 空

只有 nil，类似 js 的 null/undefined.

来执行

## 注释

类似 js

## 条件/循环语言

有`#if...#else`宏，类似 js 的 if...else，且如果作为表达式，也是返回内部的

```js

ab=#if(x largeThan b)a #else b;
zb=#if(x largeThan b){
  a add b
}#else{
  b sub c
};
```

### while 语句

```js
#while(...){
  //语句，可以包含#return
}

```

使用#while 宏，与 js 中的 while 类似
