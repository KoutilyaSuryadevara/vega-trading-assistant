// Local copy of shared types — keeps the backend self-contained for Docker builds.
// Frontend uses shared/types/index.ts directly via its own build.

export type AssistantMode = 'readonly' | 'approval_required' | 'autonomous';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ChatRequest {
  message: string;
  sessionId?: string;
  mode?: AssistantMode;
}

export interface ChatResponse {
  message: string;
  sessionId: string;
  timestamp: string;
  suggestions?: string[];
  requiresApproval?: boolean;
  pendingAction?: TradingCommand;
}

export type CommandType =
  | 'pause_trading'
  | 'resume_trading'
  | 'add_symbol'
  | 'remove_symbol'
  | 'refresh_predictions'
  | 'start_training'
  | 'stop_training'
  | 'show_alpaca_status'
  | 'show_training_progress'
  | 'emergency_stop'
  | 'get_watchlist'
  | 'get_predictions'
  | 'get_orders'
  | 'get_open_orders'
  | 'get_risks'
  | 'get_status';

export interface TradingCommand {
  type: CommandType;
  params?: Record<string, string | number | boolean>;
  requiresApproval: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export interface CommandRequest {
  command: CommandType;
  params?: Record<string, string | number | boolean>;
  sessionId: string;
  approved?: boolean;
}

export interface CommandResponse {
  success: boolean;
  result?: unknown;
  message: string;
  requiresApproval?: boolean;
  commandId?: string;
}

export interface TradingContext {
  watchlist: string[];
  predictions: Prediction[];
  recentOrders: Order[];
  openOrders: Order[];
  tradingStatus: TradingStatus;
  alpacaStatus: AlpacaStatus;
  trainingStatus: TrainingStatus;
  lastUpdated: string;
}

export interface Prediction {
  symbol: string;
  signal: 'buy' | 'sell' | 'hold';
  confidence: number;
  price: number;
  reasoning?: string;
  timestamp: string;
}

export interface Order {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price?: number;
  status: string;
  filledAt?: string;
  createdAt: string;
}

export interface TradingStatus {
  isPaused: boolean;
  isAutoTradingEnabled: boolean;
  isOptionsEnabled: boolean;
  activePositions: number;
  totalPnl: number;
  lastTradeAt?: string;
}

export interface AlpacaStatus {
  connected: boolean;
  accountStatus?: string;
  buyingPower?: number;
  portfolioValue?: number;
  dayTradeCount?: number;
}

export interface TrainingStatus {
  isRunning: boolean;
  progress?: number;
  currentEpoch?: number;
  totalEpochs?: number;
  loss?: number;
  accuracy?: number;
  startedAt?: string;
  estimatedCompletion?: string;
}

export interface AuditEntry {
  id: string;
  sessionId: string;
  timestamp: string;
  eventType: 'chat' | 'command' | 'approval' | 'rejection' | 'emergency_stop';
  userId?: string;
  input: string;
  output: string;
  commandType?: CommandType;
  approved?: boolean;
  mode: AssistantMode;
  ipAddress?: string;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  assistantName: string;
  mode: AssistantMode;
  uptime: number;
  services: {
    anthropic: 'connected' | 'error';
    tradingApi: 'connected' | 'error' | 'unknown';
    auditDb: 'connected' | 'error';
  };
  timestamp: string;
}
