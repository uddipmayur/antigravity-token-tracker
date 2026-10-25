import * as vscode from 'vscode';
import { ProcessLocator } from './rpc/processLocator';
import { TokenCollector } from './data/tokenCollector';
import { TokenStatusBar } from './statusBar/tokenStatusBar';
import { DashboardPanel } from './views/dashboardPanel';
import { SidebarViewProvider } from './views/sidebarViewProvider';
import { getExtensionConfig } from './config';

let pollTimer: NodeJS.Timeout | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Antigravity Token Activity');
  const log = (msg: string) => output.appendLine(`[${new Date().toISOString()}] ${msg}`);
  log('Antigravity Token Activity & Calendar extension activating...');

  const locator = new ProcessLocator(log);
  const collector = new TokenCollector(context, locator, log);
  const statusBar = new TokenStatusBar();

  context.subscriptions.push(output, statusBar);

  // Status Bar update on data changed
  collector.onDataChanged((stats) => {
    statusBar.update(stats);
  });

  // Register Sidebar Webview View
  const sidebarProvider = new SidebarViewProvider(context.extensionUri, collector);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarViewProvider.viewType,
      sidebarProvider
    )
  );

  // Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity-token-calendar.openDashboard', () => {
      DashboardPanel.createOrShow(context.extensionUri, collector);
    }),

    vscode.commands.registerCommand('antigravity-token-calendar.refresh', async () => {
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Refreshing Antigravity token usage...',
          cancellable: false,
        },
        async () => {
          await collector.refresh(true);
        }
      );
    }),

    vscode.commands.registerCommand('antigravity-token-calendar.clearCache', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Are you sure you want to clear the token cache and rescan all sessions?',
        'Yes, Clear and Rescan',
        'Cancel'
      );
      if (confirm === 'Yes, Clear and Rescan') {
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Rescanning all Antigravity sessions...',
            cancellable: false,
          },
          async () => {
            await collector.clearCacheAndRescan();
            vscode.window.showInformationMessage('Antigravity token cache cleared and refreshed.');
          }
        );
      }
    }),

    vscode.commands.registerCommand('antigravity-token-calendar.exportJson', async () => {
      const panel = DashboardPanel.createOrShow(context.extensionUri, collector);
      // Trigger export via panel
    }),

    vscode.commands.registerCommand('antigravity-token-calendar.exportCsv', async () => {
      const panel = DashboardPanel.createOrShow(context.extensionUri, collector);
      // Trigger export via panel
    })
  );

  // Initial load
  collector.initialize().then((stats) => {
    statusBar.update(stats);
    log(`Initial token count: ${stats.allTimeTotalTokens.toLocaleString()} tokens across ${stats.totalActiveDays} active days.`);
  }).catch((err) => {
    log(`Failed to initialize TokenCollector: ${err}`);
  });

  // Setup periodic background polling
  function startPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    const cfg = getExtensionConfig();
    const interval = Math.max(10000, cfg.pollIntervalMs);
    pollTimer = setInterval(async () => {
      try {
        await collector.refresh(false);
      } catch (e) {
        log(`Background poll error: ${e}`);
      }
    }, interval);
  }

  startPolling();

  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('antigravityTokenCalendar')) {
        log('Configuration updated, applying changes...');
        startPolling();
        const cached = collector.getCachedStats();
        if (cached) {
          statusBar.update(cached);
        }
        if (DashboardPanel.currentPanel) {
          DashboardPanel.currentPanel.update();
        }
      }
    })
  );

  log('Antigravity Token Activity extension activated successfully.');
}

export function deactivate(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
