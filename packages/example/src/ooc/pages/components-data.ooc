// components-data.ooc —— 数据展示分类：Tabs / Table / Avatar / Separator / Skeleton。
#import { fc } '../bridge.ts';
#import { ComponentPage } './component-page.ooc';
#import { DataDisplay } './data-display.ooc';

DataPage = fc $ [ctx =>
    (ComponentPage $ {
        title = '数据展示',
        description = 'Tabs / Table / Avatar / Separator / Skeleton。'
    }
        (DataDisplay $)
    ) $ ctx
];

DataPage
