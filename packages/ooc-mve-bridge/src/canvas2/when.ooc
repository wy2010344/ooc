// 布尔分流小工具（语言无三元）：cond 真取 yes，否则取 no。
// 注意：浏览器的 window.when 是一个原生函数（apply 会抛 Illegal invocation），
// 桥接模块不能靠「隐式全局 when」，必须显式 #import 本文件。
when = [cond, yes, no => #guard cond; yes #else; no];

{ when = when }
