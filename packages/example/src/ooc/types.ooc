// 类型注解：只做提示，不影响运行
x: number = 42;
greet: string = 'hi';

// typedef 定义类型形状（方法签名）
Animal #type { speak: string };
animal = { 
  speak = 'voice' ,
  speak2= x+9,
  ask => x + 9,
  call(it:number){
    it + 9
  }  ,
  call2(it:number)=>it+9,
  call3(it:number)=>it,
  call4=[it:number => it+8],
  call5<=@{
    self=this;
    [it:number=>it+1 | self call2]
  }
};

console log (animal call5 88);

x=merge $ animal {
  abc=9
};
console log (x abc) 'abc';

// 对象赋值到带类型注解的变量，检查方法签名是否吻合
dog: Animal = { speak = 'voice', bark = 'wang' };

// 联合类型
result: number | string = 1;
result
