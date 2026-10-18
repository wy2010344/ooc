/**
 * multiBind(holder) —— 把「读/写持有者」（wy-helper 的 Signal、storage 的 Ref 等
 * 任何 { get, set }）包成一个 lambda：无参读、单参写。
 *
 *   count = multiBind $ (createSignal $ 0);
 *   count $          // → 0（读，用作响应式 GetValue 时会被追踪）
 *   count $ 5        // → 写 5
 *
 * 依据运行时对函数值的特判（`o $ args` 即调用函数本体），OOC 侧一个 lambda
 * 即可同时充当 setter 与 GetValue，省掉 {get,set} 的两套调用姿势。
 */
export type Holder<T = unknown> = {
  get(): T
  set(value: T): unknown
}

export function multiBind<T = unknown>(
  holder: Holder<T>,
): (...args: unknown[]) => T {
  return (...args: unknown[]) =>
    args.length ? (holder.set(args[0] as T), holder.get()) : holder.get()
}
