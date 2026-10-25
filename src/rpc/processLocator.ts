import * as os from 'os';
import * as http from 'http';
import * as https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface RpcConnectionInfo {
  pid: number;
  port: number;
  csrfToken: string;
}

interface ProcessCandidate {
  pid: number;
  ppid: number;
  extensionPort: number;
  csrfToken: string;
}

export class ProcessLocator {
  private cachedConnection: RpcConnectionInfo | null = null;
  private lastCheckedTime = 0;

  constructor(private readonly log?: (msg: string) => void) {}

  public async getConnection(force = false): Promise<RpcConnectionInfo | null> {
    const now = Date.now();
    // Cache for 30s if healthy
    if (!force && this.cachedConnection && now - this.lastCheckedTime < 30000) {
      const isAlive = await this.testHeartbeat(this.cachedConnection.port, this.cachedConnection.csrfToken);
      if (isAlive) {
        return this.cachedConnection;
      }
    }

    const connections = await this.detectConnections();
    if (connections.length > 0) {
      this.cachedConnection = connections[0];
      this.lastCheckedTime = now;
      return this.cachedConnection;
    }

    this.cachedConnection = null;
    return null;
  }

  public async detectConnections(): Promise<RpcConnectionInfo[]> {
    const platform = os.platform();
    const candidates = await this.findCandidates(platform);
    if (candidates.length === 0) {
      this.log?.('ProcessLocator: No language_server candidate processes found.');
      return [];
    }

    const validConnections: RpcConnectionInfo[] = [];

    for (const cand of candidates) {
      // Fast path: test parsed extension_server_port from command line args first
      if (cand.extensionPort > 0) {
        const ok = await this.testHeartbeat(cand.extensionPort, cand.csrfToken);
        if (ok) {
          this.log?.(`ProcessLocator: Fast connected to PID ${cand.pid} on extensionPort ${cand.extensionPort}`);
          validConnections.push({
            pid: cand.pid,
            port: cand.extensionPort,
            csrfToken: cand.csrfToken,
          });
          break;
        }
      }

      const ports = await this.getListeningPorts(cand.pid);
      this.log?.(`ProcessLocator: PID ${cand.pid} has listening ports: [${ports.join(', ')}]`);

      for (const port of ports) {
        if (port === cand.extensionPort) continue; // Already tested above
        const ok = await this.testHeartbeat(port, cand.csrfToken);
        if (ok) {
          this.log?.(`ProcessLocator: Successfully connected to PID ${cand.pid} on port ${port}`);
          validConnections.push({
            pid: cand.pid,
            port,
            csrfToken: cand.csrfToken,
          });
          break; // Found the active port for this process
        }
      }
    }

    return validConnections;
  }

  private async findCandidates(platform: NodeJS.Platform): Promise<ProcessCandidate[]> {
    const candidates: ProcessCandidate[] = [];

    if (platform === 'linux' || platform === 'darwin') {
      const processNames = platform === 'darwin'
        ? ['language_server_macos_arm', 'language_server_macos']
        : ['language_server_linux_x64', 'language_server_linux_arm'];

      for (const name of processNames) {
        try {
          const { stdout } = await execAsync(
            `ps -ww -eo pid,ppid,args | grep "${name}" | grep -v grep`,
            { timeout: 3000 }
          );
          const parsed = this.parseProcessLines(stdout);
          candidates.push(...parsed);
        } catch {
          // Process not found with this name
        }
      }
    } else if (platform === 'win32') {
      try {
        const { stdout } = await execAsync(
          'wmic process where "name like \'%language_server%\'" get ProcessId,ParentProcessId,CommandLine /format:csv',
          { timeout: 4000 }
        );
        const parsed = this.parseWindowsWmic(stdout);
        candidates.push(...parsed);
      } catch {
        // Windows fallback
      }
    }

    // Deduplicate by PID
    const unique = new Map<number, ProcessCandidate>();
    for (const c of candidates) {
      unique.set(c.pid, c);
    }
    return Array.from(unique.values());
  }

  private parseProcessLines(stdout: string): ProcessCandidate[] {
    const results: ProcessCandidate[] = [];
    const lines = stdout.trim().split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 3) continue;

      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      const cmd = parts.slice(2).join(' ');

      if (isNaN(pid) || isNaN(ppid)) continue;
      if (!cmd.includes('antigravity')) continue;

      const portMatch = cmd.match(/--extension_server_port[=\s]+(\d+)/i);
      const tokenMatch = cmd.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);

      if (tokenMatch?.[1]) {
        results.push({
          pid,
          ppid,
          extensionPort: portMatch ? parseInt(portMatch[1], 10) : 0,
          csrfToken: tokenMatch[1],
        });
      }
    }

    return results;
  }

  private parseWindowsWmic(stdout: string): ProcessCandidate[] {
    const results: ProcessCandidate[] = [];
    const lines = stdout.trim().split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('Node,')) continue;
      const parts = trimmed.split(',');
      if (parts.length < 3) continue;

      const cmd = parts[1] || '';
      const pid = parseInt(parts[2] || '0', 10);
      if (!pid || !cmd.includes('antigravity')) continue;

      const portMatch = cmd.match(/--extension_server_port[=\s]+(\d+)/i);
      const tokenMatch = cmd.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);

      if (tokenMatch?.[1]) {
        results.push({
          pid,
          ppid: 0,
          extensionPort: portMatch ? parseInt(portMatch[1], 10) : 0,
          csrfToken: tokenMatch[1],
        });
      }
    }

    return results;
  }

  private async getListeningPorts(pid: number): Promise<number[]> {
    const platform = os.platform();
    const ports = new Set<number>();

    const commands = platform === 'darwin'
      ? [`lsof -Pan -p ${pid} -iTCP -sTCP:LISTEN 2>/dev/null`]
      : platform === 'linux'
      ? [
          `ss -tlnp 2>/dev/null | grep "pid=${pid},"`,
          `lsof -Pan -p ${pid} -iTCP -sTCP:LISTEN 2>/dev/null`,
          `netstat -tulpn 2>/dev/null | grep ${pid}`
        ]
      : [`netstat -ano | findstr ${pid}`];

    for (const cmd of commands) {
      try {
        const { stdout } = await execAsync(cmd, { timeout: 3000 });
        for (const port of this.extractPorts(stdout)) {
          ports.add(port);
        }
        if (ports.size > 0) break;
      } catch {
        // Next command
      }
    }

    return Array.from(ports).sort((a, b) => a - b);
  }

  private extractPorts(stdout: string): number[] {
    const ports: number[] = [];
    const patterns = [
      /127\.0\.0\.1:(\d+).*(?:LISTEN|\(LISTEN\))/i,
      /localhost:(\d+).*(?:LISTEN|\(LISTEN\))/i,
      /\*:(\d+).*(?:LISTEN|\(LISTEN\))/i,
      /LISTEN\s+\d+\s+\d+\s+(?:127\.0\.0\.1|\*|::1|::):(\d+)/i,
      /TCP\s+(?:127\.0\.0\.1|0\.0\.0\.0):(\d+)\s+.*LISTENING/i,
    ];

    for (const line of stdout.split('\n')) {
      for (const pat of patterns) {
        const m = line.match(pat);
        if (m?.[1]) {
          const p = parseInt(m[1], 10);
          if (!isNaN(p) && p > 0) {
            ports.push(p);
          }
        }
      }
    }

    return ports;
  }

  public testHeartbeat(port: number, csrfToken: string): Promise<boolean> {
    return new Promise((resolve) => {
      const body = JSON.stringify({ uuid: '00000000-0000-0000-0000-000000000000' });
      const req = https.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/exa.language_server_pb.LanguageServerService/Heartbeat',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Connect-Protocol-Version': '1',
            'X-Codeium-Csrf-Token': csrfToken,
            'Content-Length': Buffer.byteLength(body),
          },
          rejectUnauthorized: false,
          timeout: 2000,
        },
        (res: http.IncomingMessage) => {
          resolve(res.statusCode === 200);
        }
      );

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.write(body);
      req.end();
    });
  }
}
