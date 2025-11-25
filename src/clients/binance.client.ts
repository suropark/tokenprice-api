import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export interface PriceData {
  price: number;
  volume: number;
  timestamp: number;
}

@Injectable()
export class BinanceClient {
  private readonly logger = new Logger(BinanceClient.name);
  private readonly axios: AxiosInstance;

  constructor() {
    this.axios = axios.create({
      baseURL: 'https://api.binance.com',
      timeout: 5000,
    });
  }

  /**
   * Normalize symbol format: BTC/USDT → BTCUSDT
   */
  private normalizeSymbol(symbol: string): string {
    return symbol.replace('/', '');
  }

  /**
   * Get current price for a symbol
   */
  async getPrice(symbol: string): Promise<PriceData | null> {
    try {
      const normalized = this.normalizeSymbol(symbol);
      const { data } = await this.axios.get('/api/v3/ticker/24hr', {
        params: { symbol: normalized },
      });

      return {
        price: parseFloat(data.lastPrice),
        volume: parseFloat(data.volume),
        timestamp: data.closeTime,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch price for ${symbol}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get prices for multiple symbols in parallel
   */
  async getPrices(symbols: string[]): Promise<Map<string, PriceData>> {
    const results = new Map<string, PriceData>();

    const promises = symbols.map(async (symbol) => {
      const data = await this.getPrice(symbol);
      if (data) results.set(symbol, data);
    });

    await Promise.all(promises);
    return results;
  }
}
