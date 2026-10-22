// order-book.ts — 本地全量订单簿：REST 快照铺底，@depth@100ms 增量帧持续修正。
//
// 为什么需要它：深度图要中间价 ±0.5%（BTCUSDT 约 1 万档）的完整簿，而币安的快照流
// 最多只有 20 档，5000 档只能靠 REST 拉一次。若用 REST 定时刷新，5 秒一次、每次 50 权重，
// 是全套接口里最贵的取数方式；改成「快照一次 + 增量流」后，REST 只在连接建立 / 断档时用一次。
//
// 同步算法照币安官方「How to manage a local order book」：
//   1. 拉快照，记住 lastUpdateId；
//   2. 订阅 <symbol>@depth@100ms，快照落地前先把增量帧缓冲起来；
//   3. 丢弃 u <= lastUpdateId 的旧帧；
//   4. 第一帧必须满足 U <= lastUpdateId + 1 <= u，否则中间缺帧，重新拉快照；
//   5. 逐帧应用：qty 为 0 删档，否则覆盖。

import type { Depth, DepthLevel } from './market.js'

/** 币安 `<symbol>@depth@100ms` 的增量帧。 */
export type DepthDiff = {
  /** 本帧首个更新号 */
  U: number
  /** 本帧末个更新号 */
  u: number
  b: [string, string][]
  a: [string, string][]
}

/** REST `/api/v3/depth` 的快照。 */
export type DepthSnapshot = {
  lastUpdateId: number
  bids: [string, string][]
  asks: [string, string][]
}

/** ok=已应用；skip=旧帧/未就绪；resync=缺帧，整个簿要重建。 */
export type ApplyResult = 'ok' | 'skip' | 'resync'

export type LocalBook = {
  /** 是否已经拿到过有效快照。 */
  ready(): boolean
  apply(diff: DepthDiff): ApplyResult
  reset(snapshot: DepthSnapshot): ApplyResult
  /** 当前全簿；未就绪返回 nil。数组是内部实例（下一次增量会原地修改），调用方只读。 */
  depth(): Depth | null
}

/** 每侧最大档数：比快照多留一点余量，防止长时间运行后簿无限长。 */
const MAX_LEVELS = 6000
/** 快照迟迟不回时的缓冲上限，超了丢最旧的（反正后面要重新对齐）。 */
const MAX_BUFFER = 4096

type Level = DepthLevel

function parseLevels(rows: [string, string][]): Level[] {
  const out: Level[] = []
  for (const [price, qty] of rows) {
    const p = Number(price)
    const q = Number(qty)
    if (Number.isFinite(p) && q > 0) out.push({ price: p, qty: q })
  }
  return out
}

/** 二分找插入位置：asc 为真时按升序（asks），否则按降序（bids）。 */
function locate(list: Level[], price: number, asc: boolean): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const value = list[mid].price
    if (asc ? value < price : value > price) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** 覆盖或删除单个价位；只动一个位置，不用整表重排。 */
function upsert(list: Level[], price: number, qty: number, asc: boolean): void {
  const index = locate(list, price, asc)
  const hit = list[index]
  if (qty <= 0) {
    // 删档：二分位置不一定就是该价位（可能根本没这档），命中才删。
    if (hit && hit.price === price) list.splice(index, 1)
    return
  }
  if (hit && hit.price === price) {
    hit.qty = qty
    return
  }
  list.splice(index, 0, { price, qty })
  // 超出上限时截断最深的一档（数组有序，末尾就是最深）。
  if (list.length > MAX_LEVELS) list.length = MAX_LEVELS
}

export function createLocalBook(): LocalBook {
  let bids: Level[] = []
  let asks: Level[] = []
  let lastUpdateId = 0
  let buffered: DepthDiff[] = []

  /** 应用一帧；调用前提是该帧已经被判过新旧。 */
  const applyOne = (diff: DepthDiff): ApplyResult => {
    if (diff.u <= lastUpdateId) return 'skip'
    // 中间缺帧：本地簿已经不可信，只能重新拉快照。
    if (diff.U > lastUpdateId + 1) return 'resync'
    for (const [price, qty] of diff.b) upsert(bids, Number(price), Number(qty), false)
    for (const [price, qty] of diff.a) upsert(asks, Number(price), Number(qty), true)
    lastUpdateId = diff.u
    return 'ok'
  }

  return {
    ready: () => lastUpdateId > 0,

    apply(diff) {
      if (!Number.isFinite(diff.U) || !Number.isFinite(diff.u)) return 'skip'
      // 快照还在路上：先攒着，reset 时按序回放。
      if (!lastUpdateId) {
        buffered.push(diff)
        if (buffered.length > MAX_BUFFER) buffered.shift()
        return 'skip'
      }
      return applyOne(diff)
    },

    reset(snapshot) {
      bids = parseLevels(snapshot.bids).sort((l, r) => r.price - l.price).slice(0, MAX_LEVELS)
      asks = parseLevels(snapshot.asks).sort((l, r) => l.price - r.price).slice(0, MAX_LEVELS)
      lastUpdateId = snapshot.lastUpdateId
      // 回放快照等待期间收到的帧：过期丢弃，缺帧则本次快照也算白拉。
      const pending = buffered
      buffered = []
      for (const diff of pending) {
        if (applyOne(diff) === 'resync') return 'resync'
      }
      return 'ok'
    },

    depth() {
      if (!lastUpdateId || (!bids.length && !asks.length)) return null
      return { bids, asks, time: Date.now() }
    },
  }
}
