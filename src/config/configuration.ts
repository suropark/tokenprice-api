import { z } from 'zod';

const ConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3000),
  redis: z.object({
    host: z.string(),
    port: z.coerce.number(),
    password: z.string().optional(),
  }),
  databaseUrl: z.string(),
  symbols: z.string().transform((s) => s.split(',')),
  binanceApiKey: z.string().optional(),
  upbitApiKey: z.string().optional(),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export const configuration = (): AppConfig => {
  const config = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3000,
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
    },
    databaseUrl: process.env.DATABASE_URL,
    symbols: process.env.SYMBOLS || 'BTC/USDT,ETH/USDT',
    binanceApiKey: process.env.BINANCE_API_KEY,
    upbitApiKey: process.env.UPBIT_API_KEY,
  };

  return ConfigSchema.parse(config);
};
