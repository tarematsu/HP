import { describe, expect, it } from 'vitest';
import { requestFamily } from '../src/unified_routes.js';

describe('unified Worker route boundaries', () => {
  it.each([
    ['/admin', 'homepanel'],
    ['/v1', 'homepanel'],
    ['/v1/health', 'homepanel'],
    ['/v1/device/exchange', 'homepanel'],
    ['/v1/update/file/app.exe', 'homepanel'],
    ['/api/videos', 'video'],
    ['/api/admin/import', 'video'],
    ['/', 'video'],
    ['/styles.css', 'video'],
  ])('routes %s to %s', (pathname, expected) => {
    expect(requestFamily(pathname)).toBe(expected);
  });

  it('does not treat lookalike paths as HomePanel API routes', () => {
    expect(requestFamily('/v10/health')).toBe('video');
    expect(requestFamily('/admin-tools')).toBe('video');
  });
});
