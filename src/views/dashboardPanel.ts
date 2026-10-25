import * as vscode from 'vscode';
import { TokenCollector } from '../data/tokenCollector';
import { getWebviewHtml } from '../webview/htmlTemplate';
import { getExtensionConfig } from '../config';
import { AggregatedStats } from '../types';

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    collector: TokenCollector
  ): DashboardPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(column);
      DashboardPanel.currentPanel.update();
      return DashboardPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'antigravityTokenDashboard',
      'Antigravity Token Tracker',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist'),
          vscode.Uri.joinPath(extensionUri, 'resources'),
        ],
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri, collector);
    return DashboardPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly collector: TokenCollector
  ) {
    this.panel = panel;
    this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'icon.svg');

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'ready':
            this.sendStats();
            break;
          case 'refresh':
            await this.collector.refresh(true);
            break;
          case 'exportJson':
            await this.exportJson();
            break;
          case 'exportCsv':
            await this.exportCsv();
            break;
        }
      },
      null,
      this.disposables
    );

    // Listen to data updates from collector
    this.collector.onDataChanged(
      (stats) => {
        this.sendStats(stats);
      },
      null,
      this.disposables
    );

    this.update();
  }

  public update(): void {
    const config = getExtensionConfig();
    this.panel.webview.html = getWebviewHtml(
      this.panel.webview,
      this.extensionUri,
      config.colorTheme,
      false
    );
    this.sendStats();
  }

  private sendStats(stats?: AggregatedStats): void {
    const data = stats || this.collector.getCachedStats();
    if (data) {
      this.panel.webview.postMessage({
        type: 'updateStats',
        stats: data,
      });
    }
  }

  private async exportJson(): Promise<void> {
    const stats = this.collector.getCachedStats();
    if (!stats) {
      vscode.window.showWarningMessage('No token data available to export.');
      return;
    }

    const uri = await vscode.window.showSaveDialog({
      filters: { 'JSON Files': ['json'] },
      defaultUri: vscode.Uri.file(`antigravity-token-history-${new Date().toISOString().slice(0, 10)}.json`),
    });

    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(stats, null, 2), 'utf8'));
      vscode.window.showInformationMessage(`Exported token history to ${uri.fsPath}`);
    }
  }

  private async exportCsv(): Promise<void> {
    const stats = this.collector.getCachedStats();
    if (!stats) {
      vscode.window.showWarningMessage('No token data available to export.');
      return;
    }

    const rows: string[] = [
      'Date,DayOfWeek,TotalTokens,InputTokens,OutputTokens,ThinkingTokens,CacheReadTokens,TurnCount,SessionCount,PrimaryModel',
    ];

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const dStr of stats.dateList) {
      const day = stats.days[dStr];
      if (!day) continue;
      const primaryModel = Object.values(day.models).sort((a, b) => b.totalTokens - a.totalTokens)[0]?.displayName || 'N/A';
      rows.push(
        `"${day.date}","${dayNames[day.dayOfWeek]}",${day.totalTokens},${day.inputTokens},${day.outputTokens},${day.thinkingTokens},${day.cacheReadTokens},${day.turnCount},${day.sessionCount},"${primaryModel}"`
      );
    }

    const uri = await vscode.window.showSaveDialog({
      filters: { 'CSV Files': ['csv'] },
      defaultUri: vscode.Uri.file(`antigravity-token-daily-${new Date().toISOString().slice(0, 10)}.csv`),
    });

    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(rows.join('\n'), 'utf8'));
      vscode.window.showInformationMessage(`Exported token daily CSV to ${uri.fsPath}`);
    }
  }

  public dispose(): void {
    DashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) x.dispose();
    }
  }
}
