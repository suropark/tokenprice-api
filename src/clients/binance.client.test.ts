import { describe, test, expect, beforeAll } from 'bun:test';
import { BinanceClient } from './binance.client';
import { Logger } from '@nestjs/common';

describe('BinanceClient', () => {
  let client: BinanceClient;

  beforeAll(() => {
    // Disable logging during tests
    Logger.overrideLogger(false);
    client = new BinanceClient();
  });

  describe('getPrice', () => {
    test('should fetch BTC/USDT price successfully', async () => {
      const result = await client.getPrice('BTC/USDT');

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

    test('should fetch ETH/USDT price successfully', async () => {
      const result = await client.getPrice('ETH/USDT');

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
      // Test that BTC/USDT is normalized to BTCUSDT internally
      const result = await client.getPrice('BTC/USDT');

      expect(result).toBeDefined();
      expect(result).not.toBeNull();
    });
  });

  describe('getPrices', () => {
    test('should fetch multiple prices in parallel', async () => {
      const symbols = ['BTC/USDT', 'ETH/USDT', 'BNB/USDT'];
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
      const symbols = ['BTC/USDT', 'INVALID/SYMBOL', 'ETH/USDT'];
      const results = await client.getPrices(symbols);

      // Should have at least 2 valid results (BTC and ETH)
      expect(results.size).toBeGreaterThanOrEqual(2);

      // Valid symbols should be present
      expect(results.has('BTC/USDT')).toBe(true);
      expect(results.has('ETH/USDT')).toBe(true);

      // Invalid symbol should not be present
      expect(results.has('INVALID/SYMBOL')).toBe(false);
    });

    test('should return empty map for empty symbol array', async () => {
      const results = await client.getPrices([]);

      expect(results.size).toBe(0);
    });
  });

  describe('Real-time data validation', () => {
    test('should return reasonable price values', async () => {
      const result = await client.getPrice('BTC/USDT');

      if (result) {
        // BTC price should be above $1,000 and below $1,000,000 (sanity check)
        expect(result.price).toBeGreaterThan(1000);
        expect(result.price).toBeLessThan(1000000);
      }
    });

    test('should have recent timestamp', async () => {
      const result = await client.getPrice('BTC/USDT');

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
    test('should connect to Binance API successfully', async () => {
      const result = await client.getPrice('BTC/USDT');

      // If we get a result, API is reachable
      expect(result).not.toBeNull();
    }, 10000); // 10 second timeout for network request
  });
});
