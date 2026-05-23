import axios, { AxiosInstance } from 'axios';
import logger from '../logger';
import type {
  TradingContext, Prediction, Order, TradingStatus, AlpacaStatus, TrainingStatus
} from '../../../shared/types';

function mockContext(): TradingContext {
  const now = new Date().toISOString();
  return {
    watchlist: ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'SPY', 'QQQ'],
    predictions: [
      { symbol: 'AAPL', signal: 'buy', confidence: 0.82, price: 189.45, reasoning: 'Strong earnings momentum', timestamp: now },
      { symbol: 'NVDA', signal: 'buy', confidence: 0.75, price: 875.20, reasoning: 'AI demand surge', timestamp: now },
      { symbol: 'TSLA', signal: 'sell', confidence: 0.68, price: 245.10, reasoning: 'Margin compression risk', timestamp: now },
      { symbol: 'MSFT', signal: 'hold', confidence: 0.55, price: 415.30, reasoning: 'Near fair value', timestamp: now },
    ],
    recentOrders: [
      { id: 'ord-001', symbol: 'AAPL', side: 'buy', qty: 10, price: 188.50, status: 'filled', filledAt: now, createdAt: now },
    ],
    openOrders: [],
    tradingStatus: {
      isPaused: false,
      isAutoTradingEnabled: true,
      isOptionsEnabled: false,
      activePositions: 3,
      totalPnl: 1247.85,
      lastTradeAt: now,
    },
    alpacaStatus: {
      connected: true,
      accountStatus: 'ACTIVE',
      buyingPower: 25000,
      portfolioValue: 52400,
      dayTradeCount: 1,
    },
    trainingStatus: {
      isRunning: false,
      progress: 100,
      currentEpoch: 50,
      totalEpochs: 50,
      loss: 0.042,
      accuracy: 0.78,
    },
    lastUpdated: now,
  };
}

export class TradingApiClient {
  private client: AxiosInstance;
  private isDev: boolean;

  constructor(private baseUrl: string, private token: string) {
    this.isDev = process.env.NODE_ENV !== 'production';
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 8000,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.response.use(
      r => r,
      err => {
        // Strip auth token from error messages before logging
        const msg = (err.message ?? '').replace(this.token, '[REDACTED]');
        logger.warn('Trading API request failed', { message: msg, url: err.config?.url });
        return Promise.reject(err);
      }
    );
  }

  private async get<T>(path: string, fallback: () => T): Promise<T> {
    try {
      const res = await this.client.get<T>(path);
      return res.data;
    } catch {
      if (this.isDev) {
        logger.warn(`Trading API unavailable — returning mock data for ${path}`);
        return fallback();
      }
      throw new Error(`Trading API unavailable: ${path}`);
    }
  }

  private async post<T>(path: string, data?: unknown): Promise<T> {
    const res = await this.client.post<T>(path, data);
    return res.data;
  }

  async getContext(): Promise<TradingContext> {
    if (this.isDev && !this.baseUrl.includes('localhost')) return mockContext();
    try {
      const [watchlist, predictions, recentOrders, openOrders, tradingStatus, alpacaStatus, trainingStatus] =
        await Promise.allSettled([
          this.get<string[]>('/api/watchlist', () => []),
          this.get<Prediction[]>('/api/predictions', () => []),
          this.get<Order[]>('/api/orders?recent=true', () => []),
          this.get<Order[]>('/api/orders/open', () => []),
          this.get<TradingStatus>('/api/status', () => mockContext().tradingStatus),
          this.get<AlpacaStatus>('/api/alpaca/status', () => mockContext().alpacaStatus),
          this.get<TrainingStatus>('/api/training/status', () => mockContext().trainingStatus),
        ]);

      return {
        watchlist: watchlist.status === 'fulfilled' ? watchlist.value : [],
        predictions: predictions.status === 'fulfilled' ? predictions.value : [],
        recentOrders: recentOrders.status === 'fulfilled' ? recentOrders.value : [],
        openOrders: openOrders.status === 'fulfilled' ? openOrders.value : [],
        tradingStatus: tradingStatus.status === 'fulfilled' ? tradingStatus.value : mockContext().tradingStatus,
        alpacaStatus: alpacaStatus.status === 'fulfilled' ? alpacaStatus.value : mockContext().alpacaStatus,
        trainingStatus: trainingStatus.status === 'fulfilled' ? trainingStatus.value : mockContext().trainingStatus,
        lastUpdated: new Date().toISOString(),
      };
    } catch {
      return mockContext();
    }
  }

  async getWatchlist(): Promise<string[]> {
    return this.get('/api/watchlist', () => ['AAPL', 'MSFT', 'NVDA']);
  }

  async getPredictions(): Promise<Prediction[]> {
    return this.get('/api/predictions', () => []);
  }

  async getRecentOrders(): Promise<Order[]> {
    return this.get('/api/orders?recent=true', () => []);
  }

  async getOpenOrders(): Promise<Order[]> {
    return this.get('/api/orders/open', () => []);
  }

  async getTradingStatus(): Promise<TradingStatus> {
    return this.get('/api/status', () => mockContext().tradingStatus);
  }

  async getAlpacaStatus(): Promise<AlpacaStatus> {
    return this.get('/api/alpaca/status', () => mockContext().alpacaStatus);
  }

  async getTrainingStatus(): Promise<TrainingStatus> {
    return this.get('/api/training/status', () => mockContext().trainingStatus);
  }

  async pauseTrading(): Promise<void> {
    await this.post('/api/trading/pause');
  }

  async resumeTrading(): Promise<void> {
    await this.post('/api/trading/resume');
  }

  async addSymbol(symbol: string): Promise<void> {
    await this.post('/api/watchlist/add', { symbol });
  }

  async removeSymbol(symbol: string): Promise<void> {
    await this.post('/api/watchlist/remove', { symbol });
  }

  async refreshPredictions(): Promise<void> {
    await this.post('/api/predictions/refresh');
  }

  async startTraining(): Promise<void> {
    await this.post('/api/training/start');
  }

  async stopTraining(): Promise<void> {
    await this.post('/api/training/stop');
  }

  async emergencyStop(): Promise<void> {
    await this.post('/api/trading/emergency-stop');
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.client.get('/health', { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}
