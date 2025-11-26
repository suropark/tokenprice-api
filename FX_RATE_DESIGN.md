# FX Rate Service Design

## Problem

각 exchange의 quote currency가 다름:
- Binance: BTC/USDT (USDT quoted)
- Upbit: BTC/KRW (KRW quoted)

**중요한 제약사항**:
1. **USD ≠ USDT**: USDT는 스테이블코인이며 디페깅 가능 (정상: $0.9998-1.0002)
2. **김치 프리미엄**: KRW 마켓 전체가 프리미엄을 가짐
   - 예: Binance BTC/USDT $43,000 vs Upbit BTC/KRW ₩58,500,000
   - USD/KRW 공식 환율(1,340) 사용 시: ₩57,620,000 (실제와 다름)
   - USDT/KRW 실제 시장가(1,360) 사용: ₩58,480,000 (거의 일치)
3. **Quote별 분리 필수**: 다른 quote currency 간 직접 aggregation 불가

**결론**: Quote currency별로 **별도 관리**해야 함

## Solution: Quote-Separated Markets with Optional FX Reference

### 핵심 설계 원칙

1. **원본 데이터 보존**: Quote currency 그대로 저장
2. **Quote별 분리 Aggregation**: 같은 quote끼리만 aggregation
   - USDT 마켓: Binance, ... (USDT quote 거래소만)
   - KRW 마켓: Upbit, ... (KRW quote 거래소만)
3. **FX Rate는 참고용**: Cross-market 비교 및 김치 프리미엄 계산용
4. **No Cross-Quote Aggregation**: USDT와 KRW를 섞어서 평균내지 않음

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Collector Service                    │
│  ┌──────────┐         ┌──────────┐                     │
│  │ Binance  │         │  Upbit   │                     │
│  │ BTC/USDT │         │ BTC/KRW  │                     │
│  └────┬─────┘         └────┬─────┘                     │
│       │                    │                            │
│       │                    │                            │
│       ▼                    ▼                            │
│    Store with quote currency                            │
│    - candle:BTC/USDT:binance  (USDT market)           │
│    - candle:BTC/KRW:upbit     (KRW market)            │
│                                                          │
│    Quote별 분리 Aggregation:                            │
│    - candle:BTC:USDT:aggregated (Binance만)           │
│    - candle:BTC:KRW:aggregated  (Upbit만)             │
└─────────────────────────────────────────────────────────┘
                         │
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌───────────────┐  ┌──────────┐  ┌──────────────┐
│  TimescaleDB  │  │  Redis   │  │ FX Rate      │
│               │  │          │  │ Service      │
│ Quote별 분리  │  │ Quote별  │  │ (참고용)     │
│               │  │ 분리     │  │              │
│ BTC:USDT      │  │          │  │ Redis:       │
│ BTC:KRW       │  │          │  │ fx:USDT:KRW  │
│ (no mixing)   │  │          │  │ (시장가)     │
└───────────────┘  └──────────┘  └──────────────┘
                                         │
                         ┌───────────────┘
                         ▼
                   ┌──────────┐
                   │  Upbit   │
                   │ USDT/KRW │  ← 김치 프리미엄 반영된 실제 시장가
                   └──────────┘

                   ┌─────────────────────────────┐
                   │      Market API             │
                   │                             │
                   │  Quote별 분리 응답:         │
                   │  {                          │
                   │    "USDT": { ... },         │
                   │    "KRW": { ... },          │
                   │    "premium": "1.5%"        │
                   │  }                          │
                   └─────────────────────────────┘
```

## Implementation

### 1. Redis Key Structure (Updated)

```typescript
// Exchange-specific prices (기존과 동일)
candle:{symbol}:{exchange}
  예: candle:BTC/USDT:binance
  예: candle:BTC/KRW:upbit

// Quote별 분리 Aggregation (변경)
candle:{base}:{quote}:aggregated
  예: candle:BTC:USDT:aggregated  (Binance + 다른 USDT 거래소)
  예: candle:BTC:KRW:aggregated   (Upbit + 다른 KRW 거래소)

// FX Rate Cache (참고용)
fx:{from}:{to}
  Value: { rate, timestamp, source }

// Examples
fx:USDT:KRW → { rate: 1360.5, timestamp: 1704110400000, source: 'upbit' }
  주의: 김치 프리미엄이 반영된 시장가 (공식 USD/KRW와 다름)
```

### 2. Symbol Metadata (Config)

```typescript
// config/symbols.ts
export const SYMBOLS = [
  {
    base: 'BTC',
    markets: {
      USDT: {
        exchanges: [
          { name: 'binance', pair: 'BTC/USDT' },
          // 나중에 추가: { name: 'bybit', pair: 'BTC/USDT' }
        ],
      },
      KRW: {
        exchanges: [
          { name: 'upbit', pair: 'BTC/KRW' },
          // 나중에 추가: { name: 'bithumb', pair: 'BTC/KRW' }
        ],
      },
    },
  },
  {
    base: 'ETH',
    markets: {
      USDT: {
        exchanges: [{ name: 'binance', pair: 'ETH/USDT' }],
      },
      KRW: {
        exchanges: [{ name: 'upbit', pair: 'ETH/KRW' }],
      },
    },
  },
];

// Supported quote currencies
export const QUOTE_CURRENCIES = ['USDT', 'USDC', 'BUSD', 'KRW', 'JPY'];
```

### 3. FX Rate Service (Optional - For Premium Calculation)

```typescript
@Injectable()
export class FxRateService {
  constructor(
    private readonly redis: Redis,
    private readonly upbitClient: UpbitClient,
  ) {}

  // Update USDT/KRW rate every 1 minute (김치 프리미엄 반영된 시장가)
  @Cron('*/1 * * * *')
  async updateUsdtKrwRate() {
    const usdtKrw = await this.upbitClient.getPrice('USDT/KRW');
    if (usdtKrw) {
      await this.setRate('USDT', 'KRW', usdtKrw.price, 'upbit');
    }
  }

  // Get FX rate (참고용)
  async getRate(from: string, to: string): Promise<number | null> {
    if (from === to) return 1;

    const direct = await this.redis.hget(`fx:${from}:${to}`, 'rate');
    if (direct) return parseFloat(direct);

    const inverse = await this.redis.hget(`fx:${to}:${from}`, 'rate');
    if (inverse) return 1 / parseFloat(inverse);

    return null;
  }

  // Calculate kimchi premium (김치 프리미엄 계산)
  async calculatePremium(
    usdtPrice: number,
    krwPrice: number,
  ): Promise<{ premium: number; percentageString: string } | null> {
    const usdtKrwRate = await this.getRate('USDT', 'KRW');
    if (!usdtKrwRate) return null;

    const expectedKrwPrice = usdtPrice * usdtKrwRate;
    const premium = ((krwPrice - expectedKrwPrice) / expectedKrwPrice) * 100;

    return {
      premium,
      percentageString: `${premium > 0 ? '+' : ''}${premium.toFixed(2)}%`,
    };
  }

  private async setRate(from: string, to: string, rate: number, source: string) {
    await this.redis.hset(`fx:${from}:${to}`, {
      rate: rate.toString(),
      timestamp: Date.now().toString(),
      source,
    });
    await this.redis.expire(`fx:${from}:${to}`, 86400);
  }
}
```

### 4. Enhanced Market API (Quote-Separated)

```typescript
// DTO
export class TickerQueryDto {
  @IsString() @IsNotEmpty() base: string;  // BTC, ETH, ...
  @IsOptional() @IsString() exchange?: string;  // binance, upbit
  @IsOptional() @IsIn(['USDT', 'KRW']) quote?: string;  // Filter by quote
  @IsOptional() @IsBoolean() includePremium?: boolean;  // Include kimchi premium
}

// Controller
@Get('ticker')
async getTicker(@Query() query: TickerQueryDto) {
  const { base, exchange, quote, includePremium } = query;

  // Case 1: Specific exchange
  if (exchange) {
    return this.getExchangePrice(base, exchange);
  }

  // Case 2: Specific quote currency
  if (quote) {
    return this.getQuoteMarket(base, quote, includePremium);
  }

  // Case 3: All markets (quote별로 분리)
  return this.getAllMarkets(base, includePremium);
}

// Get specific exchange price
private async getExchangePrice(base: string, exchange: string) {
  const metadata = this.getExchangeMetadata(base, exchange);
  if (!metadata) throw new NotFoundException();

  const key = `candle:${metadata.pair}:${exchange}`;
  const data = await this.redis.hgetall(key);
  if (!data || !data.c) throw new NotFoundException();

  return {
    base,
    exchange,
    quote: metadata.quote,
    pair: metadata.pair,
    price: parseFloat(data.c),
    volume: parseFloat(data.v || '0'),
    timestamp: parseInt(data.t),
  };
}

// Get aggregated price for specific quote market
private async getQuoteMarket(
  base: string,
  quote: string,
  includePremium: boolean,
) {
  const key = `candle:${base}:${quote}:aggregated`;
  const data = await this.redis.hgetall(key);
  if (!data || !data.c) throw new NotFoundException();

  const result = {
    base,
    quote,
    price: parseFloat(data.c),
    open: parseFloat(data.o),
    high: parseFloat(data.h),
    low: parseFloat(data.l),
    volume: parseFloat(data.v || '0'),
    timestamp: parseInt(data.t),
    sourceCount: parseInt(data.sources || '1'),
  };

  // Add premium calculation if requested
  if (includePremium && quote === 'KRW') {
    const usdtMarket = await this.getQuoteMarket(base, 'USDT', false);
    const premium = await this.fxRateService.calculatePremium(
      usdtMarket.price,
      result.price,
    );
    if (premium) {
      return { ...result, premium: premium.percentageString };
    }
  }

  return result;
}

// Get all markets (quote별 분리)
private async getAllMarkets(base: string, includePremium: boolean) {
  const markets = {};

  // Get each quote market separately
  for (const quote of ['USDT', 'KRW']) {
    try {
      markets[quote] = await this.getQuoteMarket(base, quote, false);
    } catch (e) {
      // Market not available
    }
  }

  const result = { base, markets };

  // Add premium if requested and both markets exist
  if (includePremium && markets['USDT'] && markets['KRW']) {
    const premium = await this.fxRateService.calculatePremium(
      markets['USDT'].price,
      markets['KRW'].price,
    );
    if (premium) {
      result['premium'] = {
        value: premium.percentageString,
        note: 'KRW market premium vs USDT market',
      };
    }
  }

  return result;
}
```

### 5. API Examples

```bash
# 1. Get all markets (quote별로 분리)
GET /api/v1/market/ticker?base=BTC

Response:
{
  "base": "BTC",
  "markets": {
    "USDT": {
      "base": "BTC",
      "quote": "USDT",
      "price": 43000.5,
      "open": 42800.0,
      "high": 43200.0,
      "low": 42700.0,
      "volume": 1234.5,
      "timestamp": 1704110400000,
      "sourceCount": 1  // binance only
    },
    "KRW": {
      "base": "BTC",
      "quote": "KRW",
      "price": 58500000,
      "open": 58200000,
      "high": 58800000,
      "low": 58000000,
      "volume": 45.2,
      "timestamp": 1704110400000,
      "sourceCount": 1  // upbit only
    }
  }
}

# 2. Get specific quote market
GET /api/v1/market/ticker?base=BTC&quote=USDT

Response:
{
  "base": "BTC",
  "quote": "USDT",
  "price": 43000.5,
  "open": 42800.0,
  "high": 43200.0,
  "low": 42700.0,
  "volume": 1234.5,
  "timestamp": 1704110400000,
  "sourceCount": 1
}

# 3. Get specific exchange
GET /api/v1/market/ticker?base=BTC&exchange=binance

Response:
{
  "base": "BTC",
  "exchange": "binance",
  "quote": "USDT",
  "pair": "BTC/USDT",
  "price": 43000.5,
  "volume": 1234.5,
  "timestamp": 1704110400000
}

# 4. Get with kimchi premium (김치 프리미엄 포함)
GET /api/v1/market/ticker?base=BTC&includePremium=true

Response:
{
  "base": "BTC",
  "markets": {
    "USDT": { "price": 43000.5, ... },
    "KRW": { "price": 58500000, ... }
  },
  "premium": {
    "value": "+1.52%",
    "note": "KRW market premium vs USDT market"
  }
}
// Calculation:
// Expected KRW = 43000.5 * 1360 (USDT/KRW) = 58,480,680
// Actual KRW = 58,500,000
// Premium = (58,500,000 - 58,480,680) / 58,480,680 = +1.52%

# 5. Get KRW market with premium
GET /api/v1/market/ticker?base=BTC&quote=KRW&includePremium=true

Response:
{
  "base": "BTC",
  "quote": "KRW",
  "price": 58500000,
  "open": 58200000,
  "high": 58800000,
  "low": 58000000,
  "volume": 45.2,
  "timestamp": 1704110400000,
  "sourceCount": 1,
  "premium": "+1.52%"
}
```

## Data Sources

### FX Rate for Premium Calculation (1분 주기)
- **USDT/KRW**: Upbit USDT/KRW 시장가 (김치 프리미엄 반영)
  - 이 레이트는 공식 USD/KRW 환율과 다름
  - KRW 마켓 전체의 프리미엄을 반영
  - Premium calculation에만 사용 (aggregation에는 사용 안 함)

## Migration Path

### Phase 1: Update CollectorService (2-3 hours)
1. Quote별 분리 aggregation 구현
   - 기존: `candle:BTC/USDT:aggregated`
   - 변경: `candle:BTC:USDT:aggregated`, `candle:BTC:KRW:aggregated`
2. Symbol metadata 구조 변경 (markets로 그룹핑)
3. USDT 거래소만으로 USDT aggregation, KRW 거래소만으로 KRW aggregation

### Phase 2: FX Rate Service (Optional, 1-2 hours)
1. FxRateService 구현 (김치 프리미엄 계산용)
2. USDT/KRW rate를 Upbit에서 수집
3. Premium calculation 로직 구현

### Phase 3: API Enhancement (2-3 hours)
1. TickerQueryDto 수정: `quote`, `includePremium` 파라미터 추가
2. MarketController에 quote별 필터링 로직 추가
3. Premium 정보 포함 응답 구현

### Phase 4: Testing (1 hour)
1. Unit tests for quote-separated aggregation
2. Unit tests for premium calculation
3. E2E tests for new API parameters
4. Manual verification

## Benefits

✅ **정확성**:
- Quote별 분리로 김치 프리미엄 왜곡 방지
- USD ≠ USDT 디페깅 이슈 회피
- 각 마켓의 실제 가격 반영

✅ **간단함**:
- Quote별로 aggregation만 분리
- FX Rate는 optional (premium calculation용)
- 기존 exchange-specific storage 재활용

✅ **확장성**:
- 새 quote currency 추가 쉬움 (JPY, EUR, ...)
- 같은 quote의 거래소 추가 쉬움 (Bybit USDT, Bithumb KRW, ...)
- Config 파일로 markets 관리

✅ **유연성**:
- Client가 원하는 quote market 선택
- Premium 정보 optional 제공
- Cross-market 비교 가능

✅ **성능**:
- Aggregation 로직 변경만 (storage 변경 없음)
- FX rate 1개만 수집 (USDT/KRW)
- Premium calculation은 on-demand
