export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

export interface TurnRecord {
  sessionId: string;
  sessionTitle: string;
  timestamp: string; // ISO string
  date: string; // YYYY-MM-DD
  hour: number; // 0-23
  model: string;
  modelDisplayName: string;
  usage: TokenUsage;
}

export interface SessionInfo {
  id: string;
  title: string;
  createdAt: string;
  lastModifiedAt: string;
  stepCount: number;
  usage: TokenUsage;
  models: string[];
}

export interface DayModelStats {
  model: string;
  displayName: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheTokens: number;
  turns: number;
}

export interface DaySessionRef {
  id: string;
  title: string;
  totalTokens: number;
  turns: number;
  models: string[];
  lastModifiedAt: string;
}

export interface DayTokenStats {
  date: string; // YYYY-MM-DD
  dayOfWeek: number; // 0 = Sun, 6 = Sat
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  turnCount: number;
  sessionCount: number;
  hourly: number[]; // 24 numbers for hours 0-23
  models: Record<string, DayModelStats>;
  sessions: DaySessionRef[];
  level: 0 | 1 | 2 | 3 | 4;
}

export interface ModelLeaderboardEntry {
  model: string;
  displayName: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheTokens: number;
  turns: number;
  percentage: number;
}

export interface AggregatedStats {
  days: Record<string, DayTokenStats>;
  dateList: string[]; // sorted YYYY-MM-DD
  allTimeTotalTokens: number;
  allTimeInputTokens: number;
  allTimeOutputTokens: number;
  allTimeThinkingTokens: number;
  allTimeCacheTokens: number;
  allTimeTurns: number;
  totalActiveDays: number;
  todayTokens: number;
  thisWeekTokens: number;
  thisMonthTokens: number;
  currentStreak: number;
  longestStreak: number;
  peakDay: { date: string; tokens: number } | null
  dailyAverageTokens: number;
  models: ModelLeaderboardEntry[];
  recentSessions: SessionInfo[];
  lastRefreshedAt: string;
  rpcConnected: boolean;
  rpcPid?: number;
  rpcPort?: number;
}

export type HeatmapTheme =
  | 'github-green'
  | 'antigravity-emerald'
  | 'cyberpunk-cyan'
  | 'solar-flame'
  | 'amethyst-purple';

export type HeatmapMetric =
  | 'total'
  | 'output'
  | 'input'
  | 'cache'
  | 'turns';

export type TimeRangePreset =
  | '30d'
  | '90d'
  | '180d'
  | '365d'
  | 'current-year'
  | 'all';

export interface WebviewFilterState {
  timeRange: TimeRangePreset;
  metric: HeatmapMetric;
  theme: HeatmapTheme;
  selectedDate: string | null;
}
