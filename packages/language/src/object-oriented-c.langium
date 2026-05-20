grammar ObjectOrientedC

entry Model:
    (expressions+=TopStatement ( ';' expressions+=TopStatement )* ';'?)?;


TopStatement:
    ImportStatement | Statement
;

ImportStatement:
    name=ID '=' '#import' path=STRING
;

Statement:
    Assignment  | Expression;

//绑定
Assignment:
    name=ID '=' expression=Expression;

//object的方法
Method:
    MethodAll | MethodBind;

MethodAll:
    name=MethodDefName 
        ('(' 
            ( (params+=Param (',' params+=Param)* ( ',' '...' restParam=Param)?)
             |('...' restParam=Param)
            ) 
          ')' 
        )? 
        (
            ('{' 
                ('#guard' guardExpression=Expression ';')?
                (expressions+=Statement (';' expressions+=Statement)* ';'?)?
             '}'
            ) 
          | ('=>' expressions+=Expression) 
        );


MethodBind:
    name=MethodDefName '=' expression=Expression;

MethodDefName:
    name=(Ref|Str|StID);

Param:
    name=ID;

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
    infix=('>'|'>='|'<'|'<='|'=='|'!='|'&&'|'||'|'+'|'-'|'*'|'//'|'%') value=Primary;

NamedExpression:
    param=ID '=>' expression=(MessageChain| ComplexPrimary);

MessageChain:
    primary=Primary message=Message;

/**消息名 消息参数*/
Message:
    name=MethodCallName args+=Primary*;

MethodCallName:
    value=(Ref|StID|Str|ProId);

ObjectDef:
    '{' (methods+=Method (',' methods+=Method)* ','? )? '}';


ComplexPrimary:
    ObjectDef | '(' Expression ')';

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
ProId:
    value=PropertyID;

hidden terminal WS: /\s+/;
terminal BOOL: /true|false/;
//允许了转义
terminal STRING: /'(\\.|[^'\\])*'/;
terminal STID: /"[^\s]*/;
terminal NUMBER returns number: /[0-9]+(\.[0-9]+)?/;
terminal ID: /[_a-zA-Z][_a-zA-Z0-9]*/;
terminal PropertyID: /@[_a-zA-Z][_a-zA-Z0-9]*/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;