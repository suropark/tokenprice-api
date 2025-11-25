import { Test, TestingModule } from '@nestjs/testing';
import { BinanceClient } from './binance.client';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BinanceClient', () => {
  let client: BinanceClient;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BinanceClient],
    }).compile();

    client = module.get<BinanceClient>(BinanceClient);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('normalizeSymbol', () => {
    it('should convert BTC/USDT to BTCUSDT', () => {
      const result = client['normalizeSymbol']('BTC/USDT');
      expect(result).toBe('BTCUSDT');
    });

    it('should convert ETH/USDT to ETHUSDT', () => {
      const result = client['normalizeSymbol']('ETH/USDT');
      expect(result).toBe('ETHUSDT');
    });
  });

  describe('getPrice', () => {
    it('should fetch price successfully', async () => {
      const mockAxios = {
        get: jest.fn().mockResolvedValue({
          data: {
            symbol: 'BTCUSDT',
            lastPrice: '42000.50',
            volume: '1234.56',
            closeTime: 1704110400000,
          },
        }),
      };

      (client as any).axios = mockAxios;

      const result = await client.getPrice('BTC/USDT');

      expect(result).toEqual({
        price: 42000.5,
        volume: 1234.56,
        timestamp: 1704110400000,
      });

      expect(mockAxios.get).toHaveBeenCalledWith('/api/v3/ticker/24hr', {
        params: { symbol: 'BTCUSDT' },
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

    it('should return null for invalid symbol', async () => {
      const mockAxios = {
        get: jest.fn().mockRejectedValue({ response: { status: 400 } }),
      };

      (client as any).axios = mockAxios;

      const result = await client.getPrice('INVALID/USDT');

      expect(result).toBeNull();
    });
  });

  describe('getPrices', () => {
    it('should fetch multiple symbols', async () => {
      const mockAxios = {
        get: jest
          .fn()
          .mockResolvedValueOnce({
            data: {
              symbol: 'BTCUSDT',
              lastPrice: '42000.50',
              volume: '1234.56',
              closeTime: 1704110400000,
            },
          })
          .mockResolvedValueOnce({
            data: {
              symbol: 'ETHUSDT',
              lastPrice: '2200.75',
              volume: '5678.90',
              closeTime: 1704110400000,
            },
          }),
      };

      (client as any).axios = mockAxios;

      const results = await client.getPrices(['BTC/USDT', 'ETH/USDT']);

      expect(results.size).toBe(2);
      expect(results.get('BTC/USDT')).toEqual({
        price: 42000.5,
        volume: 1234.56,
        timestamp: 1704110400000,
      });
      expect(results.get('ETH/USDT')).toEqual({
        price: 2200.75,
        volume: 5678.9,
        timestamp: 1704110400000,
      });
    });

    it('should skip failed requests', async () => {
      const mockAxios = {
        get: jest
          .fn()
          .mockResolvedValueOnce({
            data: {
              symbol: 'BTCUSDT',
              lastPrice: '42000.50',
              volume: '1234.56',
              closeTime: 1704110400000,
            },
          })
          .mockRejectedValueOnce(new Error('Network error')),
      };

      (client as any).axios = mockAxios;

      const results = await client.getPrices(['BTC/USDT', 'ETH/USDT']);

      expect(results.size).toBe(1);
      expect(results.has('BTC/USDT')).toBe(true);
      expect(results.has('ETH/USDT')).toBe(false);
    });
  });
});
