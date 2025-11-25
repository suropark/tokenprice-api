import { Injectable } from '@nestjs/common';
import { PriceData } from '../clients/binance.client';

export interface AggregatedPrice {
  price: number;
  volume: number;
  sourceCount: number;
  algorithm: 'median' | 'vwap';
}

@Injectable()
export class AggregationService {
  /**
   * Calculate median price
   */
  calculateMedian(prices: number[]): number {
    if (prices.length === 0) {
      throw new Error('No prices to aggregate');
    }

    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  /**
   * Calculate Volume-Weighted Average Price
   */
  calculateVWAP(priceData: PriceData[]): number {
    let totalVolume = 0;
    let weightedSum = 0;

    for (const { price, volume } of priceData) {
      totalVolume += volume;
      weightedSum += price * volume;
    }

    if (totalVolume === 0) {
      // Fallback to median if no volume data
      return this.calculateMedian(priceData.map((d) => d.price));
    }

    return weightedSum / totalVolume;
  }

  /**
   * Aggregate multiple price sources into a single reliable price
   */
  aggregate(priceData: PriceData[]): AggregatedPrice {
    if (priceData.length === 0) {
      throw new Error('No price data to aggregate');
    }

    // Check if we have volume data
    const hasVolume = priceData.some((d) => d.volume > 0);

    const price = hasVolume
      ? this.calculateVWAP(priceData)
      : this.calculateMedian(priceData.map((d) => d.price));

    const totalVolume = priceData.reduce((sum, d) => sum + d.volume, 0);

    return {
      price,
      volume: totalVolume,
      sourceCount: priceData.length,
      algorithm: hasVolume ? 'vwap' : 'median',
    };
  }
}
