import * as vscode from 'vscode';
import { AggregatedStats } from '../types';
import { getExtensionConfig } from '../config';

export class TokenStatusBar {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'antigravity-token-calendar.openDashboard';
    this.statusBarItem.text = '$(flame) -- tokens';
    this.statusBarItem.tooltip = 'Antigravity Token Tracker: Initializing...';
  }

  public update(stats: AggregatedStats): void {
    const config = getExtensionConfig();

    if (!config.showStatusBarItem) {
      this.statusBarItem.hide();
      return;
    }

    const formattedToday = formatCompactNumber(stats.todayTokens);
    const formattedTotal = formatCompactNumber(stats.allTimeTotalTokens);

    if (config.statusBarMetric === 'total-tokens') {
      this.statusBarItem.text = `$(graph) ${formattedTotal} tokens`;
    } else if (config.statusBarMetric === 'streak') {
      this.statusBarItem.text = `$(flame) ${stats.currentStreak}d streak`;
    } else {
      // today-tokens default
      this.statusBarItem.text = `$(flame) ${formattedToday} today`;
    }

    const tooltip = new vscode.MarkdownString('', true);
    tooltip.isTrusted = true;
    tooltip.appendMarkdown(`### ⚡ Antigravity Token Tracker\n\n`);
    tooltip.appendMarkdown(`- **Today:** ${stats.todayTokens.toLocaleString()} tokens\n`);
    tooltip.appendMarkdown(`- **This Week:** ${stats.thisWeekTokens.toLocaleString()} tokens\n`);
    tooltip.appendMarkdown(`- **This Month:** ${stats.thisMonthTokens.toLocaleString()} tokens\n`);
    tooltip.appendMarkdown(`- **All Time:** ${stats.allTimeTotalTokens.toLocaleString()} tokens\n`);
    tooltip.appendMarkdown(`- **Current Streak:** ${stats.currentStreak} day${stats.currentStreak === 1 ? '' : 's'} 🔥\n`);
    tooltip.appendMarkdown(`- **Active Days:** ${stats.totalActiveDays} days\n`);
    if (stats.peakDay) {
      tooltip.appendMarkdown(`- **Peak Day:** ${stats.peakDay.date} (${stats.peakDay.tokens.toLocaleString()} tokens)\n`);
    }
    tooltip.appendMarkdown(`\n---\n`);
    tooltip.appendMarkdown(`**RPC Status:** ${stats.rpcConnected ? `🟢 Connected (Port ${stats.rpcPort || 'active'})` : '🟡 Offline / Cached'}\n\n`);
    tooltip.appendMarkdown(`[📊 Open Full Calendar & Analytics](command:antigravity-token-calendar.openDashboard)`);

    this.statusBarItem.tooltip = tooltip;
    this.statusBarItem.show();
  }

  public show(): void {
    this.statusBarItem.show();
  }

  public hide(): void {
    this.statusBarItem.hide();
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}

export function formatCompactNumber(num: number): string {
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return num.toString();
}
