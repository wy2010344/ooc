// 文档示例用的同目录模块（docs/guide/_fixtures），供 #import 解析。
// 校验脚本会把本目录复制进临时目录，所以示例里的 'math.ooc' / 'geometry.ooc' / 'lib.ooc' 都指向它。
calc = { run(a, b) => a + b };
calc
