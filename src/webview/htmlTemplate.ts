import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { HeatmapTheme } from '../types';

export function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  theme: HeatmapTheme = 'github-green',
  isSidebar = false
): string {
  const nonce = crypto.randomBytes(16).toString('base64');

  const stylesUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'styles.css')
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webviewApp.js')
  );
  const iconUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'resources', 'icon.svg')
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Antigravity Token Tracker</title>
  <link rel="stylesheet" href="${stylesUri}">
</head>
<body data-theme="${theme}" class="${isSidebar ? 'sidebar-mode' : ''}">
  <div id="calendar-tooltip"></div>

  <!-- Header Section -->
  <header class="header-row">
    <div class="brand-section">
      <img src="${iconUri}" class="brand-icon" alt="Token Tracker" />
      <div>
        <div class="brand-title">Antigravity Token Tracker</div>
      </div>
    </div>

    <div class="controls-group">
      <select id="time-range-select" class="select-control" title="Time Range">
        <option value="30d">Past 30 Days</option>
        <option value="90d">Past 90 Days</option>
        <option value="180d" selected>Past 180 Days (Half Year)</option>
        <option value="365d">Full Year (365 Days)</option>
        <option value="all">All Time History</option>
      </select>

      <button id="btn-refresh" class="btn" title="Refresh Now">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1.705 8.001a6.3 6.3 0 0 1 10.518-4.698l.824-.824a.5.5 0 0 1 .853.354V6a.5.5 0 0 1-.5.5h-3.167a.5.5 0 0 1-.354-.854l.95-.95a4.8 4.8 0 1 0 1.282 4.31.75.75 0 0 1 1.48.243 6.3 6.3 0 0 1-11.886-.252z"/>
        </svg>
        Refresh
      </button>

      <button id="btn-export-json" class="btn" title="Export JSON">Export JSON</button>
      <button id="btn-export-csv" class="btn" title="Export CSV">Export CSV</button>
    </div>
  </header>

  <!-- KPI Cards -->
  <section class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Today's Tokens</div>
      <div class="kpi-value" id="kpi-today" style="color: var(--dot-lvl-4);">--</div>
      <div class="kpi-subtext">Active coding session usage</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Current Streak</div>
      <div class="kpi-value" id="kpi-streak">--</div>
      <div class="kpi-subtext">Consecutive active coding days</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Longest Streak</div>
      <div class="kpi-value" id="kpi-longest-streak">--</div>
      <div class="kpi-subtext">Record unbroken coding run</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Total All-Time Tokens</div>
      <div class="kpi-value" id="kpi-total-tokens">--</div>
      <div class="kpi-subtext">Cumulative input & output tokens</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Peak Activity Day</div>
      <div class="kpi-value" id="kpi-peak-day" style="font-size: 19px;">--</div>
      <div class="kpi-subtext">Highest single-day token count</div>
    </div>
  </section>

  <!-- GitHub Style Calendar Dots Heatmap -->
  <section class="calendar-card">
    <div class="calendar-header">
      <div class="calendar-title-wrap">
        <div>
          <div class="calendar-title">Daily Token Contribution Heatmap</div>
          <div class="calendar-subtitle">Hover over dots for breakdowns; click any date to inspect sessions & hourly timeline</div>
        </div>
      </div>

      <div class="calendar-metric-pills">
        <button class="metric-pill active" data-metric="total" title="Total Tokens">
          <span class="pill-full">Total Tokens</span>
          <span class="pill-short">Total</span>
        </button>
        <button class="metric-pill" data-metric="output" title="Output & Thinking">
          <span class="pill-full">Output & Thinking</span>
          <span class="pill-short">Output</span>
        </button>
        <button class="metric-pill" data-metric="input" title="Input Tokens">
          <span class="pill-full">Input Tokens</span>
          <span class="pill-short">Input</span>
        </button>
        <button class="metric-pill" data-metric="cache" title="Cache Read">
          <span class="pill-full">Cache Read</span>
          <span class="pill-short">Cache</span>
        </button>
        <button class="metric-pill" data-metric="turns" title="Turns / Prompts">
          <span class="pill-full">Turns / Prompts</span>
          <span class="pill-short">Turns</span>
        </button>
      </div>
    </div>

    <div class="heatmap-scroll-container">
      <svg id="heatmap-svg" class="heatmap-svg"></svg>
    </div>

    <div class="calendar-footer">
      <div>Click any dot to pin details below</div>
      <div class="legend-group">
        <span>Less</span>
        <div class="legend-dot lvl-0"></div>
        <div class="legend-dot lvl-1"></div>
        <div class="legend-dot lvl-2"></div>
        <div class="legend-dot lvl-3"></div>
        <div class="legend-dot lvl-4"></div>
        <span>More</span>
      </div>
    </div>

    <!-- Day Inspector inserted here when clicked -->
    <div id="day-inspector-container"></div>
  </section>

  <!-- Bottom Analytics Grid -->
  <section class="bottom-grid">
    <div class="card">
      <div class="card-title">
        <span>Model Breakdown & Distribution</span>
      </div>
      <div id="models-container">
        <p style="color: var(--text-muted);">Loading model breakdown...</p>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>Recent Antigravity Sessions</span>
      </div>
      <div id="recent-sessions-container">
        <p style="color: var(--text-muted);">Loading recent sessions...</p>
      </div>
    </div>
  </section>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
