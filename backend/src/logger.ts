import winston from 'winston';
import { config } from './config';

const REDACTED_FIELDS = new Set([
  'apiKey', 'api_key', 'token', 'secret', 'password', 'alpaca_key',
  'alpaca_secret', 'broker_credentials', 'authorization', 'jwt_secret',
  'anthropic_api_key', 'trading_api_token', 'ANTHROPIC_API_KEY',
  'TRADING_API_TOKEN', 'JWT_SECRET',
]);

function redactSensitive(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitive);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = REDACTED_FIELDS.has(k) ? '[REDACTED]' : redactSensitive(v);
  }
  return result;
}

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format((info) => {
      if (info.meta) info.meta = redactSensitive(info.meta);
      return info;
    })(),
    config.nodeEnv === 'development'
      ? winston.format.colorize()
      : winston.format.json(),
    winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
      const base = `${timestamp} [${level}] ${message}`;
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return stack ? `${base}\n${stack}` : `${base}${metaStr}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

export default logger;
