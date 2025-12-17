grammar ObjectOrientedC

entry OOCModel:
    (items+=Item)*
;

Item:
    (Declaration | Statement) (';')?
;

Declaration:
    VarDecl | MethodDecl | Import | Export
;

Import:
    'import' name=ID filepath=STRING
;

Export:
    'export' decl=(VarDecl | MethodDecl)
;

VarDecl:
    name=ID op=(':=' | '=') value=Expr
;

MethodDecl:
    name=ID '(' params=ParamList? ')' ('@')?
    ('{' body=Expr '}' | ':' body=Expr)
;

ParamList:
    // Accept either comma-separated or space-separated parameter lists
    params+=ID (','? params+=ID)*
;

Statement:
    expr=Expr
;

Expr:
    Base
;

Base:
    atom=Primary (methods+=MethodCall)*
;

MethodCall:
    name=ID (args=Args)?
;

Args:
    items+=Primary (',' items+=Primary)*
;

Primary:
    StringLit | NumLit | BoolLit | ObjLit | ID | UnionVal | '(' Expr ')'
;

StringLit:
    value=STRING
;

NumLit:
    value=(INT | FLOAT)
;

BoolLit:
    value=('true' | 'false')
;

ObjLit:
    '{' (items+=ObjItem (',' items+=ObjItem)*)? '}'
;

ObjItem:
    // Try method first (name followed by parentheses)
    name=ID '(' params=ParamList? ')' ('@')?
       ('{' expr=Expr '}' | ':' expr=Expr)
    // Then property (name with operator and value)
    | name=ID (':=' | '=' | ':') val=Expr
    // Or just a name (reference to variable)
    | name=ID
;

UnionVal:
    '$' tag=ID (args=Args)?
;

hidden terminal WS: /\s+/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal INT: /[0-9]+/;
terminal FLOAT: /[0-9]+\.[0-9]+/;
terminal STRING: /'(\\.|[^'\\])*'/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
