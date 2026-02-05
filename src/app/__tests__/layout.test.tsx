import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'

// Mock next/font/google to avoid font loading in tests
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: '--font-geist-sans' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono' }),
}))

// Mock ThemeProvider
vi.mock('@/components/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="theme-provider">{children}</div>
  ),
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

describe('Root Layout Component', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders ThemeProvider wrapping children', async () => {
    const RootLayout = (await import('../layout')).default

    const testChild = <div data-testid="child">Test Child</div>
    const result = RootLayout({ children: testChild })

    // result is an html element, we need to find the body and render its content
    // The structure is: <html><head>...</head><body><ThemeProvider>{children}</ThemeProvider></body></html>
    // Extract body content
    const body = result.props.children[1] // body is second child after head
    const bodyContent = body.props.children // ThemeProvider wrapper
    
    const { getByTestId } = render(<>{bodyContent}</>)

    expect(getByTestId('theme-provider')).toBeInTheDocument()
    expect(getByTestId('child')).toBeInTheDocument()
  })

  it('includes theme initialization script in head', async () => {
    const RootLayout = (await import('../layout')).default
    const result = RootLayout({ children: <div>Test</div> })

    // Check that html element has suppressHydrationWarning
    expect(result.props.suppressHydrationWarning).toBe(true)

    // Check for script in head
    const headChildren = result.props.children
    // First child should be head
    const head = Array.isArray(headChildren) ? headChildren[0] : null
    expect(head).not.toBeNull()
    expect(head?.type).toBe('head')

    // Head should contain a script element
    const headContent = head?.props?.children
    const scriptElement = Array.isArray(headContent)
      ? headContent.find((c: { type?: string }) => c?.type === 'script')
      : headContent?.type === 'script' ? headContent : null
    expect(scriptElement).not.toBeNull()
    expect(scriptElement?.props?.dangerouslySetInnerHTML?.__html).toContain('localStorage')
    expect(scriptElement?.props?.dangerouslySetInnerHTML?.__html).toContain('theme')
  })
})
