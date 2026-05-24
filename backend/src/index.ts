import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import logger from './logger';
import { OperationalContextStore } from './services/operationalContext';
import { VegaSSMClient } from './services/ssmClient';
import { VegaAI } from './services/ai';
import { CostGovernor } from './services/costGovernor';
import { init as initVega } from './services/vegaInstance';
import healthRouter from './routes/health';
import contextRouter from './routes/context';
import chatRouter from './routes/chat';
import commandRouter from './routes/command';
import costRouter from './routes/cost';

// ─── Initialize VEGA AI with its dependencies ────────────────────────────────
const opCtx = new OperationalContextStore(
  process.env.OPERATIONAL_DB_PATH ?? './data/operational.db',
);

// CostGovernor shares the same SQLite DB instance as OperationalContextStore.
// Access the underlying db via the exposed getter.
const costGovernor = new CostGovernor(opCtx.getDb());

const ssmClient = new VegaSSMClient();
initVega(new VegaAI(opCtx, ssmClient, costGovernor));
logger.info('VEGA AI initialized', { mode: config.mode });

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10kb' }));
app.use(morgan('combined', {
  stream: { write: (msg: string) => logger.http(msg.trim()) },
  skip: (req) => req.url === '/api/ai/health',
}));

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'rate_limit', message: 'Too many chat requests. Please wait and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const commandLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'rate_limit', message: 'Too many command requests. Please wait and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/ai/health', healthRouter);
app.use('/api/ai/context', contextRouter);
app.use('/api/ai/chat', chatLimiter, chatRouter);
app.use('/api/ai/command', commandLimiter, commandRouter);
app.use('/api/ai/cost', costRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Endpoint not found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(500).json({
    error: 'internal_error',
    message: config.nodeEnv === 'production' ? 'An unexpected error occurred' : err.message,
  });
});

const server = app.listen(config.port, () => {
  logger.info(`VEGA backend started`, {
    port: config.port,
    mode: config.mode,
    env: config.nodeEnv,
    tradeCommandsEnabled: config.enableTradeCommands,
  });
});

function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully`);
  server.close(() => {
    logger.info('VEGA backend stopped');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
