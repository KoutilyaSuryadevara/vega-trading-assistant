/**
 * Singleton holder for VegaAI. Initialized once in index.ts via init().
 * Routes import vegaAI from here to avoid circular deps.
 */
import type { VegaAI } from './ai';

let _instance: VegaAI | null = null;

export function init(instance: VegaAI): void {
  _instance = instance;
}

export function getInstance(): VegaAI {
  if (!_instance) throw new Error('VegaAI not initialized — call init() before using getInstance()');
  return _instance;
}

// Convenience re-export as vegaAI for drop-in compatibility with existing imports
export { getInstance as vegaAI };
