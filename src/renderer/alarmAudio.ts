import type { Theme } from './theme';

let context: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;
let gain: GainNode | null = null;
let sweepTimer: number | null = null;
let beepPatternTimer: number | null = null;

const frequencyBySound: Record<Theme['alarmSound'], number> = {
  pulse: 660,
  beacon: 440,
  chime: 880,
  beep: 1320
};

export function startAlarmAudio(sound: Theme['alarmSound'], volume: number, muted: boolean): void {
  if (oscillator) return;

  context = new AudioContext();
  oscillator = context.createOscillator();
  gain = context.createGain();

  oscillator.type = sound === 'chime' ? 'sine' : sound === 'beep' ? 'triangle' : 'square';
  oscillator.frequency.value = frequencyBySound[sound];
  gain.gain.value = 0.0001;

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();

  const audibleVolume = muted ? 0 : Math.max(0, Math.min(1, volume));
  if (sound === 'beep') {
    let step = 0;
    const sequence = [
      { lengthMs: 92, active: true, frequency: 1568 },
      { lengthMs: 64, active: false, frequency: 1568 },
      { lengthMs: 92, active: true, frequency: 1568 },
      { lengthMs: 64, active: false, frequency: 1568 },
      { lengthMs: 92, active: true, frequency: 1396 },
      { lengthMs: 64, active: false, frequency: 1396 },
      { lengthMs: 112, active: true, frequency: 1396 },
      { lengthMs: 420, active: false, frequency: 1320 }
    ];

    const advance = () => {
      if (!gain || !context || !oscillator) return;
      const part = sequence[step];
      const now = context.currentTime;
      oscillator.frequency.cancelScheduledValues(now);
      oscillator.frequency.setTargetAtTime(part.frequency, now, 0.01);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(part.active ? audibleVolume * 0.24 : 0.0001, now, 0.006);
      step = (step + 1) % sequence.length;
      beepPatternTimer = window.setTimeout(advance, part.lengthMs);
    };

    advance();
    return;
  }

  let loud = false;
  sweepTimer = window.setInterval(() => {
    if (!gain || !context || !oscillator) return;
    loud = !loud;
    const now = context.currentTime;
    oscillator.frequency.setTargetAtTime(loud ? frequencyBySound[sound] * 1.25 : frequencyBySound[sound], now, 0.03);
    gain.gain.setTargetAtTime(loud ? audibleVolume * 0.18 : audibleVolume * 0.015, now, 0.03);
  }, 420);
}

export function stopAlarmAudio(): void {
  if (beepPatternTimer !== null) {
    window.clearTimeout(beepPatternTimer);
    beepPatternTimer = null;
  }

  if (sweepTimer !== null) {
    window.clearInterval(sweepTimer);
    sweepTimer = null;
  }

  oscillator?.stop();
  oscillator?.disconnect();
  gain?.disconnect();
  void context?.close();

  oscillator = null;
  gain = null;
  context = null;
}
