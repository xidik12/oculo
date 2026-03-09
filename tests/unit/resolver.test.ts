import { describe, it, expect } from 'vitest'

// The resolver module requires Electron's WebContents for element resolution.
// These tests verify the module structure and exported types load correctly.

describe('Element Resolver', () => {
  it('should export resolver module', async () => {
    const mod = await import('../../src/main/engine/resolver')
    expect(mod).toBeDefined()
    expect(mod.ElementResolver).toBeDefined()
  })

  it('should have ElementResolver as a class constructor', async () => {
    const { ElementResolver } = await import('../../src/main/engine/resolver')
    expect(typeof ElementResolver).toBe('function')
    const instance = new ElementResolver()
    expect(instance).toBeInstanceOf(ElementResolver)
  })

  it('should have a resolve method', async () => {
    const { ElementResolver } = await import('../../src/main/engine/resolver')
    const instance = new ElementResolver()
    expect(typeof instance.resolve).toBe('function')
  })
})
