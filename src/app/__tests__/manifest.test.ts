import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

describe('PWA Manifest', () => {
  const manifestPath = join(process.cwd(), 'public', 'manifest.json')

  it('should have manifest.json in public directory', () => {
    expect(existsSync(manifestPath)).toBe(true)
  })

  it('should have required PWA fields', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

    expect(manifest.name).toBe('Food Logger')
    expect(manifest.short_name).toBe('FoodLog')
    expect(manifest.description).toBe('AI-powered food logging for Fitbit')
    expect(manifest.start_url).toBe('/app')
    expect(manifest.display).toBe('standalone')
    expect(manifest.background_color).toBe('#ffffff')
    expect(manifest.theme_color).toBe('#ffffff') // Match light mode background
    expect(manifest.orientation).toBe('portrait')
  })

  it('should have valid icon configurations', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

    expect(manifest.icons).toBeDefined()
    expect(Array.isArray(manifest.icons)).toBe(true)
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2)

    // Check for 192x192 icon
    const icon192 = manifest.icons.find(
      (icon: { sizes: string }) => icon.sizes === '192x192'
    )
    expect(icon192).toBeDefined()
    expect(icon192.src).toBe('/icon-192.png')
    expect(icon192.type).toBe('image/png')

    // Check for 512x512 icon
    const icon512 = manifest.icons.find(
      (icon: { sizes: string }) => icon.sizes === '512x512'
    )
    expect(icon512).toBeDefined()
    expect(icon512.src).toBe('/icon-512.png')
    expect(icon512.type).toBe('image/png')
  })
})
