# Railway Deployment Guide

이 가이드는 Token Price Oracle을 Railway에 배포하는 방법을 설명합니다.

## Prerequisites

- Railway 계정 (https://railway.app)
- GitHub 계정 (optional, 추천)
- Railway CLI (optional)

## Railway 배포 방법

### Option 1: GitHub 연동 (추천)

이 방법이 가장 간단하고 자동 배포가 가능합니다.

#### 1. GitHub에 Push

```bash
# 현재 브랜치를 GitHub에 push
git push origin <your-branch>
```

#### 2. Railway Project 생성

1. https://railway.app 접속 및 로그인
2. "New Project" 클릭
3. "Deploy from GitHub repo" 선택
4. Repository 선택: `tokenprice-api`
5. Branch 선택 (예: `main` 또는 `claude/token-price-oracle-01GVYMTHC5kDeMgGtia7p3Q8`)

#### 3. PostgreSQL 추가

1. Project 대시보드에서 "+ New" 클릭
2. "Database" → "Add PostgreSQL" 선택
3. 자동으로 `DATABASE_URL` 환경 변수가 생성됨

**중요**: TimescaleDB extension 활성화

Railway PostgreSQL에 TimescaleDB extension을 활성화해야 합니다:

```bash
# Railway CLI 사용
railway run psql $DATABASE_URL

# 또는 Railway 대시보드의 "Query" 탭에서
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

#### 4. Redis 추가

1. Project 대시보드에서 "+ New" 클릭
2. "Database" → "Add Redis" 선택
3. 자동으로 `REDIS_URL` 환경 변수가 생성됨

#### 5. 환경 변수 설정

API 서비스의 "Variables" 탭에서 다음 환경 변수 추가:

```bash
# Port (Railway가 자동 할당)
PORT=3000

# Database (자동 생성됨, 확인만)
DATABASE_URL=<PostgreSQL에서 자동 생성>

# Redis (자동 생성, 수동 설정 필요)
REDIS_HOST=<Redis 서비스의 내부 호스트명>
REDIS_PORT=6379
REDIS_PASSWORD=<Redis 비밀번호 (optional)>

# 또는 REDIS_URL 사용 (더 간단)
REDIS_URL=redis://<Redis 내부 주소>:6379

# Symbols (수집할 토큰 목록)
SYMBOLS=BTC/USDT,ETH/USDT,BTC/KRW,ETH/KRW

# Node Environment
NODE_ENV=production
```

**Redis 연결 설정**:
- Railway의 Redis 서비스로 이동
- "Connect" 탭에서 내부 연결 정보 확인
- `REDIS_PRIVATE_URL` 또는 `REDIS_URL` 복사
- API 서비스의 환경 변수에 추가

#### 6. 배포

환경 변수 설정 후 자동으로 배포가 시작됩니다.

- 배포 로그 확인: "Deployments" 탭
- 상태 확인: "Metrics" 탭

#### 7. Database Migration

첫 배포 시 Prisma migration이 자동 실행됩니다 (`railway.toml`의 `startCommand` 참조).

만약 수동으로 실행해야 한다면:

```bash
# Railway CLI 설치
npm install -g @railway/cli

# Railway 로그인
railway login

# Project 연결
railway link

# Migration 실행
railway run npx prisma migrate deploy
```

#### 8. TimescaleDB 설정

PostgreSQL에 TimescaleDB 전용 설정 적용:

```bash
# Railway CLI로 PostgreSQL 접속
railway run psql $DATABASE_URL

# 또는 대시보드의 PostgreSQL → Query 탭에서 실행
```

다음 SQL 실행:

```sql
-- Hypertable 생성
SELECT create_hypertable('ohlcv_1m', 'time', if_not_exists => TRUE);

-- Compression 설정
ALTER TABLE ohlcv_1m SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol',
  timescaledb.compress_orderby = 'time DESC'
);

-- Compression policy (7일 후 압축)
SELECT add_compression_policy('ohlcv_1m', INTERVAL '7 days');

-- Retention policy (90일 후 삭제)
SELECT add_retention_policy('ohlcv_1m', INTERVAL '90 days');

-- Continuous aggregates (5분봉)
CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_5m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('5 minutes', time) AS bucket,
  symbol,
  first(open, time) AS open,
  max(high) AS high,
  min(low) AS low,
  last(close, time) AS close,
  sum(volume) AS volume,
  sum(quote_volume) AS quote_volume,
  avg(source_count) AS source_count
FROM ohlcv_1m
GROUP BY bucket, symbol;

-- Continuous aggregates (1시간봉)
CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', time) AS bucket,
  symbol,
  first(open, time) AS open,
  max(high) AS high,
  min(low) AS low,
  last(close, time) AS close,
  sum(volume) AS volume,
  sum(quote_volume) AS quote_volume,
  avg(source_count) AS source_count
FROM ohlcv_1m
GROUP BY bucket, symbol;

-- Refresh policies
SELECT add_continuous_aggregate_policy('ohlcv_5m',
  start_offset => INTERVAL '10 minutes',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '5 minutes');

SELECT add_continuous_aggregate_policy('ohlcv_1h',
  start_offset => INTERVAL '4 hours',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');
```

#### 9. 확인

배포가 완료되면 생성된 URL로 접속:

```bash
# Health check
curl https://<your-app>.railway.app/api/v1/market/health

# Ticker API
curl https://<your-app>.railway.app/api/v1/market/ticker?base=BTC

# Symbols
curl https://<your-app>.railway.app/api/v1/market/symbols
```

### Option 2: Railway CLI

#### 1. Railway CLI 설치

```bash
npm install -g @railway/cli
```

#### 2. 로그인

```bash
railway login
```

#### 3. Project 초기화

```bash
# 프로젝트 루트에서
railway init

# 또는 기존 프로젝트 연결
railway link
```

#### 4. 서비스 추가

```bash
# PostgreSQL 추가
railway add postgresql

# Redis 추가
railway add redis
```

#### 5. 환경 변수 설정

```bash
# 로컬 환경 변수 파일 생성
railway variables set SYMBOLS="BTC/USDT,ETH/USDT,BTC/KRW,ETH/KRW"
railway variables set NODE_ENV=production
```

#### 6. 배포

```bash
# 배포
railway up

# 배포 후 로그 확인
railway logs
```

## Architecture on Railway

```
┌──────────────────────────────────────────────────┐
│                  Railway Project                 │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌─────────────┐   ┌──────────────┐            │
│  │   API App   │   │ PostgreSQL   │            │
│  │  (Node.js)  │──→│ + TimescaleDB│            │
│  └──────┬──────┘   └──────────────┘            │
│         │                                        │
│         ↓                                        │
│  ┌──────────────┐                               │
│  │    Redis     │                               │
│  └──────────────┘                               │
│                                                  │
└──────────────────────────────────────────────────┘
         │
         ↓
   Public URL
https://<your-app>.railway.app
```

## 환경 변수 상세

| 변수명 | 설명 | 기본값 | 필수 |
|--------|------|--------|------|
| `PORT` | API 포트 | 3000 | ✅ |
| `DATABASE_URL` | PostgreSQL 연결 URL | (자동) | ✅ |
| `REDIS_HOST` | Redis 호스트 | - | ✅ |
| `REDIS_PORT` | Redis 포트 | 6379 | ✅ |
| `REDIS_PASSWORD` | Redis 비밀번호 | - | ❌ |
| `SYMBOLS` | 수집할 심볼 목록 | BTC/USDT,ETH/USDT | ✅ |
| `NODE_ENV` | 환경 | production | ✅ |

## Troubleshooting

### 1. DATABASE_URL 인식 안 됨

Railway의 PostgreSQL 서비스에서 "Connect" 탭을 확인하고, API 서비스의 환경 변수에 `DATABASE_URL`이 자동으로 추가되었는지 확인하세요.

수동 추가가 필요한 경우:
```bash
railway variables set DATABASE_URL="postgresql://..."
```

### 2. Redis 연결 실패

Redis는 내부 네트워크로 연결해야 합니다:
- Railway의 Redis 서비스 → "Connect" 탭
- "Private Networking" 사용
- `REDIS_PRIVATE_URL` 또는 `redis.railway.internal` 주소 사용

### 3. Prisma Migration 실패

```bash
# Railway CLI로 수동 실행
railway run npx prisma migrate deploy

# 또는 Prisma Studio 접속
railway run npx prisma studio
```

### 4. TimescaleDB Extension 누락

```bash
# PostgreSQL 접속
railway run psql $DATABASE_URL

# Extension 설치
CREATE EXTENSION IF NOT EXISTS timescaledb;
\dx  # extension 확인
```

### 5. 메모리 부족

Railway의 무료 플랜은 제한이 있습니다. 프로덕션 사용 시 유료 플랜 권장:
- Starter: $5/month
- Developer: $20/month

### 6. 배포 로그 확인

```bash
# CLI에서 로그 확인
railway logs

# 또는 대시보드에서
# Project → Service → Deployments → 최신 배포 클릭
```

## 비용 예상 (2024년 1월 기준)

Railway는 사용량 기반 과금:

**무료 플랜**:
- $5 credit/month
- Hobby projects에 적합
- 제한: 512MB RAM, shared CPU

**Pro 플랫**:
- $20/month (base)
- Usage-based pricing
- 예상 비용:
  - API (1GB RAM): ~$10/month
  - PostgreSQL (1GB): ~$10/month
  - Redis (512MB): ~$5/month
  - **Total**: ~$45/month

**최적화 팁**:
- Development 환경은 무료 플랜 사용
- Production만 Pro 플랫 사용
- 불필요한 서비스 중지

## Monitoring

Railway 대시보드에서 제공:
- CPU/Memory 사용량
- Network traffic
- Deployment logs
- Crash reports

추가 모니터링이 필요하면:
- Datadog
- New Relic
- Sentry (error tracking)

## Auto-Deploy 설정

GitHub 연동 시 자동으로 활성화됩니다:
1. GitHub에 push
2. Railway가 자동으로 감지
3. 빌드 및 배포 시작
4. Health check 통과 시 트래픽 전환

**Branch 전략**:
- `main` 브랜치: Production 환경
- `develop` 브랜치: Staging 환경 (별도 Railway 프로젝트)

## 참고 자료

- Railway Documentation: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- Prisma on Railway: https://www.prisma.io/docs/guides/deployment/deployment-guides/deploying-to-railway
- TimescaleDB: https://docs.timescale.com

## 지원

문제가 발생하면:
1. Railway 대시보드의 로그 확인
2. Railway Discord 커뮤니티
3. GitHub Issues
