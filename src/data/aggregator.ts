import {
  AggregatedStats,
  DayModelStats,
  DaySessionRef,
  DayTokenStats,
  ModelLeaderboardEntry,
  SessionInfo,
  TurnRecord,
} from '../types';

export function aggregateTurns(
  turns: TurnRecord[],
  sessions: SessionInfo[],
  rpcConnected = false,
  rpcPort?: number
): AggregatedStats {
  const daysMap: Record<string, DayTokenStats> = {};
  const modelTotals: Record<string, { displayName: string; total: number; input: number; output: number; thinking: number; cache: number; turns: number }> = {};

  let allTimeTotal = 0;
  let allTimeInput = 0;
  let allTimeOutput = 0;
  let allTimeThinking = 0;
  let allTimeCache = 0;
  let allTimeTurns = 0;

  const dateSessionMap = new Map<string, Map<string, { tokens: number; turns: number; models: Set<string> }>>();

  // 1. Group turns into days
  for (const turn of turns) {
    const dStr = turn.date;
    if (!daysMap[dStr]) {
      const dt = new Date(dStr + 'T12:00:00Z');
      daysMap[dStr] = {
        date: dStr,
        dayOfWeek: dt.getUTCDay(),
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        cacheReadTokens: 0,
        turnCount: 0,
        sessionCount: 0,
        hourly: new Array(24).fill(0),
        models: {},
        sessions: [],
        level: 0,
      };
    }

    const day = daysMap[dStr];
    const u = turn.usage;

    day.totalTokens += u.totalTokens;
    day.inputTokens += u.inputTokens;
    day.outputTokens += u.outputTokens;
    day.thinkingTokens += u.thinkingTokens;
    day.cacheReadTokens += u.cacheReadTokens;
    day.turnCount += 1;

    // Hourly
    const h = Math.max(0, Math.min(23, turn.hour));
    day.hourly[h] += u.totalTokens;

    // Day model stats
    if (!day.models[turn.model]) {
      day.models[turn.model] = {
        model: turn.model,
        displayName: turn.modelDisplayName,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        cacheTokens: 0,
        turns: 0,
      };
    }
    const dm = day.models[turn.model];
    dm.totalTokens += u.totalTokens;
    dm.inputTokens += u.inputTokens;
    dm.outputTokens += u.outputTokens;
    dm.thinkingTokens += u.thinkingTokens;
    dm.cacheTokens += u.cacheReadTokens;
    dm.turns += 1;

    // All-time model totals
    if (!modelTotals[turn.model]) {
      modelTotals[turn.model] = {
        displayName: turn.modelDisplayName,
        total: 0,
        input: 0,
        output: 0,
        thinking: 0,
        cache: 0,
        turns: 0,
      };
    }
    const mt = modelTotals[turn.model];
    mt.total += u.totalTokens;
    mt.input += u.inputTokens;
    mt.output += u.outputTokens;
    mt.thinking += u.thinkingTokens;
    mt.cache += u.cacheReadTokens;
    mt.turns += 1;

    allTimeTotal += u.totalTokens;
    allTimeInput += u.inputTokens;
    allTimeOutput += u.outputTokens;
    allTimeThinking += u.thinkingTokens;
    allTimeCache += u.cacheReadTokens;
    allTimeTurns += 1;

    // Pre-index session turn aggregates per date (linear O(1) per turn)
    let sMap = dateSessionMap.get(dStr);
    if (!sMap) {
      sMap = new Map();
      dateSessionMap.set(dStr, sMap);
    }
    let sEntry = sMap.get(turn.sessionId);
    if (!sEntry) {
      sEntry = { tokens: 0, turns: 0, models: new Set() };
      sMap.set(turn.sessionId, sEntry);
    }
    sEntry.tokens += u.totalTokens;
    sEntry.turns += 1;
    sEntry.models.add(turn.modelDisplayName);
  }

  // 2. Link sessions into each day in linear O(S + T) time
  const sessionInfoMap = new Map<string, SessionInfo>();
  for (const s of sessions) {
    sessionInfoMap.set(s.id, s);
  }

  for (const [dStr, sMap] of dateSessionMap) {
    const day = daysMap[dStr];
    if (!day) continue;

    for (const [sessionId, sData] of sMap) {
      const sInfo = sessionInfoMap.get(sessionId);
      day.sessions.push({
        id: sessionId,
        title: sInfo?.title || 'Untitled Session',
        totalTokens: sData.tokens,
        turns: sData.turns,
        models: Array.from(sData.models),
        lastModifiedAt: sInfo?.lastModifiedAt || '',
      });
    }
    day.sessionCount = day.sessions.length;
    day.sessions.sort((a, b) => b.totalTokens - a.totalTokens);
  }

  // 3. Compute dynamic quantile levels for the heatmap dots
  const activeDayTokens = Object.values(daysMap)
    .map((d) => d.totalTokens)
    .filter((t) => t > 0)
    .sort((a, b) => a - b);

  let q1 = 20000;
  let q2 = 100000;
  let q3 = 500000;

  if (activeDayTokens.length >= 4) {
    q1 = activeDayTokens[Math.floor(activeDayTokens.length * 0.25)];
    q2 = activeDayTokens[Math.floor(activeDayTokens.length * 0.50)];
    q3 = activeDayTokens[Math.floor(activeDayTokens.length * 0.75)];
  } else if (activeDayTokens.length > 0) {
    const maxT = activeDayTokens[activeDayTokens.length - 1];
    q1 = Math.max(5000, Math.floor(maxT * 0.2));
    q2 = Math.max(20000, Math.floor(maxT * 0.5));
    q3 = Math.max(50000, Math.floor(maxT * 0.8));
  }

  let peakDay: { date: string; tokens: number } | null = null;
  for (const day of Object.values(daysMap)) {
    if (day.totalTokens === 0) {
      day.level = 0;
    } else if (day.totalTokens <= q1) {
      day.level = 1;
    } else if (day.totalTokens <= q2) {
      day.level = 2;
    } else if (day.totalTokens <= q3) {
      day.level = 3;
    } else {
      day.level = 4;
    }

    if (!peakDay || day.totalTokens > peakDay.tokens) {
      peakDay = { date: day.date, tokens: day.totalTokens };
    }
  }

  // 4. Calculate streaks and date boundaries
  const now = new Date();
  const todayStr = toLocalDateString(now);

  const todayTokens = daysMap[todayStr]?.totalTokens || 0;

  // This week tokens (starting Sunday)
  const dayOfWeek = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  const weekStartStr = toLocalDateString(weekStart);

  let thisWeekTokens = 0;
  for (const [dStr, day] of Object.entries(daysMap)) {
    if (dStr >= weekStartStr && dStr <= todayStr) {
      thisWeekTokens += day.totalTokens;
    }
  }

  // This month tokens
  const monthPrefix = todayStr.substring(0, 7); // YYYY-MM
  let thisMonthTokens = 0;
  for (const [dStr, day] of Object.entries(daysMap)) {
    if (dStr.startsWith(monthPrefix)) {
      thisMonthTokens += day.totalTokens;
    }
  }

  // Streaks
  const { currentStreak, longestStreak } = calculateStreaks(daysMap, todayStr);

  // Model leaderboard
  const modelsList: ModelLeaderboardEntry[] = Object.entries(modelTotals).map(([model, data]) => ({
    model,
    displayName: data.displayName,
    totalTokens: data.total,
    inputTokens: data.input,
    outputTokens: data.output,
    thinkingTokens: data.thinking,
    cacheTokens: data.cache,
    turns: data.turns,
    percentage: allTimeTotal > 0 ? (data.total / allTimeTotal) * 100 : 0,
  }));
  modelsList.sort((a, b) => b.totalTokens - a.totalTokens);

  // Sorted list of dates
  const dateList = Object.keys(daysMap).sort();

  const totalActiveDays = activeDayTokens.length;
  const dailyAverageTokens = totalActiveDays > 0 ? Math.round(allTimeTotal / totalActiveDays) : 0;

  // Sort recent sessions
  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(b.lastModifiedAt).getTime() - new Date(a.lastModifiedAt).getTime()
  );

  return {
    days: daysMap,
    dateList,
    allTimeTotalTokens: allTimeTotal,
    allTimeInputTokens: allTimeInput,
    allTimeOutputTokens: allTimeOutput,
    allTimeThinkingTokens: allTimeThinking,
    allTimeCacheTokens: allTimeCache,
    allTimeTurns,
    totalActiveDays,
    todayTokens,
    thisWeekTokens,
    thisMonthTokens,
    currentStreak,
    longestStreak,
    peakDay,
    dailyAverageTokens,
    models: modelsList,
    recentSessions: sortedSessions,
    lastRefreshedAt: new Date().toISOString(),
    rpcConnected,
    rpcPort,
  };
}

function calculateStreaks(daysMap: Record<string, DayTokenStats>, todayStr: string): { currentStreak: number; longestStreak: number } {
  // Current streak
  let currentStreak = 0;
  const curDate = new Date(todayStr + 'T12:00:00Z');

  // Check today first
  const todayTokens = daysMap[todayStr]?.totalTokens || 0;
  if (todayTokens > 0) {
    currentStreak++;
    curDate.setUTCDate(curDate.getUTCDate() - 1);
  } else {
    // If today is 0 so far, check if yesterday was active (streak might be alive today)
    curDate.setUTCDate(curDate.getUTCDate() - 1);
    const yestStr = toLocalDateString(curDate);
    if ((daysMap[yestStr]?.totalTokens || 0) === 0) {
      // Streak broken
      curDate.setUTCDate(curDate.getUTCDate() + 1);
    }
  }

  while (true) {
    const dStr = toLocalDateString(curDate);
    const day = daysMap[dStr];
    if (day && day.totalTokens > 0) {
      currentStreak++;
      curDate.setUTCDate(curDate.getUTCDate() - 1);
    } else {
      break;
    }
  }

  // Longest streak: iterate all active dates chronologically
  const activeDates = Object.keys(daysMap)
    .filter((d) => daysMap[d].totalTokens > 0)
    .sort();

  let longestStreak = 0;
  let tempStreak = 0;
  let prevDate: Date | null = null;

  for (const dStr of activeDates) {
    const dt = new Date(dStr + 'T12:00:00Z');
    if (!prevDate) {
      tempStreak = 1;
    } else {
      const diffMs = dt.getTime() - prevDate.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        tempStreak++;
      } else {
        tempStreak = 1;
      }
    }
    prevDate = dt;
    if (tempStreak > longestStreak) {
      longestStreak = tempStreak;
    }
  }

  if (currentStreak > longestStreak) {
    longestStreak = currentStreak;
  }

  return { currentStreak, longestStreak };
}

export function toLocalDateString(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
