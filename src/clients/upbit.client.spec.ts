import { Test, TestingModule } from '@nestjs/testing';
import { UpbitClient } from './upbit.client';

describe('UpbitClient', () => {
  let client: UpbitClient;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UpbitClient],
    }).compile();

    client = module.get<UpbitClient>(UpbitClient);

    jest.clearAllMocks();
  });

  describe('normalizeSymbol', () => {
    it('should convert BTC/USDT to KRW-BTC', () => {
      const result = client['normalizeSymbol']('BTC/USDT');
      expect(result).toBe('KRW-BTC');
    });

    it('should convert ETH/USDT to KRW-ETH', () => {
      const result = client['normalizeSymbol']('ETH/USDT');
      expect(result).toBe('KRW-ETH');
    });
  });

  describe('getPrice', () => {
    it('should fetch price successfully', async () => {
      const mockAxios = {
        get: jest.fn().mockResolvedValue({
          data: [
            {
              market: 'KRW-BTC',
              trade_price: 56000000,
              acc_trade_volume_24h: 1234.56,
              timestamp: 1704110400000,
            },
          ],
        }),
      };

      (client as any).axios = mockAxios;

      const result = await client.getPrice('BTC/USDT');

      expect(result).toEqual({
        price: 56000000,
        volume: 1234.56,
        timestamp: 1704110400000,
      });

      expect(mockAxios.get).toHaveBeenCalledWith('/v1/ticker', {
        params: { markets: 'KRW-BTC' },
      });
    });

    it('should return null on API error', async () => {
      const mockAxios = {
        get: jest.fn().mockRejectedValue(new Error('Network error')),
      };

      (client as any).axios = mockAxios;

      const result = await client.getPrice('BTC/USDT');

      expect(result).toBeNull();
    });

    it('should return null for empty response', async () => {
      const mockAxios = {
        get: jest.fn().mockResolvedValue({ data: [] }),
      };

      (client as any).axios = mockAxios;

      const result = await client.getPrice('BTC/USDT');

      expect(result).toBeNull();
    });
  });

  describe('getPrices', () => {
    it('should fetch multiple symbols in batch', async () => {
      const mockAxios = {
        get: jest.fn().mockResolvedValue({
          data: [
            {
              market: 'KRW-BTC',
              trade_price: 56000000,
              acc_trade_volume_24h: 1234.56,
              timestamp: 1704110400000,
            },
            {
              market: 'KRW-ETH',
              trade_price: 2900000,
              acc_trade_volume_24h: 5678.90,
              timestamp: 1704110400000,
            },
          ],
        }),
      };

      (client as any).axios = mockAxios;

      const results = await client.getPrices(['BTC/USDT', 'ETH/USDT']);

      expect(results.size).toBe(2);
      expect(results.get('BTC/USDT')).toEqual({
        price: 56000000,
        volume: 1234.56,
        timestamp: 1704110400000,
      });
      expect(results.get('ETH/USDT')).toEqual({
        price: 2900000,
        volume: 5678.9,
        timestamp: 1704110400000,
      });

      expect(mockAxios.get).toHaveBeenCalledWith('/v1/ticker', {
        params: { markets: 'KRW-BTC,KRW-ETH' },
      });
    });

    it('should return empty map on error', async () => {
      const mockAxios = {
        get: jest.fn().mockRejectedValue(new Error('Network error')),
      };

      (client as any).axios = mockAxios;

      const results = await client.getPrices(['BTC/USDT', 'ETH/USDT']);

      expect(results.size).toBe(0);
    });
  });
});
