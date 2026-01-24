grammar ObjectOrientedC

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;

entry OOCModel:
    beforeExpressions+=Item ';' 
    expression=Expression
;

Item:
    Import | TopLevelItem
;

TopLevelItem:
    VarDeclaration | ExpressionCatch | Expression
;

// ============================================================
// Imports,最终转化成Promise.all的导入，最后一条语句作为导出
// 异步的方法体，可以使用#await与#import
// 普通函数体里有import，自动变成一个promise。普通函数里有#await，也自动变成promise，毕竟这只是脚本语言。什么csp的yield。
// 主要是await当然必然只是单次通知。而yield可能多次通知，这时必须是回调函数，因为事件性。
// 因为promise是类似于return来resolve一次。
// 有yield，自动变成一种流程介入。但#await是只一次。
// yield将函数分成几段，其实每一段都可以接受上一段的返回，传递下一段的参数。应该可以 a=yield b,b作为本次返回，a作为本次调用的传入。
// 事实上每次都返回一个值与函数，函数表示继续，需要传入参数。
// 还有xxx #throw 抛出错误
// ============================================================

Import:
    '#import' name=ID path=STRING
;

// ============================================================
// Variable Declaration
// ============================================================

VarDeclaration:
    name=ID  '=' value=Expression
;

ExpressionCatch:
    error=ID','name=ID '=' value=Expression
;

MethodParams:
    '(' (params+=ID (',' params+=ID)*)? ')'
;

MethodBody:
    '#async'? (Expressions | ('=>' expression=Expression))
;


fragment Expressions:
    '{'
        beforeExpressions+=TopLevelItem ';' 
        expression=Expression
    '}'
;

// ============================================================
// Expression Hierarchy
// ============================================================

Expression:
    Pipeline
;

// Pipeline: left-recursive infix operators (/ and |)
// / right side: single message (method arg1 arg2...)
// | right side: pattern binding or message chain
Pipeline infers Expression:
    MessageOrChain ({infer Pipeline.left=current} ('/' right=Message | '|' right=PipelineRight))*
;

// Right side of pipe can be either:
// 1. Pattern binding: var . expression
// 2. Message chain (primary + messages)
PipelineRight:
    PatternBinding | MessageChain
;

PatternBinding:
    varName=ID '.' expr=MessageOrChain
;

MessageOrChain:
    primary=Primary (messages=Message)?
;
// Message chain: primary optionally followed by messages
MessageChain:
    primary=Primary messages=Message
;

Message:
    name=ID args+=Primary*
;

Primary:
    '(' Expression ')'
    | ObjectLiteral
    | StringLiteral
    | BooleanLiteral
    | NumberLiteral
    | NilLiteral
    | UnionLiteral
    | MacroCall
    | ID
;

// ============================================================
// Macros。增加函数声明的macro?
// ============================================================

MacroCall:
    IfMacro
    | WhileMacro
    | ReturnMacro
    | '#await'
;

IfMacro:
    '#if' '(' condition=Expression ')'
    thenBody=ExpressionBody
    ('#else' elseBody=ExpressionBody)?
;

ExpressionBody:
    Expressions
    | expression=Expression
;

WhileMacro:
    '#while' '(' condition=Expression ')' expression=ExpressionBody
;

ReturnMacro:
    '#return' value=Expression?
;

// ============================================================
// Object Literal。简化，始终有逗号。
// ============================================================

ObjectLiteral:
    '{' ( members+=ObjectMember ',')* '}'
;

ObjectMember:
    MethodMember | CachedMember | VariableMember
;

MethodMember:
    name=ID params=MethodParams? body=MethodBody
;

CachedMember:
    name=ID '=' value=Expression
;

VariableMember:
    name=ID params=MethodParams? '=>' value=Expression
;

// ============================================================
// Literals
// ============================================================

StringLiteral:
    value=STRING
;

BooleanLiteral:
    value=('true' | 'false')
;

NumberLiteral:
    value=NUMBER
;

NilLiteral:
    {infer NilLiteral} 'nil'
;

UnionLiteral:
    '$' message=Message
;

// ============================================================
// Terminals
// ============================================================

terminal STRING: /'[^']*'/;
terminal NUMBER: /[0-9]+(\.[0-9]+)?/;
terminal ID: /[_a-zA-Z][_a-zA-Z0-9]*/;
