import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CollectorService } from './collector.service';
import { BinanceClient } from '../clients/binance.client';
import { UpbitClient } from '../clients/upbit.client';
import { AggregationService } from './aggregation.service';

describe('CollectorService', () => {
  let service: CollectorService;
  let redis: any;
  let binance: BinanceClient;
  let upbit: UpbitClient;
  let aggregator: AggregationService;

  beforeEach(async () => {
    redis = {
      exists: jest.fn(),
      hset: jest.fn(),
      hmget: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectorService,
        {
          provide: 'REDIS_CLIENT',
          useValue: redis,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key) => {
              if (key === 'symbols') return ['BTC/USDT'];
              return null;
            }),
          },
        },
        {
          provide: BinanceClient,
          useValue: {
            getPrice: jest.fn(),
          },
        },
        {
          provide: UpbitClient,
          useValue: {
            getPrice: jest.fn(),
          },
        },
        AggregationService,
      ],
    }).compile();

    service = module.get<CollectorService>(CollectorService);
    binance = module.get<BinanceClient>(BinanceClient);
    upbit = module.get<UpbitClient>(UpbitClient);
    aggregator = module.get<AggregationService>(AggregationService);
  });

  describe('collectSymbol', () => {
    it('should fetch from both exchanges and update Redis', async () => {
      jest.spyOn(binance, 'getPrice').mockResolvedValue({
        price: 42000,
        volume: 100,
        timestamp: Date.now(),
      });

      jest.spyOn(upbit, 'getPrice').mockResolvedValue({
        price: 42050,
        volume: 50,
        timestamp: Date.now(),
      });

      jest.spyOn(redis, 'exists').mockResolvedValue(0);
      jest.spyOn(redis, 'hset').mockResolvedValue(1);

      await service['collectSymbol']('BTC/USDT');

      expect(binance.getPrice).toHaveBeenCalledWith('BTC/USDT');
      expect(upbit.getPrice).toHaveBeenCalledWith('BTC/USDT');
      expect(redis.hset).toHaveBeenCalled();
    });

    it('should handle when one exchange fails', async () => {
      jest.spyOn(binance, 'getPrice').mockResolvedValue({
        price: 42000,
        volume: 100,
        timestamp: Date.now(),
      });

      jest.spyOn(upbit, 'getPrice').mockResolvedValue(null);

      jest.spyOn(redis, 'exists').mockResolvedValue(0);
      jest.spyOn(redis, 'hset').mockResolvedValue(1);

      await service['collectSymbol']('BTC/USDT');

      expect(redis.hset).toHaveBeenCalled();
    });

    it('should skip when all exchanges fail', async () => {
      jest.spyOn(binance, 'getPrice').mockResolvedValue(null);
      jest.spyOn(upbit, 'getPrice').mockResolvedValue(null);
      jest.spyOn(redis, 'hset');

      await service['collectSymbol']('BTC/USDT');

      expect(redis.hset).not.toHaveBeenCalled();
    });
  });

  describe('updateRedis', () => {
    it('should create new candle if not exists', async () => {
      jest.spyOn(redis, 'exists').mockResolvedValue(0);
      jest.spyOn(redis, 'hset').mockResolvedValue(1);

      await service['updateRedis']('BTC/USDT', 42000);

      expect(redis.hset).toHaveBeenCalledWith('candle:BTC/USDT', {
        o: '42000',
        h: '42000',
        l: '42000',
        c: '42000',
        t: expect.any(String),
      });
    });

    it('should update existing candle with new high', async () => {
      jest.spyOn(redis, 'exists').mockResolvedValue(1);
      jest.spyOn(redis, 'hmget').mockResolvedValue(['42000', '41900']);
      jest.spyOn(redis, 'hset').mockResolvedValue(1);

      await service['updateRedis']('BTC/USDT', 42100);

      expect(redis.hset).toHaveBeenCalledWith('candle:BTC/USDT', {
        h: '42100', // New high
        l: '41900', // Keep low
        c: '42100', // New close
      });
    });

    it('should update existing candle with new low', async () => {
      jest.spyOn(redis, 'exists').mockResolvedValue(1);
      jest.spyOn(redis, 'hmget').mockResolvedValue(['42100', '41900']);
      jest.spyOn(redis, 'hset').mockResolvedValue(1);

      await service['updateRedis']('BTC/USDT', 41800);

      expect(redis.hset).toHaveBeenCalledWith('candle:BTC/USDT', {
        h: '42100', // Keep high
        l: '41800', // New low
        c: '41800', // New close
      });
    });

    it('should keep existing high and low if price is in range', async () => {
      jest.spyOn(redis, 'exists').mockResolvedValue(1);
      jest.spyOn(redis, 'hmget').mockResolvedValue(['42100', '41900']);
      jest.spyOn(redis, 'hset').mockResolvedValue(1);

      await service['updateRedis']('BTC/USDT', 42000);

      expect(redis.hset).toHaveBeenCalledWith('candle:BTC/USDT', {
        h: '42100', // Keep high
        l: '41900', // Keep low
        c: '42000', // New close
      });
    });
  });
});
