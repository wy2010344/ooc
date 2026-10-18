// 合并/兜底：merge $（宿主端 merge 全局）——无原型继承下的复用方式
// 前面的对象自有消息优先，未知消息按后面对象顺序查找（兜底随之转发）。

// 未知消息按 defaults 找：speak/bark 在 defaults 上，fly 是 spec 自有的
defaults = { speak = 'voice', bark = 'wang' };
spec = { fly = 'fly' };
w = merge $ spec defaults;
w speak;
w fly;

// spec 与 defaults 同名时 spec 优先（抢占，不经过转发）
defaults2 = { greet = 'hi', go = 'go' };
spec2 = { greet = 'hey' };
w2 = merge $ spec2 defaults2;
w2 greet;
w2 go;
