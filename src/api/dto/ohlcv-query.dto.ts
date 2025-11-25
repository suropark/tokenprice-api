import { IsString, IsNotEmpty, IsInt, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class OhlcvQueryDto {
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(0)
  from: number;

  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(0)
  to: number;
}
