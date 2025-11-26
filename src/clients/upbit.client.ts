import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { PriceData } from './binance.client';

@Injectable()
export class UpbitClient {
  private readonly logger = new Logger(UpbitClient.name);
  private readonly axios: AxiosInstance;

  constructor() {
    this.axios = axios.create({
      baseURL: 'https://api.upbit.com',
      timeout: 5000,
    });
  }

  /**
   * Normalize symbol format: BTC/USDT → KRW-BTC
   * Note: Upbit uses KRW pairs
   */
  private normalizeSymbol(symbol: string): string {
    const [base] = symbol.split('/');
    return `KRW-${base}`;
  }

  /**
   * Get current price for a symbol
   */
  async getPrice(symbol: string): Promise<PriceData | null> {
    try {
      const market = this.normalizeSymbol(symbol);
      const { data } = await this.axios.get('/v1/ticker', {
        params: { markets: market },
      });

      if (!data || data.length === 0) {
        return null;
      }

      const ticker = data[0];

      return {
        price: ticker.trade_price,
        volume: ticker.acc_trade_volume_24h,
        timestamp: ticker.timestamp,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch price for ${symbol}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get prices for multiple symbols (Upbit supports batch request)
   */
  async getPrices(symbols: string[]): Promise<Map<string, PriceData>> {
    const results = new Map<string, PriceData>();

    try {
      const markets = symbols.map((s) => this.normalizeSymbol(s)).join(',');

      const { data } = await this.axios.get('/v1/ticker', {
        params: { markets },
      });

      data.forEach((ticker: any, index: number) => {
        const symbol = symbols[index];
        results.set(symbol, {
          price: ticker.trade_price,
          volume: ticker.acc_trade_volume_24h,
          timestamp: ticker.timestamp,
        });
      });
    } catch (error) {
      this.logger.error(`Failed to fetch batch prices: ${error.message}`);
    }

    return results;
  }
}
