这在个 langium 中，我想实现这样一门语言。

没有函数与调用，只有对象定义与向对象发送消息。

定义对象

```
//类似js中 const ab=9
ab=9;
//类似js中 let bc = 99
bc:=99;
//定义一个对象abc
abc={
 //方法aa，返回98
 aa{
  98
 }
 //方法bb，接受两个参数a b，方法体里，向a发送消息sub，参数为b
 bb(a b){
  a sub b
 }
 //或者可以简写成，注意，对象下key是不能重复的，这里只是举例
 bc(a b):a sub b,
 //单行方法，表达式,每次调用gc，都会执行ab add bc
 gc:ab add bc,
 //方法abc，返回ab call cd的结果(只执行一次)
 abc=ab sub bc,
 //直接返回作用域上的bc的简写
 bc,
 //ef方法接受参数ff，赋值于作用于上了bc
 ef(ff):bc=:ff,
 //或者可以简写成
 ef:=bc
};

//pipline方法，类似js中 'abcdef'.slice(1,4).slice(1,3)
'abcdef' slice 1 4 | slice 1 3;


//pipline进阶, 如果右边的表达式类似于 `x . balabala`，则是将左边结果命名为x，代入点后的表达式中执行
'abcdef' length | x . 1 add x;

//使用|>，将左边的结果，放进右边消息的参数1，其结果类似于 1 add ('abcdef' length)
'abcdef' length |> 1 add;

```

对象上不能存放字段，没有 this，没有继承。

共享的字段放在闭包环境中。

不支持`+-*/`，目前只有 ID 作为方法名。

如果在模块中：

```

import ab 'abc'


bc:=9;

export af(f g){
 f add g |> ab call
};

export am=9;

export zz:=bc;
```

模块是导出多个方法，模块以对象的方式发送消息来调用。

## 异步

```

abc={
 abc(xx)@{
   import of 'abc' @await
 }
}
```

通过这个 @ 将消息变成异步方法。特殊的@await 消息是展开 promise。import of 'abc'是动态导入模块。

## 基础类型

字符串 'abc' 只支持单引号。

布尔 true/false

数字 类似 js

枚举联合， 向`$`发送消息，类似`$ success 8 7`，`$ error 87`

可通过

```
union call data {
  success(a b){
    //data为 $ success a b
  }
  error(value){
    //data为 $ error
  }
}
```

来执行

## 注释

类似 js

## 条件/循环语言

没有 js 中那种条件循环语句，通过向对象发送消息来实现，如

```

//类似于js中 a||b?8:9
a or b | cond 8 9;

//这里是根据a||b的结果，去执行这个匿名对象的分支
a or b | condWith {
 true: a and b,
 false: a xor b
};

//向while对象发送do消息，类似js中while(a||b){}
while do {
 cond: a or b,
 body{
 //循环体
 }
}//

```

像 smalltalk 就没有 js 中 if/while/for 等原语
