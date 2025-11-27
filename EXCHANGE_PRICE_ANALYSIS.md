# Exchange별 가격 저장 - 성능 및 용량 분석

## 📊 시나리오 비교

### 현재 구현 (Aggregated Only)
```
데이터 구조:
- Redis: candle:BTC/USDT:current { o, h, l, c, t }
- DB: ohlcv_1m (time, symbol, open, high, low, close, volume)

1분당 데이터:
- Redis: 1 key × 100 symbols = 100 keys
- DB: 1 row × 100 symbols = 100 rows
```

### 제안 1: Exchange별 전부 저장 (DB + Redis)
```
데이터 구조:
- Redis:
  * candle:BTC/USDT:binance { o, h, l, c, t, v }
  * candle:BTC/USDT:upbit { o, h, l, c, t, v }
  * candle:BTC/USDT:aggregated { o, h, l, c, t, v }

- DB: ohlcv_by_exchange (time, symbol, exchange, open, high, low, close, volume)

1분당 데이터:
- Redis: 3 keys × 100 symbols = 300 keys
- DB: 3 rows × 100 symbols = 300 rows
```

### 제안 2: Redis만 Exchange별, DB는 Aggregated (추천!)
```
데이터 구조:
- Redis:
  * candle:BTC/USDT:binance { o, h, l, c, t, v }
  * candle:BTC/USDT:upbit { o, h, l, c, t, v }
  * candle:BTC/USDT:aggregated { o, h, l, c, t, v }

- DB: ohlcv_1m (time, symbol, open, high, low, close, volume) - Aggregated only

1분당 데이터:
- Redis: 3 keys × 100 symbols = 300 keys (휘발성)
- DB: 1 row × 100 symbols = 100 rows (영구 저장)
```

---

## 💾 용량 분석

### Redis 메모리 사용량

**단일 candle key 크기**:
```
Key: "candle:BTC/USDT:binance" ≈ 30 bytes
Value (Hash):
  o: 10 bytes (필드명 + 값)
  h: 10 bytes
  l: 10 bytes
  c: 10 bytes
  t: 15 bytes
  v: 10 bytes
  sc: 5 bytes (source count)
Total per key: ~100 bytes
```

**100 symbols, 3 keys per symbol**:
- 현재: 100 keys × 100 bytes = **10 KB**
- Exchange별: 300 keys × 100 bytes = **30 KB**
- **차이: 20 KB (무시할 수준)**

**1시간 보관 시** (flush 후에도 1시간 유지):
- 현재: 10 KB × 60 = 600 KB
- Exchange별: 30 KB × 60 = **1.8 MB**
- **차이: 1.2 MB (여전히 무시할 수준)**

**결론**: Redis 메모리는 문제 없음 (MB 단위)

---

### TimescaleDB 디스크 사용량

**단일 row 크기**:
```sql
-- Current (aggregated)
time: 8 bytes
symbol: ~20 bytes (text)
open, high, low, close: 8 bytes each × 4 = 32 bytes
volume, quote_volume: 8 bytes × 2 = 16 bytes
source_count: 4 bytes
indexes, metadata: ~20 bytes
Total per row: ~108 bytes
```

**1년간 데이터 (100 symbols)**:
```
현재 (Aggregated only):
- Rows: 100 symbols × 525,600 min/year = 52,560,000 rows
- Size: 52,560,000 × 108 bytes = 5.67 GB/year
- Compressed (TimescaleDB 10x): ~570 MB/year

Exchange별 (3배):
- Rows: 157,680,000 rows
- Size: 17 GB/year
- Compressed: ~1.7 GB/year

차이: 1.13 GB/year (압축 후)
```

**5 exchanges 시나리오 (미래 확장)**:
```
Exchange별 전부 저장:
- Rows: 262,800,000 rows
- Size: 28.4 GB/year
- Compressed: ~2.84 GB/year

차이: 2.27 GB/year (압축 후)
```

**결론**:
- 2개 거래소: **연간 1.13 GB 추가** (문제 없음)
- 5개 거래소: **연간 2.27 GB 추가** (여전히 관리 가능)

---

## ⚡ 성능 분석

### Write 성능

**현재 (Aggregated)**:
```
Redis: 100 writes/second (1 per symbol)
DB: 100 inserts/minute (bulk)
```

**Exchange별 저장 (DB + Redis)**:
```
Redis: 300 writes/second (3 per symbol)
DB: 300 inserts/minute (bulk)

성능 차이:
- Redis: 3배 증가 (300 vs 100) - 문제 없음 (Redis는 100k+ ops/sec 가능)
- DB: 3배 증가 (300 vs 100 rows) - Bulk insert라 문제 없음
```

**Redis만 Exchange별 (추천)**:
```
Redis: 300 writes/second
DB: 100 inserts/minute (aggregated만)

성능 차이:
- Redis: 3배 증가 (여전히 무시할 수준)
- DB: 변화 없음
```

### Read 성능

**Exchange별 데이터 조회**:
```sql
-- 현재: 단순 조회
SELECT * FROM ohlcv_1m WHERE symbol = 'BTC/USDT' AND time > ...

-- Exchange별 저장 시
SELECT * FROM ohlcv_by_exchange WHERE symbol = 'BTC/USDT' AND time > ...
-- 또는
SELECT * FROM ohlcv_by_exchange
WHERE symbol = 'BTC/USDT' AND exchange = 'binance' AND time > ...

성능 차이:
- Full scan: 3배 느림 (3배 더 많은 rows)
- Index seek: 동일 (exchange 컬럼 추가 시)
```

**결론**: Index 잘 설계하면 성능 차이 미미

---

## 🎯 추천 방안: Redis만 Exchange별, DB는 Aggregated

### 장점

1. **실시간 데이터**: Exchange별 가격을 Redis에서 즉시 조회 가능
2. **DB 용량 절약**: 장기 보관은 aggregated만
3. **성능**: Redis write 3배 증가하지만 무시할 수준
4. **유연성**: 필요하면 나중에 DB에도 추가 가능

### 구현 방안

```typescript
// Redis 구조
candle:BTC/USDT:binance → { o, h, l, c, t, v }
candle:BTC/USDT:upbit → { o, h, l, c, t, v }
candle:BTC/USDT:aggregated → { o, h, l, c, t, v, sc, s }

// DB 구조 (기존 유지)
ohlcv_1m → aggregated data only
```

### API

```typescript
// 현재가 (aggregated)
GET /api/v1/market/ticker?symbol=BTC/USDT

// Exchange별 현재가
GET /api/v1/market/ticker?symbol=BTC/USDT&exchange=binance
GET /api/v1/market/ticker?symbol=BTC/USDT&exchange=upbit

// 모든 Exchange 현재가
GET /api/v1/market/ticker?symbol=BTC/USDT&includeExchanges=true
```

---

## 📊 결론 및 권장사항

### 즉시 구현 (Phase 1)
✅ **Redis에만 Exchange별 가격 저장**
- 메모리: 30 KB (100 symbols × 3 exchanges)
- Write: 300 ops/sec (무시할 수준)
- 장점: 실시간 조회 가능, DB 용량 절약

### 필요 시 구현 (Phase 2)
⚠️ **DB에도 Exchange별 저장**
- 용량: +1.13 GB/year (2 exchanges), +2.27 GB/year (5 exchanges)
- Write: 3배 증가 (여전히 관리 가능)
- 필요한 경우: 과거 Exchange별 가격 분석, Compliance, 백테스팅

### 구현 우선순위

1. **지금 구현**:
   - Redis에 Exchange별 현재 candle 저장
   - 현재가 API (aggregated + per-exchange)
   - Redis에서만 조회

2. **나중에 구현** (필요 시):
   - DB에 Exchange별 historical data 저장
   - Historical API에 exchange 파라미터 추가
   - 백테스팅/분석 도구

---

## 💡 최종 판단

**성능**: 문제 없음 (Redis, DB 모두)
**용량**: 연간 1-2 GB 추가 (무시할 수준)
**권장**: Redis만 Exchange별 저장 → 나중에 필요하면 DB 추가

지금 구현해드릴까요? 🚀
