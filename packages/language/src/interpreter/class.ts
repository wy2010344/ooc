import type { ClassDef, MethodAll } from '../generated/ast.js'
import { OOC_CLASS } from '../library/object.js'
import { addScope, type Scope } from './scope.js'
import {
  bindMethod,
  getObjDefineName,
  objectValue,
  runBody,
} from './runtime.js'

/**
 * 从 #classDef 创建类对象。
 *
 * 类对象 = 类方法块（除 new 外的静态方法）烧录成的普通 OOC 对象；
 * `new` 是实例化入口：每次调用都用「实例方法块」独立求值生成一个全新层对象，
 * bind/mutable 缓存按实例隔离、互不共享。构造方法体里 `self` 指向新实例
 * （responser 也是实例，符合消息接收者语义）。
 *
 * 实例归属：实例与类对象都打上 OOC_CLASS 标记，`include` 据此判定 instance-of。
 */
export function createClass(classDef: ClassDef, scope: Scope) {
  // 抽取构造方法：类方法块里的 new；未声明时用空构造兜底
  let newDef: MethodAll | undefined
  const classMethods = classDef.classMethods.filter((m) => {
    if (getObjDefineName(m.name) === 'new' && m.$type === 'MethodAll') {
      newDef = m
      return false
    }
    return true
  })
  // 类对象：静态方法直接烧录（bind/mutable/call 都由 objectValue 处理）。
  // 空类方法块不能走 objectValue 的共享空对象单例，否则会把类标记写进全局 {} 字面量
  const classObj =
    classMethods.length > 0
      ? objectValue(classMethods, scope, undefined)
      : {}
  // 类归属标记：类对象指向自身，实例指向类
  Object.defineProperty(classObj, OOC_CLASS, {
    enumerable: false,
    value: classObj,
  })
  // 构造入口：发送 new 消息 → 生成全新实例
  Object.defineProperty(classObj, 'new', {
    enumerable: true,
    value: (...args: unknown[]) => {
      // 每个实例用实例方法块独立求值出的层对象，bind/mutable 缓存按实例隔离；
      // 空实例方法块同样绕开共享空对象
      const instance =
        classDef.instanceMethods.length > 0
          ? objectValue(classDef.instanceMethods, scope, undefined)
          : {}
      Object.defineProperty(instance, OOC_CLASS, {
        enumerable: false,
        value: classObj,
      })
      if (newDef) {
        const s = addScope(
          bindMethod(newDef, scope, instance, args),
          'self',
          instance,
        )
        runBody(newDef.expressions, s)
      }
      return instance
    },
  })
  return classObj
}