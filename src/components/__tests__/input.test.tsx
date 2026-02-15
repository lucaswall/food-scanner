import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Input } from '@/components/ui/input';

describe('Input', () => {
  it('should have h-11 class for 44px touch target', () => {
    const { container } = render(<Input />);
    const input = container.querySelector('input');

    expect(input).toBeTruthy();
    expect(input?.className).toContain('h-11');
  });
});
