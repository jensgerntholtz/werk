import { describe, expect, it } from 'vitest'
import * as werk from '../src/index'

describe('@werk/core public entry', () => {
  it('loads as an ES module and exposes no runtime API yet', () => {
    expect(werk).toBeTypeOf('object')
    expect(Object.keys(werk)).toEqual([])
  })
})
