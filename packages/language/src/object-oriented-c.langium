grammar ObjectOrientedC

interface CastExpression {
    expression: Expression
    type: Type
}

entry Model:
    (expressions+=TopStatement ( ';' expressions+=TopStatement )* ';'?)?;


TopStatement:
    ImportStatement | TypeDef | Statement
;

// #import 的多种写法共用同一个 ImportStatement：
//   x = #import 'p'                  —— 默认导入（x = 模块最后一条表达式结果）
//   x = #import 'p' { T as U }       —— 默认导入 + 类型导入（类型导入在 path 之后）
//   #import { a as b, c } 'p'        —— 命名导入（命名导入在 path 之前，类型或值皆可）
//   #import { a } 'p' { T }          —— 命名导入与类型导入可同时存在，分列 path 两侧
// 命名导入 named 在 path 前；类型导入 types 在 path 后。
ImportStatement:
    (name=ID '=')? '#import' named=ImportList? path=STRING types=ImportList?
;

ImportList:
    '{' (items+=ImportItem (',' items+=ImportItem)*)? '}';

ImportItem:
    name=ID ('as' alias=ID)?;

//类型别名（#type 指令）：成员只声明签名，无实现；#type 后用 <> 声明泛型类型参数
TypeDef:
    name=ID '#type' ('<' typeParams+=TypeParam (',' typeParams+=TypeParam)* '>')? body=TypeMemberList;

TypeParam:
    name=ID;

TypeMemberList:
    '{' (members+=TypeMember (',' members+=TypeMember)*)? '}';

TypeMember:
    name=MethodDefName 
        ('<' typeParams+=TypeParam (',' typeParams+=TypeParam)* '>')?
        ('(' ((params+=Param (',' params+=Param)*)?) ')')? 
        (':' typeAnnotation=Type)?
;

// 语句：
//  - Assignment  局部赋值
//  - Expression 其它表达式
// 分支守卫不是普通语句：#guard 必须带分支体并位于方法体末尾（见 MethodBody/GuardBranch），
// 这样「命中哪个分支、兜底块是哪段」在语法上无歧义。
Statement:
    Assignment | Expression
;

//绑定
Assignment:
    name=ID (':' typeAnnotation=Type)? '=' expression=Expression;

//object的方法
Method:
    MethodAll | MethodBind | MethodBindMutable;

fragment ParamAll:
    (params+=Param (',' params+=Param)* ( ',' '...' restParam=Param)?)?
             | ('...' restParam=Param)
;
MethodAll:
    name=MethodDefName 
        ('<' typeParams+=TypeParam (',' typeParams+=TypeParam)* '>')?
        ('(' 
            ParamAll
          ')' 
        )? 
        (':' returnType=Type)?
        body=MethodBody?;

MethodBody:
    (
        ('{'
            (stmts+=Statement (';' stmts+=Statement)* ';'?)?
            (guardBranches+=GuardBranch)*
            (elseBranch=ElseBranch)?
         '}')
      | ('=>' guardBranches+=GuardBranch+ elseBranch=ElseBranch?)
      | ('=>' stmts+=Expression)
    );

// 分支块：({ #guard 条件; 分支体 }) —— 括号把条件+体包成一个整体，
// 避免与方法体/对象字面量的花括号混在一起造成二义。
GuardBranch:
    '(' '#guard' guardExpression=Expression ';' branchBody=BranchBody ')'
;
// else 兜底块：(#else { 语句 }) —— 全部 guard 都不命中时执行。
ElseBranch:
    '(' '#else' elseBody=BranchBody ')'
;

BranchBody:
    '{' (expressions+=Statement (';' expressions+=Statement)* ';'?)? '}'
;


MethodBind:
    name=MethodDefName (':' typeAnnotation=Type)? '=' expression=Expression;

//转发属性：本 key 的一切消息原样转发给委托对象的 apply 执行（消息名不传给 apply）
MethodBindMutable:
    name=MethodDefName '<=' expression=Expression;

MethodDefName:
    name=(Ref|Str|StID);

Param:
    name=ID (':' typeAnnotation=Type)?;

Expression:
    PipeExpression ({CastExpression.expression=current} CAST type=Type)?;

PipeExpression infers Expression:
    MessageOrChain ({infer PiplingExpression.left=current} (
        right=(MessageChainExt|MessagePipRight|MessageInfixRight)
    ))*;

MessageOrChain:
    primary=Primary (message=Message)?;

MessageChainExt:
    '/' value=Message;

MessagePipRight:
    '|' value=(NamedExpression | MessageChain);

MessageInfixRight:
    infix=('>'|'>='|'<'|'<='|'=='|'!='|'&&'|'||'|'+'|'-'|'*'|'%') value=Primary;

NamedExpression:
    param=ID '->' expression=Expression;

MessageChain:
    primary=Primary message=Message;

/**消息名 消息参数 消息类型参数（可选）*/
Message:
    name=MethodCallName ('<' typeArgs+=Type (',' typeArgs+=Type)* '>')? args+=Primary*;

MethodCallName:
    value=(Ref|StID|Str);

//类型表达式：支持联合（|）与交叉（&）
Type:
    first=TypeName (seps+=('&'|'|') rest+=TypeName)*;

//类型名：具名类型 / 内置 / 字面量（用于可区分联合的判别，如 kind(): 'circle'）
//泛型实例化：Box<number>、Pair<A, B>
//命名空间访问：#import 导入的模块类型成员，如 math#Circle、math#area（方法返回类型）
TypeName:
    ((ns=ID '#')? name=(ID | Nil | Bool | Str | Num)) ('<' typeArgs+=Type (',' typeArgs+=Type)* '>')?;

ObjectDef:
    '{' 
        (methods+=Method (',' methods+=Method)*)?  
    '}';

//lambda，等价于 { apply(...) { ... } }
//  [x => x + 1]          带参 lambda，函数体为表达式
//  [a, b => a + b]       多参数，逗号分割，参数可带类型注解
//  [x => y = x + 1; y*2] 函数体为分号分割的多条语句（与方法体一致）
//  [42]                  无参 lambda，函数体为表达式
LambdaDef:
    '['
        (ParamAll '=>')?
        (expressions+=Statement (';' expressions+=Statement)* ';'?)?
    ']';

ComplexPrimary:
    ObjectDef | LambdaDef | '(' Expression ')';

Primary:
    Num | Str | StID | Bool | Nil | Ref | ComplexPrimary;

Ref:
    value=ID;
Str:
    value=STRING;
StID:
    value=STID;
Bool:
    value=BOOL;
Num:
    value=NUMBER;
Nil:
    value='nil';

hidden terminal WS: /\s+/;
terminal CAST: /#as/;
terminal BOOL: /true|false/;
//允许了转义
terminal STRING: /'(\\.|[^'\\])*'/;
terminal STID: /"[^\s]*/;
terminal NUMBER returns number: /[0-9]+(\.[0-9]+)?/;
terminal ID: /[_a-zA-Z][_a-zA-Z0-9]*/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;