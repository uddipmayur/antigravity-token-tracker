import * as http from 'http';
import * as https from 'https';
import { ProcessLocator, RpcConnectionInfo } from './processLocator';

export interface RawTrajectorySummary {
  summary?: string;
  stepCount?: number;
  lastModifiedTime?: string;
  trajectoryId?: string;
  status?: string;
  createdTime?: string;
}

export interface RawUsageRecord {
  model?: string;
  inputTokens?: string | number;
  outputTokens?: string | number;
  thinkingOutputTokens?: string | number;
  responseOutputTokens?: string | number;
  cacheReadTokens?: string | number;
  cacheWriteTokens?: string | number;
}

export interface RawGeneratorMetadataEntry {
  stepIndices?: number[];
  chatModel?: {
    model?: string;
    usage?: RawUsageRecord;
    responseModel?: string;
    modelDisplayName?: string;
    chatStartMetadata?: {
      createdAt?: string;
    };
  };
}

export class AntigravityRpcClient {
  private currentConnection: RpcConnectionInfo | null = null;

  constructor(
    private readonly locator: ProcessLocator,
    private readonly log?: (msg: string) => void
  ) {}

  public async getActiveConnection(): Promise<RpcConnectionInfo | null> {
    if (!this.currentConnection) {
      this.currentConnection = await this.locator.getConnection();
    }
    return this.currentConnection;
  }

  public resetConnection(): void {
    this.currentConnection = null;
  }

  public async request<T = any>(method: string, body: any = {}, timeoutMs = 5000): Promise<T> {
    const conn = await this.getActiveConnection();
    if (!conn) {
      throw new Error('Antigravity Language Server RPC is not available.');
    }

    const payload = JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: '127.0.0.1',
          port: conn.port,
          path: `/exa.language_server_pb.LanguageServerService/${method}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Connect-Protocol-Version': '1',
            'X-Codeium-Csrf-Token': conn.csrfToken,
            'Content-Length': Buffer.byteLength(payload),
          },
          rejectUnauthorized: false,
          timeout: timeoutMs,
        },
        (res: http.IncomingMessage) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: any) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode !== 200) {
              reject(new Error(`RPC ${method} returned status ${res.statusCode}: ${raw}`));
              return;
            }
            try {
              resolve(raw ? JSON.parse(raw) : ({} as T));
            } catch (err) {
              reject(err);
            }
          });
        }
      );

      req.on('error', (err: Error) => {
        this.resetConnection();
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        this.resetConnection();
        reject(new Error(`RPC ${method} timed out after ${timeoutMs}ms`));
      });

      req.write(payload);
      req.end();
    });
  }

  public async getAllCascadeTrajectories(): Promise<Record<string, RawTrajectorySummary>> {
    try {
      const resp = await this.request('GetAllCascadeTrajectories', {}, 6000);
      const raw = resp.trajectorySummaries;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return raw;
      }
      if (Array.isArray(raw)) {
        const result: Record<string, RawTrajectorySummary> = {};
        for (const item of raw) {
          if (item && item.cascadeId) {
            result[item.cascadeId] = item;
          }
        }
        return result;
      }
      return {};
    } catch (err) {
      this.log?.(`getAllCascadeTrajectories failed: ${err}`);
      return {};
    }
  }

  public async getCascadeTrajectoryGeneratorMetadata(cascadeId: string): Promise<RawGeneratorMetadataEntry[]> {
    try {
      const resp = await this.request('GetCascadeTrajectoryGeneratorMetadata', { cascadeId }, 5000);
      if (Array.isArray(resp.generatorMetadata)) {
        return resp.generatorMetadata;
      }
      return [];
    } catch (err) {
      this.log?.(`getCascadeTrajectoryGeneratorMetadata for ${cascadeId} failed: ${err}`);
      return [];
    }
  }
}
