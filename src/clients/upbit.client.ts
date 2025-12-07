import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { PriceData, OHLCVData } from './binance.client';

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

  /**
   * Get historical OHLCV data (candles)
   * @param symbol - Trading pair (e.g., 'BTC/KRW')
   * @param to - End time in ISO 8601 format (optional, defaults to now)
   * @param count - Number of candles (max 200)
   */
  async getHistoricalData(symbol: string, to?: string, count: number = 200): Promise<OHLCVData[]> {
    try {
      const market = this.normalizeSymbol(symbol);
      const params: any = { market, count };
      if (to) params.to = to;

      const { data } = await this.axios.get('/v1/candles/minutes/1', {
        params,
      });

      return data.map((candle: any) => ({
        time: new Date(candle.candle_date_time_kst).getTime(),
        open: candle.opening_price,
        high: candle.high_price,
        low: candle.low_price,
        close: candle.trade_price,
        volume: candle.candle_acc_trade_volume,
        quoteVolume: candle.candle_acc_trade_price,
      }));
    } catch (error) {
      this.logger.error(`Failed to fetch historical data for ${symbol}: ${error.message}`);
      return [];
    }
  }

  /**
   * Get historical data in batches for a date range
   * Upbit limits to 200 candles per request and returns data in reverse order (newest first)
   */
  async getHistoricalDataRange(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<OHLCVData[]> {
    const allData: OHLCVData[] = [];
    const batchSize = 200;
    const oneMinute = 60 * 1000;
    let currentEnd = endTime;

    while (currentEnd > startTime) {
      const toDate = new Date(currentEnd).toISOString();
      const data = await this.getHistoricalData(symbol, toDate, batchSize);

      if (data.length === 0) {
        break;
      }

      // Filter data within the range
      const filteredData = data.filter(
        (candle) => candle.time >= startTime && candle.time <= endTime,
      );

      allData.unshift(...filteredData.reverse()); // Reverse and prepend

      // Move to next batch (going backwards)
      const oldestTime = data[data.length - 1].time;
      if (oldestTime <= startTime) {
        break;
      }

      currentEnd = oldestTime - oneMinute;

      // Rate limiting: wait 100ms between requests
      await new Promise((resolve) => setTimeout(resolve, 100));

      this.logger.debug(`Fetched ${data.length} candles for ${symbol}, total: ${allData.length}`);
    }

    // Sort by time ascending
    return allData.sort((a, b) => a.time - b.time);
  }
}
