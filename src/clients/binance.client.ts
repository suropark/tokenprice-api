import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export interface PriceData {
  price: number;
  volume: number;
  timestamp: number;
}

export interface OHLCVData {
  time: number; // Unix timestamp in milliseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
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

  /**
   * Get historical OHLCV data (klines)
   * @param symbol - Trading pair (e.g., 'BTC/USDT')
   * @param interval - Kline interval ('1m', '5m', '1h', '1d', etc.)
   * @param startTime - Start time in milliseconds
   * @param endTime - End time in milliseconds
   * @param limit - Max number of candles (default 1000, max 1000)
   */
  async getHistoricalData(
    symbol: string,
    interval: string = '1m',
    startTime: number,
    endTime: number,
    limit: number = 1000,
  ): Promise<OHLCVData[]> {
    try {
      const normalized = this.normalizeSymbol(symbol);
      const { data } = await this.axios.get('/api/v3/klines', {
        params: {
          symbol: normalized,
          interval,
          startTime,
          endTime,
          limit,
        },
      });

      return data.map((candle: any[]) => ({
        time: candle[0], // Open time
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[5]),
        quoteVolume: parseFloat(candle[7]),
      }));
    } catch (error) {
      this.logger.error(
        `Failed to fetch historical data for ${symbol}: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Get historical data in batches for a date range
   * Binance limits to 1000 candles per request
   */
  async getHistoricalDataRange(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<OHLCVData[]> {
    const allData: OHLCVData[] = [];
    const batchSize = 1000;
    const oneMinute = 60 * 1000;
    let currentStart = startTime;

    while (currentStart < endTime) {
      const currentEnd = Math.min(
        currentStart + batchSize * oneMinute,
        endTime,
      );

      const data = await this.getHistoricalData(
        symbol,
        '1m',
        currentStart,
        currentEnd,
        batchSize,
      );

      if (data.length === 0) {
        break;
      }

      allData.push(...data);

      // Move to next batch
      currentStart = data[data.length - 1].time + oneMinute;

      // Rate limiting: wait 100ms between requests
      await new Promise((resolve) => setTimeout(resolve, 100));

      this.logger.debug(
        `Fetched ${data.length} candles for ${symbol}, total: ${allData.length}`,
      );
    }

    return allData;
  }
}
