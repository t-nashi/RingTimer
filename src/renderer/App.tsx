import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { startAlarmAudio, stopAlarmAudio } from './alarmAudio';
import {
  createInitialSession,
  dismissRinging,
  formatDuration,
  getDisplayMs,
  inputToMs,
  nextAlarmTarget,
  normalizeInput,
  pauseSession,
  startSession,
  stopSession,
  tickSession,
  type Mode,
  type Session,
  type TimeInput
} from './session';
import { loadState, saveState } from './storage';
import { builtInThemes, isTheme, makeUserTheme, type Theme } from './theme';

const modeLabels: Record<Mode, string> = {
  timer: 'Timer',
  alarm: 'Alarm',
  stopwatch: 'Stopwatch'
};

const inputFields: Array<keyof TimeInput> = ['hours', 'minutes', 'seconds'];

const RING_RADIUS = 136;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

const presetMinutes = [5, 10, 25, 60];

const CUSTOM_THEME_ID = 'custom-draft';
const SWATCH_SIZE = 26;
const SWATCH_GAP = 8;

export function App() {
  const loaded = useMemo(loadState, []);
  const [session, setSession] = useState<Session>(() => tickSession(loaded.session));
  const [now, setNow] = useState(Date.now());
  const [userThemes, setUserThemes] = useState<Theme[]>(loaded.userThemes);
  const [draftTheme, setDraftTheme] = useState<Theme | null>(null);
  const [activeThemeId, setActiveThemeId] = useState(loaded.activeThemeId);
  const [zoom, setZoom] = useState(loaded.zoom);
  const [alarmVolume, setAlarmVolume] = useState(loaded.alarmVolume);
  const [alarmMuted, setAlarmMuted] = useState(loaded.alarmMuted);
  const [minimal, setMinimal] = useState(loaded.minimal);
  const [focusedField, setFocusedField] = useState<keyof TimeInput>('minutes');
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [previewingSound, setPreviewingSound] = useState(false);
  const notifiedRingingRef = useRef(false);
  const previewTimerRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdIntervalRef = useRef<number | null>(null);
  const segRefs = useRef<Partial<Record<keyof TimeInput, HTMLInputElement | null>>>({});
  const swatchesRef = useRef<HTMLDivElement | null>(null);
  const minimalTransitionRef = useRef(false);
  const minimalInitRef = useRef(false);
  const [swatchAreaWidth, setSwatchAreaWidth] = useState<number | null>(null);

  const themes = [...builtInThemes, ...userThemes, ...(draftTheme ? [draftTheme] : [])];
  const activeTheme = themes.find((theme) => theme.id === activeThemeId) ?? builtInThemes[0];
  const sameColors = (a: Theme, b: Theme) =>
    a.backgroundColor === b.backgroundColor &&
    a.textColor === b.textColor &&
    a.accentColor === b.accentColor &&
    (a.backgroundImageEnabled ?? Boolean(a.backgroundImage)) === (b.backgroundImageEnabled ?? Boolean(b.backgroundImage)) &&
    ((a.backgroundImageEnabled ?? Boolean(a.backgroundImage)) === false || a.backgroundImage === b.backgroundImage);
  const swatchThemes = themes.filter((theme, index) => themes.findIndex((other) => sameColors(other, theme)) === index);
  const swatchFitCount = swatchAreaWidth === null
    ? swatchThemes.length
    : Math.max(1, Math.floor((swatchAreaWidth + SWATCH_GAP) / (SWATCH_SIZE + SWATCH_GAP)));
  const swatchOverflow = swatchFitCount < swatchThemes.length;
  const swatchVisibleCount = swatchOverflow ? Math.max(1, swatchFitCount - 1) : swatchThemes.length;
  const activeSwatchIndex = swatchThemes.findIndex((theme) => sameColors(theme, activeTheme));
  const visibleSwatches = swatchOverflow
    ? (() => {
        const activeSwatch = activeSwatchIndex >= 0 ? [swatchThemes[activeSwatchIndex]] : [];
        const others = swatchThemes.filter((_, index) => index !== activeSwatchIndex);
        return [...activeSwatch, ...others.slice(0, Math.max(0, swatchVisibleCount - activeSwatch.length))];
      })()
    : swatchThemes;
  const hiddenSwatchCount = swatchThemes.length - visibleSwatches.length;
  const displayMs = getDisplayMs(session, now);
  const canStart = session.mode !== 'timer' || inputToMs(normalizeInput(session.input)) > 0;

  const totalMs = sessionTotalMs(session);
  const remainFrac = session.mode === 'stopwatch'
    ? 1
    : totalMs > 0
      ? Math.min(1, Math.max(0, displayMs / totalMs))
      : 1;
  const drawnFrac = session.mode === 'stopwatch'
    ? (displayMs % 60000) / 60000
    : remainFrac;
  const ringActive = session.state === 'running' || session.state === 'paused' || session.state === 'ringing';
  const ringClass = [
    'ring-fill',
    ringActive && remainFrac <= 0.05 ? 'ring-fill--danger' : ringActive && remainFrac <= 0.15 ? 'ring-fill--warn' : ''
  ].filter(Boolean).join(' ');

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextNow = Date.now();
      setNow(nextNow);
      setSession((current) => tickSession(current, nextNow));
    }, 200);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    saveState({ session, activeThemeId, userThemes, zoom, alarmVolume, alarmMuted, minimal });
  }, [session, activeThemeId, userThemes, zoom, alarmVolume, alarmMuted, minimal]);

  useEffect(() => {
    const el = swatchesRef.current;
    if (!el) return;
    setSwatchAreaWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSwatchAreaWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
    // minimal mode unmounts/remounts the swatches row, orphaning the previous
    // observer — re-run this effect so a fresh one attaches to the new node.
  }, [minimal]);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [activeThemeId]);

  useEffect(() => {
    if (loaded.minimal && !minimalInitRef.current) {
      minimalInitRef.current = true;
      void window.desktop?.setMinimal?.(true);
    }
    return () => endHold();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--bg', activeTheme.backgroundColor);
    document.documentElement.style.setProperty('--text', activeTheme.textColor);
    document.documentElement.style.setProperty('--accent', activeTheme.accentColor);
    document.documentElement.style.setProperty('--range-fill', activeTheme.accentColor);
  }, [activeTheme]);

  useEffect(() => {
    if (session.state === 'ringing') {
      // プレビュー再生中なら止めてから本鳴動に切り替える
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
        stopAlarmAudio();
        setPreviewingSound(false);
      }
      startAlarmAudio(activeTheme.alarmSound, alarmVolume, alarmMuted);
      if (!notifiedRingingRef.current) {
        notifiedRingingRef.current = true;
        void window.desktop?.notify({
          title: 'RingTimer',
          body: `${modeLabels[session.mode]} is ringing`
        });
      }
    } else {
      notifiedRingingRef.current = false;
      stopAlarmAudio();
    }

    return () => stopAlarmAudio();
  }, [activeTheme.alarmSound, session.mode, session.state, alarmVolume, alarmMuted]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, select, textarea')) {
        return;
      }
      if (event.key === ' ' || event.key.toLowerCase() === 'p') {
        event.preventDefault();
        togglePause();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (session.state === 'ringing') {
          setSession((current) => dismissRinging(current));
        } else {
          begin();
        }
      } else if (event.key === 'Escape') {
        if (session.state === 'ringing') {
          setSession((current) => dismissRinging(current));
        } else if (minimal) {
          toggleMinimal();
        } else {
          setThemePanelOpen(false);
        }
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const currentIndex = inputFields.indexOf(focusedField);
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        setFocusedField(inputFields[(currentIndex + direction + inputFields.length) % inputFields.length]);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        updateInput(focusedField, session.input[focusedField] + (event.key === 'ArrowUp' ? 1 : -1));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function setMode(mode: Mode) {
    if (session.state === 'running' || session.state === 'paused') return;
    setSession(createInitialSession(mode));
    setFocusedField(mode === 'alarm' ? 'hours' : 'minutes');
  }

  function updateInput(field: keyof TimeInput, value: number) {
    setSession((current) => ({
      ...current,
      input: normalizeInput({ ...current.input, [field]: value })
    }));
  }

  function stepInput(field: keyof TimeInput, delta: number) {
    setSession((current) => {
      if (current.state === 'running' || current.state === 'ringing') return current;
      if (field === 'hours') {
        const hours = ((current.input.hours + delta) % 100 + 100) % 100;
        return { ...current, input: { ...current.input, hours } };
      }
      if (delta < 0) {
        const input = { ...current.input };
        if (input[field] > 0) {
          input[field] -= 1;
        } else {
          input[field] = 59;
          const higherField = field === 'seconds' ? 'minutes' : 'hours';
          if (input[higherField] > 0) {
            input[higherField] -= 1;
          }
        }
        return { ...current, input };
      }
      return {
        ...current,
        input: normalizeInput({ ...current.input, [field]: current.input[field] + delta })
      };
    });
    setFocusedField(field);
  }

  function beginHold(field: keyof TimeInput, delta: number) {
    endHold();
    stepInput(field, delta);
    holdTimerRef.current = window.setTimeout(() => {
      holdIntervalRef.current = window.setInterval(() => stepInput(field, delta), 70);
    }, 420);
  }

  function endHold() {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdIntervalRef.current !== null) {
      window.clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  }

  async function toggleMinimal() {
    if (minimalTransitionRef.current) return;
    const next = !minimal;
    minimalTransitionRef.current = true;

    try {
      if (next) {
        setMinimal(true);
        await window.desktop?.setMinimal?.(true);
      } else {
        const restored = await window.desktop?.setMinimal?.(false);
        if (restored !== false) setMinimal(false);
      }
    } finally {
      minimalTransitionRef.current = false;
    }
  }

  function handleSegKey(event: React.KeyboardEvent<HTMLInputElement>, field: keyof TimeInput) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      stepInput(field, event.key === 'ArrowUp' ? 1 : -1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const index = inputFields.indexOf(field);
      const next = inputFields[(index + (event.key === 'ArrowRight' ? 1 : -1) + inputFields.length) % inputFields.length];
      segRefs.current[next]?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      begin();
    } else if (event.key === 'Escape') {
      event.currentTarget.blur();
    }
  }

  function stopSoundPreview() {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setPreviewingSound((playing) => {
      if (playing) stopAlarmAudio();
      return false;
    });
  }

  function toggleSoundPreview() {
    if (previewingSound) {
      stopSoundPreview();
      return;
    }
    if (session.state === 'ringing') return;
    startAlarmAudio(activeTheme.alarmSound, alarmVolume, alarmMuted);
    setPreviewingSound(true);
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      stopAlarmAudio();
      setPreviewingSound(false);
    }, 3000);
  }

  function setInputToNow() {
    const current = new Date();
    setSession((session) => ({
      ...session,
      input: {
        hours: current.getHours(),
        minutes: current.getMinutes(),
        seconds: current.getSeconds()
      }
    }));
  }

  function begin() {
    // 表示用の now と開始時刻をそろえ、開始直後に残り時間が1秒ぶれるのを防ぐ
    const startedNow = Date.now();
    setNow(startedNow);
    setSession((current) => startSession(current, startedNow));
  }

  function togglePause() {
    const toggledNow = Date.now();
    setNow(toggledNow);
    setSession((current) => {
      if (current.state === 'running') return pauseSession(current, toggledNow);
      if (current.state === 'paused') return startSession(current, toggledNow);
      return current;
    });
  }

  function stop() {
    setSession((current) => stopSession(current));
  }

  function mainAction() {
    if (session.state === 'ringing') {
      setSession((current) => dismissRinging(current));
      return;
    }
    if (session.state === 'running') {
      togglePause();
      return;
    }
    begin();
  }

  function snooze() {
    const now = Date.now();
    setNow(now);
    setSession((current) => ({
      ...current,
      state: 'running',
      startedAt: now,
      targetAt: now + 60000,
      elapsedBeforePauseMs: 0,
      pausedRemainingMs: null
    }));
  }

  function confirmSaveTheme() {
    const name = (savingName ?? '').trim();
    if (!name) return;
    const saved = makeUserTheme({ ...activeTheme, name });
    setUserThemes((current) => [...current, saved]);
    setDraftTheme(null);
    setActiveThemeId(saved.id);
    setSavingName(null);
  }

  function requestDeleteTheme() {
    if (activeTheme.builtIn) return;
    setConfirmingDelete(true);
  }

  function cancelDeleteTheme() {
    setConfirmingDelete(false);
  }

  function deleteTheme() {
    setConfirmingDelete(false);
    if (activeTheme.id === CUSTOM_THEME_ID) {
      setDraftTheme(null);
      setActiveThemeId(builtInThemes[0].id);
      return;
    }
    if (activeTheme.builtIn) return;
    setUserThemes((current) => current.filter((theme) => theme.id !== activeTheme.id));
    setActiveThemeId(builtInThemes[0].id);
  }

  async function exportTheme() {
    if (window.desktop) {
      await window.desktop.exportTheme(activeTheme);
      return;
    }

    window.navigator.clipboard?.writeText(JSON.stringify(activeTheme, null, 2));
  }

  async function importTheme() {
    if (!window.desktop) return;
    const result = await window.desktop.importTheme();
    if (!result.canceled && isTheme(result.theme)) {
      const imported = makeUserTheme(result.theme);
      setUserThemes((current) => [...current, imported]);
      setActiveThemeId(imported.id);
    }
  }

  const overlayColor = isDarkColor(activeTheme.textColor) ? 'rgba(255,255,255,.42)' : 'rgba(0,0,0,.35)';
  const backgroundImageEnabled = activeTheme.backgroundImageEnabled ?? Boolean(activeTheme.backgroundImage);
  const backgroundStyle = backgroundImageEnabled && activeTheme.backgroundImage
    ? { backgroundImage: `linear-gradient(${overlayColor}, ${overlayColor}), url("${activeTheme.backgroundImage}")` }
    : undefined;
  const resetIsStop = session.state === 'running';

  const resetStopButton = (
    <button
      className="ctl"
      type="button"
      onClick={stop}
      disabled={session.state === 'idle'}
      title={resetIsStop ? 'Stop' : 'Reset'}
      aria-label={resetIsStop ? 'Stop' : 'Reset'}
    >
      {resetIsStop ? (
        <svg key="stop" viewBox="0 0 24 24" aria-hidden="true" className="icon-solid">
          <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
        </svg>
      ) : (
        <svg key="reset" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" /></svg>
      )}
    </button>
  );

  const mainIcon = session.state === 'running' ? (
    <svg key="pause" viewBox="0 0 24 24" aria-hidden="true" className="icon-solid">
      <rect x="7" y="5" width="3.6" height="14" rx="1" />
      <rect x="13.4" y="5" width="3.6" height="14" rx="1" />
    </svg>
  ) : session.state === 'ringing' ? (
    <svg key="dismiss" viewBox="0 0 24 24" aria-hidden="true" className="icon-solid">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  ) : (
    <svg key="play" viewBox="0 0 24 24" aria-hidden="true" className="icon-solid">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );

  const ringOverlay = session.state === 'ringing' && (
    <div className="ring-overlay" role="alertdialog" aria-label="Ringing">
      <div className="ring-overlay__panel">
        <p className="ring-overlay__time">{new Date(now).toLocaleTimeString()}</p>
        <p className="ring-overlay__msg">{session.mode === 'alarm' ? 'Alarm' : 'Time is up'}</p>
        <div className="ring-overlay__actions">
          <button
            type="button"
            className="ring-overlay__dismiss"
            autoFocus
            onClick={() => setSession((current) => dismissRinging(current))}
          >
            Dismiss
          </button>
          <button type="button" className="ring-overlay__snooze" onClick={snooze}>
            +1 min
          </button>
        </div>
      </div>
    </div>
  );

  if (minimal) {
    const barClass = [
      'mini__bar-fill',
      ringActive && remainFrac <= 0.05
        ? 'mini__bar-fill--danger'
        : ringActive && remainFrac <= 0.15
          ? 'mini__bar-fill--warn'
          : ''
    ].filter(Boolean).join(' ');

    return (
      <main className={`app app--minimal app--${session.state}`} style={backgroundStyle}>
        <div className="mini" role="group" aria-label="Minimal timer">
          <div className="mini__main">
            <span className="mini__mode">
              <span className="mini__dot" aria-hidden="true" />
              {modeLabels[session.mode]}
            </span>
            <span className="mini__time">{formatDuration(displayMs)}</span>
            <div className="mini__bar" aria-hidden="true">
              <div className={barClass} style={{ width: `${Math.min(100, Math.max(0, drawnFrac * 100))}%` }} />
            </div>
          </div>
          <div className="mini__actions">
            {resetStopButton}
            <button
              className={session.state === 'ringing' ? 'ctl ctl--main ctl--ringing' : 'ctl ctl--main'}
              type="button"
              onClick={mainAction}
              disabled={session.state === 'idle' && !canStart}
              title={mainActionLabel(session.state)}
              aria-label={mainActionLabel(session.state)}
            >
              {mainIcon}
            </button>
            <button className="ctl" type="button" onClick={toggleMinimal} title="元のサイズに戻す (Esc)" aria-label="Expand view">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" /></svg>
            </button>
          </div>
        </div>
        {ringOverlay}
      </main>
    );
  }

  return (
    <main className={`app app--${session.state}`} style={backgroundStyle}>
      <section className="workspace" aria-label="Timer workspace">
        <header className="topbar">
          <div className="mode-tabs" role="tablist" aria-label="Mode">
            {(Object.keys(modeLabels) as Mode[]).map((mode) => (
              <button
                className={session.mode === mode ? 'tab tab--active' : 'tab'}
                key={mode}
                onClick={() => setMode(mode)}
                disabled={session.state === 'running' || session.state === 'paused'}
                title={session.state === 'running' || session.state === 'paused' ? 'Reset するとモードを切り替えられます' : undefined}
                type="button"
              >
                {modeLabels[mode]}
              </button>
            ))}
          </div>
        </header>

        <div className="counter-wrap">
          <p className={`status status--${session.state}`}>
            <span className="status__dot" aria-hidden="true" />
            {statusText(session, now)}
          </p>
          <div className="ring-wrap" style={{ transform: `scale(${zoom})` }}>
            <svg className="ring-svg" viewBox="0 0 300 300" aria-hidden="true">
              <circle className="ring-track" cx="150" cy="150" r={RING_RADIUS} />
              <circle
                className={ringClass}
                cx="150"
                cy="150"
                r={RING_RADIUS}
                strokeDasharray={RING_CIRC}
                strokeDashoffset={RING_CIRC * (1 - drawnFrac)}
              />
            </svg>
            <div className="ring-center">
              {session.mode === 'alarm' && (
                <p className="counter-top">
                  {`Target ${new Date(session.targetAt ?? nextAlarmTarget(session.input, now)).toLocaleString()}`}
                </p>
              )}
              {session.mode !== 'stopwatch' && session.state === 'idle' ? (
                <div className="counter counter-edit" role="group" aria-label={session.mode === 'alarm' ? 'Set alarm time' : 'Set timer duration'}>
                  {inputFields.map((field, index) => (
                    <Fragment key={field}>
                      {index > 0 && <span className="counter-colon" aria-hidden="true">:</span>}
                      <div className={focusedField === field ? 'counter-seg counter-seg--focused' : 'counter-seg'}>
                        <button
                          type="button"
                          className="counter-seg__step counter-seg__step--up"
                          tabIndex={-1}
                          aria-hidden="true"
                          onPointerDown={() => beginHold(field, 1)}
                          onPointerUp={endHold}
                          onPointerLeave={endHold}
                          onPointerCancel={endHold}
                        >
                          <svg viewBox="0 0 24 24"><path d="m6 14 6-6 6 6" /></svg>
                        </button>
                        <input
                          className="counter-seg__input"
                          type="text"
                          inputMode="numeric"
                          maxLength={3}
                          ref={(el) => { segRefs.current[field] = el; }}
                          value={String(session.input[field]).padStart(2, '0')}
                          onFocus={(event) => {
                            setFocusedField(field);
                            event.target.select();
                          }}
                          onChange={(event) => updateInput(field, Number(event.target.value.replace(/\D/g, '')) || 0)}
                          onKeyDown={(event) => handleSegKey(event, field)}
                          onWheel={(event) => stepInput(field, event.deltaY < 0 ? 1 : -1)}
                          aria-label={field}
                        />
                        <button
                          type="button"
                          className="counter-seg__step counter-seg__step--down"
                          tabIndex={-1}
                          aria-hidden="true"
                          onPointerDown={() => beginHold(field, -1)}
                          onPointerUp={endHold}
                          onPointerLeave={endHold}
                          onPointerCancel={endHold}
                        >
                          <svg viewBox="0 0 24 24"><path d="m6 10 6 6 6-6" /></svg>
                        </button>
                      </div>
                    </Fragment>
                  ))}
                </div>
              ) : (
                <h1 className="counter">
                  {formatDuration(displayMs).split(':').map((part, index) => (
                    <Fragment key={index}>
                      {index > 0 && <span className="counter-colon" aria-hidden="true">:</span>}
                      <span className="counter-num">{part}</span>
                    </Fragment>
                  ))}
                </h1>
              )}
              <p className="counter-sub">
                {session.mode === 'timer' && ringActive ? `of ${formatDuration(totalMs)}` : ' '}
              </p>
              {session.mode === 'alarm' && session.state === 'idle' && (
                <button
                  type="button"
                  className="now-btn"
                  onClick={setInputToNow}
                  title="現在時刻を取得してセット"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="8.5" />
                    <path d="M12 7.5V12l3 2" />
                  </svg>
                  現在時刻取得
                </button>
              )}
            </div>
          </div>
          {session.mode === 'timer' ? (
            <div className="presets" role="group" aria-label="Presets">
              {presetMinutes.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className={inputToMs(normalizeInput(session.input)) === minutes * 60000 ? 'chip chip--active' : 'chip'}
                  disabled={session.state !== 'idle'}
                  onClick={() => setSession((current) => ({ ...current, input: normalizeInput({ hours: 0, minutes, seconds: 0 }) }))}
                >
                  {minutes} min
                </button>
              ))}
            </div>
          ) : (
            <p className="target">
              {session.mode === 'alarm' && session.state === 'idle' ? formatDuration(displayMs) : ' '}
            </p>
          )}
        </div>

        <section className="controls" aria-label="Controls">
          <div className="action-row">
            {resetStopButton}
            <button
              className={session.state === 'ringing' ? 'ctl ctl--main ctl--ringing' : 'ctl ctl--main'}
              type="button"
              onClick={mainAction}
              disabled={session.state === 'idle' && !canStart}
              title={mainActionLabel(session.state)}
              aria-label={mainActionLabel(session.state)}
            >
              {mainIcon}
            </button>
            <button
              className={alarmMuted ? 'ctl ctl--muted' : 'ctl'}
              type="button"
              onClick={() => setAlarmMuted((muted) => !muted)}
              title={alarmMuted ? 'Unmute alarm' : 'Mute alarm'}
              aria-label={alarmMuted ? 'Unmute alarm' : 'Mute alarm'}
              aria-pressed={alarmMuted}
            >
              {alarmMuted ? (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19zM15 9.5l5 5M20 9.5l-5 5" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19zM15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" /></svg>
              )}
            </button>
          </div>
        </section>

        <footer className="theme-bar">
          <span className="theme-bar__label">Theme</span>
          <div className="theme-bar__swatches" ref={swatchesRef} role="group" aria-label="Themes">
            {visibleSwatches.map((theme) => (
              <button
                key={theme.id}
                type="button"
                className={sameColors(theme, activeTheme) ? 'swatch swatch--active' : 'swatch'}
                style={{ background: theme.backgroundColor }}
                title={theme.name}
                aria-label={`Theme: ${theme.name}`}
                aria-pressed={sameColors(theme, activeTheme)}
                onClick={() => setActiveThemeId(theme.id)}
              />
            ))}
            {swatchOverflow && (
              <button
                type="button"
                className="swatch swatch--overflow"
                onClick={() => setThemePanelOpen(true)}
                title={`他 ${hiddenSwatchCount} 件のテーマ`}
                aria-label={`Show ${hiddenSwatchCount} more themes`}
              >
                +{hiddenSwatchCount}
              </button>
            )}
          </div>
          <div className="window-tools">
            <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.7, value - 0.1))}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
            </button>
            <button type="button" className="zoom-value" title="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
            <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
            </button>
            <span className="window-tools__sep" aria-hidden="true" />
            <button type="button" title="Minimal view" aria-label="Minimal view" onClick={toggleMinimal}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
            </button>
            <button type="button" title="Fullscreen" aria-label="Fullscreen" onClick={() => window.desktop?.toggleFullscreen()}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
            </button>
            <span className="window-tools__sep" aria-hidden="true" />
            <button
              type="button"
              className="settings-toggle"
              title={themePanelOpen ? 'Close theme settings' : 'Settings'}
              aria-label={themePanelOpen ? 'Close theme settings' : 'Settings'}
              aria-expanded={themePanelOpen}
              onClick={() => setThemePanelOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 5h-7M10 5H3M21 12h-9M8 12H3M21 19h-5M12 19H3M14 3v4M8 10v4M16 17v4" />
              </svg>
            </button>
          </div>
        </footer>
      </section>

      <div
        className={themePanelOpen ? 'panel-backdrop panel-backdrop--open' : 'panel-backdrop'}
        aria-hidden="true"
        onClick={() => setThemePanelOpen(false)}
      />
      <aside className={themePanelOpen ? 'theme-panel theme-panel--open' : 'theme-panel'} aria-label="Theme settings" aria-hidden={!themePanelOpen}>
        <div className="theme-panel__head">
          <h2>Theme</h2>
          <button type="button" className="theme-panel__close" onClick={() => setThemePanelOpen(false)} aria-label="Close theme settings">
            ✕
          </button>
        </div>
        <label>
          <span>Saved</span>
          <div className="select-field">
            <select value={activeTheme.id} onChange={(event) => setActiveThemeId(event.target.value)}>
              {themes.map((theme) => (
                <option key={theme.id} value={theme.id}>{theme.name}</option>
              ))}
            </select>
          </div>
        </label>
        <div className="theme-color-row">
          <HexColorField label="Background" value={activeTheme.backgroundColor} onChange={(hex) => updateActiveTheme({ backgroundColor: hex })} />
          <HexColorField label="Text" value={activeTheme.textColor} onChange={(hex) => updateActiveTheme({ textColor: hex })} />
          <HexColorField label="Accent" value={activeTheme.accentColor} onChange={(hex) => updateActiveTheme({ accentColor: hex })} />
        </div>
        <label>
          <span className={backgroundImageEnabled ? undefined : 'is-dimmed'}>Background Image URL</span>
          <div className="input-with-toggle">
            <input
              className={backgroundImageEnabled ? undefined : 'is-dimmed'}
              type="url"
              value={activeTheme.backgroundImage}
              onChange={(event) => updateActiveTheme({ backgroundImage: event.target.value })}
              placeholder="https://..."
            />
            <button
              type="button"
              className={backgroundImageEnabled ? 'icon-toggle icon-toggle--active' : 'icon-toggle'}
              onClick={() => updateActiveTheme({ backgroundImageEnabled: !backgroundImageEnabled })}
              title={backgroundImageEnabled ? 'Hide background image' : 'Show background image'}
              aria-label={backgroundImageEnabled ? 'Hide background image' : 'Show background image'}
              aria-pressed={backgroundImageEnabled}
            >
              {backgroundImageEnabled ? (
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="m21 16-5-5-4 4-3-3-4 4" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="m21 16-5-5-4 4-3-3-4 4" /><path d="M4 4l16 16" /></svg>
              )}
            </button>
          </div>
        </label>
        <label>
          <span className={alarmMuted ? 'is-dimmed' : undefined}>Alarm</span>
          <div className="alarm-row">
            <div className="select-field">
              <select
                className={alarmMuted ? 'is-dimmed' : undefined}
                value={activeTheme.alarmSound}
                onChange={(event) => {
                  stopSoundPreview();
                  updateActiveTheme({ alarmSound: event.target.value as Theme['alarmSound'] });
                }}
              >
                <option value="beep">Beep</option>
                <option value="pulse">Pulse</option>
                <option value="beacon">Beacon</option>
                <option value="chime">Chime</option>
              </select>
            </div>
            <button
              type="button"
              className={[
                'preview-btn',
                previewingSound ? 'preview-btn--active' : '',
                alarmMuted ? 'is-dimmed' : ''
              ].filter(Boolean).join(' ')}
              onClick={(event) => {
                event.preventDefault();
                toggleSoundPreview();
              }}
              title={previewingSound ? 'プレビューを停止' : 'アラーム音をプレビュー'}
              aria-label={previewingSound ? 'Stop preview' : 'Preview alarm sound'}
              aria-pressed={previewingSound}
            >
              {previewingSound ? (
                <svg key="stop" viewBox="0 0 24 24" aria-hidden="true" className="icon-solid">
                  <rect x="7" y="7" width="10" height="10" rx="1.5" />
                </svg>
              ) : (
                <svg key="play" viewBox="0 0 24 24" aria-hidden="true" className="icon-solid">
                  <path d="M9 6.5v11l9-5.5z" />
                </svg>
              )}
            </button>
          </div>
        </label>
        <label className="volume-field">
          <span className={alarmMuted ? 'is-dimmed' : undefined}>Volume {Math.round(alarmVolume * 100)}%</span>
          <div className="input-with-toggle">
            <input
              className={alarmMuted ? 'is-dimmed' : undefined}
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(alarmVolume * 100)}
              onChange={(event) => setAlarmVolume(Number(event.target.value) / 100)}
            />
            <button
              type="button"
              className={alarmMuted ? 'icon-toggle icon-toggle--active' : 'icon-toggle'}
              onClick={() => setAlarmMuted((muted) => !muted)}
              title={alarmMuted ? 'Unmute alarm' : 'Mute alarm'}
              aria-label={alarmMuted ? 'Unmute alarm' : 'Mute alarm'}
              aria-pressed={alarmMuted}
            >
              {alarmMuted ? (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19zM15 9.5l5 5M20 9.5l-5 5" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19zM15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" /></svg>
              )}
            </button>
          </div>
        </label>
        {confirmingDelete && (
          <div className="save-row confirm-row">
            <span className="confirm-row__text">Delete “{activeTheme.name}”?</span>
            <button type="button" className="btn-danger" onClick={deleteTheme}>Delete</button>
            <button type="button" onClick={cancelDeleteTheme}>Cancel</button>
          </div>
        )}
        {savingName !== null && (
          <div className="save-row">
            <input
              value={savingName}
              onChange={(event) => setSavingName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') confirmSaveTheme();
                if (event.key === 'Escape') setSavingName(null);
              }}
              placeholder="Theme name"
              aria-label="Theme name"
              autoFocus
            />
            <button type="button" onClick={confirmSaveTheme} disabled={!(savingName ?? '').trim()}>OK</button>
            <button type="button" onClick={() => setSavingName(null)}>Cancel</button>
          </div>
        )}
        <div className="theme-actions">
          <button
            type="button"
            className={activeTheme.builtIn ? undefined : 'btn-danger-outline'}
            onClick={requestDeleteTheme}
            disabled={activeTheme.builtIn}
          >
            Delete
          </button>
          <button type="button" onClick={importTheme}>Import</button>
          <button type="button" onClick={exportTheme}>Export</button>
        </div>
        <button type="button" className="primary theme-save-btn" onClick={() => setSavingName(activeTheme.name)}>Save</button>
      </aside>

      {ringOverlay}
    </main>
  );

  function updateActiveTheme(patch: Partial<Theme>) {
    const draft: Theme = {
      ...activeTheme,
      ...patch,
      version: 1,
      id: CUSTOM_THEME_ID,
      name: 'Custom',
      builtIn: false
    };
    setDraftTheme(draft);
    setActiveThemeId(CUSTOM_THEME_ID);
  }
}

function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : null;
}

function HexColorField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  function commit() {
    const normalized = normalizeHex(text);
    if (normalized) {
      onChange(normalized);
      setText(normalized);
    } else {
      setText(value);
    }
  }

  return (
    <label className="theme-color-field">
      <span>{label}</span>
      <div className="color-swatch-input">
        <input
          type="color"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setText(event.target.value);
          }}
          aria-label={`${label} color`}
        />
        <input
          type="text"
          className="hex-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit();
              event.currentTarget.blur();
            }
          }}
          spellCheck={false}
          maxLength={7}
          aria-label={`${label} hex value`}
        />
      </div>
    </label>
  );
}

function isDarkColor(hex: string): boolean {
  const value = hex.replace('#', '');
  if (value.length < 6) return false;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

function sessionTotalMs(session: Session): number {
  if (session.mode === 'timer') {
    return inputToMs(normalizeInput(session.input));
  }
  if (session.mode === 'alarm' && session.startedAt !== null && session.targetAt !== null) {
    return session.targetAt - session.startedAt;
  }
  return 0;
}

function mainActionLabel(state: Session['state']): string {
  if (state === 'ringing') return 'Dismiss';
  if (state === 'running') return 'Pause';
  if (state === 'paused') return 'Resume';
  return 'Start';
}

function statusText(session: Session, now: number): string {
  if (session.state === 'ringing') return 'Ringing';
  if (session.state === 'paused') return 'Paused';
  if (session.state === 'running') return session.mode === 'alarm' ? 'Alarm armed' : 'Running';
  if (session.mode === 'alarm') return `Ready for ${new Date(nextAlarmTarget(session.input, now)).toLocaleTimeString()}`;
  return 'Ready';
}
