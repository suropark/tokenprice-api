# Token Price Oracle - Practical Review & Simplified Design

## 🎯 프로젝트 실제 요구사항

- **CEX**: Binance, Upbit 2개만
- **확장성**: 토큰 100개 × 5개 source = 500 streams 대응
- **기술**: TypeScript only (Lua script ❌)
- **배포**: Docker only (Kubernetes ❌)
- **목표**: 실용적이고 간단하면서 확장 가능한 설계

---

## 📊 기존 설계의 문제점

### 1. **과도한 복잡도 (Over-engineering)**

#### ❌ Leader Election with Fencing Tokens
```typescript
// 기존: 복잡한 leader election
class LeaderService {
  private fencingToken: number;
  async acquireLock(): Promise<number | null> {
    const token = Date.now();
    // 복잡한 fencing token 로직...
  }
}
```

**문제점**:
- 초기엔 단일 인스턴스로도 충분
- 필요하면 나중에 추가
- 코드 복잡도만 증가

**대안**:
```typescript
// ✅ 간단한 접근: 처음엔 단일 인스턴스
// 필요시 Redis lock만으로 충분
const lock = await redis.set('ingestion:lock', instanceId, 'NX', 'EX', 30);
if (!lock) return; // 다른 인스턴스가 실행 중
```

---

#### ❌ Lua Script for Atomic Updates
```lua
-- 기존: Lua script 사용
local key = KEYS[1]
local price = tonumber(ARGV[1])
-- 복잡한 로직...
```

**문제점**:
- TypeScript 프로젝트에 Lua 파일 추가
- 디버깅 어려움
- 실제로 race condition 가능성 낮음 (1초마다 실행)

**대안 1: Redis Transaction (WATCH/MULTI/EXEC)**
```typescript
// ✅ TypeScript로 해결
async updateCandle(symbol: string, price: number) {
  const key = `candle:${symbol}`;

  while (true) {
    await redis.watch(key);
    const current = await redis.hgetall(key);

    const multi = redis.multi();
    if (!current.o) {
      multi.hset(key, 'o', price, 'h', price, 'l', price, 'c', price);
    } else {
      multi.hset(key, {
        h: Math.max(Number(current.h), price),
        l: Math.min(Number(current.l), price),
        c: price,
      });
    }

    const result = await multi.exec();
    if (result) break; // Success
    // Retry if another client modified the key
  }
}
```

**대안 2: 더 간단하게 - 개별 명령**
```typescript
// ✅ 가장 간단: race condition 리스크 낮음
async updateCandle(symbol: string, price: number) {
  const key = `candle:${symbol}`;
  const exists = await redis.exists(key);

  if (!exists) {
    await redis.hset(key, {
      o: price, h: price, l: price, c: price,
      v: 0, t: Date.now()
    });
  } else {
    const [high, low] = await redis.hmget(key, 'h', 'l');
    await redis.hset(key, {
      h: Math.max(Number(high), price),
      l: Math.min(Number(low), price),
      c: price,
    });
  }
}
```

**실제로는**: 1초에 한 번만 업데이트하므로 race condition 거의 없음!

---

#### ❌ 과도한 추상화: BaseExchangeService + Circuit Breaker

```typescript
// 기존: 복잡한 추상화
abstract class BaseExchangeService {
  protected circuitBreaker: CircuitBreaker;
  abstract fetchPrice(): Promise<PriceData>;
}

class BinanceService extends BaseExchangeService {
  async fetchPrice() { /* ... */ }
}
```

**문제점**:
- Binance, Upbit 2개만 사용
- Circuit breaker는 나중에 추가해도 됨
- 추상화가 코드 복잡도만 증가

**대안**:
```typescript
// ✅ 간단하게: 직접 구현
class BinanceClient {
  async getPrice(symbol: string): Promise<number> {
    try {
      const { data } = await axios.get(
        `https://api.binance.com/api/v3/ticker/price`,
        { params: { symbol: symbol.replace('/', '') } }
      );
      return parseFloat(data.price);
    } catch (error) {
      logger.error(`Binance API error: ${error.message}`);
      return null; // 실패 시 null 반환
    }
  }
}

class UpbitClient {
  async getPrice(symbol: string): Promise<number> {
    try {
      const market = `KRW-${symbol.split('/')[0]}`;
      const { data } = await axios.get(
        `https://api.upbit.com/v1/ticker`,
        { params: { markets: market } }
      );
      return data[0]?.trade_price || null;
    } catch (error) {
      logger.error(`Upbit API error: ${error.message}`);
      return null;
    }
  }
}
```

---

### 2. **불필요한 라이브러리**

#### ❌ CCXT Library
```json
"ccxt": "^4.x"  // 100+ exchanges, 수백 MB
```

**문제점**:
- Binance, Upbit 2개만 사용
- 무거운 라이브러리 (번들 크기 증가)
- 직접 API 호출이 더 간단하고 제어 가능

**대안**: `axios` 직접 사용 (이미 포함)

---

#### ❌ TypeORM vs Prisma

```typescript
// TypeORM: Decorator 기반
@Entity('ohlcv_1m')
export class OhlcvEntity {
  @PrimaryColumn()
  time: Date;

  @Column()
  symbol: string;
  // ...
}
```

**Prisma 장점**:
- TypeScript 네이티브 (타입 자동 생성)
- 더 나은 DX (개발 경험)
- 마이그레이션 관리 간단

```prisma
// schema.prisma
model Ohlcv1m {
  time        DateTime
  symbol      String
  open        Decimal
  high        Decimal
  low         Decimal
  close       Decimal
  volume      Decimal
  quoteVolume Decimal
  sourceCount Int

  @@id([time, symbol])
}
```

---

### 3. **Kubernetes는 불필요**

```yaml
# 기존: K8s 매니페스트
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 3
  # ...
```

**문제점**:
- Docker만으로 충분
- 초기엔 단일 컨테이너로도 충분
- 필요시 docker-compose scale 사용

**대안**:
```yaml
# docker-compose.yml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped

  timescaledb:
    image: timescale/timescaledb:latest-pg15
    restart: unless-stopped
```

---

## 🎯 실용적인 대안 설계

### 핵심 아키텍처: 3-Layer Simple Design

```
┌─────────────────────────────────────────────────┐
│         Data Collection Layer (1초마다)          │
│  ┌──────────┐  ┌──────────┐                    │
│  │ Binance  │  │  Upbit   │                    │
│  │  Client  │  │  Client  │                    │
│  └────┬─────┘  └────┬─────┘                    │
│       │             │                           │
│       └─────┬───────┘                           │
│             ↓                                   │
│      ┌─────────────┐                           │
│      │ Aggregator  │  (Median/VWAP)           │
│      └──────┬──────┘                           │
│             ↓                                   │
│      ┌─────────────┐                           │
│      │   Redis     │  (Current Candle)         │
│      └─────────────┘                           │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│          Persistence Layer (1분마다)             │
│      ┌─────────────┐                           │
│      │   Redis     │                           │
│      └──────┬──────┘                           │
│             ↓                                   │
│      ┌─────────────┐                           │
│      │ TimescaleDB │  (Historical)             │
│      └─────────────┘                           │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│             API Layer (Query)                   │
│      ┌─────────────┐  ┌─────────────┐         │
│      │   Redis     │  │ TimescaleDB │         │
│      │  (Current)  │  │ (Historical)│         │
│      └──────┬──────┘  └──────┬──────┘         │
│             └────────┬────────┘                 │
│                      ↓                          │
│              ┌──────────────┐                  │
│              │  REST API    │                  │
│              └──────────────┘                  │
└─────────────────────────────────────────────────┘
```

---

### 간소화된 기술 스택

```json
{
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/schedule": "^4.0.0",
    "@nestjs/config": "^3.0.0",

    "ioredis": "^5.3.2",
    "@prisma/client": "^5.7.0",

    "axios": "^1.6.2",
    "zod": "^3.22.4",

    "winston": "^3.11.0",
    "prom-client": "^15.1.0"
  },
  "devDependencies": {
    "prisma": "^5.7.0",
    "@nestjs/testing": "^10.0.0",
    "jest": "^29.7.0",
    "supertest": "^6.3.3"
  }
}
```

**제거된 것들**:
- ❌ ccxt (직접 API 호출)
- ❌ typeorm (Prisma 사용)
- ❌ big.js (JavaScript Number로 충분, 필요시 추가)
- ❌ testcontainers (초기엔 mock으로 충분)

---

### 확장성 설계: 500 Streams 처리

#### 문제: 100 토큰 × 5 exchanges = 500 streams

**전략 1: Polling (간단)**
```typescript
class PriceCollector {
  private symbols = ['BTC/USDT', 'ETH/USDT', /* ... 100개 */];

  @Cron(CronExpression.EVERY_SECOND)
  async collect() {
    // 병렬 처리: 100개 토큰, 2개 거래소 = 200 요청/초
    const promises = this.symbols.flatMap(symbol => [
      this.binance.getPrice(symbol),
      this.upbit.getPrice(symbol),
    ]);

    const prices = await Promise.all(promises); // 병렬 실행
    // 처리...
  }
}
```

**문제점**:
- 200 HTTP 요청/초 → API rate limit 위험
- 비효율적

**전략 2: WebSocket (효율적)**
```typescript
class BinanceWebSocket {
  private ws: WebSocket;
  private priceCallbacks = new Map<string, (price: number) => void>();

  connect(symbols: string[]) {
    const streams = symbols.map(s => `${s.toLowerCase()}@trade`).join('/');
    this.ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

    this.ws.on('message', (data) => {
      const { stream, data: { s: symbol, p: price } } = JSON.parse(data);
      const callback = this.priceCallbacks.get(symbol);
      if (callback) callback(parseFloat(price));
    });
  }

  subscribe(symbol: string, callback: (price: number) => void) {
    this.priceCallbacks.set(symbol, callback);
  }
}
```

**장점**:
- 실시간 업데이트
- Rate limit 걱정 없음
- 1개 연결로 100개 토큰 처리

**단점**:
- 연결 관리 복잡
- 재연결 로직 필요
- 일부 거래소는 WebSocket 제한 (예: 한 연결당 50 streams)

**권장**: 초기엔 Polling, 필요시 WebSocket 전환

---

## 🏗️ 내가 처음부터 설계한다면?

### Phase 1: MVP (3-4일)

#### 목표: 동작하는 최소 시스템

```typescript
// 1. 단순한 구조
src/
  config/          # 환경 설정
  clients/         # Binance, Upbit API 클라이언트
  services/
    collector.service.ts    # 가격 수집
    storage.service.ts      # DB 저장
  api/
    market.controller.ts    # REST API
  app.module.ts
  main.ts
```

#### collector.service.ts
```typescript
@Injectable()
export class CollectorService {
  constructor(
    private binance: BinanceClient,
    private upbit: UpbitClient,
    private redis: Redis,
  ) {}

  @Cron(CronExpression.EVERY_SECOND)
  async collectPrices() {
    for (const symbol of ['BTC/USDT', 'ETH/USDT']) {
      const prices = await Promise.all([
        this.binance.getPrice(symbol),
        this.upbit.getPrice(symbol),
      ]);

      // 유효한 가격만 필터
      const valid = prices.filter(p => p !== null);
      if (valid.length === 0) continue;

      // Median 계산
      const median = this.calculateMedian(valid);

      // Redis 업데이트
      await this.updateRedis(symbol, median);
    }
  }

  private async updateRedis(symbol: string, price: number) {
    const key = `candle:${symbol}`;
    const exists = await this.redis.exists(key);

    if (!exists) {
      await this.redis.hset(key, {
        o: price, h: price, l: price, c: price,
        t: Date.now(),
      });
    } else {
      const [h, l] = await this.redis.hmget(key, 'h', 'l');
      await this.redis.hset(key, {
        h: Math.max(Number(h), price),
        l: Math.min(Number(l), price),
        c: price,
      });
    }
  }

  private calculateMedian(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}
```

#### storage.service.ts
```typescript
@Injectable()
export class StorageService {
  constructor(
    private redis: Redis,
    private prisma: PrismaClient,
  ) {}

  @Cron('0 * * * * *') // 매분 00초
  async flushToDatabase() {
    const keys = await this.redis.keys('candle:*');

    for (const key of keys) {
      const data = await this.redis.hgetall(key);
      const symbol = key.replace('candle:', '');

      const time = new Date();
      time.setSeconds(0, 0); // 정각으로 맞춤

      await this.prisma.ohlcv1m.upsert({
        where: { time_symbol: { time, symbol } },
        create: {
          time,
          symbol,
          open: parseFloat(data.o),
          high: parseFloat(data.h),
          low: parseFloat(data.l),
          close: parseFloat(data.c),
        },
        update: {
          close: parseFloat(data.c),
          high: Math.max(await this.prisma.ohlcv1m.findUnique(...).high, parseFloat(data.h)),
          low: Math.min(await this.prisma.ohlcv1m.findUnique(...).low, parseFloat(data.l)),
        },
      });

      // Redis 초기화 (다음 분봉 시작)
      await this.redis.del(key);
    }
  }
}
```

#### market.controller.ts
```typescript
@Controller('api/v1/market')
export class MarketController {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
  ) {}

  @Get('ohlcv')
  async getOhlcv(@Query() query: OhlcvQueryDto) {
    const { symbol, from, to } = query;

    // 1. DB에서 과거 데이터 조회
    const historical = await this.prisma.ohlcv1m.findMany({
      where: {
        symbol,
        time: {
          gte: new Date(from * 1000),
          lte: new Date(to * 1000),
        },
      },
      orderBy: { time: 'asc' },
    });

    // 2. Redis에서 현재 분봉 조회
    const current = await this.redis.hgetall(`candle:${symbol}`);

    // 3. 병합
    const result = [...historical];
    if (current.o) {
      result.push({
        time: new Date(parseInt(current.t)),
        open: parseFloat(current.o),
        high: parseFloat(current.h),
        low: parseFloat(current.l),
        close: parseFloat(current.c),
      });
    }

    return { data: result };
  }
}
```

**MVP 완료**: 3-4일 만에 동작하는 시스템

---

### Phase 2: 확장 (1-2주)

#### 추가할 기능들:

1. **WebSocket 전환** (토큰 많아지면)
```typescript
class WebSocketManager {
  private connections = new Map<string, WebSocket>();

  connectBinance(symbols: string[]) {
    // 50개씩 묶어서 연결 (Binance 제한)
    for (let i = 0; i < symbols.length; i += 50) {
      const chunk = symbols.slice(i, i + 50);
      this.createConnection('binance', chunk);
    }
  }
}
```

2. **Rate Limiting**
```typescript
@UseGuards(ThrottlerGuard)
@Throttle(100, 60) // 100 req/min
@Get('ohlcv')
async getOhlcv() { /* ... */ }
```

3. **Outlier Detection** (필요시)
```typescript
private removeOutliers(prices: number[]): number[] {
  if (prices.length < 4) return prices;

  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;

  return prices.filter(p =>
    p >= q1 - 1.5 * iqr && p <= q3 + 1.5 * iqr
  );
}
```

4. **Metrics**
```typescript
@Injectable()
export class MetricsService {
  private readonly priceUpdates = new Counter({
    name: 'price_updates_total',
    help: 'Total price updates',
  });

  recordUpdate() {
    this.priceUpdates.inc();
  }
}
```

5. **분산 처리** (필요시)
```typescript
// 간단한 락만으로 충분
async collectPrices() {
  const lock = await this.redis.set('lock:collect', 'true', 'NX', 'EX', 5);
  if (!lock) return; // 다른 인스턴스가 실행 중

  try {
    // 수집 로직
  } finally {
    await this.redis.del('lock:collect');
  }
}
```

---

## 📊 비교: 기존 vs 실용적 설계

| 항목 | 기존 설계 | 실용적 설계 |
|------|-----------|-------------|
| **복잡도** | 높음 (Leader election, Fencing tokens) | 낮음 (필요시 간단한 락) |
| **Lua Script** | 사용 (TypeScript 외 언어) | 미사용 (Pure TypeScript) |
| **Exchange 추상화** | BaseExchangeService + Circuit Breaker | 직접 구현 (필요시 추가) |
| **ORM** | TypeORM | Prisma (더 TypeScript 친화적) |
| **라이브러리** | ccxt, big.js, testcontainers | Minimal (axios, zod, winston) |
| **배포** | K8s 매니페스트 | Docker Compose |
| **초기 구현 시간** | 2주 | 3-4일 (MVP) |
| **코드 라인** | ~5000+ | ~1000 (MVP) |
| **테스트 복잡도** | 높음 | 낮음 (필수 부분만) |
| **확장성** | 처음부터 고려 | 필요시 추가 (YAGNI) |

---

## ✅ 최종 권장사항

### 1단계: MVP (1주일)
- [ ] NestJS 기본 구조
- [ ] Binance, Upbit 직접 API 호출
- [ ] Redis 현재 캔들 관리
- [ ] TimescaleDB 저장 (Prisma)
- [ ] 기본 REST API
- [ ] Docker Compose 배포

### 2단계: 확장 (필요시)
- [ ] WebSocket 전환 (토큰 50개 이상)
- [ ] Outlier detection
- [ ] Rate limiting
- [ ] Metrics (Prometheus)
- [ ] 분산 처리 (단순 Redis lock)

### 3단계: 최적화 (필요시)
- [ ] Caching layer
- [ ] Connection pooling
- [ ] Query optimization
- [ ] Load testing

---

## 🎓 교훈: YAGNI (You Aren't Gonna Need It)

**Over-engineering 증상**:
- ❌ "나중에 필요할 수도 있으니까" → 실제론 안 씀
- ❌ 추상화 레이어 3단 → 실제론 구현체 1개
- ❌ 완벽한 에러 처리 → 실제론 간단한 try-catch로 충분
- ❌ 복잡한 테스트 → 핵심 로직만 테스트해도 충분

**올바른 접근**:
- ✅ 동작하는 코드 먼저
- ✅ 리팩토링은 필요할 때
- ✅ 테스트는 핵심 로직 위주
- ✅ 간단한 것부터 시작

**결론**: 처음엔 간단하게, 문제 생기면 그때 해결! 🚀
