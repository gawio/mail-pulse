import { describe, expect, it } from 'vitest';
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, backoffDelay, nextBackoff } from './backoff';

const noJitter = () => 0.5; // jitter = 1.0

describe('backoff', () => {
  it('tăng gấp đôi mỗi lần thất bại', () => {
    expect(backoffDelay(1, noJitter)).toBe(BACKOFF_BASE_MS);
    expect(backoffDelay(2, noJitter)).toBe(BACKOFF_BASE_MS * 2);
    expect(backoffDelay(3, noJitter)).toBe(BACKOFF_BASE_MS * 4);
  });

  it('không vượt quá mức trần', () => {
    expect(backoffDelay(50, () => 1)).toBe(BACKOFF_MAX_MS);
  });

  it('jitter trong khoảng ±20%', () => {
    expect(backoffDelay(1, () => 0)).toBe(BACKOFF_BASE_MS * 0.8);
    expect(backoffDelay(1, () => 1)).toBe(BACKOFF_BASE_MS * 1.2);
  });

  it('nextBackoff tăng attempt và đặt until', () => {
    const a = nextBackoff(undefined, 1000, noJitter);
    expect(a).toEqual({ attempt: 1, until: 1000 + BACKOFF_BASE_MS });
    const b = nextBackoff(a, 2000, noJitter);
    expect(b).toEqual({ attempt: 2, until: 2000 + BACKOFF_BASE_MS * 2 });
  });
});
