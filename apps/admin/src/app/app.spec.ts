import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';

describe('admin routing foundation', () => {
  it('has an entry route and lazy-loaded status page', () => {
    expect(routes[0]?.path).toBe('');
    expect(routes.find((route) => route.path === 'status')?.loadComponent).toBeTypeOf('function');
  });

  it('does not expose a payment route in G1', () => {
    expect(routes.some((route) => route.path?.includes('payment'))).toBe(false);
  });
});
