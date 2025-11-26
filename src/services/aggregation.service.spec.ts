import { Test, TestingModule } from '@nestjs/testing';
import { AggregationService } from './aggregation.service';
import { PriceData } from '../clients/binance.client';

describe('AggregationService', () => {
  let service: AggregationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AggregationService],
    }).compile();

    service = module.get<AggregationService>(AggregationService);
  });

  describe('calculateMedian', () => {
    it('should calculate median for odd number of prices', () => {
      const result = service.calculateMedian([100, 150, 200]);
      expect(result).toBe(150);
    });

    it('should calculate median for even number of prices', () => {
      const result = service.calculateMedian([100, 200]);
      expect(result).toBe(150);
    });

    it('should handle single price', () => {
      const result = service.calculateMedian([100]);
      expect(result).toBe(100);
    });

    it('should sort prices correctly', () => {
      const result = service.calculateMedian([200, 100, 150]);
      expect(result).toBe(150);
    });

    it('should throw error for empty array', () => {
      expect(() => service.calculateMedian([])).toThrow('No prices to aggregate');
    });
  });

  describe('calculateVWAP', () => {
    it('should calculate VWAP correctly', () => {
      const data: PriceData[] = [
        { price: 100, volume: 1000, timestamp: Date.now() },
        { price: 200, volume: 4000, timestamp: Date.now() },
      ];

      // VWAP = (100*1000 + 200*4000) / (1000 + 4000) = 180
      const result = service.calculateVWAP(data);
      expect(result).toBeCloseTo(180, 2);
    });

    it('should give equal weight when volumes are equal', () => {
      const data: PriceData[] = [
        { price: 100, volume: 1000, timestamp: Date.now() },
        { price: 200, volume: 1000, timestamp: Date.now() },
      ];

      const result = service.calculateVWAP(data);
      expect(result).toBeCloseTo(150, 2);
    });

    it('should give more weight to higher volume', () => {
      const data: PriceData[] = [
        { price: 100, volume: 100, timestamp: Date.now() },
        { price: 200, volume: 9900, timestamp: Date.now() },
      ];

      const result = service.calculateVWAP(data);
      expect(result).toBeCloseTo(199, 0); // Close to 200
    });

    it('should fallback to median when no volume', () => {
      const data: PriceData[] = [
        { price: 100, volume: 0, timestamp: Date.now() },
        { price: 200, volume: 0, timestamp: Date.now() },
      ];

      const result = service.calculateVWAP(data);
      expect(result).toBe(150);
    });
  });

  describe('aggregate', () => {
    it('should use VWAP when volume is available', () => {
      const data: PriceData[] = [
        { price: 100, volume: 1000, timestamp: Date.now() },
        { price: 200, volume: 4000, timestamp: Date.now() },
      ];

      const result = service.aggregate(data);

      expect(result.algorithm).toBe('vwap');
      expect(result.price).toBeCloseTo(180, 2);
      expect(result.volume).toBe(5000);
      expect(result.sourceCount).toBe(2);
    });

    it('should use median when no volume', () => {
      const data: PriceData[] = [
        { price: 100, volume: 0, timestamp: Date.now() },
        { price: 200, volume: 0, timestamp: Date.now() },
      ];

      const result = service.aggregate(data);

      expect(result.algorithm).toBe('median');
      expect(result.price).toBe(150);
      expect(result.volume).toBe(0);
      expect(result.sourceCount).toBe(2);
    });

    it('should handle single source', () => {
      const data: PriceData[] = [{ price: 42000, volume: 100, timestamp: Date.now() }];

      const result = service.aggregate(data);

      expect(result.price).toBe(42000);
      expect(result.sourceCount).toBe(1);
    });

    it('should throw error for empty data', () => {
      expect(() => service.aggregate([])).toThrow('No price data to aggregate');
    });

    it('should sum volumes correctly', () => {
      const data: PriceData[] = [
        { price: 100, volume: 1000, timestamp: Date.now() },
        { price: 200, volume: 2000, timestamp: Date.now() },
        { price: 150, volume: 3000, timestamp: Date.now() },
      ];

      const result = service.aggregate(data);

      expect(result.volume).toBe(6000);
    });
  });
});
