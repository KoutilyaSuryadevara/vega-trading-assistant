import { Router, Request, Response } from 'express';
import { getInstance as getVegaAI } from '../services/vegaInstance';

const router = Router();

// GET /api/ai/cost — AI usage and budget dashboard
router.get('/', (_req: Request, res: Response) => {
  try {
    const vegaAI = getVegaAI();
    const governor = vegaAI.getCostGovernor();
    const cfg = governor.config;

    const daily = governor.getDailyStats();
    const monthly = governor.getMonthlyStats();

    res.json({
      daily: {
        spend: parseFloat(daily.spend.toFixed(6)),
        budget: cfg.dailyBudget,
        calls: daily.calls,
        cachedCalls: daily.cachedCalls,
        blockedCalls: daily.blockedCalls,
        avgTokens: daily.avgTokens,
      },
      monthly: {
        spend: parseFloat(monthly.spend.toFixed(6)),
        budget: cfg.monthlyBudget,
        calls: monthly.calls,
      },
      cacheHitRate: governor.getCacheHitRate(),
      topEndpoints: governor.getTopEndpoints(5),
      status: governor.getStatusMessage(),
      enabled: cfg.enabled,
    });
  } catch (err) {
    res.status(500).json({
      error: 'cost_error',
      message: (err as Error).message,
    });
  }
});

export default router;
