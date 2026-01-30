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
    Assignment | ExceptionCatch | Expression;

//绑定
Assignment:
    name=ID '=' expression=Expression;
//异常捕获
ExceptionCatch:
    error=ID ',' name=ID '=' expression=Expression;


//object的方法
Method:
    MethodAll | MethodBind;

MethodAll:
    name=ID ('(' params+=Param (',' params+=Param)* ')')? (('{' 
      (expressions+=Statement (';' expressions+=Statement)* ';'?)?
    '}') | ('=>' expressions+=Expression) );

MethodBind:
    name=ID '=' expression=Expression;

Param:
    name=ID;

Expression:
    PipeExpression;

PipeExpression infers Expression:
    MessageOrChain ({infer PiplingExpression.left=current} (('/' right=Message ) | ('|' right=MessageRight)))*;

MessageOrChain:
    primary=Primary (message=Message)?;

MessageRight:
    NamedExpression | MessageChain;

NamedExpression:
    param=ID '=>' expression=(MessageChain| ComplexPrimary);

MessageChain:
    primary=Primary message=Message;

/**消息名 消息参数*/
Message:
    name=(MethodFunName|MethodProperty) args+=Primary*;

MethodFunName:
    value=ID;
MethodProperty:
    value=PropertyID;

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

hidden terminal WS: /\s+/;
terminal BOOL: /true|false/;
terminal STRING: /'[^']*'/;
terminal STID: /"[^\s]*/;
terminal NUMBER returns number: /[0-9]+(\.[0-9]+)?/;
terminal ID: /[_a-zA-Z][_a-zA-Z0-9]*/;
terminal PropertyID: /#[_a-zA-Z][_a-zA-Z0-9]*/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;