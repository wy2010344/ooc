# 03 管道

## `/`：结果继续发消息

```ooc
'abcdef' slice 1 3 / slice 1 2    // 'c'
```

`'abcdef' slice 1 3` 得到 `'bc'`，`/ slice 1 2` 再对 `'bc'` 调用。

## `|`：把左边的结果作为右边消息的第一个参数

```ooc
add = { call(a, b) => a + b };
3 | add call 5      // 8，等价于 add call 3 5
```

## `|`：命名占位

右边写成 `名字 => 表达式` 时，左边的值绑定为该名字：

```ooc
'abcdef' slice 1 3 | s => s + '!'    // 'bc!'
```
