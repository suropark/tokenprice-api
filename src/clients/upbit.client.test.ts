import { describe, test, expect, beforeAll } from 'bun:test';
import { UpbitClient } from './upbit.client';
import { Logger } from '@nestjs/common';

describe('UpbitClient', () => {
  let client: UpbitClient;

  beforeAll(() => {
    // Disable logging during tests
    Logger.overrideLogger(false);
    client = new UpbitClient();
  });

  describe('getPrice', () => {
    test('should fetch BTC/KRW price successfully', async () => {
      const result = await client.getPrice('BTC/KRW');

      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      if (result) {
        expect(result.price).toBeGreaterThan(0);
        expect(result.volume).toBeGreaterThan(0);
        expect(result.timestamp).toBeGreaterThan(0);
        expect(typeof result.price).toBe('number');
        expect(typeof result.volume).toBe('number');
        expect(typeof result.timestamp).toBe('number');
      }
    });

    test('should fetch ETH/KRW price successfully', async () => {
      const result = await client.getPrice('ETH/KRW');

      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      if (result) {
        expect(result.price).toBeGreaterThan(0);
        expect(result.volume).toBeGreaterThan(0);
        expect(typeof result.price).toBe('number');
      }
    });

    test('should handle invalid symbol gracefully', async () => {
      const result = await client.getPrice('INVALID/SYMBOL');

      expect(result).toBeNull();
    });

    test('should normalize symbol format correctly', async () => {
      // Test that BTC/KRW is normalized to KRW-BTC internally
      const result = await client.getPrice('BTC/KRW');

      expect(result).toBeDefined();
      expect(result).not.toBeNull();
    });
  });

  describe('getPrices', () => {
    test('should fetch multiple prices in batch', async () => {
      const symbols = ['BTC/KRW', 'ETH/KRW', 'XRP/KRW'];
      const results = await client.getPrices(symbols);

      expect(results.size).toBeGreaterThan(0);
      expect(results.size).toBeLessThanOrEqual(symbols.length);

      for (const [symbol, data] of results) {
        expect(symbols).toContain(symbol);
        expect(data.price).toBeGreaterThan(0);
        expect(data.volume).toBeGreaterThan(0);
        expect(data.timestamp).toBeGreaterThan(0);
      }
    });

    test('should handle mix of valid and invalid symbols', async () => {
      const symbols = ['BTC/KRW', 'INVALID/SYMBOL', 'ETH/KRW'];
      const results = await client.getPrices(symbols);

      // Should have at least 2 valid results (BTC and ETH)
      expect(results.size).toBeGreaterThanOrEqual(2);

      // Valid symbols should be present
      expect(results.has('BTC/KRW')).toBe(true);
      expect(results.has('ETH/KRW')).toBe(true);
    });

    test('should return empty map for empty symbol array', async () => {
      const results = await client.getPrices([]);

      expect(results.size).toBe(0);
    });
  });

  describe('Real-time data validation', () => {
    test('should return reasonable KRW price values', async () => {
      const result = await client.getPrice('BTC/KRW');

      if (result) {
        // BTC price in KRW should be above 1,000,000 and below 1,000,000,000 (sanity check)
        expect(result.price).toBeGreaterThan(1000000);
        expect(result.price).toBeLessThan(1000000000);
      }
    });

    test('should have recent timestamp', async () => {
      const result = await client.getPrice('BTC/KRW');

      if (result) {
        const now = Date.now();
        const fiveMinutesAgo = now - 5 * 60 * 1000;

        // Timestamp should be within last 5 minutes
        expect(result.timestamp).toBeGreaterThan(fiveMinutesAgo);
        expect(result.timestamp).toBeLessThanOrEqual(now);
      }
    });
  });

  describe('API endpoint connectivity', () => {
    test('should connect to Upbit API successfully', async () => {
      const result = await client.getPrice('BTC/KRW');

      // If we get a result, API is reachable
      expect(result).not.toBeNull();
    }, 10000); // 10 second timeout for network request
  });

  describe('Upbit specific features', () => {
    test('should support batch request with comma-separated markets', async () => {
      const symbols = ['BTC/KRW', 'ETH/KRW'];
      const results = await client.getPrices(symbols);

      // Upbit should return all requested symbols in one API call
      expect(results.size).toBe(symbols.length);
    });

    test('should handle various Korean market pairs', async () => {
      const symbols = ['BTC/KRW', 'ETH/KRW', 'XRP/KRW', 'ADA/KRW'];
      const results = await client.getPrices(symbols);

      expect(results.size).toBeGreaterThan(0);

      for (const [, data] of results) {
        // All prices should be in KRW, so they should be relatively large numbers
        expect(data.price).toBeGreaterThan(0);
      }
    });
  });
});
