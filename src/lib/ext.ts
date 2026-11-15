/**
 * Namespace WebExtension dùng chung cho Chrome và Firefox.
 * - Firefox: `browser` (API trả về Promise — chuẩn của Firefox).
 * - Chrome: `chrome` (MV3 trả về Promise).
 */

type ExtApi = typeof chrome;

const g = globalThis as unknown as { browser?: ExtApi; chrome?: ExtApi };

export const ext: ExtApi = (g.browser ?? g.chrome) as ExtApi;

// An toàn khi nạp ngoài môi trường extension (unit test trong Node).
export const IS_FIREFOX: boolean = ext?.runtime?.getURL?.('').startsWith('moz-extension:') ?? false;
