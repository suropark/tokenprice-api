export interface ExchangeConfig {
  name: string;
  pair: string;
}

export interface MarketConfig {
  exchanges: ExchangeConfig[];
}

export interface SymbolConfig {
  base: string;
  markets: Record<string, MarketConfig>;
}

export const SYMBOLS: SymbolConfig[] = [
  {
    base: 'BTC',
    markets: {
      USDT: {
        exchanges: [{ name: 'binance', pair: 'BTC/USDT' }],
      },
      KRW: {
        exchanges: [{ name: 'upbit', pair: 'BTC/KRW' }],
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

export const QUOTE_CURRENCIES = ['USDT', 'KRW'] as const;
export type QuoteCurrency = (typeof QUOTE_CURRENCIES)[number];

// Helper functions
export function getSymbolConfig(base: string): SymbolConfig | undefined {
  return SYMBOLS.find((s) => s.base === base);
}

export function getExchangeMetadata(
  base: string,
  exchange: string,
): { quote: string; pair: string } | undefined {
  const symbol = getSymbolConfig(base);
  if (!symbol) return undefined;

  for (const [quote, market] of Object.entries(symbol.markets)) {
    const exchangeConfig = market.exchanges.find((e) => e.name === exchange);
    if (exchangeConfig) {
      return { quote, pair: exchangeConfig.pair };
    }
  }
  return undefined;
}

export function getAllSymbolPairs(): string[] {
  const pairs: string[] = [];
  for (const symbol of SYMBOLS) {
    for (const market of Object.values(symbol.markets)) {
      for (const exchange of market.exchanges) {
        if (!pairs.includes(exchange.pair)) {
          pairs.push(exchange.pair);
        }
      }
    }
  }
  return pairs;
}

export function getMarketExchanges(base: string, quote: string): ExchangeConfig[] {
  const symbol = getSymbolConfig(base);
  return symbol?.markets[quote]?.exchanges || [];
}
