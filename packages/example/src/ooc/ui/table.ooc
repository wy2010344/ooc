// table.ooc —— 复刻 shadcn/ui Table 家族（new-york-v4）。
// 无 Radix：普通语义标签 + 类名；Table 自带 overflow 容器。
//   Table $ {} (TableHeader $ {} (TableRow $ {} (TableHead $ {} '列') …)) …
#import { dom, fc } '../bridge.ts';
#import { merge } './utils.ooc';

tableDefaults = { className = nil };

Table = fc $ [ctx, props, ...children =>
    p = merge $ props tableDefaults;
    (dom div { className = 'relative w-full overflow-x-auto' }
        (dom table { className => 'w-full caption-bottom text-sm ${p className}' } ...children)
    ) $ ctx
];

TableHeader = fc $ [ctx, props, ...children =>
    p = merge $ props tableDefaults;
    (dom thead { className => '[&_tr]:border-b ${p className}' } ...children) $ ctx
];

TableBody = fc $ [ctx, props, ...children =>
    p = merge $ props tableDefaults;
    (dom tbody { className => '[&_tr:last-child]:border-0 ${p className}' } ...children) $ ctx
];

TableFooter = fc $ [ctx, props, ...children =>
    p = merge $ props tableDefaults;
    (dom tfoot {
        className => 'border-t bg-muted/50 font-medium [&>tr]:last:border-b-0 ${p className}'
    } ...children) $ ctx
];

TableRow = fc $ [ctx, props, ...children =>
    p = merge $ props tableDefaults;
    (dom tr {
        className => 'border-b transition-colors hover:bg-muted/50 ${p className}'
    } ...children) $ ctx
];

TableHead = fc $ [ctx, props, ...children =>
    p = merge $ props tableDefaults;
    (dom th {
        className => 'h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground ${p className}'
    } ...children) $ ctx
];

TableCell = fc $ [ctx, props, ...children =>
    p = merge $ props tableDefaults;
    (dom td { className => 'p-2 align-middle whitespace-nowrap ${p className}' } ...children) $ ctx
];

TableCaption = fc $ [ctx, props, ...children =>
    p = merge $ props tableDefaults;
    (dom caption { className => 'mt-4 text-sm text-muted-foreground ${p className}' } ...children) $ ctx
];

{
    Table = Table,
    TableHeader = TableHeader,
    TableBody = TableBody,
    TableFooter = TableFooter,
    TableRow = TableRow,
    TableHead = TableHead,
    TableCell = TableCell,
    TableCaption = TableCaption
}
