import { Router, Request, Response } from 'express';
import { config } from '../config';
import { vegaAI } from '../services/ai';
import { tradingClient } from '../services/trading-client';
import { isDbHealthy } from '../services/audit';
import type { HealthResponse } from '../../../shared/types';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const tradingApiUp = await tradingClient.checkHealth();
  const dbHealthy = isDbHealthy();
  const aiConfigured = vegaAI.isConfigured();

  const services: HealthResponse['services'] = {
    anthropic: aiConfigured ? 'connected' : 'error',
    tradingApi: tradingApiUp ? 'connected' : 'error',
    auditDb: dbHealthy ? 'connected' : 'error',
  };

  const allHealthy = Object.values(services).every(s => s === 'connected');
  const anyError = Object.values(services).some(s => s === 'error');

  const response: HealthResponse = {
    status: allHealthy ? 'healthy' : anyError ? 'degraded' : 'unhealthy',
    version: config.version,
    assistantName: config.assistantName,
    mode: config.mode,
    uptime: process.uptime(),
    services,
    timestamp: new Date().toISOString(),
  };

  res.status(allHealthy ? 200 : 207).json(response);
});

export default router;
