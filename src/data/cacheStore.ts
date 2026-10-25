import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AggregatedStats, TurnRecord, SessionInfo } from '../types';

interface PersistedCache {
  version: number;
  lastUpdated: string;
  sessionHashes: Record<string, { lastModified: string; stepCount: number }>;
  cachedTurns: Record<string, TurnRecord[]>; // sessionId -> turns
  cachedSessions: Record<string, SessionInfo>; // sessionId -> info
}

const CACHE_VERSION = 1;

export class CacheStore {
  private fallbackFilePath: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.fallbackFilePath = path.join(os.homedir(), '.gemini', 'antigravity-tokens-cache.json');
  }

  public async load(): Promise<PersistedCache> {
    // 1. Try Extension globalState
    const state = this.context.globalState.get<PersistedCache>('antigravity_token_cache');
    if (state && state.version === CACHE_VERSION) {
      return state;
    }

    // 2. Try filesystem cache fallback
    try {
      if (fs.existsSync(this.fallbackFilePath)) {
        const raw = await fs.promises.readFile(this.fallbackFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === CACHE_VERSION) {
          return parsed;
        }
      }
    } catch {
      // Ignore
    }

    return {
      version: CACHE_VERSION,
      lastUpdated: new Date().toISOString(),
      sessionHashes: {},
      cachedTurns: {},
      cachedSessions: {},
    };
  }

  public async save(cache: PersistedCache): Promise<void> {
    cache.lastUpdated = new Date().toISOString();
    try {
      await this.context.globalState.update('antigravity_token_cache', cache);
    } catch {
      // Ignore
    }

    try {
      const dir = path.dirname(this.fallbackFilePath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      await fs.promises.writeFile(this.fallbackFilePath, JSON.stringify(cache, null, 2), 'utf8');
    } catch {
      // Ignore
    }
  }

  public async clear(): Promise<void> {
    try {
      await this.context.globalState.update('antigravity_token_cache', undefined);
    } catch {
      // Ignore
    }
    try {
      if (fs.existsSync(this.fallbackFilePath)) {
        await fs.promises.unlink(this.fallbackFilePath);
      }
    } catch {
      // Ignore
    }
  }
}
