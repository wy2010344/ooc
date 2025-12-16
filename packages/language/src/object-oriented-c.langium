grammar ObjectOrientedC

entry OOCModel:
    statements+=Statement*;

// 语句定义 - 完全分离不同类型的语句
Statement:
    BindingStatement | AssignmentStatement | ExpressionStatement;

// 绑定语句 - 常量和变量绑定
// 这些语句必须以ID开头，后跟特定的绑定操作符
BindingStatement:
    // 常量绑定: name = expression
    ConstBinding |
    // 可变绑定: name := expression
    VarBinding;

// 常量绑定
ConstBinding:
    name=ID '=' expression=Expression ';'?;

// 可变绑定
VarBinding:
    name=ID ':=' expression=Expression ';'?;

// 赋值语句 - 重新赋值: name =: expression
AssignmentStatement:
    name=ID '=:' expression=Expression ';'?;

// 表达式语句 - 不能以ID直接开头，避免与绑定语句混淆
// 表达式必须以括号、引号、数字、对象字面量或数组字面量开头
ExpressionStatement:
    expression=Expression ';'?;

// 表达式定义 - 优先级从低到高
Expression:
    PipeExpression;

// 管道表达式 - 处理 | 和 |> 操作符，优先级相同
PipeExpression:
    (MessageExpression|PrimaryExpression) (
        ({infer PipeExpression.left=current} operator='|'  right=(NamedPipeExpression|MessageExtExpression)) |
        ({infer PipeExpression.left=current} operator='|>' right=MessageExpression)
    )*;

// 命名管道表达式
NamedPipeExpression:
    name=ID '.' expression=MessageExpression;

// 消息表达式 - 对象消息传递: receiver message arg1 arg2
MessageExpression:
    NormalMessageExpression | UnionMessageExpression;


NormalMessageExpression:
    receiver=PrimaryExpression ext=MessageExtExpression;

UnionMessageExpression:
    '$' ext=MessageExtExpression;

// 消息扩展表达式
MessageExtExpression:
    message=ID (arguments+=PrimaryExpression)*;

// 主要表达式 - 不能直接以ID开头，避免与绑定语句混淆
PrimaryExpression:
    // 字面量 - 字符串、数字、布尔值
    StringLiteral | NumberLiteral | BooleanLiteral |
    // 对象和数组字面量
    ObjectLiteral | ArrayLiteral |
    // 括号表达式 - 用于将ID作为表达式使用 (id)
    ParenthesizedExpression | ID;

// 对象字面量 - { (message arg1 arg2) { body } }
ObjectLiteral:
    '{' (messageHandlers+=MessageHandler)* '}';

// 消息处理器 - (name param1 param2) { body }
MessageHandler:
    '(' name=ID (parameters+=ID)* ')' '{' body+=Statement* '}';

// 数组字面量 - [element1, element2]
ArrayLiteral:
    '[' (elements+=Expression (',' elements+=Expression)*)? ']';

// 括号表达式 - (expression)
// 用于将ID作为表达式使用: (id)
ParenthesizedExpression:
    '(' expression=Expression ')';

// 字符串字面量
StringLiteral:
    value=STRING;

// 数字字面量
NumberLiteral:
    value=NUMBER;

// 布尔字面量
BooleanLiteral:
    value=('true' | 'false');

// 终端定义
hidden terminal WS: /\s+/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal NUMBER returns number: /[0-9]+(\.[0-9]+)?/;
terminal STRING: /'(\\.|[^'\\])*'/;

hidden terminal ML_COMMENT:     /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT:     /\/\/[^\n\r]*/;