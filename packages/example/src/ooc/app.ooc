// app.ooc — 示例应用入口
// 用 dom/text/fc 渲染界面，展示 OOC 语言能力

// ===== 语言能力展示 =====

// 可区分联合 + guard
Circle #type { kind(): 'circle', radius: number };
Square #type { kind(): 'square', side: number };

area = {
    calc(s: Circle | Square) {
        #guard (s kind) == 'circle';
        (s radius) * (s radius) * 3.14
    },
    calc(s: Circle | Square) {
        #guard (s kind) == 'square';
        (s side) * (s side)
    }
};

// 对象方法
math = #import 'math';
hello = { greet(name) { 'Hello, ' + name + '!' } };

// storage 引用
counter = storage ref 0;

// ===== 响应式状态 =====
count = createSignal apply 0;
name = createSignal apply 'OOC';

// ===== 组件 =====
Card = fc apply [ctx, title, content =>
    (dom div {className => 'card'}
        (dom h3 {} (text apply title))
        (dom p {className => 'card-value'} (text apply content))
    ) / apply ctx
];

{
    preview(ctx){
        ctx addDestroy [console log 'app 预览关闭';];

        circleArea = (area calc { kind() { 'circle' }, radius() { 5 } });
        squareArea = (area calc { kind() { 'square' }, side() { 4 } });
        mathResult = (math add 2 3);
        greeting = (hello greet 'World');

        // 初始 storage 值
        counter set 42;

        (dom div {}
            (dom h1 {} (text apply 'OOC 浏览器示例'))

            (dom p {className => 'sub'}
                (text apply '语言特性展示：联合类型、guard、对象方法、模块导入、响应式信号')
            )

            // 语言能力卡片
            (dom div {className => 'grid'}
                (Card apply '联合类型 + guard' [circleArea + ' / ' + squareArea])
                (Card apply '模块导入 (math)' [mathResult])
                (Card apply '对象方法' greeting)
                (Card apply 'storage 引用' (counter get))
            )

            // 响应式计数器
            (dom div {className => 'section section-blue'}
                (dom h3 {} (text apply '响应式计数器'))
                (dom p {className => 'counter-value'}
                    (text apply [count get])
                )
                (dom div {className => 'flex gap-2'}
                    (dom button {className => 'btn',
                        onClick(e){ count set ((count get) - 1) }
                    } (text apply '-'))
                    (dom button {className => 'btn',
                        onClick(e){ count set ((count get) + 1) }
                    } (text apply '+'))
                )
            )

            // 受控输入
            (dom div {className => 'section section-green'}
                (dom h3 {} (text apply '受控输入'))
                (dom p {className => 'greeting'}
                    (text apply ['Hello, ' + (name get) + '!'])
                )
                (dom input {className => 'input',
                    value => (name get),
                    onInput(e){ name set (e target / value) }
                })
            )
        ) / apply ctx
    }
}
