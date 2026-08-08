// 继承：'...' 不是 spread 拷贝，而是单继承——运行时把父对象挂在方法路由链上，
// 自身找不到方法时向上路由给父对象；可覆盖同名方法
animal = { speak() { 'voice' } };
dog = { ...animal, bark() { 'wang' } };
dog speak;
dog bark;

// 覆盖父方法
bird = { ...animal, speak() { 'tweet' } };
bird speak;

// 父对象字段通过 this 访问（路由链向上）
base = { name = 'pet' };
child = { ...base, greet() { this name } };
child greet;
