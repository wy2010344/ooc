grammar ObjectOrientedC

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;

entry OOCModel:
    items+=Item*
;

Item:
    Import | Export | TopLevelItem
;

TopLevelItem:
    VarDeclaration ';'?
    | Statement ';'?
;

// ============================================================
// Imports & Exports
// ============================================================

Import:
    'import' name=ID path=STRING ';'?
;

Export:
    'export' (varDecl=VarDeclaration | methodDecl=MethodDeclaration) ';'?
;

// ============================================================
// Variable Declaration
// ============================================================

VarDeclaration:
    name=ID assignOp=('=' | ':=') value=Expression
;

MethodDeclaration:
    name=ID params=MethodParams body=MethodBody
;

MethodParams:
    '(' (params+=ID (',' params+=ID)*)? ')'
;

MethodBody:
    '#async'? ('{' expressions+=Expression (';' expressions+=Expression)* ';'? '}'
    | '=>' expression=Expression)
;

// ============================================================
// Statements
// ============================================================

Statement:
    expression=Expression
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
Pipeline infers Pipeline:
    messageChain=MessageChain
    ({infer Pipeline.left=current} ('/' message=Message | '|' right=PipelineRight))*
;

// Right side of pipe can be either:
// 1. Pattern binding: var . expression
// 2. Message chain (primary + messages)
PipelineRight:
    PatternBinding | MessageChain
;

PatternBinding:
    varName=ID '.' expr=MessageChain
;

// Message chain: primary optionally followed by messages
MessageChain:
    primary=Primary (messages=Message)?
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
// Macros
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
    '{' expressions+=Expression (';' expressions+=Expression)* ';'? '}'
    | Expression
;

WhileMacro:
    '#while' '(' condition=Expression ')' '{'
    body+=Expression (';' body+=Expression)* ';'?
    '}'
;

ReturnMacro:
    '#return' value=Expression?
;

// ============================================================
// Object Literal
// ============================================================

ObjectLiteral:
    '{' members+=ObjectMember (',' members+=ObjectMember)* '}'
    | '{' '}'
;

ObjectMember:
    MethodMember | CachedMember | VariableMember
;

MethodMember:
    name=ID params=MethodParams body=MethodBody
;

CachedMember:
    name=ID '=' value=Expression
;

VariableMember:
    name=ID assignOp=(':=' | '=') value=Expression
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
    '$' constructor=ID (unionArgs+=(NUMBER | STRING | ID))*
;

// ============================================================
// Terminals
// ============================================================

terminal STRING: /'[^']*'/;
terminal NUMBER: /[0-9]+(\.[0-9]+)?/;
terminal ID: /[_a-zA-Z][_a-zA-Z0-9]*/;
