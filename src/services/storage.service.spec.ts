import { Test, TestingModule } from '@nestjs/testing';
import { StorageService } from './storage.service';
import { PrismaService } from '../database/prisma.service';

describe('StorageService', () => {
  let service: StorageService;
  let redis: any;
  let prisma: any;

  beforeEach(async () => {
    redis = {
      keys: jest.fn(),
      hgetall: jest.fn(),
      del: jest.fn(),
    };

    prisma = {
      ohlcv1m: {
        upsert: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: 'REDIS_CLIENT',
          useValue: redis,
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  describe('flushToDatabase', () => {
    it('should skip when no candles exist', async () => {
      jest.spyOn(redis, 'keys').mockResolvedValue([]);
      jest.spyOn(redis, 'hgetall');

      await service.flushToDatabase();

      expect(redis.hgetall).not.toHaveBeenCalled();
      expect(prisma.ohlcv1m.upsert).not.toHaveBeenCalled();
    });

    it('should flush candles to database', async () => {
      jest.spyOn(redis, 'keys').mockResolvedValue(['candle:BTC/USDT', 'candle:ETH/USDT']);
      jest
        .spyOn(redis, 'hgetall')
        .mockResolvedValueOnce({
          o: '42000',
          h: '42100',
          l: '41900',
          c: '42050',
          t: '1704110400000',
        })
        .mockResolvedValueOnce({
          o: '2000',
          h: '2010',
          l: '1990',
          c: '2005',
          t: '1704110400000',
        });
      jest.spyOn(redis, 'del').mockResolvedValue(1);
      jest.spyOn(prisma.ohlcv1m, 'upsert').mockResolvedValue({});

      await service.flushToDatabase();

      expect(prisma.ohlcv1m.upsert).toHaveBeenCalledTimes(2);
      expect(redis.del).toHaveBeenCalledTimes(2);
    });

    it('should handle flush errors gracefully', async () => {
      jest.spyOn(redis, 'keys').mockResolvedValue(['candle:BTC/USDT']);
      jest.spyOn(redis, 'hgetall').mockResolvedValue({
        o: '42000',
        h: '42100',
        l: '41900',
        c: '42050',
      });
      jest.spyOn(prisma.ohlcv1m, 'upsert').mockRejectedValue(new Error('DB error'));
      jest.spyOn(redis, 'del');

      await service.flushToDatabase();

      // Should not delete Redis key if DB write fails
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('flushCandle', () => {
    it('should upsert candle data to database', async () => {
      jest.spyOn(redis, 'hgetall').mockResolvedValue({
        o: '42000',
        h: '42100',
        l: '41900',
        c: '42050',
        t: '1704110400000',
      });
      jest.spyOn(redis, 'del').mockResolvedValue(1);
      jest.spyOn(prisma.ohlcv1m, 'upsert').mockResolvedValue({});

      await service['flushCandle']('candle:BTC/USDT');

      expect(prisma.ohlcv1m.upsert).toHaveBeenCalledWith({
        where: {
          time_symbol: {
            time: expect.any(Date),
            symbol: 'BTC/USDT',
          },
        },
        create: {
          time: expect.any(Date),
          symbol: 'BTC/USDT',
          open: 42000,
          high: 42100,
          low: 41900,
          close: 42050,
          volume: 0,
          quoteVolume: 0,
          sourceCount: 2,
        },
        update: {
          close: 42050,
          high: 42100,
          low: 41900,
        },
      });

      expect(redis.del).toHaveBeenCalledWith('candle:BTC/USDT');
    });

    it('should skip empty candle data', async () => {
      jest.spyOn(redis, 'hgetall').mockResolvedValue({});
      jest.spyOn(prisma.ohlcv1m, 'upsert');

      await service['flushCandle']('candle:BTC/USDT');

      expect(prisma.ohlcv1m.upsert).not.toHaveBeenCalled();
    });

    it('should not delete Redis key if upsert fails', async () => {
      jest.spyOn(redis, 'hgetall').mockResolvedValue({
        o: '42000',
        h: '42100',
        l: '41900',
        c: '42050',
      });
      jest.spyOn(prisma.ohlcv1m, 'upsert').mockRejectedValue(new Error('DB error'));
      jest.spyOn(redis, 'del');

      await service['flushCandle']('candle:BTC/USDT');

      expect(redis.del).not.toHaveBeenCalled();
    });

    it('should extract symbol from Redis key correctly', async () => {
      jest.spyOn(redis, 'hgetall').mockResolvedValue({
        o: '42000',
        h: '42100',
        l: '41900',
        c: '42050',
      });
      jest.spyOn(redis, 'del').mockResolvedValue(1);
      jest.spyOn(prisma.ohlcv1m, 'upsert').mockResolvedValue({});

      await service['flushCandle']('candle:ETH/USDT');

      expect(prisma.ohlcv1m.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            time_symbol: {
              time: expect.any(Date),
              symbol: 'ETH/USDT',
            },
          },
        }),
      );
    });
  });
});
