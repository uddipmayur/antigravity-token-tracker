import {
  AggregatedStats,
  DayTokenStats,
  HeatmapMetric,
  HeatmapTheme,
  TimeRangePreset,
} from '../types';

declare function acquireVsCodeApi(): {
  postMessage(msg: any): void;
  setState(state: any): void;
  getState(): any;
};

const vscode = acquireVsCodeApi();

interface AppState {
  timeRange: TimeRangePreset;
  metric: HeatmapMetric;
  theme: HeatmapTheme;
  selectedDate: string | null;
}

const state: AppState = {
  timeRange: '180d',
  metric: 'total',
  theme: 'github-green',
  selectedDate: null,
};

let currentStats: AggregatedStats | null = null;

// Initialize
window.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  // Request initial data from extension
  vscode.postMessage({ type: 'ready' });
});

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg) return;

  switch (msg.type) {
    case 'updateStats':
      currentStats = msg.stats;
      if (msg.theme && !state.theme) {
        state.theme = msg.theme;
      }
      renderAll();
      break;
    case 'setTheme':
      state.theme = msg.theme;
      document.body.setAttribute('data-theme', state.theme);
      renderHeatmap();
      break;
  }
});

function setupEventListeners() {
  const timeRangeSelect = document.getElementById('time-range-select') as HTMLSelectElement | null;
  if (timeRangeSelect) {
    timeRangeSelect.addEventListener('change', (e) => {
      state.timeRange = (e.target as HTMLSelectElement).value as TimeRangePreset;
      renderAll();
    });
  }

  const themeSelect = document.getElementById('theme-select') as HTMLSelectElement | null;
  if (themeSelect) {
    themeSelect.addEventListener('change', (e) => {
      state.theme = (e.target as HTMLSelectElement).value as HeatmapTheme;
      document.body.setAttribute('data-theme', state.theme);
      vscode.postMessage({ type: 'changeTheme', theme: state.theme });
      renderHeatmap();
    });
  }

  const metricPills = document.querySelectorAll('.metric-pill');
  metricPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      metricPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      state.metric = pill.getAttribute('data-metric') as HeatmapMetric;
      renderHeatmap();
      if (state.selectedDate) {
        renderDayInspector();
      }
    });
  });

  const refreshBtn = document.getElementById('btn-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.classList.add('loading');
      vscode.postMessage({ type: 'refresh' });
    });
  }

  const exportJsonBtn = document.getElementById('btn-export-json');
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'exportJson' });
    });
  }

  const exportCsvBtn = document.getElementById('btn-export-csv');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'exportCsv' });
    });
  }
}

function renderAll() {
  if (!currentStats) return;

  // Set theme attribute
  document.body.setAttribute('data-theme', state.theme);

  // Update Status Badge
  const statusEl = document.getElementById('connection-status');
  if (statusEl) {
    if (currentStats.rpcConnected) {
      statusEl.className = 'status-badge';
      statusEl.innerHTML = `<span class="status-dot"></span> Language Server Connected (PID ${currentStats.rpcPid || 'active'})`;
    } else {
      statusEl.className = 'status-badge offline';
      statusEl.innerHTML = `<span class="status-dot"></span> Cached Offline Mode`;
    }
  }

  renderKpis();
  renderHeatmap();
  renderDayInspector();
  renderModelAnalytics();
  renderRecentSessions();

  const refreshBtn = document.getElementById('btn-refresh');
  if (refreshBtn) {
    refreshBtn.classList.remove('loading');
  }
}

function renderKpis() {
  if (!currentStats) return;

  const todayEl = document.getElementById('kpi-today');
  const streakEl = document.getElementById('kpi-streak');
  const longestStreakEl = document.getElementById('kpi-longest-streak');
  const totalTokensEl = document.getElementById('kpi-total-tokens');
  const peakDayEl = document.getElementById('kpi-peak-day');

  if (todayEl) {
    todayEl.innerText = formatNumber(currentStats.todayTokens);
  }
  if (streakEl) {
    streakEl.innerText = `${currentStats.currentStreak} day${currentStats.currentStreak === 1 ? '' : 's'} 🔥`;
  }
  if (longestStreakEl) {
    longestStreakEl.innerText = `${currentStats.longestStreak} days ⚡`;
  }
  if (totalTokensEl) {
    totalTokensEl.innerText = formatNumber(currentStats.allTimeTotalTokens);
  }
  if (peakDayEl && currentStats.peakDay) {
    peakDayEl.innerText = `${formatCompact(currentStats.peakDay.tokens)} (${formatDateShort(currentStats.peakDay.date)})`;
  }
}

// --------------------------------------------------------------------------
// CALENDAR HEATMAP SVG RENDERING (GITHUB STYLE)
// --------------------------------------------------------------------------
function renderHeatmap() {
  if (!currentStats) return;

  const svg = document.getElementById('heatmap-svg') as unknown as SVGSVGElement | null;
  if (!svg) return;

  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }

  // Determine date bounds based on timeRange
  const now = new Date();
  let daysBack = 180;
  if (state.timeRange === '30d') daysBack = 30;
  else if (state.timeRange === '90d') daysBack = 90;
  else if (state.timeRange === '180d') daysBack = 180;
  else if (state.timeRange === '365d') daysBack = 365;
  else if (state.timeRange === 'all') {
    if (currentStats.dateList.length > 0) {
      const earliest = new Date(currentStats.dateList[0] + 'T00:00:00Z');
      const diffDays = Math.ceil((now.getTime() - earliest.getTime()) / (1000 * 3600 * 24));
      daysBack = Math.max(90, Math.min(365, diffDays + 7));
    } else {
      daysBack = 180;
    }
  }

  const startDate = new Date(now);
  startDate.setDate(now.getDate() - daysBack);

  // Align start date to Sunday (day 0)
  const startDayOfWeek = startDate.getDay();
  startDate.setDate(startDate.getDate() - startDayOfWeek);

  // Build grid data: columns are weeks, rows are days (0..6)
  const weeks: Array<Array<{ date: Date; dateStr: string; val: number; dayStats: DayTokenStats | null }>> = [];
  let curDate = new Date(startDate);
  let curWeek: Array<{ date: Date; dateStr: string; val: number; dayStats: DayTokenStats | null }> = [];

  while (curDate <= now || curWeek.length > 0) {
    const dStr = toDateString(curDate);
    const dayStats = currentStats.days[dStr] || null;
    const val = getDayMetricValue(dayStats, state.metric);

    curWeek.push({
      date: new Date(curDate),
      dateStr: dStr,
      val,
      dayStats,
    });

    if (curWeek.length === 7) {
      weeks.push(curWeek);
      curWeek = [];
    }

    curDate.setDate(curDate.getDate() + 1);
    if (curDate > now && curWeek.length === 0) break;
  }

  if (curWeek.length > 0) {
    weeks.push(curWeek);
  }

  // Calculate dynamic quantiles for active days
  const activeVals = weeks
    .flat()
    .map((c) => c.val)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);

  let q1 = 10000;
  let q2 = 50000;
  let q3 = 200000;

  if (activeVals.length >= 4) {
    q1 = activeVals[Math.floor(activeVals.length * 0.25)];
    q2 = activeVals[Math.floor(activeVals.length * 0.50)];
    q3 = activeVals[Math.floor(activeVals.length * 0.75)];
  } else if (activeVals.length > 0) {
    const maxVal = activeVals[activeVals.length - 1];
    q1 = Math.max(1, Math.floor(maxVal * 0.2));
    q2 = Math.max(2, Math.floor(maxVal * 0.5));
    q3 = Math.max(3, Math.floor(maxVal * 0.8));
  }

  // Dimensions
  const cellSize = 11;
  const cellGap = 3;
  const leftMargin = 32;
  const topMargin = 22;
  const weekWidth = cellSize + cellGap;

  const totalWidth = leftMargin + weeks.length * weekWidth + 10;
  const totalHeight = topMargin + 7 * (cellSize + cellGap) + 8;

  svg.setAttribute('width', `${totalWidth}`);
  svg.setAttribute('height', `${totalHeight}`);
  svg.setAttribute('viewBox', `0 0 ${totalWidth} ${totalHeight}`);

  // Month labels along the top
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let lastMonth = -1;

  weeks.forEach((week, wIndex) => {
    const firstDay = week[0]?.date;
    if (firstDay) {
      const monthIndex = firstDay.getMonth();
      if (monthIndex !== lastMonth) {
        lastMonth = monthIndex;
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', `${leftMargin + wIndex * weekWidth}`);
        text.setAttribute('y', '12');
        text.setAttribute('font-size', '10');
        text.setAttribute('fill', 'var(--text-muted)');
        text.setAttribute('font-family', 'var(--font-family)');
        text.textContent = monthNames[monthIndex];
        svg.appendChild(text);
      }
    }
  });

  // Day of week labels on the left: Mon (1), Wed (3), Fri (5)
  const dayLabels = [
    { name: 'Mon', row: 1 },
    { name: 'Wed', row: 3 },
    { name: 'Fri', row: 5 },
  ];

  for (const dl of dayLabels) {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '4');
    text.setAttribute('y', `${topMargin + dl.row * (cellSize + cellGap) + 9}`);
    text.setAttribute('font-size', '9');
    text.setAttribute('fill', 'var(--text-muted)');
    text.setAttribute('font-family', 'var(--font-family)');
    text.textContent = dl.name;
    svg.appendChild(text);
  }

  // Render Grid Cells
  const tooltip = document.getElementById('calendar-tooltip');

  weeks.forEach((week, wIndex) => {
    week.forEach((cell, rIndex) => {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const x = leftMargin + wIndex * weekWidth;
      const y = topMargin + rIndex * (cellSize + cellGap);

      rect.setAttribute('x', `${x}`);
      rect.setAttribute('y', `${y}`);
      rect.setAttribute('width', `${cellSize}`);
      rect.setAttribute('height', `${cellSize}`);
      rect.setAttribute('rx', '2.5');
      rect.setAttribute('data-date', cell.dateStr);

      // Level determination
      let level = 0;
      if (cell.val > 0) {
        if (cell.val <= q1) level = 1;
        else if (cell.val <= q2) level = 2;
        else if (cell.val <= q3) level = 3;
        else level = 4;
      }

      rect.setAttribute('fill', `var(--dot-lvl-${level})`);
      rect.setAttribute('stroke', cell.dateStr === state.selectedDate ? 'var(--accent-blue)' : 'var(--dot-stroke)');
      rect.setAttribute('stroke-width', cell.dateStr === state.selectedDate ? '1.5' : '1');
      rect.style.cursor = 'pointer';

      // Tooltip interactions
      rect.addEventListener('mouseenter', (ev) => {
        showTooltip(ev, cell.dateStr, cell.dayStats, cell.val);
        rect.setAttribute('stroke', '#ffffff');
        rect.setAttribute('stroke-width', '1.5');
      });

      rect.addEventListener('mouseleave', () => {
        hideTooltip();
        rect.setAttribute('stroke', cell.dateStr === state.selectedDate ? 'var(--accent-blue)' : 'var(--dot-stroke)');
        rect.setAttribute('stroke-width', cell.dateStr === state.selectedDate ? '1.5' : '1');
      });

      // Click to inspect day
      rect.addEventListener('click', () => {
        if (state.selectedDate === cell.dateStr) {
          state.selectedDate = null;
        } else {
          state.selectedDate = cell.dateStr;
        }
        renderHeatmap();
        renderDayInspector();
      });

      svg.appendChild(rect);
    });
  });
}

function getDayMetricValue(dayStats: DayTokenStats | null, metric: HeatmapMetric): number {
  if (!dayStats) return 0;
  switch (metric) {
    case 'output': return dayStats.outputTokens + dayStats.thinkingTokens;
    case 'input': return dayStats.inputTokens;
    case 'cache': return dayStats.cacheReadTokens;
    case 'turns': return dayStats.turnCount;
    case 'total':
    default:
      return dayStats.totalTokens;
  }
}

// --------------------------------------------------------------------------
// FLOATING TOOLTIP
// --------------------------------------------------------------------------
function showTooltip(ev: MouseEvent, dateStr: string, dayStats: DayTokenStats | null, val: number) {
  const tooltip = document.getElementById('calendar-tooltip');
  if (!tooltip) return;

  const dt = new Date(dateStr + 'T12:00:00Z');
  const dateFormatted = dt.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  let content = `<div class="tooltip-date">${dateFormatted}</div>`;

  if (!dayStats || dayStats.totalTokens === 0) {
    content += `<div class="tooltip-tokens" style="color: var(--text-muted); font-size: 12px;">No activity recorded</div>`;
  } else {
    content += `<div class="tooltip-tokens">${dayStats.totalTokens.toLocaleString()} tokens</div>`;
    content += `
      <div class="tooltip-row"><span>Input tokens:</span><span>${dayStats.inputTokens.toLocaleString()}</span></div>
      <div class="tooltip-row"><span>Output tokens:</span><span>${dayStats.outputTokens.toLocaleString()}</span></div>
      ${dayStats.thinkingTokens > 0 ? `<div class="tooltip-row"><span>Thinking tokens:</span><span>${dayStats.thinkingTokens.toLocaleString()}</span></div>` : ''}
      ${dayStats.cacheReadTokens > 0 ? `<div class="tooltip-row"><span>Cached read:</span><span>${dayStats.cacheReadTokens.toLocaleString()}</span></div>` : ''}
      <div class="tooltip-row"><span>Turns / Prompts:</span><span>${dayStats.turnCount}</span></div>
      <div class="tooltip-row"><span>Active sessions:</span><span>${dayStats.sessionCount}</span></div>
    `;

    const modelNames = Object.values(dayStats.models).map((m) => m.displayName);
    if (modelNames.length > 0) {
      content += `<div style="margin-top: 6px; font-size: 10px; color: var(--accent-blue);">Models: ${modelNames.join(', ')}</div>`;
    }
    content += `<div class="tooltip-hint">Click dot to inspect sessions & hourly timeline</div>`;
  }

  tooltip.innerHTML = content;
  tooltip.classList.add('visible');

  // Position relative to viewport
  const offset = 12;
  const left = Math.min(window.innerWidth - 290, ev.pageX + offset);
  const top = ev.pageY - 100 > 0 ? ev.pageY - 100 : ev.pageY + offset;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  const tooltip = document.getElementById('calendar-tooltip');
  if (tooltip) {
    tooltip.classList.remove('visible');
  }
}

// --------------------------------------------------------------------------
// DAY INSPECTOR (WHEN A DOT IS CLICKED)
// --------------------------------------------------------------------------
function renderDayInspector() {
  const container = document.getElementById('day-inspector-container');
  if (!container || !currentStats) return;

  if (!state.selectedDate) {
    container.innerHTML = '';
    return;
  }

  const dayStats = currentStats.days[state.selectedDate];
  const dt = new Date(state.selectedDate + 'T12:00:00Z');
  const formattedDate = dt.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  if (!dayStats || dayStats.totalTokens === 0) {
    container.innerHTML = `
      <div class="day-inspector">
        <div class="inspector-header">
          <div class="inspector-title">📅 ${formattedDate}</div>
          <button class="close-btn" id="close-inspector">✕</button>
        </div>
        <p style="color: var(--text-muted); font-size: 12px;">No token activity recorded on this date.</p>
      </div>
    `;
    document.getElementById('close-inspector')?.addEventListener('click', () => {
      state.selectedDate = null;
      renderHeatmap();
      renderDayInspector();
    });
    return;
  }

  // Hourly bars calculation
  const maxHourTokens = Math.max(1, ...dayStats.hourly);
  let hourlyBarsHtml = '';
  for (let h = 0; h < 24; h++) {
    const tokens = dayStats.hourly[h];
    const heightPct = Math.round((tokens / maxHourTokens) * 100);
    const hourLabel = h % 4 === 0 ? `${h}h` : '';
    hourlyBarsHtml += `
      <div class="hour-col" title="${h}:00 - ${h}:59: ${tokens.toLocaleString()} tokens">
        <div class="hour-bar" style="height: ${Math.max(2, heightPct)}%; opacity: ${tokens > 0 ? 1 : 0.2};"></div>
        <div class="hour-label">${hourLabel}</div>
      </div>
    `;
  }

  // Sessions list
  let sessionsHtml = '';
  for (const s of dayStats.sessions) {
    sessionsHtml += `
      <div class="session-item">
        <div>
          <div class="session-title">${escapeHtml(s.title)}</div>
          <div class="session-meta">
            <span>${s.turns} prompt${s.turns === 1 ? '' : 's'}</span>
            <span>•</span>
            <span>${s.models.join(', ') || 'AI'}</span>
          </div>
        </div>
        <div class="session-tokens">${s.totalTokens.toLocaleString()} tokens</div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="day-inspector">
      <div class="inspector-header">
        <div class="inspector-title">
          <span>📅 Activity on ${formattedDate}</span>
          <span class="badge" style="background: var(--dot-lvl-3); color: #fff;">${dayStats.turnCount} turns</span>
        </div>
        <button class="close-btn" id="close-inspector">✕</button>
      </div>

      <div class="inspector-stats-row">
        <div class="stat-chip">
          <span class="stat-chip-label">Total Tokens</span>
          <span class="stat-chip-val" style="color: var(--dot-lvl-4);">${dayStats.totalTokens.toLocaleString()}</span>
        </div>
        <div class="stat-chip">
          <span class="stat-chip-label">Input</span>
          <span class="stat-chip-val">${dayStats.inputTokens.toLocaleString()}</span>
        </div>
        <div class="stat-chip">
          <span class="stat-chip-label">Output</span>
          <span class="stat-chip-val">${dayStats.outputTokens.toLocaleString()}</span>
        </div>
        ${dayStats.thinkingTokens > 0 ? `
        <div class="stat-chip">
          <span class="stat-chip-label">Thinking</span>
          <span class="stat-chip-val">${dayStats.thinkingTokens.toLocaleString()}</span>
        </div>` : ''}
        ${dayStats.cacheReadTokens > 0 ? `
        <div class="stat-chip">
          <span class="stat-chip-label">Cache Read</span>
          <span class="stat-chip-val">${dayStats.cacheReadTokens.toLocaleString()}</span>
        </div>` : ''}
        <div class="stat-chip">
          <span class="stat-chip-label">Active Sessions</span>
          <span class="stat-chip-val">${dayStats.sessionCount}</span>
        </div>
      </div>

      <div class="hourly-chart-wrap">
        <div class="chart-label">Hourly Distribution (24 Hours)</div>
        <div class="hourly-bars">${hourlyBarsHtml}</div>
      </div>

      <div>
        <div class="chart-label">Sessions Active on this Day (${dayStats.sessions.length})</div>
        <div class="inspector-sessions-list">${sessionsHtml || '<p style="color:var(--text-muted);">No sessions recorded.</p>'}</div>
      </div>
    </div>
  `;

  document.getElementById('close-inspector')?.addEventListener('click', () => {
    state.selectedDate = null;
    renderHeatmap();
    renderDayInspector();
  });
}

// --------------------------------------------------------------------------
// MODEL ANALYTICS & RECENT SESSIONS
// --------------------------------------------------------------------------
const MODEL_COLORS = ['#39d353', '#58a6ff', '#bc8cff', '#f0883e', '#79c0ff', '#ff7b72'];

function renderModelAnalytics() {
  const container = document.getElementById('models-container');
  if (!container || !currentStats) return;

  const models = currentStats.models;
  if (models.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted);">No model data available yet.</p>';
    return;
  }

  // Stacked progress bar
  let stackHtml = '<div class="model-stack-bar">';
  models.forEach((m, idx) => {
    const color = MODEL_COLORS[idx % MODEL_COLORS.length];
    stackHtml += `<div class="stack-segment" style="width: ${m.percentage}%; background-color: ${color};" title="${m.displayName}: ${m.percentage.toFixed(1)}%"></div>`;
  });
  stackHtml += '</div>';

  // Model rows
  let rowsHtml = '<div class="model-list">';
  models.forEach((m, idx) => {
    const color = MODEL_COLORS[idx % MODEL_COLORS.length];
    rowsHtml += `
      <div class="model-row">
        <div class="model-info">
          <span class="model-color-dot" style="background-color: ${color};"></span>
          <span class="model-name">${escapeHtml(m.displayName)}</span>
        </div>
        <div class="model-nums">
          <span class="model-tokens">${m.totalTokens.toLocaleString()}</span>
          <span class="model-pct"> (${m.percentage.toFixed(1)}%)</span>
        </div>
      </div>
    `;
  });
  rowsHtml += '</div>';

  container.innerHTML = stackHtml + rowsHtml;
}

function renderRecentSessions() {
  const container = document.getElementById('recent-sessions-container');
  if (!container || !currentStats) return;

  const sessions = currentStats.recentSessions.slice(0, 8);
  if (sessions.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted);">No recent sessions found.</p>';
    return;
  }

  let html = '<div class="inspector-sessions-list">';
  for (const s of sessions) {
    const dateFormatted = s.lastModifiedAt ? formatDateShort(s.lastModifiedAt.slice(0, 10)) : '';
    html += `
      <div class="session-item">
        <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; padding-right: 8px;">
          <div class="session-title">${escapeHtml(s.title || 'Untitled Session')}</div>
          <div class="session-meta">
            <span>${dateFormatted}</span>
            <span>•</span>
            <span>${s.stepCount} turns</span>
            <span>•</span>
            <span>${s.models.join(', ') || 'Gemini'}</span>
          </div>
        </div>
        <div class="session-tokens">${s.usage.totalTokens.toLocaleString()}</div>
      </div>
    `;
  }
  html += '</div>';

  container.innerHTML = html;
}

// --------------------------------------------------------------------------
// UTILITIES
// --------------------------------------------------------------------------
function toDateString(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateShort(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mIdx = parseInt(parts[1], 10) - 1;
  return `${mNames[mIdx]} ${parseInt(parts[2], 10)}`;
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

function formatCompact(num: number): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1) + 'k';
  }
  return num.toString();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
