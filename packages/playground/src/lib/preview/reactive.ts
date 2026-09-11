/**
 * 迷你信号实现（参考 wy-helper / mve 的信号语义，按本项目需求裁剪）：
 * - createSignal(value) → { get, set, destroy }：get 登记当前订阅者，set 变更后批量跑订阅者
 * - collectSignal(callback) → { collect(fun, remove?), destroy }：collect 跑一次 fun 并登记其读到的
 *   信号，之后相应信号一变，批量刷新时重跑 callback（renderForEach 用它做响应式整段重建）
 * - addEffect(fun)：立即跑一次，读到的信号变化后重跑
 * - memo(get, after?) → { get, destroy }：依赖信号变化自动重算，get 返回缓存
 *
 * 与 wy-helper 的差异：调度用 setTimeout(0)（浏览器与 Node 都安全），不构造 MessageChannel，
 * 因此 Node 下测试不会因隐式句柄挂起进程；批量刷新、计算期禁改值等语义保持一致。
 */

/** 订阅体：信号 get 时被登记为监听者；批次刷新时重跑 fun */
export interface Sub {
  readonly disabled: boolean
  fun(): void
  readonly signals: Set<SignalImpl<unknown>>
}

/** 信号的公共接口（OOC 里 createSignal apply emptyList 得到的就是它） */
export interface SignalLike<T> {
  get(): T
  set(v: T): T
  destroy(): void
}

/** 内部信号实现：负责登记/批处理订阅者 */
class SignalImpl<T> implements SignalLike<T> {
  private readonly listeners = new Set<Sub>()

  constructor(
    private _value: T,
    private readonly shouldChange: (a: T, b: T) => boolean,
  ) {}

  get(): T {
    if (activeSub && !activeSub.disabled) {
      this.listeners.add(activeSub)
      activeSub.signals.add(this as SignalImpl<unknown>)
    }
    return this._value
  }

  set(v: T): T {
    // 与 wy-helper 一致：计算期间不允许改值，避免刷新循环
    if (inWork && this.listeners.size) {
      throw new Error('计算期间不允许修改信号值')
    }
    if (!this.shouldChange(v, this._value)) return v
    this._value = v
    if (this.listeners.size) {
      for (const s of this.listeners) if (!s.disabled) batchSubs.add(s)
      this.listeners.clear()
      scheduleFlush()
    }
    return v
  }

  destroy(): void {
    this.listeners.clear()
  }

  _delete(sub: Sub): void {
    this.listeners.delete(sub)
  }
}

/** 当前正在执行/收集的订阅者，信号 get 时登记它 */
let activeSub: Sub | null = null
/** 是否已有待执行的批次 */
let scheduled = false
/** 正在批量刷新（期间禁止 set） */
let inWork = false
/** 本批要运行的订阅（set 时登记） */
const batchSubs = new Set<Sub>()
/** 建号即排队、每批都跑的订阅（对齐 wy-helper currentBatch.deps） */
let depsQueue: Sub[] = []

function simpleNotEqual<T>(a: T, b: T): boolean {
  return a !== b
}

function makeSub(fun: () => void): Sub {
  const sub: Sub = {
    disabled: false,
    fun: (): void => {
      if (!sub.disabled) runWith(sub, fun)
    },
    signals: new Set(),
  }
  return sub
}

/** 建号即排进批次队列的订阅（collectSignal 用） */
function createQueuedSub(fun: () => void): Sub {
  const sub = makeSub(fun)
  depsQueue.push(sub)
  scheduleFlush()
  return sub
}

/** 以 sub 为当前订阅者执行 fun（期间信号 get 会登记 sub 与它的信号集合），返回 fun 的结果 */
function runWith<T>(sub: Sub, fun: () => T): T {
  const prev = activeSub
  activeSub = sub
  try {
    return fun()
  } finally {
    activeSub = prev
  }
}

/** 把 sub 从它登记过的所有信号上摘除并停用 */
function unsubscribe(sub: Sub): void {
  for (const sig of sub.signals) sig._delete(sub)
  sub.signals.clear()
}

function scheduleFlush(): void {
  if (scheduled || inWork) return
  scheduled = true
  setTimeout(flush, 0)
}

function flush(): void {
  scheduled = false
  inWork = true
  try {
    // 兜底轮数防失控；正常在首个 while 内结束（计算期 set 会抛错，不会无限循环）
    let guard = 10000
    while ((batchSubs.size || depsQueue.length) && guard-- > 0) {
      const subs = [...batchSubs]
      batchSubs.clear()
      const deps = depsQueue
      depsQueue = []
      for (const s of subs) if (!s.disabled) s.fun()
      for (const d of deps) if (!d.disabled) d.fun()
    }
  } finally {
    inWork = false
    // 刷新期间又安排了对下一批的等待，则接着刷
    if (scheduled) flush()
  }
}

export function createSignal<T>(
  value: T,
  shouldChange: (a: T, b: T) => boolean = simpleNotEqual,
): SignalLike<T> {
  return new SignalImpl<T>(value, shouldChange)
}

export interface Collector {
  collect<T>(fun: () => T, remove?: boolean): T
  destroy(): void
}

/**
 * 响应式采集：collect 跑一次 fun（首次渲染并登记依赖），
 * 之后读到的任一信号变化，批次刷新时重跑 callback。
 */
export function collectSignal(callback: () => void): Collector {
  const sub = createQueuedSub(callback)
  return {
    collect<T>(fun: () => T, remove = false): T {
      if (remove) unsubscribe(sub)
      return runWith(sub, fun)
    },
    destroy(): void {
      sub as { disabled: boolean }
      ;(sub as { disabled: boolean }).disabled = true
      unsubscribe(sub)
    },
  }
}

/** 立即跑一次 fun，读到的信号变化后重跑（无销毁句柄，随运行会话一起废弃） */
export function addEffect(fun: () => void): void {
  const sub = makeSub(fun)
  runWith(sub, fun)
}

/**
 * 依赖信号变化自动重算：首次 query 立即算一次并登记依赖，
 * 之后任一依赖 set 后重算，get 返回最新缓存。
 */
export function memo<T>(
  get: (last?: T, inited?: boolean) => T,
  after?: (v: T) => void,
): { get(): T; destroy(): void } {
  let last!: T
  let inited = false
  const relay = makeSub((): void => {
    const v = runWith(relay, () => get(last, inited))
    if (!inited || v !== last) {
      last = v
      inited = true
      after?.(v)
    }
  })
  // 首次计算，登记依赖
  relay.fun()
  return {
    get: (): T => last,
    destroy: (): void => {
      relay as { disabled: boolean }
      ;(relay as { disabled: boolean }).disabled = true
      unsubscribe(relay)
    },
  }
}