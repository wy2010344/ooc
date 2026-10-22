// three-demo.ooc —— 真 3D 示例：mve-three（three.js + WebGL）薄桥接。
// 与 canvas/dom 完全同构：fc + 信号，只是节点换成 3D 物体；
// 变换/材质属性写 lambda 就是响应式的（信号变 → 物体在动画循环里跟着变）。
// 交互靠 OrbitControls：拖拽旋转、滚轮缩放；命中检测（Raycaster）暂未桥接。
#import { dom, text, fc, bindSignal } '../bridge.ts';
#import { three } '../bridge.ts';
#import { Button } '../ui/button.ooc';
#import { when } '../ui/utils.ooc';

// 色号名：模板洞内不能再出现单引号（整段是一个字符串 token），所以放成顶层函数
colorNameOf = [b =>
    #guard b;
    '暖调'
    #else;
    '冷调'
];

ThreeDemo = fc $ [ctx =>
    spin = bindSignal $ 0;
    flip = bindSignal $ false;

    (dom section { className = 'space-y-3' }
        (dom div { className = 'flex items-baseline justify-between' }
            (dom h2 { className = 'text-lg font-semibold tracking-tight' } (text $ 'Three 3D'))
            (dom span { className = 'text-xs text-muted-foreground' }
                (text $ 'mve-three / three.js + OrbitControls'))
        )
        (dom div { className = 'flex gap-2' }
            (Button $ { variant = 'outline', onPress(e){ spin $ ((spin $) + 1) } } '转一下')
            (Button $ { variant = 'outline', onPress(e){ flip $ (when $ (flip $) false true) } } '换色')
        )
        (three stage {
            id = 'three-demo-stage',
            className = 'block h-[360px] w-full overflow-hidden rounded-xl border bg-slate-950'
        }
            (three ambient { intensity = 0.7 })
            (three directional { intensity = 1.6, x = 3, y = 5, z = 4 })
            (three grid { size = 10, divisions = 10, color = '#334155' })
            (three group { rotationY = [spin $ * 0.6] }
                (three box {
                    size = 1.2,
                    x = 0 - 1.7,
                    y = 0.9,
                    color = [when $ (flip $) '#f472b6' '#22d3ee'],
                    roughness = 0.25,
                    metalness = 0.35,
                    rotationX = [spin $ * 0.4]
                })
                (three sphere {
                    radius = 0.75,
                    y = 1,
                    color = '#a3e635',
                    roughness = 0.2,
                    metalness = 0.5
                })
                (three torus {
                    radius = 0.7,
                    tube = 0.22,
                    x = 1.7,
                    y = 1,
                    color = '#fb923c',
                    roughness = 0.3,
                    rotationX = [spin $ * 0.8]
                })
            )
            (three label { value = ['spin ${spin $}'], y = 2.4, scale = 0.9, color = '#e2e8f0' })
        )
        (dom p { className = 'text-xs tabular-nums text-muted-foreground' }
            (text $ ['3D 旋转：${spin $}，配色：${colorNameOf $ (flip $)}'])
        )
    ) $ ctx
];

ThreeDemo
