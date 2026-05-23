import axios, { AxiosError } from 'axios';
import type {
  ChatRequest, ChatResponse, TradingContext, CommandRequest,
  CommandResponse, HealthResponse
} from '../types';

const client = axios.create({
  baseURL: '/api/ai',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.response.use(
  r => r,
  (err: AxiosError<{ message?: string; error?: string }>) => {
    const msg = err.response?.data?.message ?? err.response?.data?.error ?? err.message ?? 'Network error';
    const status = err.response?.status;
    if (status === 429) throw new Error('Rate limit reached. Please wait a moment before sending another message.');
    if (status === 403) throw new Error('Action not permitted in current mode.');
    if (status === 503) throw new Error('Trading bot API is currently unreachable.');
    throw new Error(msg);
  }
);

export const api = {
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await client.post<ChatResponse>('/chat', req);
    return res.data;
  },

  async getContext(): Promise<TradingContext> {
    const res = await client.get<TradingContext>('/context');
    return res.data;
  },

  async executeCommand(req: CommandRequest): Promise<CommandResponse> {
    const res = await client.post<CommandResponse>('/command', req);
    return res.data;
  },

  async getHealth(): Promise<HealthResponse> {
    const res = await client.get<HealthResponse>('/health');
    return res.data;
  },
};
