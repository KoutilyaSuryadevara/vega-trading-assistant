import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { vegaAI } from '../services/ai';
import { tradingClient } from '../services/trading-client';
import { logEvent } from '../services/audit';
import { config } from '../config';
import logger from '../logger';
import type { ChatRequest, TradingContext } from '../../../shared/types';

const router = Router();

let contextCache: TradingContext | null = null;
let contextCacheTime = 0;
const CACHE_TTL = 30_000;

async function getCachedContext(): Promise<TradingContext> {
  const now = Date.now();
  if (contextCache && now - contextCacheTime < CACHE_TTL) return contextCache;
  try {
    contextCache = await tradingClient.getContext();
    contextCacheTime = now;
  } catch {
    if (!contextCache) throw new Error('Trading context unavailable');
  }
  return contextCache!;
}

router.post('/', async (req: Request, res: Response) => {
  const body = req.body as Partial<ChatRequest>;

  if (!body.message || typeof body.message !== 'string') {
    return res.status(400).json({ error: 'validation_error', message: 'message is required' });
  }
  if (body.message.trim().length === 0) {
    return res.status(400).json({ error: 'validation_error', message: 'message cannot be empty' });
  }
  if (body.message.length > 2000) {
    return res.status(400).json({ error: 'validation_error', message: 'message exceeds 2000 character limit' });
  }

  const sessionId = body.sessionId ?? uuidv4();
  const mode = config.mode;
  const ipAddress = req.ip ?? 'unknown';

  try {
    const context = await getCachedContext();
    const response = await vegaAI.chat({ message: body.message, sessionId, mode }, context);

    // Strip pendingAction in readonly mode — it cannot be executed
    if (mode === 'readonly' && response.pendingAction) {
      response.pendingAction = undefined;
      response.requiresApproval = false;
      if (!response.message.includes('readonly')) {
        response.message += '\n\n*Note: Command execution is disabled in readonly mode. Switch to approval_required mode to execute commands.*';
      }
    }

    logEvent({
      sessionId,
      timestamp: new Date().toISOString(),
      eventType: 'chat',
      input: body.message,
      output: response.message,
      mode,
      ipAddress,
    });

    res.json(response);
  } catch (err) {
    logger.error('Chat error', { error: (err as Error).message, sessionId });
    res.status(500).json({ error: 'ai_error', message: (err as Error).message });
  }
});

export default router;
