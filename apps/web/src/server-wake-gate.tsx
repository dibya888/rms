import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * ============================================================================
 * RENDER FREE-TIER "COLD START" WAKE SCREEN — fully self-contained, easy to remove
 * ============================================================================
 * Render's free web-service plan spins the API down after ~15 minutes with no
 * traffic. The next request has to wait for the container (and the app
 * inside it) to boot back up, which can take anywhere from a few seconds to
 * roughly a minute. Without this, the first page load after a sleep either
 * hangs with no explanation or fails outright.
 *
 * This component pings the API's `GET /health` endpoint (already exists,
 * unauthenticated, checks DB connectivity too — see apps/api/src/app.controller.ts)
 * and keeps the app behind a friendly "waking up" screen until it answers.
 *
 * TO REMOVE ONCE YOU'RE ON A PLAN THAT DOESN'T SLEEP:
 *   1. Delete this file.
 *   2. In main.tsx, remove the `ServerWakeGate` import and change
 *        <ServerWakeGate><App /></ServerWakeGate>
 *      back to just
 *        <App />
 * Nothing else in the app imports from or depends on this file.
 * ============================================================================
 */

const HEALTH_URL = `${(import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'}/health`;
const PING_TIMEOUT_MS = 6_000;
const RETRY_DELAY_MS = 2_500;
const SLOW_AFTER_MS = 15_000;
const VERY_SLOW_AFTER_MS = 45_000;

// Once we've confirmed the API is awake, trust that for a while so clicking
// around the app (this is a classic multi-page app — most links are full
// browser navigations) doesn't flash this screen on every single click.
// Render's own idle-sleep window is ~15 minutes, so this stays comfortably
// under that.
const TRUST_WINDOW_MS = 10 * 60 * 1000;
const AWAKE_AT_KEY = 'rms_server_awake_at';

function recentlyConfirmedAwake(): boolean {
  const raw = sessionStorage.getItem(AWAKE_AT_KEY);
  const at = raw ? Number(raw) : NaN;
  return Number.isFinite(at) && Date.now() - at < TRUST_WINDOW_MS;
}

async function pingOnce(): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const response = await fetch(HEALTH_URL, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function ServerWakeGate({ children }: { children: ReactNode }) {
  const [awake, setAwake] = useState(() => recentlyConfirmedAwake());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (awake) return;
    let cancelled = false;
    startRef.current = Date.now();
    const clock = window.setInterval(() => { if (!cancelled) setElapsedMs(Date.now() - startRef.current); }, 1000);

    async function loop() {
      while (!cancelled) {
        const ok = await pingOnce();
        if (ok) {
          if (cancelled) return;
          sessionStorage.setItem(AWAKE_AT_KEY, String(Date.now()));
          setAwake(true);
          return;
        }
        if (cancelled) return;
        setAttempt((value) => value + 1);
        await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    void loop();

    return () => { cancelled = true; window.clearInterval(clock); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (awake) return <>{children}</>;

  const message = elapsedMs > VERY_SLOW_AFTER_MS
    ? 'Still working on it — free-tier cold starts occasionally take a bit longer than usual.'
    : elapsedMs > SLOW_AFTER_MS
      ? 'Warming things up — usually done within a minute.'
      : 'Waking up the server…';

  return (
    <div style={styles.wrap}>
      <style>{'@keyframes rms-wake-spin { to { transform: rotate(360deg); } }'}</style>
      <div style={styles.card}>
        <img src="/icon-192.png" alt="RMS" style={styles.icon} />
        <div style={styles.spinner} />
        <h1 style={styles.title}>{message}</h1>
        <p style={styles.subtitle}>{Math.floor(elapsedMs / 1000)}s elapsed{attempt > 1 ? ` · attempt ${attempt}` : ''}</p>
        <p style={styles.note}>This runs on a free hosting tier that pauses the server after a period of inactivity to save resources. It wakes up automatically — no action needed on your part.</p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#eef2ed', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '2rem' },
  card: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.9rem', maxWidth: '26rem', textAlign: 'center' },
  icon: { width: '3.2rem', height: '3.2rem', borderRadius: '8px' },
  spinner: { width: '2.1rem', height: '2.1rem', border: '3px solid #cbd6ce', borderTopColor: '#315b47', borderRadius: '50%', animation: 'rms-wake-spin 0.8s linear infinite' },
  title: { margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#20362a' },
  subtitle: { margin: 0, fontSize: '.82rem', color: '#5b6b63', fontWeight: 600 },
  note: { margin: '.4rem 0 0', fontSize: '.78rem', color: '#718078', lineHeight: 1.5 },
};
