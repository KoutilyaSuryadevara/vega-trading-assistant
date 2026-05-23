import { config } from '../config';
import { TradingApiClient } from './trading';

export const tradingClient = new TradingApiClient(config.tradingApiBaseUrl, config.tradingApiToken);
