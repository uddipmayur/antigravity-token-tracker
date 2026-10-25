import * as vscode from 'vscode';
import { TokenCollector } from '../data/tokenCollector';
import { getWebviewHtml } from '../webview/htmlTemplate';
import { getExtensionConfig } from '../config';
import { AggregatedStats } from '../types';

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'antigravity-token-calendar.sidebar';
  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly collector: TokenCollector
  ) {
    this.collector.onDataChanged((stats) => {
      this.sendStats(stats);
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'resources'),
      ],
    };

    const config = getExtensionConfig();
    webviewView.webview.html = getWebviewHtml(
      webviewView.webview,
      this.extensionUri,
      config.colorTheme,
      true
    );

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'ready':
          this.sendStats();
          break;
        case 'refresh':
          await this.collector.refresh(true);
          break;
        case 'openDashboard':
          await vscode.commands.executeCommand('antigravity-token-calendar.openDashboard');
          break;
      }
    });

    this.sendStats();
  }

  public sendStats(stats?: AggregatedStats): void {
    if (!this.view) return;
    const data = stats || this.collector.getCachedStats();
    const config = getExtensionConfig();
    if (data) {
      this.view.webview.postMessage({
        type: 'updateStats',
        stats: data,
        theme: config.colorTheme,
      });
    }
  }
}
