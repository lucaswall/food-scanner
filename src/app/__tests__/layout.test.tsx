import { describe, it, expect, vi } from 'vitest'

// Mock next/font/google to avoid font loading in tests
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: '--font-geist-sans' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono' }),
}))

describe('Root Layout Metadata', () => {
  it('should have manifest link', async () => {
    const { metadata } = await import('../layout')
    expect(metadata.manifest).toBe('/manifest.json')
  })

  it('should have theme color in viewport', async () => {
    const { viewport } = await import('../layout')
    expect(viewport.themeColor).toBe('#000000')
  })

  it('should have apple touch icon', async () => {
    const { metadata } = await import('../layout')
    expect(metadata.icons).toBeDefined()
    const icons = metadata.icons as {
      apple?: string | { url: string }[]
    }
    expect(icons.apple).toBeDefined()
  })

  it('should have application name', async () => {
    const { metadata } = await import('../layout')
    expect(metadata.applicationName).toBe('Food Logger')
  })

  it('should have apple mobile web app capable', async () => {
    const { metadata } = await import('../layout')
    expect(metadata.appleWebApp).toBeDefined()
    const appleWebApp = metadata.appleWebApp as {
      capable?: boolean
      title?: string
      statusBarStyle?: string
    }
    expect(appleWebApp.capable).toBe(true)
    expect(appleWebApp.title).toBe('Food Logger')
  })
})
