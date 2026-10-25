import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { AggregatedStats, SessionInfo, TokenUsage, TurnRecord } from '../types';
import { AntigravityRpcClient } from '../rpc/rpcClient';
import { ProcessLocator } from '../rpc/processLocator';
import { CacheStore } from './cacheStore';
import { aggregateTurns, toLocalDateString } from './aggregator';
import { resolveModelName } from '../modelAliases';
import { getExtensionConfig } from '../config';

export class TokenCollector {
  private rpcClient: AntigravityRpcClient;
  private cacheStore: CacheStore;
  private cachedStats: AggregatedStats | null = null;
  private isScanning = false;
  private onDataChangedEmitter = new vscode.EventEmitter<AggregatedStats>();
  public readonly onDataChanged = this.onDataChangedEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly locator: ProcessLocator,
    private readonly log?: (msg: string) => void
  ) {
    this.rpcClient = new AntigravityRpcClient(locator, log);
    this.cacheStore = new CacheStore(context);
  }

  public getCachedStats(): AggregatedStats | null {
    return this.cachedStats;
  }

  public async initialize(): Promise<AggregatedStats> {
    // 1. Quick load from disk cache so UI can render immediately
    const diskCache = await this.cacheStore.load();
    const allCachedTurns = Object.values(diskCache.cachedTurns).flat();
    const allCachedSessions = Object.values(diskCache.cachedSessions);

    if (allCachedTurns.length > 0) {
      this.cachedStats = aggregateTurns(allCachedTurns, allCachedSessions, false);
      this.onDataChangedEmitter.fire(this.cachedStats);
    }

    // 2. Run background live refresh
    return this.refresh(false);
  }

  public async refresh(force = false): Promise<AggregatedStats> {
    if (this.isScanning) {
      return this.cachedStats || this.getEmptyStats();
    }

    this.isScanning = true;
    try {
      const stats = await this.performScan(force);
      this.cachedStats = stats;
      this.onDataChangedEmitter.fire(stats);
      return stats;
    } catch (err) {
      this.log?.(`TokenCollector refresh error: ${err}`);
      return this.cachedStats || this.getEmptyStats();
    } finally {
      this.isScanning = false;
    }
  }

  public async clearCacheAndRescan(): Promise<AggregatedStats> {
    await this.cacheStore.clear();
    this.cachedStats = null;
    return this.refresh(true);
  }

  private async performScan(force: boolean): Promise<AggregatedStats> {
    const config = getExtensionConfig();
    const diskCache = force ? {
      version: 1,
      lastUpdated: new Date().toISOString(),
      sessionHashes: {},
      cachedTurns: {},
      cachedSessions: {},
    } : await this.cacheStore.load();

    // 1. Check RPC connection
    const conn = await this.locator.getConnection(force);
    const rpcConnected = conn !== null;
    let rpcSummaries: Record<string, any> = {};

    if (rpcConnected) {
      rpcSummaries = await this.rpcClient.getAllCascadeTrajectories();
    }

    // 2. Discover all session IDs from RPC + Filesystem
    const sessionIds = new Set<string>(Object.keys(rpcSummaries));
    const sessionRoots = this.resolveSessionRoots(config.customSessionRoot);
    const dbPathMap = new Map<string, string>();

    for (const root of sessionRoots) {
      const convDir = path.join(root, 'conversations');
      if (fs.existsSync(convDir)) {
        try {
          const files = await fs.promises.readdir(convDir);
          for (const f of files) {
            if (f.endsWith('.db') || f.endsWith('.pb')) {
              const sId = path.basename(f, path.extname(f));
              sessionIds.add(sId);
              if (!dbPathMap.has(sId)) {
                dbPathMap.set(sId, path.join(convDir, f));
              }
            }
          }
        } catch {
          // Ignore
        }
      }

      const brainDir = path.join(root, 'brain');
      if (fs.existsSync(brainDir)) {
        try {
          const dirs = await fs.promises.readdir(brainDir, { withFileTypes: true });
          for (const d of dirs) {
            if (d.isDirectory()) {
              sessionIds.add(d.name);
            }
          }
        } catch {
          // Ignore
        }
      }
    }

    this.log?.(`TokenCollector: Discovered ${sessionIds.size} total sessions. (RPC Connected: ${rpcConnected})`);

    const updatedTurnsMap: Record<string, TurnRecord[]> = { ...diskCache.cachedTurns };
    const updatedSessionsMap: Record<string, SessionInfo> = { ...diskCache.cachedSessions };
    const updatedHashes = { ...diskCache.sessionHashes };

    // 3. For each session, determine whether to fetch or re-use cached data
    const sessionsToFetch: Array<{ sessionId: string; lastModStr: string; stepCount: number; sessionTitle: string }> = [];

    for (const sessionId of sessionIds) {
      const rpcSummary = rpcSummaries[sessionId];
      let lastModStr = rpcSummary?.lastModifiedTime || '';

      // Only stat filesystem if lastModifiedTime is missing from RPC
      if (!lastModStr) {
        const dbPath = dbPathMap.get(sessionId) || this.findSessionDb(sessionRoots, sessionId);
        if (dbPath && fs.existsSync(dbPath)) {
          try {
            const st = fs.statSync(dbPath);
            lastModStr = new Date(Math.round(st.mtimeMs)).toISOString();
          } catch {
            // Ignore
          }
        }
      }

      const stepCount = rpcSummary?.stepCount ?? 0;
      const cachedHash = updatedHashes[sessionId];

      const isUnchanged =
        !force &&
        cachedHash &&
        cachedHash.lastModified === lastModStr &&
        cachedHash.stepCount === stepCount &&
        updatedTurnsMap[sessionId] !== undefined;

      if (isUnchanged) {
        continue;
      }

      if (rpcConnected) {
        const sessionTitle =
          rpcSummary?.summary ||
          this.guessSessionTitle(sessionRoots, sessionId) ||
          'Session ' + sessionId.slice(0, 8);
        sessionsToFetch.push({ sessionId, lastModStr, stepCount, sessionTitle });
      }
    }

    // Fetch uncached session metadata concurrently in batches of 5
    const CONCURRENCY = 5;
    for (let i = 0; i < sessionsToFetch.length; i += CONCURRENCY) {
      const batch = sessionsToFetch.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async ({ sessionId, lastModStr, stepCount, sessionTitle }) => {
          try {
            const metadata = await this.rpcClient.getCascadeTrajectoryGeneratorMetadata(sessionId);
            if (metadata && metadata.length > 0) {
              const parsedTurns: TurnRecord[] = [];
              const sessionModels = new Set<string>();
              const sessionUsage: TokenUsage = {
                inputTokens: 0,
                outputTokens: 0,
                thinkingTokens: 0,
                cacheReadTokens: 0,
                totalTokens: 0,
              };

              for (const item of metadata) {
                const cm = item.chatModel;
                if (!cm) continue;

                const u = cm.usage || {};
                const inp = parseInt(String(u.inputTokens || 0), 10) || 0;
                const out = parseInt(String(u.outputTokens || 0), 10) || 0;
                const think = parseInt(String(u.thinkingOutputTokens || 0), 10) || 0;
                const cache = parseInt(String(u.cacheReadTokens || 0), 10) || 0;
                const total = inp + out;

                const rawCreated = cm.chatStartMetadata?.createdAt;
                const createdAt = rawCreated ? new Date(rawCreated) : new Date();
                const dateStr = toLocalDateString(createdAt);
                const hour = createdAt.getHours();

                const resolved = resolveModelName(cm.responseModel || cm.model, cm.modelDisplayName);
                sessionModels.add(resolved.displayName);

                const turnUsage: TokenUsage = {
                  inputTokens: inp,
                  outputTokens: out,
                  thinkingTokens: think,
                  cacheReadTokens: cache,
                  totalTokens: total,
                };

                sessionUsage.inputTokens += inp;
                sessionUsage.outputTokens += out;
                sessionUsage.thinkingTokens += think;
                sessionUsage.cacheReadTokens += cache;
                sessionUsage.totalTokens += total;

                parsedTurns.push({
                  sessionId,
                  sessionTitle,
                  timestamp: createdAt.toISOString(),
                  date: dateStr,
                  hour,
                  model: resolved.model,
                  modelDisplayName: resolved.displayName,
                  usage: turnUsage,
                });
              }

              updatedTurnsMap[sessionId] = parsedTurns;
              updatedSessionsMap[sessionId] = {
                id: sessionId,
                title: sessionTitle,
                createdAt: rpcSummaries[sessionId]?.createdTime || (parsedTurns[0]?.timestamp ?? new Date().toISOString()),
                lastModifiedAt: lastModStr || new Date().toISOString(),
                stepCount: Math.max(stepCount, parsedTurns.length),
                usage: sessionUsage,
                models: Array.from(sessionModels),
              };

              updatedHashes[sessionId] = {
                lastModified: lastModStr,
                stepCount: Math.max(stepCount, parsedTurns.length),
              };
            }
          } catch {
            // If metadata fetch failed, keep previously cached if available
          }
        })
      );
    }

    // 4. Save updated cache
    await this.cacheStore.save({
      version: 1,
      lastUpdated: new Date().toISOString(),
      sessionHashes: updatedHashes,
      cachedTurns: updatedTurnsMap,
      cachedSessions: updatedSessionsMap,
    });

    // 5. Aggregate all turns
    const allTurns = Object.values(updatedTurnsMap).flat();
    const allSessions = Object.values(updatedSessionsMap);

    return aggregateTurns(allTurns, allSessions, rpcConnected, conn?.port);
  }

  private resolveSessionRoots(customRoot?: string): string[] {
    const roots: string[] = [];
    if (customRoot && fs.existsSync(customRoot)) {
      roots.push(customRoot);
    }
    const home = os.homedir();
    const defaultIde = path.join(home, '.gemini', 'antigravity-ide');
    const defaultCli = path.join(home, '.gemini', 'antigravity');

    if (fs.existsSync(defaultIde)) roots.push(defaultIde);
    if (fs.existsSync(defaultCli) && !roots.includes(defaultCli)) roots.push(defaultCli);

    return roots;
  }

  private findSessionDb(roots: string[], sessionId: string): string | null {
    for (const root of roots) {
      const p = path.join(root, 'conversations', `${sessionId}.db`);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  private guessSessionTitle(roots: string[], sessionId: string): string | null {
    for (const root of roots) {
      // Check brain/<sessionId>/task.md or similar
      const taskFile = path.join(root, 'brain', sessionId, 'task.md');
      if (fs.existsSync(taskFile)) {
        try {
          const content = fs.readFileSync(taskFile, 'utf8');
          const m = content.match(/^#\s*(?:Task:?\s*)?(.+)$/im);
          if (m?.[1]) return m[1].trim();
        } catch {
          // Ignore
        }
      }
    }
    return null;
  }

  private getEmptyStats(): AggregatedStats {
    return {
      days: {},
      dateList: [],
      allTimeTotalTokens: 0,
      allTimeInputTokens: 0,
      allTimeOutputTokens: 0,
      allTimeThinkingTokens: 0,
      allTimeCacheTokens: 0,
      allTimeTurns: 0,
      totalActiveDays: 0,
      todayTokens: 0,
      thisWeekTokens: 0,
      thisMonthTokens: 0,
      currentStreak: 0,
      longestStreak: 0,
      peakDay: null,
      dailyAverageTokens: 0,
      models: [],
      recentSessions: [],
      lastRefreshedAt: new Date().toISOString(),
      rpcConnected: false,
    };
  }
}
