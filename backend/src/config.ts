import dotenv from 'dotenv';
import type { AssistantMode } from '../../shared/types';

dotenv.config();

function requireEnv(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (!val) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    console.warn(`[VEGA] WARNING: ${key} is not set. Using empty string.`);
    return '';
  }
  return val;
}

function boolEnv(key: string, defaultVal: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return defaultVal;
  return val.toLowerCase() === 'true';
}

const validModes: AssistantMode[] = ['readonly', 'approval_required', 'autonomous'];
const rawMode = process.env.AI_ASSISTANT_MODE ?? 'readonly';
const mode: AssistantMode = validModes.includes(rawMode as AssistantMode)
  ? (rawMode as AssistantMode)
  : 'readonly';

export const config = {
  assistantName: process.env.AI_ASSISTANT_NAME ?? 'VEGA',
  mode,
  tradingApiBaseUrl: requireEnv('TRADING_API_BASE_URL', 'http://localhost:8000'),
  tradingApiToken: requireEnv('TRADING_API_TOKEN', 'dev-token'),
  anthropicApiKey: requireEnv('ANTHROPIC_API_KEY', ''),
  enableVoice: boolEnv('ENABLE_VOICE', true),
  enableTts: boolEnv('ENABLE_TTS', true),
  enableTradeCommands: boolEnv('ENABLE_TRADE_COMMANDS', false),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  port: parseInt(process.env.PORT ?? '3001', 10),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:3000').split(',').map(s => s.trim()),
  auditDbPath: process.env.AUDIT_DB_PATH ?? './data/audit.db',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  version: '1.0.0',
} as const;
