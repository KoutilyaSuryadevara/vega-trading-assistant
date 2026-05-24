import { Router, Request, Response } from 'express';
import { tradingClient } from '../services/trading-client';
import logger from '../logger';
import type { TradingContext } from '../types';

const router = Router();

let cachedContext: TradingContext | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 30_000;

router.get('/', async (_req: Request, res: Response) => {
  const now = Date.now();
  if (cachedContext && now - cacheTime < CACHE_TTL_MS) {
    return res.json(cachedContext);
  }

  try {
    const context = await tradingClient.getContext();
    cachedContext = context;
    cacheTime = now;
    res.json(context);
  } catch (err) {
    logger.error('Failed to fetch trading context', { error: (err as Error).message });
    if (cachedContext) {
      return res.json({ ...cachedContext, lastUpdated: cachedContext.lastUpdated + ' (cached)' });
    }
    res.status(503).json({ error: 'service_unavailable', message: 'Trading API is not reachable' });
  }
});

export { cachedContext, cacheTime, CACHE_TTL_MS };
export default router;
