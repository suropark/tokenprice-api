import { describe, test, expect, beforeAll, mock } from 'bun:test';
import { BackfillService } from './backfill.service';
import { DrizzleService } from '../database/drizzle.service';
import { BinanceClient } from '../clients/binance.client';
import { UpbitClient } from '../clients/upbit.client';
import { FxRateService } from './fx-rate.service';

describe('BackfillService', () => {
  let service: BackfillService;
  let drizzleService: any;
  let binanceClient: any;
  let upbitClient: any;
  let fxRateService: any;

  beforeAll(() => {
    // Create mock services
    drizzleService = {
      db: {
        insert: mock(() => ({
          values: mock(() => ({
            onConflictDoUpdate: mock(() => Promise.resolve()),
          })),
        })),
      },
    };

    binanceClient = {
      getHistoricalDataRange: mock(() =>
        Promise.resolve([
          {
            time: Date.now(),
            open: 50000,
            high: 51000,
            low: 49000,
            close: 50500,
            volume: 100,
            quoteVolume: 5000000,
          },
        ]),
      ),
    };

    upbitClient = {
      getHistoricalDataRange: mock(() =>
        Promise.resolve([
          {
            time: Date.now(),
            open: 65000000,
            high: 66000000,
            low: 64000000,
            close: 65500000,
            volume: 10,
            quoteVolume: 655000000,
          },
        ]),
      ),
    };

    fxRateService = {};

    service = new BackfillService(
      drizzleService as any,
      binanceClient as any,
      upbitClient as any,
      fxRateService as any,
    );
  });

  describe('backfill', () => {
    test('should backfill data for specified date range', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-02');

      const result = await service.backfill({
        base: 'BTC',
        startDate,
        endDate,
        exchanges: ['binance', 'upbit'],
      });

      expect(result.status).toBe('completed');
      expect(result.base).toBe('BTC');
      expect(result.startDate).toEqual(startDate);
      expect(result.endDate).toEqual(endDate);
      expect(result.processedCandles).toBeGreaterThan(0);
    });

    test('should handle single exchange backfill', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-02');

      const result = await service.backfill({
        base: 'ETH',
        startDate,
        endDate,
        exchanges: ['binance'],
      });

      expect(result.status).toBe('completed');
      expect(binanceClient.getHistoricalDataRange).toHaveBeenCalled();
    });

    test('should calculate total candles correctly', async () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-01T01:00:00Z'); // 1 hour = 60 minutes

      const result = await service.backfill({
        base: 'BTC',
        startDate,
        endDate,
      });

      expect(result.totalCandles).toBe(60);
    });
  });

  describe('backfillLastDays', () => {
    test('should backfill last N days', async () => {
      const result = await service.backfillLastDays('BTC', 7);

      expect(result.status).toBe('completed');
      expect(result.base).toBe('BTC');

      // Check that the date range is approximately 7 days
      const daysDiff =
        (result.endDate.getTime() - result.startDate.getTime()) /
        (1000 * 60 * 60 * 24);
      expect(Math.abs(daysDiff - 7)).toBeLessThan(0.1);
    });
  });

  describe('backfillLastHours', () => {
    test('should backfill last N hours', async () => {
      const result = await service.backfillLastHours('BTC', 24);

      expect(result.status).toBe('completed');
      expect(result.base).toBe('BTC');

      // Check that the date range is approximately 24 hours
      const hoursDiff =
        (result.endDate.getTime() - result.startDate.getTime()) /
        (1000 * 60 * 60);
      expect(Math.abs(hoursDiff - 24)).toBeLessThan(0.1);
    });
  });

  describe('error handling', () => {
    test('should handle API errors gracefully', async () => {
      const failingClient = {
        getHistoricalDataRange: mock(() => Promise.reject(new Error('API Error'))),
      };

      const failingService = new BackfillService(
        drizzleService as any,
        failingClient as any,
        upbitClient as any,
        fxRateService as any,
      );

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-02');

      try {
        await failingService.backfill({
          base: 'BTC',
          startDate,
          endDate,
          exchanges: ['binance'],
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toContain('API Error');
      }
    });
  });
});
