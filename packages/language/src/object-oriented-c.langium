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

ImportStatement:
    name=ID '=' '#import' path=STRING (ImportList)?;

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
    '{' ('...' extends=Type ',')? (members+=TypeMember (',' members+=TypeMember)*)? '}';

TypeMember:
    name=MethodDefName 
        ('<' typeParams+=TypeParam (',' typeParams+=TypeParam)* '>')?
        ('(' ((params+=Param (',' params+=Param)*)?) ')')? 
        (':' typeAnnotation=Type)?
;

Statement:
    Assignment  | Expression;

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
            ('#guard' guardExpression=Expression ';')?
            (expressions+=Statement (';' expressions+=Statement)* ';'?)?
         '}'
        ) 
      | ('=>' expressions+=Expression) 
    );


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


//类定义：#classDef { 类方法 } { 实例方法 }，类方法中的 new 是构造方法
ClassDef:
    '#classDef' '{' (
        classMethods+=Method (',' classMethods+=Method)*
    )? '}' '{' (
        instanceMethods+=Method (',' instanceMethods+=Method)*
    )? '}';

ComplexPrimary:
    ObjectDef | LambdaDef | ClassDef | '(' Expression ')';

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