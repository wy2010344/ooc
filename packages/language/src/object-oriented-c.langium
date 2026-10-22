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
        ('(' 
            ParamAll
          ')')? 
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

// 参数列表：括号内至少一个参数——无参方法不写括号（禁止空括号 `f()`）。
fragment ParamAll:
    (params+=Param (',' params+=Param)* ( ',' '...' restParam=Param)?)
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

// 分支段：#guard 条件; 后跟该分支的语句，直到下一条 #guard / #else / 方法体结束。
// 不用额外括号或花括号——靠分号分段，读起来就是 if / else if / else。
GuardBranch:
    '#guard' guardExpression=Expression ';'
    (stmts+=Statement (';' stmts+=Statement)* ';'?)?
;
// else 兜底段：以上 #guard 全不命中时执行。
ElseBranch:
    '#else' ';'
    (stmts+=Statement (';' stmts+=Statement)* ';'?)?
;


MethodBind:
    name=MethodDefName (':' typeAnnotation=Type)? '=' bindBody=BindBody
;

// 绑定体：单表达式，或 { 多条语句; ... } 块（与方法体同款，块内可局部赋值、最后一条是值）。
// 用 @{ 引导以与对象字面量 { ... } 明确区分——否则 `value = { a = 1 }` 是对象还是块无法判定。
BindBody:
    BindBlock | expression=Expression
;

BindBlock:
    '@{' bindStmts+=Statement (';' bindStmts+=Statement)* ';'? '}'
;

//转发属性：本 key 的一切消息原样转发给委托对象的 $ 执行（消息名不传给 $）
MethodBindMutable:
    name=MethodDefName '<=' bindBody=BindBody
;

MethodDefName:
    name=(Ref|Str|StID|Dollar);

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

// 中缀右操作数：其余运算符恰好一个 Primary；`$`（直接调用）右侧接 0~N 个实参
MessageInfixRight:
    infix=('>'|'>='|'<'|'<='|'=='|'!='|'&&'|'||'|'+'|'-'|'*'|'%') value=Primary
    | infix='$' args+=MessageArg*;

NamedExpression:
    param=ID '->' expression=Expression;

MessageChain:
    primary=Primary message=Message;

/**消息名 消息参数 消息类型参数（可选）*/
Message:
    name=MethodCallName ('<' typeArgs+=Type (',' typeArgs+=Type)* '>')? args+=MessageArg*;

// 消息实参：普通实参，或 `...expr` 展开（JS 风格，可出现在任意位置；
// 求值结果若为数组则把元素依次展开为多个实参，否则整体作为单个实参）。
MessageArg:
    spread?='...'? value=Primary;

MethodCallName:
    value=(Ref|StID|Str|Dollar);

// `$`：直接调用——定义键、消息名、中缀运算符三处都用它，
// 归一为 APPLY_NAME（宿主 JS 侧成员名 apply）。`$` 是独立 token。
// 与模版洞起始 `${` 共前缀，故 `$` 后紧跟 `{` 需留空格（写 `f $ {…}` 而非 `f${…}`）。
Dollar:
    value='$';

//类型表达式：支持联合（|）与交叉（&）
Type:
    first=TypeName (seps+=('&'|'|') rest+=TypeName)*;

//类型名：具名类型 / 内置 / 字面量（用于可区分联合的判别，如 kind: 'circle'）
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
//  [x => #guard x > 0; x #else; -x]  lambda 也支持 #guard / #else 分支链
LambdaDef:
    '['
        (ParamAll '=>')?
        (expressions+=Statement (';' expressions+=Statement)* ';'?)?
        (guardBranches+=GuardBranch)*
        (elseBranch=ElseBranch)?
    ']';

ComplexPrimary:
    ObjectDef | LambdaDef | '(' Expression ')';

Primary:
    Num | Str | StID | Bool | Nil | Ref | ComplexPrimary;

Ref:
    value=ID;
// 字符串字面量：单引号整段作为单个 token；含 ${表达式}（模版）时，由解析后的
// graft 子解析洞并填充 parts（见 template-graft.ts）——Langium 无 lexer mode，词法层
// 不切分「文本 vs 代码」，但**到哪里收尾**由自定义 matcher 算准（见 token-builder.ts：
// 洞内可以再写单引号字符串），洞仍留到 parse 之后再解析。
Str:
    value=STRING parts+=TemplatePart*;
TemplatePart:
    TemplateText | TemplateHole;
TemplateText:
    value=TEMPLATE_TEXT;
TemplateHole:
    '${' expression=Expression '}';
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
// 允许了转义。注意：实际词法不用这条正则，而是 token-builder.ts 里认 ${} 深度的自定义
// matcher（洞内可写单引号）；这里保留正则供 Langium 工具链分析（如关键字前缀判断）。
terminal STRING: /'(\\.|[^'\\])*'/;
// 仅为生成 TemplateText 的 AST 类型而声明；实际永不匹配（文本段由 graft 生成，源码不含 NUL）。
terminal TEMPLATE_TEXT: /\u0000/;
terminal STID: /"[^\s]*/;
terminal NUMBER returns number: /[0-9]+(\.[0-9]+)?/;
terminal ID: /[_a-zA-Z][_a-zA-Z0-9]*/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;