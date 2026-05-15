import { describe, expect, it } from 'vitest';

import { resolveNativeAppPath } from '../nativeAppUrl';

describe('resolveNativeAppPath', () => {
  it('maps custom scheme host routes', () => {
    expect(resolveNativeAppPath('identityprism://blackhole')).toBe('/blackhole');
  });

  it('maps custom scheme app routes with query and hash', () => {
    expect(resolveNativeAppPath('identityprism://app/blackhole?address=abc#focus')).toBe('/blackhole?address=abc#focus');
  });

  it('maps production https app links', () => {
    expect(resolveNativeAppPath('https://identityprism.xyz/blackhole')).toBe('/blackhole');
  });

  it('maps staging subdomains too', () => {
    expect(resolveNativeAppPath('https://staging.identityprism.xyz/app?address=abc')).toBe('/app?address=abc');
  });

  it('rejects unrelated hosts and malformed values', () => {
    expect(resolveNativeAppPath('https://example.com/blackhole')).toBeNull();
    expect(resolveNativeAppPath('not a url')).toBeNull();
    expect(resolveNativeAppPath(null)).toBeNull();
  });
});
