import { describe, it, expect } from 'vitest'
import { buttonVariants } from '../button'

describe('Button Touch Target Sizes', () => {
  // Tailwind height classes map:
  // h-11 = 44px, h-12 = 48px
  // size-11 = 44px, size-12 = 48px
  // All buttons must be at least 44px (CLAUDE.md policy)

  it('should have default size of 44px (h-11)', () => {
    const classes = buttonVariants({ size: 'default' })
    expect(classes).toContain('h-11')
  })

  it('should have lg size of 48px (h-12)', () => {
    const classes = buttonVariants({ size: 'lg' })
    expect(classes).toContain('h-12')
  })

  it('should have sm size of 44px (h-11)', () => {
    const classes = buttonVariants({ size: 'sm' })
    expect(classes).toContain('h-11')
  })

  it('should have icon size of 44px (size-11)', () => {
    const classes = buttonVariants({ size: 'icon' })
    expect(classes).toContain('size-11')
  })

  it('should have icon-sm size of 44px (size-11)', () => {
    const classes = buttonVariants({ size: 'icon-sm' })
    expect(classes).toContain('size-11')
  })

  it('should have icon-lg size of 48px (size-12)', () => {
    const classes = buttonVariants({ size: 'icon-lg' })
    expect(classes).toContain('size-12')
  })
})
