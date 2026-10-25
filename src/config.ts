import * as vscode from 'vscode';
import { HeatmapTheme } from './types';

export interface ExtensionConfig {
  pollIntervalMs: number;
  colorTheme: HeatmapTheme;
  firstDayOfWeek: number;
  showStatusBarItem: boolean;
  statusBarMetric: 'today-tokens' | 'total-tokens' | 'streak';
  customSessionRoot: string;
}

export function getExtensionConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('antigravityTokenCalendar');
  return {
    pollIntervalMs: cfg.get<number>('pollIntervalMs', 45000),
    colorTheme: cfg.get<HeatmapTheme>('colorTheme', 'github-green'),
    firstDayOfWeek: cfg.get<number>('firstDayOfWeek', 0),
    showStatusBarItem: cfg.get<boolean>('showStatusBarItem', true),
    statusBarMetric: cfg.get<'today-tokens' | 'total-tokens' | 'streak'>('statusBarMetric', 'today-tokens'),
    customSessionRoot: cfg.get<string>('customSessionRoot', '').trim(),
  };
}
