// view.ooc — 视图工具库
// 提供常用的视图组件和工具函数

// 创建带样式的容器
StyledContainer = [className, children =>
    (dom div {className => className}
        children
    )
];

// 创建按钮组件
Button = [label, onClick =>
    (dom button {
        className => 'rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600',
        onClick(e){ onClick apply e }
    }
        (text apply label)
    )
];

// 创建输入框组件
Input = [value, onValueChange =>
    (dom input {
        className => 'rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none',
        value => value,
        onValueChange(v){ onValueChange apply v }
    })
];
