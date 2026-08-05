export type Mode = 'timer' | 'alarm' | 'stopwatch';
export type SessionState = 'idle' | 'running' | 'paused' | 'ringing';

export type TimeInput = {
  hours: number;
  minutes: number;
  seconds: number;
};

export type Session = {
  mode: Mode;
  state: SessionState;
  input: TimeInput;
  startedAt: number | null;
  targetAt: number | null;
  elapsedBeforePauseMs: number;
  pausedRemainingMs: number | null;
};

export const emptyInput: TimeInput = { hours: 0, minutes: 5, seconds: 0 };

export function createInitialSession(mode: Mode = 'timer'): Session {
  return {
    mode,
    state: 'idle',
    input: mode === 'stopwatch' ? { hours: 0, minutes: 0, seconds: 0 } : emptyInput,
    startedAt: null,
    targetAt: null,
    elapsedBeforePauseMs: 0,
    pausedRemainingMs: null
  };
}

export function inputToMs(input: TimeInput): number {
  return ((input.hours * 60 * 60) + (input.minutes * 60) + input.seconds) * 1000;
}

export function normalizeInput(input: TimeInput): TimeInput {
  const totalSeconds = Math.max(
    0,
    Math.floor(Number(input.hours) || 0) * 3600 +
      Math.floor(Number(input.minutes) || 0) * 60 +
      Math.floor(Number(input.seconds) || 0)
  );
  return {
    hours: Math.floor(totalSeconds / 3600) % 100,
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60
  };
}

export function nextAlarmTarget(input: TimeInput, now = Date.now()): number {
  const normalized = normalizeInput(input);
  const target = new Date(now);
  target.setHours(normalized.hours, normalized.minutes, normalized.seconds, 0);
  if (target.getTime() <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

export function startSession(session: Session, now = Date.now()): Session {
  if (session.mode === 'stopwatch') {
    return {
      ...session,
      state: 'running',
      startedAt: now,
      targetAt: null,
      elapsedBeforePauseMs: session.state === 'paused' ? session.elapsedBeforePauseMs : 0,
      pausedRemainingMs: null
    };
  }

  if (session.mode === 'alarm') {
    return {
      ...session,
      state: 'running',
      startedAt: now,
      targetAt: nextAlarmTarget(session.input, now),
      elapsedBeforePauseMs: 0,
      pausedRemainingMs: null
    };
  }

  const duration = session.state === 'paused' && session.pausedRemainingMs !== null
    ? session.pausedRemainingMs
    : inputToMs(normalizeInput(session.input));

  if (duration <= 0) return session;

  return {
    ...session,
    state: 'running',
    startedAt: now,
    targetAt: now + duration,
    elapsedBeforePauseMs: 0,
    pausedRemainingMs: null
  };
}

export function pauseSession(session: Session, now = Date.now()): Session {
  if (session.state !== 'running') return session;

  if (session.mode === 'stopwatch') {
    return {
      ...session,
      state: 'paused',
      elapsedBeforePauseMs: getDisplayMs(session, now),
      startedAt: null
    };
  }

  return {
    ...session,
    state: 'paused',
    pausedRemainingMs: Math.max(0, (session.targetAt ?? now) - now),
    startedAt: null,
    targetAt: null
  };
}

export function stopSession(session: Session): Session {
  return {
    ...session,
    state: 'idle',
    startedAt: null,
    targetAt: null,
    elapsedBeforePauseMs: 0,
    pausedRemainingMs: null
  };
}

export function dismissRinging(session: Session): Session {
  return stopSession(session);
}

export function tickSession(session: Session, now = Date.now()): Session {
  if (session.state !== 'running' || session.mode === 'stopwatch') return session;
  if (session.targetAt !== null && now >= session.targetAt) {
    return { ...session, state: 'ringing', pausedRemainingMs: 0 };
  }
  return session;
}

export function getDisplayMs(session: Session, now = Date.now()): number {
  if (session.mode === 'stopwatch') {
    if (session.state === 'running' && session.startedAt !== null) {
      return session.elapsedBeforePauseMs + Math.max(0, now - session.startedAt);
    }
    return session.elapsedBeforePauseMs;
  }

  if (session.state === 'paused') {
    return session.pausedRemainingMs ?? inputToMs(session.input);
  }

  if (session.state === 'running' && session.targetAt !== null) {
    return Math.max(0, session.targetAt - now);
  }

  if (session.state === 'ringing') {
    return 0;
  }

  return session.mode === 'alarm' ? Math.max(0, nextAlarmTarget(session.input, now) - now) : inputToMs(session.input);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}
