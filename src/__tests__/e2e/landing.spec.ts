import { describe, it, expect } from 'vitest';

/**
 * E2E tests for landing pages
 * Run with: npm run test
 */

const BASE_URL = process.env.VITE_APP_URL || 'http://localhost:5173';

describe('Landing Pages E2E', () => {
  describe('GET /landing', () => {
    it('should load landing page', async () => {
      const response = await fetch(`${BASE_URL}/landing`);
      expect(response.status).toBe(200);
    });

    it('should have required sections', async () => {
      const response = await fetch(`${BASE_URL}/landing`);
      const html = await response.text();
      expect(html).toContain('Identity Prism');
      expect(html).toContain('Problem');
      expect(html).toContain('Solution');
    });
  });

  describe('GET /demo', () => {
    it('should load card demo page', async () => {
      const response = await fetch(`${BASE_URL}/demo`);
      expect(response.status).toBe(200);
    });

    it('should render all 10 tiers', async () => {
      const response = await fetch(`${BASE_URL}/demo`);
      const html = await response.text();
      ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'Sun'].forEach(
        (tier) => {
          expect(html).toContain(tier);
        },
      );
    });
  });

  describe('GET /sybil-check', () => {
    it('should load sybil checker page', async () => {
      const response = await fetch(`${BASE_URL}/sybil-check`);
      expect(response.status).toBe(200);
    });

    it('should have example wallets', async () => {
      const response = await fetch(`${BASE_URL}/sybil-check`);
      const html = await response.text();
      expect(html).toContain('fenn.skr');
    });
  });
});
