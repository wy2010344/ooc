grammar ObjectOrientedC

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

MethodAll:
    name=MethodDefName 
        ('<' typeParams+=TypeParam (',' typeParams+=TypeParam)* '>')?
        ('(' 
            ( (params+=Param (',' params+=Param)* ( ',' '...' restParam=Param)?)?
             | ('...' restParam=Param)
            ) 
          ')' 
        )? 
        (':' returnType=Type)?
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

//可变属性：无参返回当前值，有参修改并返回新值
MethodBindMutable:
    name=MethodDefName (':' typeAnnotation=Type)? '<=' expression=Expression;

MethodDefName:
    name=(Ref|Str|StID);

Param:
    name=ID (':' typeAnnotation=Type)?;

Expression:
    PipeExpression;

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
    param=ID '=>' expression=Expression;

MessageChain:
    primary=Primary message=Message;

/**消息名 消息参数 消息类型参数（可选）*/
Message:
    name=MethodCallName ('<' typeArgs+=Type (',' typeArgs+=Type)* '>')? args+=Primary*;

MethodCallName:
    value=(Ref|StID|Str);

//类型表达式：目前仅支持具名类型与联合
Type:
    parts+=TypeName ('|' parts+=TypeName)*;

//类型名：具名类型 / 内置 / 字面量（用于可区分联合的判别，如 kind(): 'circle'）
//泛型实例化：Box<number>、Pair<A, B>
//命名空间访问：#import 导入的模块类型成员，如 math#Circle、math#area（方法返回类型）
TypeName:
    ((ns=ID '#')? name=(ID | Nil | Bool | Str | Num)) ('<' typeArgs+=Type (',' typeArgs+=Type)* '>')?;

ObjectDef:
    '{' 
        ('...' extends=Ref ',' )?
        methods+=Method (',' methods+=Method)*  
    '}';


ComplexPrimary:
    ObjectDef | LambdaDef | '(' Expression ')';

//lambda，等价于 { apply(...) { ... } }
//  [x -> x + 1]          带参 lambda，函数体为表达式
//  [a, b -> a + b]       多参数，逗号分割，参数可带类型注解
//  [x -> y = x + 1; y*2] 函数体为分号分割的多条语句（与方法体一致）
//  [42]                  无参 lambda，函数体为表达式
LambdaDef:
    '['
        (params+=Param (',' params+=Param)* '->')?
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
terminal BOOL: /true|false/;
//允许了转义
terminal STRING: /'(\\.|[^'\\])*'/;
terminal STID: /"[^\s]*/;
terminal NUMBER returns number: /[0-9]+(\.[0-9]+)?/;
terminal ID: /[_a-zA-Z][_a-zA-Z0-9]*/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;