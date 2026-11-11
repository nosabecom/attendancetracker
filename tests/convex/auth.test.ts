import { describe, expect, it, vi } from 'vitest';
import { signIn } from '../../convex/auth';
import { authenticateNode } from '../../convex/password';

describe('public authentication boundary', () => {
  it.each([
    { params: { code: '123', email: 'a@example.com' } },
    { provider: 'other', params: {} },
    { provider: 'credentials', params: { code: '123' } },
    { refreshToken: 'token', verifier: 'x' },
    { refreshToken: 'token', params: { code: '123' } },
  ])('rejects alternate flow without touching storage', async args => {
    const ctx = { runMutation: vi.fn(), runQuery: vi.fn(), runAction: vi.fn() };
    await expect((signIn as any)._handler(ctx, args)).rejects.toThrow('Invalid sign-in request.');
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(ctx.runAction).not.toHaveBeenCalled();
  });
  it('rejects an invalid proof before any storage access', async () => {
    const ctx = { runMutation: vi.fn(), runQuery: vi.fn() };
    const result = await (authenticateNode as any)._handler(ctx, { operation: 'login', username: 'teacher', password: 'longpassword', proof: {} });
    expect(result).toBeNull();
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });
});
