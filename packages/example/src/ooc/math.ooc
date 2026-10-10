// 数学工具模块：直接返回带方法的对象
x=9;
y={
  add(a:Number,b:Number){
    a + b
  }
};
{ add(a, b) { a + b }, double(x) { x * 2 } }
