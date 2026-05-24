import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import logger from '../logger';
import type {
  ChatMessage, ChatRequest, ChatResponse, TradingCommand,
  TradingContext, AssistantMode, CommandType
} from '../types';

const COMMAND_PATTERNS: Array<{ pattern: RegExp; type: CommandType; riskLevel: TradingCommand['riskLevel']; description: string }> = [
  { pattern: /emergency.?stop|halt.?all.?trad/i, type: 'emergency_stop', riskLevel: 'critical', description: 'Emergency stop all trading activity immediately' },
  { pattern: /pause.?trad|stop.?trad|suspend.?trad/i, type: 'pause_trading', riskLevel: 'high', description: 'Pause all automated trading' },
  { pattern: /resume.?trad|restart.?trad|unpause.?trad/i, type: 'resume_trading', riskLevel: 'high', description: 'Resume automated trading' },
  { pattern: /start.?train/i, type: 'start_training', riskLevel: 'medium', description: 'Start model training run' },
  { pattern: /stop.?train/i, type: 'stop_training', riskLevel: 'medium', description: 'Stop active model training' },
  { pattern: /refresh.?pred|update.?pred/i, type: 'refresh_predictions', riskLevel: 'low', description: 'Refresh trading predictions' },
  { pattern: /add.?(?:symbol|stock|ticker)[:\s]+([A-Z]{1,5})|add ([A-Z]{1,5}).?(?:to|watch)/i, type: 'add_symbol', riskLevel: 'low', description: 'Add symbol to watchlist' },
  { pattern: /remove.?(?:symbol|stock|ticker)[:\s]+([A-Z]{1,5})|remove ([A-Z]{1,5}).?(?:from|watch)/i, type: 'remove_symbol', riskLevel: 'low', description: 'Remove symbol from watchlist' },
];

const WRITE_COMMANDS: CommandType[] = ['pause_trading', 'resume_trading', 'emergency_stop', 'start_training', 'stop_training', 'add_symbol', 'remove_symbol', 'refresh_predictions'];

function buildSystemPrompt(context: TradingContext, mode: AssistantMode): string {
  const topPredictions = context.predictions
    .slice(0, 5)
    .map(p => `${p.symbol}: ${p.signal.toUpperCase()} (${(p.confidence * 100).toFixed(0)}% confidence, $${p.price})`)
    .join('\n  ');

  const modeInstructions: Record<AssistantMode, string> = {
    readonly: 'You are in READ-ONLY mode. You can answer questions and provide analysis, but cannot execute any trading commands. If the user asks you to execute a command, explain that they need to switch to approval_required or autonomous mode.',
    approval_required: 'You are in APPROVAL REQUIRED mode. You can suggest commands and actions, but each action requires explicit user confirmation before execution. Always present a pendingAction when a command is requested.',
    autonomous: 'You are in AUTONOMOUS mode. Commands can be executed directly, but still require ENABLE_TRADE_COMMANDS=true in the environment. Always confirm before executing any write operation.',
  };

  return `You are VEGA (Voice-Enabled Guidance Agent), an AI assistant for a quantitative trading platform.
You have real-time access to trading context and market data.

## Current Trading Context
- Watchlist: ${context.watchlist.join(', ') || 'none'}
- Auto-trading: ${context.tradingStatus.isAutoTradingEnabled ? 'ENABLED' : 'DISABLED'}${context.tradingStatus.isPaused ? ' (PAUSED)' : ''}
- Active positions: ${context.tradingStatus.activePositions}
- Total P&L: $${context.tradingStatus.totalPnl.toFixed(2)}
- Options trading: ${context.tradingStatus.isOptionsEnabled ? 'ENABLED' : 'DISABLED'}
- Alpaca account: ${context.alpacaStatus.connected ? `CONNECTED (${context.alpacaStatus.accountStatus}, $${context.alpacaStatus.buyingPower?.toFixed(0)} buying power)` : 'DISCONNECTED'}
- ML training: ${context.trainingStatus.isRunning ? `RUNNING (${context.trainingStatus.progress?.toFixed(0)}% complete, epoch ${context.trainingStatus.currentEpoch}/${context.trainingStatus.totalEpochs})` : 'IDLE'}
- Top predictions:
  ${topPredictions || 'No predictions available'}

## Your Persona
- Precise, data-driven, professional, and concise
- Provide specific numbers and reasoning, not vague statements
- When uncertain, say so clearly rather than guessing
- Focus on actionable insights

## Operating Mode
${modeInstructions[mode]}

## Safety Rules (non-negotiable)
- NEVER reveal API keys, tokens, passwords, or secrets
- NEVER discuss internal system architecture details
- NEVER execute trade-affecting commands without proper mode and approval
- Emergency stop is ALWAYS available regardless of mode
- Always warn about risk before suggesting high-risk actions

## Response Format
- Be concise (2-4 sentences for simple questions, more for complex analysis)
- Use specific data from the trading context when relevant
- End responses with 2-3 brief follow-up suggestions when appropriate`;
}

export class VegaAI {
  private client: Anthropic;
  private conversationHistory: Map<string, ChatMessage[]> = new Map();
  private readonly MAX_HISTORY = 20;

  constructor() {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  async chat(request: ChatRequest, context: TradingContext): Promise<ChatResponse> {
    const sessionId = request.sessionId ?? uuidv4();
    const mode = request.mode ?? config.mode;

    const history = this.getHistory(sessionId);
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: request.message,
      timestamp: new Date().toISOString(),
    };
    history.push(userMessage);

    const detectedCommand = this.detectCommand(request.message);

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: buildSystemPrompt(context, mode),
        messages: history.map(m => ({ role: m.role, content: m.content })),
      });

      const content = response.content[0].type === 'text' ? response.content[0].text : '';
      const assistantMessage: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
      };
      history.push(assistantMessage);
      this.trimHistory(sessionId, history);

      const pendingAction = mode !== 'readonly' ? detectedCommand : null;
      const suggestions = this.extractSuggestions(content, context);

      return {
        message: content,
        sessionId,
        timestamp: new Date().toISOString(),
        suggestions,
        requiresApproval: !!pendingAction,
        pendingAction: pendingAction ?? undefined,
      };
    } catch (err) {
      logger.error('Anthropic API error', { error: (err as Error).message });
      throw new Error('AI service temporarily unavailable. Please try again.');
    }
  }

  private detectCommand(message: string): TradingCommand | null {
    for (const { pattern, type, riskLevel, description } of COMMAND_PATTERNS) {
      const match = message.match(pattern);
      if (match) {
        const params: Record<string, string> = {};
        if ((type === 'add_symbol' || type === 'remove_symbol') && match[1]) {
          params.symbol = match[1].toUpperCase();
        }
        return {
          type,
          params: Object.keys(params).length ? params : undefined,
          requiresApproval: WRITE_COMMANDS.includes(type),
          riskLevel,
          description,
        };
      }
    }
    return null;
  }

  private extractSuggestions(response: string, context: TradingContext): string[] {
    const suggestions: string[] = [];
    if (context.predictions.length > 0) {
      const top = context.predictions[0];
      suggestions.push(`Why did VEGA signal ${top.signal.toUpperCase()} for ${top.symbol}?`);
    }
    if (context.tradingStatus.isPaused) {
      suggestions.push('What do I need to do before resuming trading?');
    } else if (context.tradingStatus.isAutoTradingEnabled) {
      suggestions.push('What are the active risk controls right now?');
    }
    if (context.trainingStatus.isRunning) {
      suggestions.push('How long until model training completes?');
    } else {
      suggestions.push('Show me today\'s best trading opportunities');
    }
    return suggestions.slice(0, 3);
  }

  private getHistory(sessionId: string): ChatMessage[] {
    if (!this.conversationHistory.has(sessionId)) {
      this.conversationHistory.set(sessionId, []);
    }
    return this.conversationHistory.get(sessionId)!;
  }

  private trimHistory(sessionId: string, history: ChatMessage[]): void {
    if (history.length > this.MAX_HISTORY) {
      this.conversationHistory.set(sessionId, history.slice(-this.MAX_HISTORY));
    }
  }

  isConfigured(): boolean {
    return !!config.anthropicApiKey;
  }
}

export const vegaAI = new VegaAI();
