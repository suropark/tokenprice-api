import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Market API (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/api/v1/market/health (GET)', () => {
    it('should return health status', () => {
      return request(app.getHttpServer())
        .get('/api/v1/market/health')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBeDefined();
          expect(res.body.timestamp).toBeDefined();
          expect(res.body.services).toBeDefined();
        });
    });
  });

  describe('/api/v1/market/symbols (GET)', () => {
    it('should return list of symbols', () => {
      return request(app.getHttpServer())
        .get('/api/v1/market/symbols')
        .expect(200)
        .expect((res) => {
          expect(res.body.symbols).toBeDefined();
          expect(Array.isArray(res.body.symbols)).toBe(true);
          expect(res.body.count).toBeDefined();
        });
    });
  });

  describe('/api/v1/market/ohlcv (GET)', () => {
    it('should return OHLCV data with valid parameters', () => {
      const from = Math.floor(Date.now() / 1000) - 3600;
      const to = Math.floor(Date.now() / 1000);

      return request(app.getHttpServer())
        .get('/api/v1/market/ohlcv')
        .query({
          symbol: 'BTC/USDT',
          from,
          to,
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.symbol).toBe('BTC/USDT');
          expect(res.body.data).toBeDefined();
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.body.meta).toBeDefined();
          expect(res.body.meta.count).toBeDefined();
          expect(res.body.meta.from).toBe(from);
          expect(res.body.meta.to).toBe(to);
        });
    });

    it('should return 400 for missing symbol', () => {
      return request(app.getHttpServer())
        .get('/api/v1/market/ohlcv')
        .query({
          from: 1704110400,
          to: 1704114000,
        })
        .expect(400);
    });

    it('should return 400 for invalid from parameter', () => {
      return request(app.getHttpServer())
        .get('/api/v1/market/ohlcv')
        .query({
          symbol: 'BTC/USDT',
          from: 'invalid',
          to: 1704114000,
        })
        .expect(400);
    });

    it('should return 400 for negative from parameter', () => {
      return request(app.getHttpServer())
        .get('/api/v1/market/ohlcv')
        .query({
          symbol: 'BTC/USDT',
          from: -1,
          to: 1704114000,
        })
        .expect(400);
    });

    it('should handle empty result set', () => {
      const futureTime = Math.floor(Date.now() / 1000) + 86400;

      return request(app.getHttpServer())
        .get('/api/v1/market/ohlcv')
        .query({
          symbol: 'BTC/USDT',
          from: futureTime,
          to: futureTime + 3600,
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.data).toHaveLength(0);
        });
    });
  });
});
