import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getInstance as getVegaAI } from '../services/vegaInstance';
import { config } from '../config';
import logger from '../logger';
import type { ChatRequest } from '../types';

const router = Router();

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

  try {
    const vegaAI = getVegaAI();
    const response = await vegaAI.chat(body.message, sessionId, mode);
    res.json(response);
  } catch (err) {
    const msg = (err as Error).message ?? 'Unknown error';
    logger.error('Chat error', { error: msg, sessionId });

    // Surface user-friendly error without leaking internals
    const isUserFacing = msg.includes('temporarily unavailable') || msg.includes('mode');
    res.status(500).json({
      error: 'ai_error',
      message: isUserFacing ? msg : 'AI service temporarily unavailable. Please try again.',
    });
  }
});

export default router;
