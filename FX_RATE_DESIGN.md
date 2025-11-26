# FX Rate Service Design

## Problem

각 exchange의 quote currency가 다름:
- Binance: BTC/USDT (USDT quoted)
- Upbit: BTC/KRW (KRW quoted)

가격 비교 및 aggregation을 위해 환율/가격 변환 필요:
- Stablecoins: USDT, USDC, BUSD
- Fiat: KRW, JPY, USD, EUR

## Solution: Multi-Quote Storage with FX Rate Cache

### 핵심 설계 원칙

1. **원본 데이터 보존**: Quote currency 그대로 저장
2. **On-demand Normalization**: 필요시 API에서 변환
3. **간단한 FX Rate 관리**: Redis cache + 주기적 업데이트

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Collector Service                    │
│  ┌──────────┐         ┌──────────┐                     │
│  │ Binance  │         │  Upbit   │                     │
│  │ BTC/USDT │         │ BTC/KRW  │                     │
│  └────┬─────┘         └────┬─────┘                     │
│       │                    │                            │
│       └────────┬───────────┘                            │
│                ▼                                         │
│    Store with quote currency                            │
│    - candle:BTC/USDT:binance                           │
│    - candle:BTC/KRW:upbit                              │
└─────────────────────────────────────────────────────────┘
                         │
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌───────────────┐  ┌──────────┐  ┌──────────────┐
│  TimescaleDB  │  │  Redis   │  │ FX Rate      │
│               │  │          │  │ Service      │
│ Original      │  │ Original │  │              │
│ quote         │  │ quote    │  │ Redis:       │
│ currency      │  │ currency │  │ fx:USDT:KRW  │
└───────────────┘  └──────────┘  │ fx:USD:KRW   │
                                  │ fx:USDC:USD  │
                                  └──────────────┘
                                         │
                         ┌───────────────┼───────────────┐
                         ▼               ▼               ▼
                   ┌──────────┐   ┌──────────┐   ┌──────────┐
                   │ Binance  │   │  Upbit   │   │ Fiat API │
                   │          │   │          │   │          │
                   │ USDT/KRW │   │ USDT/KRW │   │ USD/KRW  │
                   │ USDC/USDT│   │          │   │ EUR/USD  │
                   └──────────┘   └──────────┘   └──────────┘

                         ┌─────────────────┐
                         │   Market API    │
                         │                 │
                         │  normalize=KRW  │
                         │  BTC/USDT → KRW │
                         │  BTC/KRW → KRW  │
                         └─────────────────┘
```

## Implementation

### 1. FX Rate Data Structure (Redis)

```typescript
// FX Rate Cache (Redis)
Key: fx:{from}:{to}
Value: {
  rate: number,        // 1 USDT = 1350 KRW
  timestamp: number,
  source: string       // 'binance', 'upbit', 'exchangerate-api'
}

// Examples
fx:USDT:KRW → { rate: 1350.5, timestamp: 1704110400000, source: 'upbit' }
fx:USD:KRW  → { rate: 1340.0, timestamp: 1704110400000, source: 'exchangerate-api' }
fx:USDC:USD → { rate: 1.0001, timestamp: 1704110400000, source: 'binance' }
fx:EUR:USD  → { rate: 1.09, timestamp: 1704110400000, source: 'exchangerate-api' }
```

### 2. Symbol Metadata (Config)

```typescript
// config/symbols.ts
export const SYMBOLS = [
  {
    base: 'BTC',
    exchanges: [
      { name: 'binance', pair: 'BTC/USDT', quote: 'USDT' },
      { name: 'upbit', pair: 'BTC/KRW', quote: 'KRW' },
    ],
  },
  {
    base: 'ETH',
    exchanges: [
      { name: 'binance', pair: 'ETH/USDT', quote: 'USDT' },
      { name: 'upbit', pair: 'ETH/KRW', quote: 'KRW' },
    ],
  },
];

// Supported quote currencies
export const QUOTE_CURRENCIES = ['USDT', 'USDC', 'BUSD', 'KRW', 'JPY', 'USD', 'EUR'];
```

### 3. FX Rate Service

```typescript
@Injectable()
export class FxRateService {
  constructor(
    private readonly redis: Redis,
    private readonly binanceClient: BinanceClient,
    private readonly upbitClient: UpbitClient,
  ) {}

  // Update rates every 1 minute (stablecoins) / 1 hour (fiat)
  @Cron('*/1 * * * *')
  async updateStablecoinRates() {
    // USDT/KRW from Upbit (most accurate for KRW market)
    const usdtKrw = await this.upbitClient.getPrice('USDT/KRW');
    if (usdtKrw) {
      await this.setRate('USDT', 'KRW', usdtKrw.price, 'upbit');
    }

    // USDC/USDT from Binance
    const usdcUsdt = await this.binanceClient.getPrice('USDC/USDT');
    if (usdcUsdt) {
      await this.setRate('USDC', 'USDT', usdcUsdt.price, 'binance');
    }
  }

  @Cron('0 * * * *') // Every hour
  async updateFiatRates() {
    // Fetch from exchangerate-api.io or fixer.io
    const rates = await this.fetchFiatRates(['KRW', 'JPY', 'EUR']);
    for (const [currency, rate] of Object.entries(rates)) {
      await this.setRate('USD', currency, rate, 'exchangerate-api');
    }
  }

  async getRate(from: string, to: string): Promise<number | null> {
    if (from === to) return 1;

    // Try direct rate
    const direct = await this.redis.hget(`fx:${from}:${to}`, 'rate');
    if (direct) return parseFloat(direct);

    // Try inverse rate
    const inverse = await this.redis.hget(`fx:${to}:${from}`, 'rate');
    if (inverse) return 1 / parseFloat(inverse);

    // Try cross rate via USD
    // e.g., USDT → KRW = USDT → USD → KRW
    if (from !== 'USD' && to !== 'USD') {
      const fromToUsd = await this.getRate(from, 'USD');
      const usdToTo = await this.getRate('USD', to);
      if (fromToUsd && usdToTo) return fromToUsd * usdToTo;
    }

    return null;
  }

  async convert(amount: number, from: string, to: string): Promise<number | null> {
    const rate = await this.getRate(from, to);
    return rate ? amount * rate : null;
  }

  private async setRate(from: string, to: string, rate: number, source: string) {
    await this.redis.hset(`fx:${from}:${to}`, {
      rate: rate.toString(),
      timestamp: Date.now().toString(),
      source,
    });
    await this.redis.expire(`fx:${from}:${to}`, 86400); // 24 hour TTL
  }
}
```

### 4. Enhanced Market API

```typescript
// DTO
export class TickerQueryDto {
  @IsString() @IsNotEmpty() symbol: string;
  @IsOptional() @IsString() exchange?: string;
  @IsOptional() @IsBoolean() includeExchanges?: boolean;

  // NEW: Normalize to specific quote currency
  @IsOptional()
  @IsIn(['USDT', 'USDC', 'KRW', 'JPY', 'USD', 'EUR'])
  normalize?: string;
}

// Controller
@Get('ticker')
async getTicker(@Query() query: TickerQueryDto) {
  const { symbol, exchange, includeExchanges, normalize } = query;

  if (includeExchanges) {
    const result = await this.getAllExchangePrices(symbol);

    // Normalize if requested
    if (normalize) {
      return this.normalizeAllPrices(result, normalize);
    }
    return result;
  }

  if (exchange) {
    const price = await this.getExchangePrice(symbol, exchange);
    if (!price) throw new NotFoundException();

    if (normalize) {
      return this.normalizePrice(price, normalize);
    }
    return price;
  }

  // Aggregated - need to normalize all exchanges to same quote first
  return this.getAggregatedPrice(symbol, normalize);
}

private async normalizePrice(
  price: PriceData,
  targetQuote: string
): Promise<PriceData> {
  const { symbol, exchange, price: value, quote } = price;

  if (quote === targetQuote) return price;

  const rate = await this.fxRateService.getRate(quote, targetQuote);
  if (!rate) {
    throw new BadRequestException(`FX rate ${quote}/${targetQuote} not available`);
  }

  return {
    ...price,
    price: value * rate,
    quote: targetQuote,
    originalQuote: quote,
    fxRate: rate,
  };
}

// Aggregation with normalization
private async getAggregatedPrice(symbol: string, normalize?: string) {
  const allPrices = await this.getAllExchangePrices(symbol);

  // Determine target quote (default: most common quote or USD)
  const targetQuote = normalize || this.getDefaultQuote(allPrices);

  // Normalize all exchange prices to same quote
  const normalized = await Promise.all(
    allPrices.exchanges.map(p => this.normalizePrice(p, targetQuote))
  );

  // Aggregate normalized prices
  return this.aggregationService.aggregate(normalized);
}
```

### 5. API Examples

```bash
# Original prices (no conversion)
GET /api/v1/market/ticker?symbol=BTC&includeExchanges=true

Response:
{
  "symbol": "BTC",
  "exchanges": {
    "binance": { "price": 43000, "quote": "USDT" },
    "upbit": { "price": 58000000, "quote": "KRW" }
  }
}

# Normalize to KRW
GET /api/v1/market/ticker?symbol=BTC&includeExchanges=true&normalize=KRW

Response:
{
  "symbol": "BTC",
  "quote": "KRW",
  "exchanges": {
    "binance": {
      "price": 58050000,        # 43000 * 1350 (USDT/KRW rate)
      "originalQuote": "USDT",
      "fxRate": 1350
    },
    "upbit": {
      "price": 58000000,
      "originalQuote": "KRW",
      "fxRate": 1
    }
  }
}

# Aggregated (auto-normalize to USD)
GET /api/v1/market/ticker?symbol=BTC

Response:
{
  "symbol": "BTC",
  "quote": "USD",
  "price": 42950,  # Aggregated from normalized prices
  "sources": [
    { "exchange": "binance", "originalQuote": "USDT", "fxRate": 0.9998 },
    { "exchange": "upbit", "originalQuote": "KRW", "fxRate": 0.000746 }
  ]
}
```

## Data Sources

### Stablecoin Rates (Real-time, 1분 주기)
- **Upbit**: USDT/KRW (가장 정확한 한국 시장 레ート)
- **Binance**: USDC/USDT, BUSD/USDT

### Fiat Rates (1시간 주기)
- **Free**: exchangerate-api.io (1500 req/month free)
- **Paid**: fixer.io, currencylayer.com
- **Fallback**: Upbit KRW market의 USD/KRW pair

## Migration Path

### Phase 1: FX Rate Service (2-3 hours)
1. FxRateService 구현
2. Redis에 FX rate cache
3. Symbol metadata에 quote currency 추가

### Phase 2: API Enhancement (1-2 hours)
1. TickerQueryDto에 normalize 파라미터 추가
2. MarketController에 normalization 로직 추가
3. AggregationService 수정 (normalize 후 aggregate)

### Phase 3: Testing (1 hour)
1. Unit tests for FxRateService
2. E2E tests for normalized API
3. Manual verification

## Benefits

✅ **간단함**:
- 추가 서비스 1개 (FxRateService)
- Redis에 FX rate만 추가
- 기존 데이터 구조 변경 없음

✅ **확장성**:
- 새 quote currency 추가 쉬움 (config만 수정)
- 새 FX rate source 추가 쉬움 (provider pattern)
- Cross rate 자동 계산

✅ **유연성**:
- 원본 데이터 보존
- API에서 선택적 normalization
- Client가 원하는 quote currency 선택 가능

✅ **성능**:
- FX rate는 변동이 적어 cache hit rate 높음
- On-demand conversion으로 storage overhead 없음
- Stablecoin: 1분, Fiat: 1시간 업데이트로 충분
