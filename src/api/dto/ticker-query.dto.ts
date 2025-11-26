import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class TickerQueryDto {
  @IsString()
  @IsNotEmpty()
  base: string; // BTC, ETH, ...

  @IsOptional()
  @IsString()
  exchange?: string; // 'binance', 'upbit' for specific exchange

  @IsOptional()
  @IsIn(['USDT', 'KRW'])
  quote?: string; // Filter by quote currency

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includePremium?: boolean; // Include kimchi premium calculation
}
