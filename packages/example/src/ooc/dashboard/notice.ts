// notice.ts —— 演示/免责声明的「已读」标记与延迟弹出。
// 只用 localStorage 存一个字符串标记：隐私模式下读写会抛，统一按「没读过」处理，
// 宁可多弹一次，也不要因为存储不可用把整页炸掉。
const STORAGE_NOTICE = 'ooc-market-notice-v1'

export function noticeSeen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_NOTICE) === '1'
  } catch {
    return false
  }
}

export function markNoticeSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_NOTICE, '1')
  } catch {
    // 忽略：标记失败只是下次还会弹
  }
}

/**
 * 延后一拍再执行，返回取消函数。
 * 首次进入页面时挂在组件体里，而组件体本身就跑在信号批次的 listener 阶段，
 * 此时同步创建弹层会往「正在计算」的链路上写信号，故推到宏任务里做。
 */
function deferNotice(run: () => void): () => void {
  const id = setTimeout(run, 0)
  return () => clearTimeout(id)
}

/** 首次进入才弹：读标记与执行都推到宏任务里，返回取消函数（挂 addDestroy）。 */
export function whenFirstVisit(run: () => void): () => void {
  return deferNotice(() => {
    if (!noticeSeen()) run()
  })
}
