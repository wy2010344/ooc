import { createContext } from 'mve-core'
import { hookTrackSignal } from 'mve-helper'
import { createSignal, memo, addEffect } from 'wy-helper'
import { merge, js, storage } from 'object-oriented-c-language'
import { dom, text, html } from './dom.js'
import { fc, forEach } from './fc.js'
import {
  canvas,
  canvasDraw,
  align,
  colorToCSS,
  flex,
  grow,
  ignoreFlex,
  layoutSize,
  layoutSizeDirection,
  rgba,
} from './canvas.js'
import { readValue } from './args.js'
import { three } from './three.js'
import { bindSignal, bindRef, multiBind } from './multi-bind.js'
import { createPop, renderPop } from './pop.js'
import { floating } from './floating.js'
import {
  iconCheck,
  iconChevronDown,
  iconX,
  provideIconContext,
} from './icons.js'

/** 运行时的完整桥接 globals 集合（含 storage/js/merge、视图组件与响应式信号）。
 *  example/sandbox 等宿主一行注入：`createInterpretAction(..., createBridgeGlobals())`，
 *  不再逐个显式 import 桥接对象。类型侧用 createBridgeGlobalsTypes()（Route A）。
 */
export function createBridgeGlobals() {
  return {
    storage,
    js,
    merge,
    fc,
    createContext,
    dom,
    html,
    text,
    createSignal,
    memo,
    addEffect,
    forEach,
    multiBind,
    bindSignal,
    bindRef,
    createPop,
    renderPop,
    floating,
    hookTrackSignal,
    canvas,
    canvasDraw,
    three,
    flex,
    grow,
    align,
    ignoreFlex,
    rgba,
    colorToCSS,
    layoutSize,
    layoutSizeDirection,
    readValue,
    iconCheck,
    iconChevronDown,
    iconX,
    provideIconContext,
  }
}

export type { Globals } from 'object-oriented-c-language'