// components-forms.ooc —— 表单分类：账户设置、输入框、Checkbox / Switch / Select。
#import { fc } '../bridge.ts';
#import { ComponentPage } './component-page.ooc';
#import { SettingsPanel } './settings.ooc';
#import { FormControls } './form-controls.ooc';

FormsPage = fc $ [ctx =>
    (ComponentPage $ {
        title = '表单',
        description = '账户设置、输入框、Checkbox / Switch / Select（受控信号）。'
    }
        (SettingsPanel $)
        (FormControls $)
    ) $ ctx
];

FormsPage
