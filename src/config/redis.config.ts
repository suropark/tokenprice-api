import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from './configuration';

export const redisProvider = {
  provide: 'REDIS_CLIENT',
  useFactory: (configService: ConfigService<AppConfig>) => {
    const config = configService.get('redis');
    return new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });
  },
  inject: [ConfigService],
};
