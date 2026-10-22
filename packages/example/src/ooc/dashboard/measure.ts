// measure.ts —— 把元素尺寸接进响应式系统。
// mve 的标签工厂支持 plugin(el) 挂载钩子、willRemove(node) 卸载钩子，
// 两者都在 OOC 侧写成普通方法即可；这里只负责观察尺寸并回调。

export type ElementSize = { width: number; height: number }

/**
 * 观察元素内容盒尺寸；返回断开函数，组件卸载时调用。
 * 首次尺寸由 ResizeObserver 的首个回调给出——不在构建期同步写信号。
 */
export function watchSize(
  el: HTMLElement | null | undefined,
  onSize: (size: ElementSize) => void,
): () => void {
  if (!el || typeof ResizeObserver === 'undefined') return () => {}
  let last = ''
  const report = () => {
    const width = el.clientWidth
    const height = el.clientHeight
    const key = `${width}x${height}`
    if (key === last) return
    last = key
    onSize({ width, height })
  }
  const observer = new ResizeObserver(report)
  observer.observe(el)
  return () => observer.disconnect()
}
