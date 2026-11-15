import { describe, expect, it, vi } from 'vitest';

// notifier.ts dùng API extension lúc nạp module — giả lập tối thiểu.
vi.stubGlobal('chrome', { runtime: { getURL: (p: string) => `chrome-extension://x/${p}` } });
const { badgeText } = await import('./notifier');

describe('badge', () => {
  it('ẩn khi 0, hiện số, "99+" khi vượt 99', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(7)).toBe('7');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });
});
