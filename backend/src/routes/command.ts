import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { tradingClient } from '../services/trading-client';
import { logEvent } from '../services/audit';
import { config } from '../config';
import logger from '../logger';
import type { CommandRequest, CommandType } from '../../../shared/types';

const router = Router();

const VALID_COMMANDS: CommandType[] = [
  'pause_trading', 'resume_trading', 'add_symbol', 'remove_symbol',
  'refresh_predictions', 'start_training', 'stop_training',
  'show_alpaca_status', 'show_training_progress', 'emergency_stop',
  'get_watchlist', 'get_predictions', 'get_orders', 'get_open_orders',
  'get_risks', 'get_status',
];

const WRITE_COMMANDS: CommandType[] = [
  'pause_trading', 'resume_trading', 'add_symbol', 'remove_symbol',
  'refresh_predictions', 'start_training', 'stop_training', 'emergency_stop',
];

async function executeCommand(command: CommandType, params?: Record<string, string | number | boolean>): Promise<unknown> {
  switch (command) {
    case 'pause_trading':
      await tradingClient.pauseTrading();
      return { paused: true };
    case 'resume_trading':
      await tradingClient.resumeTrading();
      return { paused: false };
    case 'add_symbol': {
      const symbol = String(params?.symbol ?? '').toUpperCase();
      if (!symbol) throw new Error('symbol parameter is required for add_symbol');
      await tradingClient.addSymbol(symbol);
      return { symbol, added: true };
    }
    case 'remove_symbol': {
      const symbol = String(params?.symbol ?? '').toUpperCase();
      if (!symbol) throw new Error('symbol parameter is required for remove_symbol');
      await tradingClient.removeSymbol(symbol);
      return { symbol, removed: true };
    }
    case 'refresh_predictions':
      await tradingClient.refreshPredictions();
      return { refreshed: true };
    case 'start_training':
      await tradingClient.startTraining();
      return { trainingStarted: true };
    case 'stop_training':
      await tradingClient.stopTraining();
      return { trainingStopped: true };
    case 'emergency_stop':
      await tradingClient.emergencyStop();
      return { emergencyStopped: true, timestamp: new Date().toISOString() };
    case 'show_alpaca_status':
      return tradingClient.getAlpacaStatus();
    case 'show_training_progress':
      return tradingClient.getTrainingStatus();
    case 'get_watchlist':
      return { watchlist: await tradingClient.getWatchlist() };
    case 'get_predictions':
      return { predictions: await tradingClient.getPredictions() };
    case 'get_orders':
      return { orders: await tradingClient.getRecentOrders() };
    case 'get_open_orders':
      return { openOrders: await tradingClient.getOpenOrders() };
    case 'get_status':
      return tradingClient.getTradingStatus();
    case 'get_risks':
      return { message: 'Risk engine data not available in this context' };
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

router.post('/', async (req: Request, res: Response) => {
  const body = req.body as Partial<CommandRequest>;
  const sessionId = body.sessionId ?? uuidv4();
  const mode = config.mode;
  const ipAddress = req.ip ?? 'unknown';

  if (!body.command) {
    return res.status(400).json({ error: 'validation_error', message: 'command is required' });
  }
  if (!VALID_COMMANDS.includes(body.command as CommandType)) {
    return res.status(400).json({ error: 'invalid_command', message: `Unknown command: ${body.command}` });
  }

  const command = body.command as CommandType;
  const isEmergencyStop = command === 'emergency_stop';
  const isWriteCommand = WRITE_COMMANDS.includes(command);

  // Emergency stop always goes through
  if (!isEmergencyStop) {
    if (mode === 'readonly') {
      return res.status(403).json({
        error: 'mode_restriction',
        message: 'Commands are disabled in readonly mode. Switch to approval_required or autonomous mode.',
        requiresApproval: false,
      });
    }

    if (isWriteCommand && !body.approved) {
      return res.status(400).json({
        error: 'approval_required',
        message: 'This command modifies trading state and requires explicit approval (approved: true)',
        requiresApproval: true,
        command,
      });
    }

    if (isWriteCommand && !config.enableTradeCommands) {
      return res.status(403).json({
        error: 'trade_commands_disabled',
        message: 'Trade-affecting commands are disabled. Set ENABLE_TRADE_COMMANDS=true to enable.',
        requiresApproval: false,
      });
    }
  }

  try {
    logger.info('Executing command', { command, sessionId, mode, approved: body.approved });
    const result = await executeCommand(command, body.params);

    const commandId = logEvent({
      sessionId,
      timestamp: new Date().toISOString(),
      eventType: isEmergencyStop ? 'emergency_stop' : 'command',
      input: JSON.stringify({ command, params: body.params }),
      output: JSON.stringify(result),
      commandType: command,
      approved: body.approved ?? true,
      mode,
      ipAddress,
    });

    res.json({
      success: true,
      result,
      message: `Command ${command} executed successfully`,
      commandId,
    });
  } catch (err) {
    logger.error('Command execution failed', { command, error: (err as Error).message });

    logEvent({
      sessionId,
      timestamp: new Date().toISOString(),
      eventType: 'command',
      input: JSON.stringify({ command, params: body.params }),
      output: `ERROR: ${(err as Error).message}`,
      commandType: command,
      approved: body.approved,
      mode,
      ipAddress,
    });

    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

export default router;
