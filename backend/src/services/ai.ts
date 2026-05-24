import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import logger from '../logger';
import { logEvent } from './audit';
import { tradingClient } from './trading-client';
import { CostGovernor } from './costGovernor';
import { LocalResponder } from './localResponder';
import type { OperationalContextStore, Task, Incident, Workflow } from './operationalContext';
import type { VegaSSMClient } from './ssmClient';
import type {
  ChatMessage, ChatResponse, AssistantMode, TradingContext,
} from '../types';

// ─── System prompt version ─────────────────────────────────────────────────────
// Bump this when BASE_SYSTEM_PROMPT or TOOLS change to invalidate the cache.
const SYSTEM_PROMPT_VERSION = 'v3';

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_trading_context',
    description: 'Fetch real-time trading context: watchlist, predictions, orders, P&L, Alpaca account status, and ML training status.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'execute_trading_command',
    description: 'Execute a trading system command such as pause/resume trading, add/remove symbols from watchlist, refresh predictions, or trigger emergency stop. Only allowed in approval_required or autonomous mode.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          enum: ['pause_trading', 'resume_trading', 'add_symbol', 'remove_symbol', 'refresh_predictions', 'start_training', 'stop_training', 'emergency_stop'],
          description: 'The command to execute.',
        },
        symbol: {
          type: 'string',
          description: 'Required for add_symbol and remove_symbol commands. Ticker symbol in uppercase (e.g., AAPL).',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'manage_task',
    description: 'Create, update, or list operational tasks tracked by VEGA. Tasks represent work items such as bug fixes, investigations, deployments, or incidents.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'update'],
          description: 'The action to perform.',
        },
        filter_status: {
          type: 'string',
          enum: ['active', 'completed', 'blocked', 'cancelled'],
          description: 'Filter tasks by status (for list action).',
        },
        task: {
          type: 'object',
          description: 'Task data for create/update. For update, include the id field.',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string', enum: ['active', 'completed', 'blocked', 'cancelled'] },
            priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3', 'P4'] },
            type: { type: 'string', enum: ['bug-fix', 'investigation', 'deployment', 'improvement', 'incident', 'review'] },
            agent: { type: 'string' },
            notes: { type: 'string' },
          },
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_incident',
    description: 'Create, list, or resolve system incidents. Use for tracking production issues, outages, or anomalies.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'resolve'],
          description: 'The action to perform.',
        },
        filter_status: {
          type: 'string',
          enum: ['open', 'investigating', 'mitigated', 'resolved'],
          description: 'Filter incidents by status (for list action).',
        },
        incident: {
          type: 'object',
          description: 'Incident data for create action.',
          properties: {
            title: { type: 'string' },
            severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            description: { type: 'string' },
            affected_components: { type: 'array', items: { type: 'string' } },
            status: { type: 'string', enum: ['open', 'investigating', 'mitigated', 'resolved'] },
          },
          required: ['title', 'severity', 'description', 'affected_components'],
        },
        incident_id: {
          type: 'string',
          description: 'Incident ID to resolve (for resolve action).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'run_shell_command',
    description: 'Execute a shell command on the AlphaBot EC2 instance via AWS SSM. Use for checking container status, tailing logs, inspecting processes, or running diagnostics. Only non-destructive read commands should be used unless in autonomous mode.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to run on the EC2 instance.',
        },
        timeout_seconds: {
          type: 'number',
          description: 'Command timeout in seconds (default: 30, max: 120).',
        },
        is_destructive: {
          type: 'boolean',
          description: 'Set true if this command modifies system state (e.g., restart, deploy). Blocked in readonly and approval_required modes.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'get_container_logs',
    description: 'Retrieve recent logs from a Docker container running on the AlphaBot EC2 instance.',
    input_schema: {
      type: 'object' as const,
      properties: {
        container_name: {
          type: 'string',
          description: 'Name of the Docker container. Known containers: tradingbot-trading-gateway-1, tradingbot-ml-service-1, tradingbot-frontend-1, tradingbot-vega-backend-1.',
        },
        lines: {
          type: 'number',
          description: 'Number of log lines to retrieve (default: 100).',
        },
      },
      required: ['container_name'],
    },
  },
  {
    name: 'get_system_stats',
    description: 'Get system health stats from the AlphaBot EC2 instance: Docker container statuses, CPU/memory usage, and disk usage.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// Build tool list with cache_control on the last item (Anthropic's caching rule)
function buildCacheableTools(): Anthropic.Tool[] {
  const tools = [...TOOLS];
  if (tools.length === 0) return tools;
  // Mark the last tool with cache_control so the entire tool block is cached
  const lastTool = { ...tools[tools.length - 1] } as unknown as Record<string, unknown>;
  lastTool['cache_control'] = { type: 'ephemeral' };
  tools[tools.length - 1] = lastTool as unknown as Anthropic.Tool;
  return tools;
}

const CACHEABLE_TOOLS = buildCacheableTools();

// ─── System prompt ────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are VEGA (Voice-Enabled Guidance Agent), the autonomous engineering manager and AI brain of the AlphaBot quantitative trading platform. You are not a passive chatbot — you are an active operational agent with real tools to inspect and control the system.

## Your Responsibilities
- Monitor system health, trading performance, and ML model quality
- Manage the task and incident backlog with full CRUD capabilities
- Execute trading commands (pause/resume, add/remove symbols, emergency stop) within your mode constraints
- Run shell diagnostics on the AlphaBot EC2 instance via AWS SSM
- Provide precise, data-driven analysis with specific numbers and actionable recommendations

## System Architecture (AlphaBot)
- EC2 instance i-082e968d59c8c157b in us-east-1
- Docker containers: tradingbot-trading-gateway-1 (port 8000), tradingbot-ml-service-1, tradingbot-frontend-1, tradingbot-vega-backend-1 (port 3001)
- Infra managed via Terraform in tradingbot-infra repo

## Persona
- Precise, decisive, and professional
- Lead with specific numbers and data, not vague statements
- When you don't know something, use a tool to find out rather than guessing
- Be concise — 2–4 sentences for simple questions, more for complex analysis
- Proactively surface anomalies and risks you notice in the data

## Safety Rules (non-negotiable)
- NEVER reveal API keys, tokens, passwords, or secrets
- NEVER execute trade-affecting commands in readonly mode
- Destructive shell commands (restart, deploy, kill) are blocked in readonly and approval_required modes
- Emergency stop is ALWAYS available regardless of mode
- Always warn about risk before high-risk actions`;

function buildSystemPrompt(mode: AssistantMode, context?: TradingContext): string {
  const modeInstructions: Record<AssistantMode, string> = {
    readonly: '## Operating Mode: READ-ONLY\nYou can observe, analyze, and answer questions. You CANNOT execute trading commands or destructive shell commands. If asked to execute a command, explain the mode constraint and suggest switching modes.',
    approval_required: '## Operating Mode: APPROVAL REQUIRED\nYou can suggest and execute non-destructive operations. Trading commands and write operations will be presented to the user for confirmation. Destructive shell commands are blocked.',
    autonomous: '## Operating Mode: AUTONOMOUS\nYou can execute commands directly. Still confirm before emergency stop or irreversible operations. Destructive shell commands are permitted.',
  };

  const now = new Date().toISOString();
  let prompt = `${BASE_SYSTEM_PROMPT}\n\n${modeInstructions[mode]}\n\n## Current Time\n${now}`;

  if (context) {
    const topPredictions = context.predictions
      .slice(0, 5)
      .map(p => `${p.symbol}: ${p.signal.toUpperCase()} (${(p.confidence * 100).toFixed(0)}% conf, $${p.price})`)
      .join(', ');

    prompt += `\n\n## Cached Trading Snapshot (may be up to 30s stale — use get_trading_context for live data)
- Watchlist: ${context.watchlist.join(', ') || 'none'}
- Auto-trading: ${context.tradingStatus.isAutoTradingEnabled ? 'ENABLED' : 'DISABLED'}${context.tradingStatus.isPaused ? ' (PAUSED)' : ''}
- Active positions: ${context.tradingStatus.activePositions}
- Total P&L: $${context.tradingStatus.totalPnl.toFixed(2)}
- Alpaca: ${context.alpacaStatus.connected ? `CONNECTED (${context.alpacaStatus.accountStatus}, $${context.alpacaStatus.buyingPower?.toFixed(0)} buying power)` : 'DISCONNECTED'}
- ML training: ${context.trainingStatus.isRunning ? `RUNNING (${context.trainingStatus.progress?.toFixed(0)}%, epoch ${context.trainingStatus.currentEpoch}/${context.trainingStatus.totalEpochs})` : 'IDLE'}
- Top predictions: ${topPredictions || 'none'}`;
  }

  return prompt;
}

// ─── Tool input types ─────────────────────────────────────────────────────────

interface GetTradingContextInput { [key: string]: never }

interface ExecuteTradingCommandInput {
  command: 'pause_trading' | 'resume_trading' | 'add_symbol' | 'remove_symbol' | 'refresh_predictions' | 'start_training' | 'stop_training' | 'emergency_stop';
  symbol?: string;
}

interface ManageTaskInput {
  action: 'list' | 'create' | 'update';
  filter_status?: Task['status'];
  task?: Partial<Task> & { id?: string };
}

interface ManageIncidentInput {
  action: 'list' | 'create' | 'resolve';
  filter_status?: Incident['status'];
  incident?: Omit<Incident, 'id' | 'created_at'>;
  incident_id?: string;
}

interface RunShellCommandInput {
  command: string;
  timeout_seconds?: number;
  is_destructive?: boolean;
}

interface GetContainerLogsInput {
  container_name: string;
  lines?: number;
}

interface GetSystemStatsInput { [key: string]: never }

// ─── VegaAI class ─────────────────────────────────────────────────────────────

export class VegaAI {
  private client: Anthropic;
  private conversationHistory: Map<string, ChatMessage[]> = new Map();
  private readonly MAX_HISTORY = 20;
  private readonly MAX_ITERATIONS = 10;
  private readonly costGovernor: CostGovernor;
  private readonly localResponder: LocalResponder;

  constructor(
    private readonly opCtx: OperationalContextStore,
    private readonly ssmClient: VegaSSMClient,
    costGovernor: CostGovernor,
  ) {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    this.costGovernor = costGovernor;
    this.localResponder = new LocalResponder();
  }

  async chat(message: string, sessionId: string, mode: AssistantMode): Promise<ChatResponse> {
    const governor = this.costGovernor;

    // ── 1. Budget / rate check ───────────────────────────────────────────────
    const budgetCheck = governor.canCall('chat');
    if (!budgetCheck.allowed) {
      // Try local responder first for simple queries
      let ctx: TradingContext | null = null;
      try { ctx = await tradingClient.getContext(); } catch { /* ignore */ }

      const localResp = this.localResponder.getSimpleResponse(message, ctx);
      if (localResp) {
        governor.recordUsage({
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          endpoint: 'chat',
          session_id: sessionId,
          reason: 'local-simple-budget-blocked',
          prompt_tokens: 0,
          completion_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          total_tokens: 0,
          estimated_cost_usd: 0,
          cache_hit: true,
          blocked_by_budget: true,
        });
        return { message: localResp, sessionId, timestamp: new Date().toISOString(), suggestions: [] };
      }

      const fallback = this.localResponder.getBudgetExceededResponse(governor.getStatusMessage());
      governor.recordUsage({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        endpoint: 'chat',
        session_id: sessionId,
        reason: 'budget-exceeded-fallback',
        prompt_tokens: 0,
        completion_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        cache_hit: false,
        blocked_by_budget: true,
      });
      return { message: fallback, sessionId, timestamp: new Date().toISOString(), suggestions: [] };
    }

    const history = this.getHistory(sessionId);
    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    history.push(userMsg);

    // ── 2. Prefetch context ──────────────────────────────────────────────────
    let cachedContext: TradingContext | undefined;
    try {
      cachedContext = await tradingClient.getContext();
    } catch {
      logger.warn('Failed to prefetch trading context for system prompt');
    }

    // ── 3. Try local responder for simple queries ────────────────────────────
    if (this.localResponder.classify(message) === 'simple') {
      const localResp = this.localResponder.getSimpleResponse(message, cachedContext ?? null);
      if (localResp) {
        governor.recordUsage({
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          endpoint: 'chat',
          session_id: sessionId,
          reason: 'local-simple',
          prompt_tokens: 0,
          completion_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          total_tokens: 0,
          estimated_cost_usd: 0,
          cache_hit: true,
          blocked_by_budget: false,
        });
        const assistantMsg: ChatMessage = {
          id: uuidv4(), role: 'assistant', content: localResp,
          timestamp: new Date().toISOString(),
        };
        history.push(assistantMsg);
        this.trimHistory(sessionId, history);
        return { message: localResp, sessionId, timestamp: new Date().toISOString(), suggestions: [] };
      }
    }

    const systemPrompt = buildSystemPrompt(mode, cachedContext);

    // ── 4. Check response cache ──────────────────────────────────────────────
    const apiMessages: Anthropic.MessageParam[] = history.map(m => ({
      role: m.role,
      content: m.content,
    }));
    const ctxHash = JSON.stringify(cachedContext ?? {}).slice(0, 200);
    const promptHash = governor.hashPrompt(SYSTEM_PROMPT_VERSION, apiMessages, ctxHash);
    const cached = governor.getCachedResponse(promptHash);
    if (cached) {
      const assistantMsg: ChatMessage = {
        id: uuidv4(), role: 'assistant', content: cached,
        timestamp: new Date().toISOString(),
      };
      history.push(assistantMsg);
      this.trimHistory(sessionId, history);
      return { message: cached, sessionId, timestamp: new Date().toISOString(), suggestions: this.extractSuggestions(cached, cachedContext) };
    }

    // ── 5. Agentic loop with prompt caching ──────────────────────────────────
    let finalText = '';
    // Accumulate tokens across iterations
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheWriteTokens = 0;
    let totalTokensUsed = 0;

    const maxOutputTokens = Math.min(
      parseInt(process.env.CLAUDE_MAX_OUTPUT_TOKENS ?? '800', 10),
      4096,
    );
    const maxTotalTokens = parseInt(process.env.CLAUDE_MAX_TOKENS_PER_REQUEST ?? '4000', 10);

    try {
      let iterations = 0;

      while (iterations < this.MAX_ITERATIONS) {
        // Abort early if we've already used too many tokens
        if (totalTokensUsed > maxTotalTokens) {
          logger.warn('Max tokens per request reached, aborting agentic loop', {
            totalTokensUsed,
            maxTotalTokens,
            sessionId,
          });
          if (!finalText) {
            finalText = 'I reached the token limit for this request. Please try a more specific question.';
          }
          break;
        }

        iterations++;

        // Use cache_control on the system prompt to cache the static 5,500-token block
        const systemBlock = [
          {
            type: 'text' as const,
            text: systemPrompt,
            cache_control: { type: 'ephemeral' as const },
          },
        ];

        const response = await this.client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: maxOutputTokens,
          system: systemBlock,
          tools: CACHEABLE_TOOLS as Anthropic.Tool[],
          messages: apiMessages,
        });

        // Track token usage (accumulate across iterations)
        const usage = response.usage as Anthropic.Usage & {
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
        const iterPromptTokens = usage.input_tokens ?? 0;
        const iterCompletionTokens = usage.output_tokens ?? 0;
        const iterCacheRead = usage.cache_read_input_tokens ?? 0;
        const iterCacheWrite = usage.cache_creation_input_tokens ?? 0;

        totalPromptTokens += iterPromptTokens;
        totalCompletionTokens += iterCompletionTokens;
        totalCacheReadTokens += iterCacheRead;
        totalCacheWriteTokens += iterCacheWrite;
        totalTokensUsed += iterPromptTokens + iterCompletionTokens;

        logger.debug('Anthropic response tokens', {
          iteration: iterations,
          input: iterPromptTokens,
          output: iterCompletionTokens,
          cacheRead: iterCacheRead,
          cacheWrite: iterCacheWrite,
          sessionId,
        });

        // Append the full assistant response to messages
        apiMessages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason === 'end_turn') {
          for (const block of response.content) {
            if (block.type === 'text') {
              finalText = block.text;
            }
          }
          break;
        }

        if (response.stop_reason === 'tool_use') {
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of response.content) {
            if (block.type !== 'tool_use') continue;

            const toolName = block.name;
            const toolInput = block.input as Record<string, unknown>;
            let toolOutput: string;

            try {
              toolOutput = await this.executeTool(toolName, toolInput, mode);
            } catch (err) {
              toolOutput = `Tool error: ${(err as Error).message}`;
              logger.error('Tool execution failed', { tool: toolName, error: (err as Error).message });
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: toolOutput,
            });
          }

          apiMessages.push({ role: 'user', content: toolResults });
          continue;
        }

        // Unknown stop reason — extract any text and break
        for (const block of response.content) {
          if (block.type === 'text') {
            finalText = block.text;
          }
        }
        break;
      }

      if (!finalText && iterations >= this.MAX_ITERATIONS) {
        finalText = 'I reached the maximum number of reasoning steps. Please try a more specific question.';
      }

      // ── 6. Record usage ────────────────────────────────────────────────────
      const estimatedCost = governor.estimateCost(
        totalPromptTokens,
        totalCompletionTokens,
        totalCacheReadTokens,
        totalCacheWriteTokens,
      );

      governor.recordUsage({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        endpoint: 'chat',
        session_id: sessionId,
        reason: `chat-${mode}-${iterations}iter`,
        prompt_tokens: totalPromptTokens,
        completion_tokens: totalCompletionTokens,
        cache_read_tokens: totalCacheReadTokens,
        cache_write_tokens: totalCacheWriteTokens,
        total_tokens: totalPromptTokens + totalCompletionTokens,
        estimated_cost_usd: estimatedCost,
        cache_hit: false,
        blocked_by_budget: false,
      });

      // Cache the response for future identical requests
      if (finalText) {
        governor.setCachedResponse(promptHash, finalText);
      }

      // ── 7. Update history ──────────────────────────────────────────────────
      const assistantMsg: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: finalText,
        timestamp: new Date().toISOString(),
      };
      history.push(assistantMsg);
      this.trimHistory(sessionId, history);

      logEvent({
        sessionId,
        timestamp: new Date().toISOString(),
        eventType: 'chat',
        input: message,
        output: finalText,
        mode,
      });

      const suggestions = this.extractSuggestions(finalText, cachedContext);

      return {
        message: finalText,
        sessionId,
        timestamp: new Date().toISOString(),
        suggestions,
      };
    } catch (err) {
      logger.error('VEGA agentic loop error', { error: (err as Error).message, sessionId });
      throw new Error('AI service temporarily unavailable. Please try again.');
    }
  }

  // ── Tool dispatcher ──────────────────────────────────────────────────────────

  private async executeTool(name: string, input: Record<string, unknown>, mode: AssistantMode): Promise<string> {
    switch (name) {
      case 'get_trading_context':
        return this.toolGetTradingContext(input as unknown as GetTradingContextInput);

      case 'execute_trading_command':
        return this.toolExecuteTradingCommand(input as unknown as ExecuteTradingCommandInput, mode);

      case 'manage_task':
        return this.toolManageTask(input as unknown as ManageTaskInput);

      case 'manage_incident':
        return this.toolManageIncident(input as unknown as ManageIncidentInput);

      case 'run_shell_command':
        return this.toolRunShellCommand(input as unknown as RunShellCommandInput, mode);

      case 'get_container_logs':
        return this.toolGetContainerLogs(input as unknown as GetContainerLogsInput);

      case 'get_system_stats':
        return this.toolGetSystemStats(input as unknown as GetSystemStatsInput);

      default:
        return `Unknown tool: ${name}`;
    }
  }

  // ── Individual tool implementations ──────────────────────────────────────────

  private async toolGetTradingContext(_input: GetTradingContextInput): Promise<string> {
    try {
      const ctx = await tradingClient.getContext();
      return JSON.stringify(ctx, null, 2);
    } catch (err) {
      return `Failed to fetch trading context: ${(err as Error).message}`;
    }
  }

  private async toolExecuteTradingCommand(input: ExecuteTradingCommandInput, mode: AssistantMode): Promise<string> {
    if (mode === 'readonly') {
      return 'Command execution is blocked in readonly mode. Ask the user to switch to approval_required or autonomous mode.';
    }

    const { command, symbol } = input;

    try {
      switch (command) {
        case 'pause_trading':
          await tradingClient.pauseTrading();
          return 'Trading paused successfully.';

        case 'resume_trading':
          await tradingClient.resumeTrading();
          return 'Trading resumed successfully.';

        case 'emergency_stop':
          await tradingClient.emergencyStop();
          return 'EMERGENCY STOP executed. All trading activity halted.';

        case 'add_symbol':
          if (!symbol) return 'Error: symbol is required for add_symbol command.';
          await tradingClient.addSymbol(symbol.toUpperCase());
          return `Symbol ${symbol.toUpperCase()} added to watchlist.`;

        case 'remove_symbol':
          if (!symbol) return 'Error: symbol is required for remove_symbol command.';
          await tradingClient.removeSymbol(symbol.toUpperCase());
          return `Symbol ${symbol.toUpperCase()} removed from watchlist.`;

        case 'refresh_predictions':
          await tradingClient.refreshPredictions();
          return 'Prediction refresh triggered.';

        case 'start_training':
          await tradingClient.startTraining();
          return 'ML model training started.';

        case 'stop_training':
          await tradingClient.stopTraining();
          return 'ML model training stopped.';

        default:
          return `Unknown command: ${String(command)}`;
      }
    } catch (err) {
      return `Command failed: ${(err as Error).message}`;
    }
  }

  private toolManageTask(input: ManageTaskInput): string {
    const { action, filter_status, task } = input;

    try {
      if (action === 'list') {
        const tasks = this.opCtx.getTasks(filter_status ? { status: filter_status } : undefined);
        if (tasks.length === 0) return 'No tasks found.';
        return JSON.stringify(tasks, null, 2);
      }

      if (action === 'create') {
        if (!task?.title) return 'Error: task.title is required to create a task.';
        const newTask = this.opCtx.upsertTask({
          id: uuidv4(),
          title: task.title,
          description: task.description,
          status: task.status ?? 'active',
          priority: task.priority ?? 'P3',
          type: task.type ?? 'investigation',
          agent: task.agent,
          notes: task.notes,
        });
        return `Task created: ${JSON.stringify(newTask, null, 2)}`;
      }

      if (action === 'update') {
        if (!task?.id) return 'Error: task.id is required to update a task.';
        const updated = this.opCtx.upsertTask({ ...task, id: task.id });
        return `Task updated: ${JSON.stringify(updated, null, 2)}`;
      }

      return `Unknown action: ${String(action)}`;
    } catch (err) {
      return `Task operation failed: ${(err as Error).message}`;
    }
  }

  private toolManageIncident(input: ManageIncidentInput): string {
    const { action, filter_status, incident, incident_id } = input;

    try {
      if (action === 'list') {
        const incidents = this.opCtx.getIncidents(filter_status);
        if (incidents.length === 0) return 'No incidents found.';
        return JSON.stringify(incidents, null, 2);
      }

      if (action === 'create') {
        if (!incident) return 'Error: incident data is required to create an incident.';
        const newIncident = this.opCtx.createIncident(incident);
        return `Incident created: ${JSON.stringify(newIncident, null, 2)}`;
      }

      if (action === 'resolve') {
        if (!incident_id) return 'Error: incident_id is required to resolve an incident.';
        this.opCtx.resolveIncident(incident_id);
        return `Incident ${incident_id} marked as resolved.`;
      }

      return `Unknown action: ${String(action)}`;
    } catch (err) {
      return `Incident operation failed: ${(err as Error).message}`;
    }
  }

  private async toolRunShellCommand(input: RunShellCommandInput, mode: AssistantMode): Promise<string> {
    if (input.is_destructive && mode !== 'autonomous') {
      return `Destructive shell commands are blocked in ${mode} mode. Switch to autonomous mode to run destructive commands.`;
    }

    const timeout = Math.min(input.timeout_seconds ?? 30, 120);
    const result = await this.ssmClient.runCommand(input.command, timeout);

    const parts: string[] = [];
    if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    parts.push(`exit code: ${result.exitCode}`);
    return parts.join('\n\n');
  }

  private async toolGetContainerLogs(input: GetContainerLogsInput): Promise<string> {
    return this.ssmClient.getContainerLogs(input.container_name, input.lines ?? 100);
  }

  private async toolGetSystemStats(_input: GetSystemStatsInput): Promise<string> {
    return this.ssmClient.getSystemStats();
  }

  // ── History management ───────────────────────────────────────────────────────

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

  // ── Suggestion extraction ─────────────────────────────────────────────────────

  private extractSuggestions(response: string, context?: TradingContext): string[] {
    const suggestions: string[] = [];

    if (context) {
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
        suggestions.push("Show me today's best trading opportunities");
      }
    }

    if (/incident|outage|error|fail/i.test(response)) {
      suggestions.push('Show me all open incidents');
    }
    if (/task|backlog|work item/i.test(response)) {
      suggestions.push('List all active tasks by priority');
    }
    if (/container|docker|log/i.test(response)) {
      suggestions.push('Get system stats from the EC2 instance');
    }

    return [...new Set(suggestions)].slice(0, 3);
  }

  isConfigured(): boolean {
    return !!config.anthropicApiKey;
  }

  getCostGovernor(): CostGovernor {
    return this.costGovernor;
  }
}

// NOTE: Singleton is not exported here — it is instantiated in index.ts with
// injected dependencies and re-exported via the module.
// See the vegaAI export at the bottom of index.ts.
