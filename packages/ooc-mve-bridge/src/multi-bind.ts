import { storage } from 'object-oriented-c-language'
import { createSignal } from 'wy-helper'

/**
 * multiBind(holder) —— 把「读/写持有者」（wy-helper 的 Signal、storage 的 Ref 等
 * 任何 { get, set }）包成一个 lambda：无参读、单参写。
 *
 *   count = multiBind $ (storage ref 0);
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

/** 无参读、单参写的绑定函数；重载让 TS 侧也能区分读/写。 */
export type Bound<T = unknown> = {
  (): T
  (value: T): T
}

export function multiBind<T = unknown>(holder: Holder<T>): Bound<T> {
  const bound = (...args: unknown[]) =>
    args.length ? (holder.set(args[0] as T), holder.get()) : holder.get()
  return bound as Bound<T>
}

/**
 * bindSignal(initial) —— createSignal + multiBind 的常用组合。
 *
 *   count = bindSignal $ 0;
 *   count $          // 读
 *   count $ 5        // 写
 */
export function bindSignal<T = unknown>(initial: T): Bound<T> {
  return multiBind(createSignal(initial))
}

/**
 * bindRef(initial) —— storage Ref + multiBind 的组合。
 *
 *   count = bindRef $ 0;
 *   count $          // 读
 *   count $ 5        // 写
 */
export function bindRef<T = unknown>(initial: T): Bound<T> {
  return multiBind(storage.ref(initial) as Holder<T>)
}
