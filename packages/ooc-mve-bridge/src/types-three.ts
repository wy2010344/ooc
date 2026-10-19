/**
 * three 桥接的类型源片段（被 types.ts 拼进 bridgeTypesSource）。
 * 单独成文件只是为了控制单文件行数；语义与其它桥接类型一致：
 * 只声明签名、不落地实现，运行时实现见 src/three.ts / src/three-nodes.ts。
 */
export const threeTypesSource = `// three 组件（mve-three 薄桥接）：舞台是持有 WebGLRenderer 的 <div>，其余是 3D 节点
// 变换/材质属性（x/y/z、rotationX/Y/Z、scale、color、roughness…）写 lambda 即响应式
three = {
    stage(props, ...children): Component,
    group(props, ...children): Component,
    box(props, ...children): Component,
    sphere(props, ...children): Component,
    cylinder(props, ...children): Component,
    torus(props, ...children): Component,
    plane(props, ...children): Component,
    ambient(props, ...children): Component,
    directional(props, ...children): Component,
    point(props, ...children): Component,
    grid(props, ...children): Component,
    axes(props, ...children): Component,
    label(props, ...children): Component
};
`
