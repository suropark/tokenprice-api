import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

export class TickerQueryDto {
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsOptional()
  @IsString()
  exchange?: string; // 'binance', 'upbit', or undefined for aggregated

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeExchanges?: boolean; // Include all exchange prices
}
