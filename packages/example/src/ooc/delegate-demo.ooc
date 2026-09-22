// 委托组合：withDefault（base 包 delegate）——无原型继承下的复用方式
// spec 自有消息优先，未知消息按 defaults 顺序查找（methodNotFound 转发）。
delegate = #import 'delegate';

// 未知消息按 defaults 找：speak/bark 在 defaults 上，fly 是 spec 自有的
defaults = { speak() => 'voice', bark() => 'wang' };
spec = { fly() => 'fly' };
w = delegate withDefault spec defaults;
w speak;
w fly;

// spec 与 defaults 同名时 spec 优先（抢占，不经过转发）
defaults2 = { greet() => 'hi', go() => 'go' };
spec2 = { greet() => 'hey' };
w2 = delegate withDefault spec2 defaults2;
w2 greet;
w2 go;