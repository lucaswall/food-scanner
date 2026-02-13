import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('globals.css theme variables', () => {
  const cssContent = readFileSync(
    join(__dirname, '..', 'globals.css'),
    'utf-8'
  );

  describe('@theme inline mappings', () => {
    it('should define --color-success mapping', () => {
      expect(cssContent).toContain('--color-success: var(--success)');
    });

    it('should define --color-success-foreground mapping', () => {
      expect(cssContent).toContain(
        '--color-success-foreground: var(--success-foreground)'
      );
    });

    it('should define --color-warning mapping', () => {
      expect(cssContent).toContain('--color-warning: var(--warning)');
    });

    it('should define --color-warning-foreground mapping', () => {
      expect(cssContent).toContain(
        '--color-warning-foreground: var(--warning-foreground)'
      );
    });

    it('should define --color-info mapping', () => {
      expect(cssContent).toContain('--color-info: var(--info)');
    });

    it('should define --color-info-foreground mapping', () => {
      expect(cssContent).toContain(
        '--color-info-foreground: var(--info-foreground)'
      );
    });
  });

  describe(':root light mode colors', () => {
    it('should define --success variable', () => {
      expect(cssContent).toMatch(/:root\s*{[^}]*--success:/);
    });

    it('should define --success-foreground variable', () => {
      expect(cssContent).toMatch(/:root\s*{[^}]*--success-foreground:/);
    });

    it('should define --warning variable', () => {
      expect(cssContent).toMatch(/:root\s*{[^}]*--warning:/);
    });

    it('should define --warning-foreground variable', () => {
      expect(cssContent).toMatch(/:root\s*{[^}]*--warning-foreground:/);
    });

    it('should define --info variable', () => {
      expect(cssContent).toMatch(/:root\s*{[^}]*--info:/);
    });

    it('should define --info-foreground variable', () => {
      expect(cssContent).toMatch(/:root\s*{[^}]*--info-foreground:/);
    });
  });

  describe('.dark mode colors', () => {
    it('should define --success variable', () => {
      expect(cssContent).toMatch(/\.dark\s*{[^}]*--success:/);
    });

    it('should define --success-foreground variable', () => {
      expect(cssContent).toMatch(/\.dark\s*{[^}]*--success-foreground:/);
    });

    it('should define --warning variable', () => {
      expect(cssContent).toMatch(/\.dark\s*{[^}]*--warning:/);
    });

    it('should define --warning-foreground variable', () => {
      expect(cssContent).toMatch(/\.dark\s*{[^}]*--warning-foreground:/);
    });

    it('should define --info variable', () => {
      expect(cssContent).toMatch(/\.dark\s*{[^}]*--info:/);
    });

    it('should define --info-foreground variable', () => {
      expect(cssContent).toMatch(/\.dark\s*{[^}]*--info-foreground:/);
    });
  });
});
