import { ChangeEvent, FormEvent, Fragment, StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
// Wakes the free-tier Render API before the app loads — see the file for
// what it does and how to remove it if you move to a non-sleeping plan.
import { ServerWakeGate } from './server-wake-gate';

type Summary = { totalUnits: number; occupiedUnits: number; availableUnits: number; thisMonthIncome: string; totalOutstanding: string; thisMonthDue: string; thisMonthOwnerRepairCost: string; thisMonthUtilityBills: string; thisMonthNetProfit: string; monthlyIncomeTrend: Array<{ month: string; income: string }>; recentPayments: Array<{ id: string; amount: string; paidOn: string; method: string }> };
const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// Currency is a display-only, per-device preference (see Settings). Nothing
// server-side is currency-aware, so we format amounts ourselves instead of
// relying on Intl's currency style, which only renders a symbol for
// currencies its "en-US" locale data recognizes (BDT/most others fall back
// to printing the bare code, e.g. "BDT 1,234").
const CURRENCIES: Array<{ code: string; symbol: string; label: string }> = [
  { code: 'USD', symbol: '$', label: 'US Dollar ($)' },
  { code: 'BDT', symbol: '৳', label: 'Bangladeshi Taka (৳)' },
  { code: 'INR', symbol: '₹', label: 'Indian Rupee (₹)' },
  { code: 'EUR', symbol: '€', label: 'Euro (€)' },
  { code: 'GBP', symbol: '£', label: 'British Pound (£)' },
  { code: 'JPY', symbol: '¥', label: 'Japanese Yen (¥)' },
  { code: 'CNY', symbol: '¥', label: 'Chinese Yuan (¥)' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar (A$)' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian Dollar (C$)' },
  { code: 'SGD', symbol: 'S$', label: 'Singapore Dollar (S$)' },
  { code: 'MYR', symbol: 'RM', label: 'Malaysian Ringgit (RM)' },
  { code: 'THB', symbol: '฿', label: 'Thai Baht (฿)' },
  { code: 'AED', symbol: 'د.إ', label: 'UAE Dirham (د.إ)' },
  { code: 'SAR', symbol: '﷼', label: 'Saudi Riyal (﷼)' },
  { code: 'PKR', symbol: '₨', label: 'Pakistani Rupee (₨)' },
  { code: 'NPR', symbol: '₨', label: 'Nepalese Rupee (₨)' },
  { code: 'LKR', symbol: 'Rs', label: 'Sri Lankan Rupee (Rs)' }
];
const CURRENCY_STORAGE_KEY = 'rms_currency';
const getCurrencyCode = () => (typeof window !== 'undefined' && localStorage.getItem(CURRENCY_STORAGE_KEY)) || 'USD';
const getCurrencySymbol = (code: string = getCurrencyCode()) => CURRENCIES.find((currency) => currency.code === code)?.symbol ?? '$';
const money = (value: string | number) => `${getCurrencySymbol()}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value))}`;

// Time format is a per-device display preference, same idea as currency:
// `toLocaleTimeString(undefined, ...)` follows the BROWSER's locale default,
// which is 24-hour in plenty of locales regardless of what the person
// actually wants to see. This makes it an explicit, overridable choice.
const TIME_FORMAT_STORAGE_KEY = 'rms_time_format';
type TimeFormat = '12h' | '24h';
const getTimeFormat = (): TimeFormat => (typeof window !== 'undefined' && localStorage.getItem(TIME_FORMAT_STORAGE_KEY) === '24h') ? '24h' : '12h';
const formatClockTime = (date: Date, format: TimeFormat = getTimeFormat()) => date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: format === '12h' });

// Spelled-out amounts ("Fifteen Thousand Five Hundred Taka Only") are a
// standard feature of printed rent receipts. Plain-English, international
// grouping (thousand/million) rather than lakh/crore, since currency here is
// a user-chosen device setting rather than tied to one country.
const CURRENCY_WORD_NAMES: Record<string, string> = { USD: 'Dollars', BDT: 'Taka', INR: 'Rupees', EUR: 'Euros', GBP: 'Pounds', JPY: 'Yen', CNY: 'Yuan', AUD: 'Dollars', CAD: 'Dollars', SGD: 'Dollars', MYR: 'Ringgit', THB: 'Baht', AED: 'Dirhams', SAR: 'Riyals', PKR: 'Rupees', NPR: 'Rupees', LKR: 'Rupees' };
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function integerToWords(value: number): string {
  if (value === 0) return 'Zero';
  function chunk(n: number): string {
    let words = '';
    if (n >= 100) { words += `${ONES[Math.floor(n / 100)]} Hundred`; n %= 100; if (n) words += ' '; }
    if (n >= 20) { words += TENS[Math.floor(n / 10)]; if (n % 10) words += `-${ONES[n % 10]}`; }
    else if (n > 0) { words += ONES[n]; }
    return words;
  }
  const scales: Array<[number, string]> = [[1_000_000_000, 'Billion'], [1_000_000, 'Million'], [1_000, 'Thousand'], [1, '']];
  let remaining = Math.floor(value); const parts: string[] = [];
  for (const [scale, label] of scales) { if (remaining >= scale) { const count = Math.floor(remaining / scale); parts.push(label ? `${chunk(count)} ${label}` : chunk(count)); remaining %= scale; } }
  return parts.join(' ');
}
function amountInWords(amount: number, currencyCode: string = getCurrencyCode()): string {
  const currencyName = CURRENCY_WORD_NAMES[currencyCode] ?? currencyCode;
  const whole = Math.floor(Math.abs(amount));
  const fraction = Math.round((Math.abs(amount) - whole) * 100);
  const words = `${integerToWords(whole)} ${currencyName}`;
  return fraction > 0 ? `${words} and ${fraction}/100 Only` : `${words} Only`;
}

// Single source of truth for the top navigation so every page shows the
// same links in the same order, instead of each page hand-rolling its own
// (previously inconsistent) subset.
const NAV_ITEMS: Array<{ key: string; label: string; href: string }> = [
  { key: 'dashboard', label: 'Dashboard', href: '/' },
  { key: 'properties', label: 'Properties', href: '/properties' },
  { key: 'units', label: 'Units', href: '/units/manage' },
  { key: 'tenants', label: 'Tenants', href: '/tenants' },
  { key: 'payments', label: 'Payments', href: '/payments' },
  { key: 'reports', label: 'Reports', href: '/reports' },
  { key: 'repairs', label: 'Repairs', href: '/repairs' },
];

const ACCESS_TOKEN_STORAGE_KEY = 'rms_access_token';

// The API issues 15-minute access tokens backed by a 7-day refresh cookie
// (see apps/api/src/auth/auth.service.ts: ACCESS_TTL / REFRESH_DAYS). Nothing
// used to call POST /auth/refresh from the browser, so every open tab hit a
// hard "session expired" wall after 15 minutes even though the refresh
// cookie was still good for a week. This silently exchanges it for a new
// access token; callers decide what to do with a null result (no valid
// refresh cookie left, e.g. after 7 days or a manual logout elsewhere).
async function refreshAccessToken(): Promise<string | null> {
  try {
    const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' });
    if (!csrfResponse.ok) return null;
    const { csrfToken } = await csrfResponse.json();
    const response = await fetch(`${apiUrl}/auth/refresh`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, credentials: 'include' });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body.accessToken === 'string' ? body.accessToken : null;
  } catch {
    return null;
  }
}

function TopNav({ active }: { active: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [active]);
  return <>
    <button className="nav-toggle" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? '✕' : '☰'}</button>
    <nav className={open ? 'open' : undefined}>{NAV_ITEMS.map((item) => <a key={item.key} className={item.key === active ? 'active' : undefined} href={item.href}>{item.label}</a>)}</nav>
  </>;
}

// Shared top-right account menu (Profile / Settings / Logout) so every page
// offers the same three actions from one place instead of loose header
// buttons. Pass onSignOut only where a caller already tracks auth state in
// memory (the Dashboard); everywhere else this does the same CSRF-protected
// logout call itself before clearing the token and redirecting.
function AccountMenu({ onSignOut }: { onSignOut?: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; const close = () => setOpen(false); window.addEventListener('click', close); return () => window.removeEventListener('click', close); }, [open]);
  async function signOut() {
    if (onSignOut) { onSignOut(); return; }
    try {
      const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' });
      const { csrfToken } = await csrfResponse.json();
      await fetch(`${apiUrl}/auth/logout`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, credentials: 'include' });
    } finally {
      localStorage.removeItem('rms_access_token');
      window.location.href = '/';
    }
  }
  return <div className="account-menu" onClick={(event) => event.stopPropagation()}>
    <button type="button" className="account-menu-trigger" aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>⋮</button>
    {open && <div className="account-menu-panel" role="menu">
      <a className="account-menu-item" href="/profile" role="menuitem">Profile</a>
      <a className="account-menu-item" href="/settings" role="menuitem">Settings</a>
      <button type="button" className="account-menu-item account-menu-danger" role="menuitem" onClick={signOut}>Logout</button>
    </div>}
  </div>;
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [firstName, setFirstName] = useState('');
  const [error, setError] = useState('');

  // Keep the access token alive in the background: refresh a few minutes
  // before its 15-minute expiry, and again whenever the tab regains focus
  // (covers a laptop sleeping through the timer). Updating `token` here
  // flows down as a prop to whatever page is mounted, and every page's own
  // data-loading effect already depends on `[token]`, so this refresh alone
  // is enough to keep an open tab working all day without a re-login.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function silentRefresh() {
      const next = await refreshAccessToken();
      if (cancelled || !next) return;
      localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, next);
      setToken(next);
    }
    const interval = window.setInterval(silentRefresh, 10 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') void silentRefresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function load(withToken: string, alreadyRetried: boolean): Promise<void> {
      const [summaryResponse, meResponse] = await Promise.all([fetch(`${apiUrl}/dashboard/summary`, { headers: { Authorization: `Bearer ${withToken}` } }), fetch(`${apiUrl}/auth/me`, { headers: { Authorization: `Bearer ${withToken}` } })]);
      if (summaryResponse.status === 401 && meResponse.status === 401 && !alreadyRetried) {
        // The 15-minute access token had already expired before the silent
        // refresh timer got to it (e.g. the tab was backgrounded). Try once
        // to refresh and retry before treating this as a real sign-out.
        const refreshed = await refreshAccessToken();
        if (refreshed && !cancelled) {
          localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, refreshed);
          setToken(refreshed);
          return load(refreshed, true);
        }
      }
      if (!summaryResponse.ok || !meResponse.ok) throw new Error('Your session may have expired.');
      const [nextSummary, me] = await Promise.all([summaryResponse.json() as Promise<Summary>, meResponse.json() as Promise<{ user: { firstName?: string } }>]);
      if (cancelled) return;
      setSummary(nextSummary);
      setFirstName(me.user.firstName ?? '');
    }
    load(token, false).catch((reason: Error) => { if (cancelled) return; setError(reason.message); setToken(null); localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY); });
    return () => { cancelled = true; };
  }, [token]);

  if (!token) return window.location.pathname === '/register' ? <Register /> : window.location.pathname === '/activate' ? <Activate /> : window.location.pathname === '/forgot-password' ? <ForgotPassword /> : window.location.pathname === '/reset-password' ? <ResetPassword /> : <Login error={error} onLogin={(next) => { localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, next); setToken(next); setError(''); }} />;
  if (window.location.pathname === '/properties/new') return <AddProperty token={token} />;
  if (window.location.pathname === '/units/new') return <AddUnit token={token} />;
  if (window.location.pathname === '/units/manage') return <ManageUnits token={token} />;
  if (window.location.pathname === '/properties') return <Properties token={token} />;
  if (window.location.pathname === '/properties/manage') return <ManageProperties token={token} />;
  if (window.location.pathname === '/tenants') return <Tenants token={token} />;
  if (window.location.pathname === '/tenants/new') return <AddTenant token={token} />;
  if (window.location.pathname === '/tenants/move-out') return <MoveOut token={token} />;
  if (window.location.pathname === '/tenants/settle') return <SettleTenant token={token} />;
  if (window.location.pathname === '/payments') return <Payments token={token} />;
  if (window.location.pathname === '/billing/defaults') return <BillingDefaults token={token} />;
  if (window.location.pathname === '/billing/generate') return <GenerateBills token={token} />;
  if (window.location.pathname === '/payments/record') return <RecordPayment token={token} />;
  if (window.location.pathname === '/reports') return <Reports token={token} />;
  if (window.location.pathname === '/repairs') return <Repairs token={token} />;
  if (window.location.pathname === '/repairs/manage') return <ManageRepairs token={token} />;
  if (window.location.pathname === '/repairs/new') return <AddRepair token={token} />;
  if (window.location.pathname === '/admin') return <Admin token={token} />;
  if (window.location.pathname === '/profile') return <Profile token={token} />;
  if (window.location.pathname === '/settings') return <Settings token={token} />;
  if (!summary) return <main className="loading-screen"><span className="status-dot" /> Loading portfolio</main>;
  return <><ThemeToggle token={token} /><Dashboard summary={summary} firstName={firstName} onSignOut={async () => { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); await fetch(`${apiUrl}/auth/logout`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, credentials: 'include' }); localStorage.removeItem('rms_access_token'); setToken(null); setSummary(null); }} /></>;
}

function ThemeToggle({ token }: { token: string }) {
  const [theme, setTheme] = useState<'LIGHT' | 'DARK'>('LIGHT');
  useEffect(() => { fetch(`${apiUrl}/auth/preferences`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((preferences) => { setTheme(preferences.themePreference); document.documentElement.dataset.theme = preferences.themePreference.toLowerCase(); }); }, [token]);
  async function toggle() { const next = theme === 'LIGHT' ? 'DARK' : 'LIGHT'; const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); await fetch(`${apiUrl}/auth/preferences`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ theme: next }) }); setTheme(next); document.documentElement.dataset.theme = next.toLowerCase(); }
  return <button className="theme-toggle" onClick={toggle} title="Toggle theme" aria-label="Toggle theme">{theme === 'LIGHT' ? '☾' : '☀'}</button>;
}

function Login({ error, onLogin }: { error: string; onLogin: (token: string) => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(error); const [needsVerification, setNeedsVerification] = useState(false); const [resending, setResending] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); setNeedsVerification(false); try { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const response = await fetch(`${apiUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ email, password }) }); const body = await response.json(); if (!response.ok) { if (typeof body.message === 'string' && body.message.includes('verification')) setNeedsVerification(true); throw new Error(body.message ?? 'Unable to sign in.'); } onLogin(body.accessToken); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to sign in.'); } finally { setBusy(false); } }
  async function resendVerification() { setResending(true); try { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); await fetch(`${apiUrl}/auth/resend-activation`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ email }) }); setMessage('If that account needs verification, a new link is on its way to your email.'); } finally { setResending(false); } }
  return <main className="auth-shell"><section className="auth-intro"><p className="eyebrow">RMS / OWNER CONSOLE</p><h1>Know what is happening across every door.</h1><p className="lede">A calm operating view for properties, tenants, payments, and the small details that keep rent on time.</p><div className="signal"><span className="status-dot" /> Portfolio systems ready</div></section><form className="auth-card" onSubmit={submit}><p className="card-kicker">Welcome back</p><h2>Log in</h2><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></label>{message && <p className="error">{message}</p>}{needsVerification && <button type="button" className="quiet-button" disabled={resending} onClick={resendVerification}>{resending ? 'Sending...' : 'Resend verification email'}</button>}<button className="primary-button" disabled={busy}>{busy ? 'Logging in...' : 'Log in'} <span>↗</span></button><p className="form-note"><a href="/forgot-password">Forgot password?</a> · <a href="/register">Sign up</a></p></form></main>;
}

function Register() {
  const [fields, setFields] = useState({ firstName: '', middleName: '', lastName: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); try { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const response = await fetch(`${apiUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify(fields) }); const body = await response.json(); if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to register.'); setMessage('Registration complete. Check your email to activate your account before logging in.'); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to register.'); } finally { setBusy(false); } }
  const update = (key: keyof typeof fields) => (event: ChangeEvent<HTMLInputElement>) => setFields({ ...fields, [key]: event.target.value });
  return <main className="auth-shell"><section className="auth-intro"><p className="eyebrow">RMS / OWNER CONSOLE</p><h1>Make the whole portfolio easier to hold.</h1><p className="lede">Create an owner workspace for properties, tenants, payments, and monthly reporting.</p></section><form className="auth-card" onSubmit={submit}><p className="card-kicker">New account</p><h2>Sign up</h2><div className="name-fields"><label>First name<input value={fields.firstName} onChange={update('firstName')} required autoComplete="given-name" /></label><label>Middle name <span className="optional">optional</span><input value={fields.middleName} onChange={update('middleName')} autoComplete="additional-name" /></label><label>Last name<input value={fields.lastName} onChange={update('lastName')} required autoComplete="family-name" /></label></div><label>Email<input type="email" value={fields.email} onChange={update('email')} required autoComplete="email" /></label><label>Phone<input value={fields.phone} onChange={update('phone')} required autoComplete="tel" /></label><label>Password<input type="password" value={fields.password} onChange={update('password')} minLength={10} required autoComplete="new-password" /></label><label>Confirm password<input type="password" value={fields.confirmPassword} onChange={update('confirmPassword')} minLength={10} required autoComplete="new-password" /></label>{message && <p className="form-note" role="status">{message}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Registering...' : 'Sign up'} <span>↗</span></button><p className="form-note">Already registered? <a href="/">Log in</a></p></form></main>;
}

function Activate() {
  const [message, setMessage] = useState('Activating your account...');
  useEffect(() => { const token = new URLSearchParams(window.location.search).get('token'); if (!token) { setMessage('This activation link is missing its token.'); return; } fetch(`${apiUrl}/auth/activate?token=${encodeURIComponent(token)}`).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'This activation link is invalid or expired.'); setMessage('Your account is active. You can log in now.'); }).catch((reason: Error) => setMessage(reason.message)); }, []);
  return <main className="auth-shell"><section className="auth-intro"><p className="eyebrow">RMS / ACCOUNT</p><h1>Your account, ready.</h1><p className="lede">Email activation keeps your workspace protected from unverified addresses.</p></section><section className="auth-card"><p className="card-kicker">Email activation</p><h2>Account status</h2><p className="form-note" role="status">{message}</p><p className="form-note"><a href="/">Log in</a></p></section></main>;
}

function ForgotPassword() {
  const [email, setEmail] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); try { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const response = await fetch(`${apiUrl}/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ email }) }); if (!response.ok) throw new Error('Unable to send the recovery request.'); setMessage('If that address exists, recovery instructions have been sent.'); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to send the recovery request.'); } finally { setBusy(false); } }
  return <main className="auth-shell"><section className="auth-intro"><p className="eyebrow">RMS / OWNER CONSOLE</p><h1>A quiet way back into your workspace.</h1><p className="lede">Request a single-use recovery link for your owner account.</p></section><form className="auth-card" onSubmit={submit}><p className="card-kicker">Account recovery</p><h2>Forgot password?</h2><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>{message && <p className="form-note" role="status">{message}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Sending request...' : 'Request recovery'} <span>↗</span></button><p className="form-note"><a href="/">Return to sign in.</a></p></form></main>;
}

function ResetPassword() {
  const [password, setPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); try { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const response = await fetch(`${apiUrl}/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ token, password, confirmPassword }) }); const body = await response.json(); if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to reset password.'); setMessage('Password reset. You can sign in now.'); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to reset password.'); } finally { setBusy(false); } }
  return <main className="auth-shell"><section className="auth-intro"><p className="eyebrow">RMS / OWNER CONSOLE</p><h1>Choose a stronger way forward.</h1><p className="lede">Your recovery token can be used once and expires automatically.</p></section><form className="auth-card" onSubmit={submit}><p className="card-kicker">Account recovery</p><h2>Reset password</h2><label>New password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} required autoComplete="new-password" /></label><label>Confirm password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={10} required autoComplete="new-password" /></label>{message && <p className="form-note" role="status">{message}</p>}<button className="primary-button" disabled={busy || !token}>{busy ? 'Updating password...' : 'Update password'} <span>↗</span></button><p className="form-note"><a href="/">Return to sign in.</a></p></form></main>;
}

function AddProperty({ token }: { token: string }) {
  const [fields, setFields] = useState({ name: '', address: '', phone: '', propertyType: 'RESIDENTIAL' }); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); try { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const response = await fetch(`${apiUrl}/portfolio/properties`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify(fields) }); const body = await response.json(); if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to add property.'); window.location.href = '/'; } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to add property.'); } finally { setBusy(false); } }
  const update = (key: keyof typeof fields) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFields({ ...fields, [key]: event.target.value });
  return <main className="auth-shell"><section className="auth-intro"><p className="eyebrow">RMS / PORTFOLIO</p><h1>Give the place a name.</h1><p className="lede">Start with the property basics. Units and tenants can be added next.</p></section><form className="auth-card" onSubmit={submit}><p className="card-kicker">New property</p><h2>Add property</h2><label>Name<input value={fields.name} onChange={update('name')} required /></label><label>Address<input value={fields.address} onChange={update('address')} required /></label><label>Phone<input value={fields.phone} onChange={update('phone')} required /></label><label>Property type<select value={fields.propertyType} onChange={update('propertyType')}><option value="RESIDENTIAL">Residential</option><option value="COMMERCIAL">Commercial</option></select></label>{message && <p className="error">{message}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Adding property...' : 'Add property'} <span>↗</span></button><p className="form-note"><a href="/">Return to dashboard.</a></p></form></main>;
}

function AddUnit({ token }: { token: string }) {
  const [properties, setProperties] = useState<Array<{ id: string; name: string }>>([]);
  const [fields, setFields] = useState({
    propertyId: '',
    unitNo: '',
    unitType: 'FLAT',
    rent: '',
    bedrooms: '1',
    bathrooms: '1',
    livingRooms: '1',
    diningRooms: '1',
    kitchens: '1',
    balconies: '0',
    floor: '',
    frontageSqft: '',
    category: ''
  });
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { fetch(`${apiUrl}/portfolio/properties`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { if (!response.ok) throw new Error('Unable to load properties.'); return response.json(); }).then(setProperties).catch((error: Error) => setMessage(error.message)); }, [token]);
  const update = (key: keyof typeof fields) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFields({ ...fields, [key]: event.target.value });
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); 
    const unitAttributes = fields.unitType === 'FLAT'
    ? {
        bedrooms: Number(fields.bedrooms),
        bathrooms: Number(fields.bathrooms),
        livingRooms: Number(fields.livingRooms),
        diningRooms: Number(fields.diningRooms),
        kitchens: Number(fields.kitchens),
        balconies: Number(fields.balconies),
      }
    : {
        floor: fields.floor,
        frontageSqft: Number(fields.frontageSqft),
        category: fields.category,
      };
    try { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const response = await fetch(`${apiUrl}/portfolio/properties/${fields.propertyId}/units`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ unitNo: fields.unitNo, unitType: fields.unitType, rent: Number(fields.rent), unitAttributes }) }); const body = await response.json(); if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to add unit.'); window.location.href = '/properties'; } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to add unit.'); } finally { setBusy(false); } }
  return <main className="auth-shell"><section className="auth-intro"><p className="eyebrow">RMS / PORTFOLIO</p><h1>Give every door a clear identity.</h1><p className="lede">Create a residential or commercial unit with the attributes needed for accurate occupancy and billing.</p></section><form className="auth-card" onSubmit={submit}><p className="card-kicker">New unit</p><h2>Add unit</h2><label>Property<select value={fields.propertyId} onChange={update('propertyId')} required><option value="">Choose a property</option>{properties.map((property) => <option value={property.id} key={property.id}>{property.name}</option>)}</select></label><label>Unit number<input value={fields.unitNo} onChange={update('unitNo')} required /></label><label>Unit type<select value={fields.unitType} onChange={update('unitType')}><option value="FLAT">Flat</option><option value="SHOP">Shop</option></select></label><label>Monthly rent<input type="number" min="0" step="0.01" value={fields.rent} onChange={update('rent')} required /></label>{fields.unitType === 'FLAT' ? <><label>Bedrooms<input type="number" min="0" value={fields.bedrooms} onChange={update('bedrooms')} required /></label><label>Bathrooms<input type="number" min="0" value={fields.bathrooms} onChange={update('bathrooms')} required /></label><label>Living rooms<input type="number" min="0" value={fields.livingRooms} onChange={update('livingRooms')} required /></label><label>Dining rooms<input type="number" min="0" value={fields.diningRooms} onChange={update('diningRooms')} required /></label><label>Kitchens<input type="number" min="0" value={fields.kitchens} onChange={update('kitchens')} required /></label><label>Balconies<input type="number" min="0" value={fields.balconies} onChange={update('balconies')} required /></label></> : <><label>Floor<input value={fields.floor} onChange={update('floor')} required /></label><label>Frontage square feet<input type="number" min="0" value={fields.frontageSqft} onChange={update('frontageSqft')} required /></label><label>Category<input value={fields.category} onChange={update('category')} required /></label></>}{message && <p className="error">{message}</p>}<button className="primary-button" disabled={busy || !properties.length}>{busy ? 'Adding unit...' : 'Add unit'} <span>↗</span></button><p className="form-note"><a href="/properties">Return to properties.</a></p></form></main>;
}

function ManageProperties({ token }: { token: string }) {
  const [properties, setProperties] = useState<Array<{ id: string; name: string; address: string; phone: string; propertyType: string; units: Array<{ id: string; unitNo: string; status: string }> }>>([]);
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState('');
  const load = () => fetch(`${apiUrl}/portfolio/properties`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { if (!response.ok) throw new Error('Unable to load properties.'); return response.json(); }).then(setProperties).catch((error: Error) => setMessage(error.message));
  useEffect(() => { void load(); }, [token]);
  async function save(property: typeof properties[number], event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(property.id); setMessage(''); const data = new FormData(event.currentTarget); try { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const response = await fetch(`${apiUrl}/portfolio/properties/${property.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ name: data.get('name'), address: data.get('address'), phone: data.get('phone') }) }); const body = await response.json(); if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to update property.'); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update property.'); } finally { setBusy(''); } }
  async function remove(property: typeof properties[number]) { if (!window.confirm(`Delete ${property.name}?`)) return; setBusy(property.id); setMessage(''); try { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const response = await fetch(`${apiUrl}/portfolio/properties/${property.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include' }); const body = await response.json(); if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to delete property.'); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to delete property.'); } finally { setBusy(''); } }
  return <main className="app-shell"><header className="topbar"><div className="brand"><img className="brand-mark" src="/icon-192.png" alt="RMS" /><span>RMS</span></div><TopNav active="properties" /><a className="quiet-button" href="/properties">Back</a><AccountMenu /></header><div className="content"><section className="welcome-row"><div><p className="eyebrow">RMS / PORTFOLIO</p><h1>Manage properties.</h1><p className="subtle">Update property details or archive an empty property.</p></div><a className="primary-button compact" href="/properties/new">+ Add property</a></section>{message && <p className="error">{message}</p>}<section className="tenant-list">{properties.map((property) => <form className="dashboard-card" key={property.id} onSubmit={(event) => save(property, event)}><p className="card-kicker">{property.propertyType} · {property.units.length} units</p><label>Name<input name="name" defaultValue={property.name} required /></label><label>Address<input name="address" defaultValue={property.address} required /></label><label>Phone<input name="phone" defaultValue={property.phone} required /></label><div className="report-actions"><button className="primary-button" disabled={busy === property.id}>{busy === property.id ? 'Saving...' : 'Save changes'}</button><button type="button" className="quiet-button export-button" onClick={() => remove(property)} disabled={busy === property.id}>Delete property</button></div></form>)}{!properties.length && !message && <p className="empty-state">No properties yet.</p>}</section></div></main>;
}

function ManageUnits({ token }: { token: string }) {
  type Unit = {
    id: string;
    unitNo: string;
    rent: string;
    status: string;
    unitType?: string;
    unitAttributes?: Record<string, unknown> | null;
    property: { name: string };
  };

  const [units, setUnits] = useState<Unit[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [editingId, setEditingId] = useState('');

  const load = () =>
    fetch(`${apiUrl}/portfolio/properties`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load units.');
        return response.json();
      })
      .then(
        (
          properties: Array<{
            name: string;
            units: Array<{
              id: string;
              unitNo: string;
              rent: string;
              status: string;
              unitType?: string;
              unitAttributes?: Record<string, unknown> | null;
            }>;
          }>
        ) => {
          setUnits(
            properties.flatMap((property) =>
              property.units.map((unit) => ({
                ...unit,
                property: { name: property.name },
              }))
            )
          );
        }
      )
      .catch((error: Error) => setMessage(error.message));

  useEffect(() => {
    void load();
  }, [token]);

  async function save(unit: Unit, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(unit.id);
    setMessage('');

    const data = new FormData(event.currentTarget);

    try {
      const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, {
        credentials: 'include',
      });

      const { csrfToken } = await csrfResponse.json();

      const response = await fetch(
        `${apiUrl}/portfolio/units/${unit.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify({
            unitNo: data.get('unitNo'),
            rent: Number(data.get('rent')),
            status: data.get('status'),
          }),
        }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          Array.isArray(body.message)
            ? body.message.join(', ')
            : body.message ?? 'Unable to update unit.'
        );
      }

      setEditingId('');
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to update unit.'
      );
    } finally {
      setBusy('');
    }
  }

  async function remove(unit: Unit) {
    if (
      !window.confirm(
        `Delete ${unit.property.name} / ${unit.unitNo}?\n\nThis will remove the unit from your active portfolio.`
      )
    ) {
      return;
    }

    setBusy(unit.id);
    setMessage('');

    try {
      const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, {
        credentials: 'include',
      });

      const { csrfToken } = await csrfResponse.json();

      const response = await fetch(
        `${apiUrl}/portfolio/units/${unit.id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
        }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          Array.isArray(body.message)
            ? body.message.join(', ')
            : body.message ?? 'Unable to delete unit.'
        );
      }

      if (expandedId === unit.id) setExpandedId('');
      if (editingId === unit.id) setEditingId('');

      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to delete unit.'
      );
    } finally {
      setBusy('');
    }
  }

  const properties = Array.from(
    new Set(units.map((unit) => unit.property.name))
  ).sort();

  const filteredUnits = units.filter((unit) => {
    const query = search.trim().toLowerCase();

    const matchesSearch =
      !query ||
      unit.unitNo.toLowerCase().includes(query) ||
      unit.property.name.toLowerCase().includes(query);

    const matchesProperty =
      !propertyFilter || unit.property.name === propertyFilter;

    const matchesType =
      !typeFilter || unit.unitType === typeFilter;

    const matchesStatus =
      !statusFilter || unit.status === statusFilter;

    return (
      matchesSearch &&
      matchesProperty &&
      matchesType &&
      matchesStatus
    );
  });

  const totalUnits = units.length;
  const availableUnits = units.filter(
    (unit) => unit.status === 'AVAILABLE'
  ).length;
  const occupiedUnits = units.filter(
    (unit) => unit.status === 'OCCUPIED'
  ).length;
  const flatUnits = units.filter(
    (unit) => unit.unitType === 'FLAT'
  ).length;
  const shopUnits = units.filter(
    (unit) => unit.unitType === 'SHOP'
  ).length;

  function getDetails(unit: Unit) {
    const attributes = unit.unitAttributes ?? {};

    if (unit.unitType === 'SHOP') {
      const floor =
        typeof attributes.floor === 'string'
          ? attributes.floor
          : '';

      const frontage =
        typeof attributes.frontageSqft === 'number'
          ? `${attributes.frontageSqft} sqft`
          : '';

      const category =
        typeof attributes.category === 'string'
          ? attributes.category
          : '';

      return [floor, frontage, category].filter(Boolean).join(' · ') || 'Shop';
    }

    const bedrooms =
      typeof attributes.bedrooms === 'number'
        ? `${attributes.bedrooms} Bed`
        : '';

    const bathrooms =
      typeof attributes.bathrooms === 'number'
        ? `${attributes.bathrooms} Bath`
        : '';

    const livingRooms =
      typeof attributes.livingRooms === 'number'
        ? `${attributes.livingRooms} Living`
        : '';

    const diningRooms =
      typeof attributes.diningRooms === 'number'
        ? `${attributes.diningRooms} Dining`
        : '';

    const kitchens =
      typeof attributes.kitchens === 'number'
        ? `${attributes.kitchens} Kitchen`
        : '';

    const balconies =
      typeof attributes.balconies === 'number'
        ? `${attributes.balconies} Balcony`
        : '';

    return [
      bedrooms,
      bathrooms,
      livingRooms,
      diningRooms,
      kitchens,
      balconies,
    ]
      .filter(Boolean)
      .join(' · ') || 'Flat';
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/icon-192.png" alt="RMS" />
          <span>RMS</span>
        </div>

        <TopNav active="units" />

        <a className="quiet-button" href="/properties">
          Back
        </a>

        <AccountMenu />
      </header>

      <div className="content">
        <section className="welcome-row">
          <div>
            <p className="eyebrow">RMS / UNITS</p>
            <h1>Manage units.</h1>
            <p className="subtle">
              Manage flats, shops, rent and occupancy from one place.
            </p>
          </div>

          <a className="primary-button compact" href="/units/new">
            + Add unit
          </a>
        </section>

        {message && <p className="error">{message}</p>}

        <section className="metric-grid">
          <Metric label="Total units" value={totalUnits} />
          <Metric label="Available" value={availableUnits} />
          <Metric label="Occupied" value={occupiedUnits} />
          <Metric label="Flats" value={flatUnits} />
          <Metric label="Shops" value={shopUnits} />
        </section>

        <section className="dashboard-card unit-toolbar">
          <div className="unit-search">
            <label>
              Search
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search unit or property..."
              />
            </label>
          </div>

          <label>
            Property
            <select
              value={propertyFilter}
              onChange={(event) => setPropertyFilter(event.target.value)}
            >
              <option value="">All properties</option>
              {properties.map((property) => (
                <option value={property} key={property}>
                  {property}
                </option>
              ))}
            </select>
          </label>

          <label>
            Type
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
            >
              <option value="">All types</option>
              <option value="FLAT">Flat</option>
              <option value="SHOP">Shop</option>
            </select>
          </label>

          <label>
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="AVAILABLE">Available</option>
              <option value="OCCUPIED">Occupied</option>
            </select>
          </label>
        </section>

        <section className="dashboard-card unit-table-card">
          <div className="section-heading">
            <div>
              <p className="card-kicker">Portfolio units</p>
              <h2>
                {filteredUnits.length} unit
                {filteredUnits.length === 1 ? '' : 's'}
              </h2>
            </div>
          </div>

          {filteredUnits.length > 0 ? (
            <div className="unit-table-wrap">
              <table className="unit-table">
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Property</th>
                    <th>Type</th>
                    <th>Details</th>
                    <th>Monthly rent</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredUnits.map((unit) => (
                    <Fragment key={unit.id}>
                      <tr>
                        <td>
                          <strong>{unit.unitNo}</strong>
                        </td>

                        <td>{unit.property.name}</td>

                        <td>
                          <span className="unit-type-badge">
                            {unit.unitType === 'SHOP'
                              ? 'Shop'
                              : 'Flat'}
                          </span>
                        </td>

                        <td className="unit-details">
                          {getDetails(unit)}
                        </td>

                        <td>
                          <strong>
                            {money(Number(unit.rent))}
                          </strong>
                        </td>

                        <td>
                          <span
                            className={`status-badge ${
                              unit.status === 'OCCUPIED'
                                ? 'status-occupied'
                                : 'status-available'
                            }`}
                          >
                            <span className="status-dot" />
                            {unit.status === 'OCCUPIED'
                              ? 'Occupied'
                              : 'Available'}
                          </span>
                        </td>

                        <td>
                          <div className="unit-actions">
                            <button
                              type="button"
                              className="quiet-button export-button"
                              onClick={() =>
                                setExpandedId(
                                  expandedId === unit.id
                                    ? ''
                                    : unit.id
                                )
                              }
                            >
                              {expandedId === unit.id
                                ? 'Hide'
                                : 'View'}
                            </button>

                            <button
                              type="button"
                              className="quiet-button export-button"
                              onClick={() => {
                                setEditingId(
                                  editingId === unit.id
                                    ? ''
                                    : unit.id
                                );
                                setExpandedId('');
                              }}
                            >
                              {editingId === unit.id
                                ? 'Cancel'
                                : 'Edit'}
                            </button>

                            <button
                              type="button"
                              className="danger-button"
                              onClick={() => remove(unit)}
                              disabled={busy === unit.id}
                            >
                              {busy === unit.id
                                ? 'Deleting...'
                                : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {expandedId === unit.id && (
                        <tr className="unit-expanded-row">
                          <td colSpan={7}>
                            <div className="unit-detail-panel">
                              <div>
                                <span className="eyebrow">
                                  UNIT DETAILS
                                </span>
                                <h3>
                                  {unit.property.name} · {unit.unitNo}
                                </h3>
                              </div>

                              <div className="unit-detail-grid">
                                <div>
                                  <span>Unit type</span>
                                  <strong>
                                    {unit.unitType === 'SHOP'
                                      ? 'Shop'
                                      : 'Flat'}
                                  </strong>
                                </div>

                                <div>
                                  <span>Monthly rent</span>
                                  <strong>
                                    {money(Number(unit.rent))}
                                  </strong>
                                </div>

                                <div>
                                  <span>Status</span>
                                  <strong>
                                    {unit.status === 'OCCUPIED'
                                      ? 'Occupied'
                                      : 'Available'}
                                  </strong>
                                </div>

                                <div>
                                  <span>Configuration</span>
                                  <strong>
                                    {getDetails(unit)}
                                  </strong>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                      {editingId === unit.id && (
                        <tr className="unit-edit-row">
                          <td colSpan={7}>
                            <form
                              className="unit-edit-form"
                              onSubmit={(event) =>
                                save(unit, event)
                              }
                            >
                              <div>
                                <label>
                                  Unit number
                                  <input
                                    name="unitNo"
                                    defaultValue={unit.unitNo}
                                    required
                                  />
                                </label>
                              </div>

                              <div>
                                <label>
                                  Monthly rent
                                  <input
                                    name="rent"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    defaultValue={unit.rent}
                                    required
                                  />
                                </label>
                              </div>

                              <div>
                                <label>
                                  Status
                                  <select
                                    name="status"
                                    defaultValue={unit.status}
                                  >
                                    <option value="AVAILABLE">
                                      Available
                                    </option>
                                    <option value="OCCUPIED">
                                      Occupied
                                    </option>
                                  </select>
                                </label>
                              </div>

                              <div className="unit-edit-submit">
                                <button
                                  className="primary-button"
                                  disabled={busy === unit.id}
                                >
                                  {busy === unit.id
                                    ? 'Saving...'
                                    : 'Save changes'}
                                </button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              {units.length
                ? 'No units match the selected filters.'
                : 'No units yet.'}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Properties({ token }: { token: string }) {
  const [properties, setProperties] = useState<Array<{ id: string; name: string; address: string; propertyType: string; units: Array<{ id: string; unitNo: string; status: string }> }>>([]); const [message, setMessage] = useState('');
  useEffect(() => { fetch(`${apiUrl}/portfolio/properties`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { if (!response.ok) throw new Error('Unable to load properties.'); return response.json(); }).then(setProperties).catch((reason: Error) => setMessage(reason.message)); }, [token]);
  return <main className="app-shell"><header className="topbar"><div className="brand"><img className="brand-mark" src="/icon-192.png" alt="RMS" /><span>RMS</span></div><TopNav active="properties" /><a className="quiet-button" href="/properties/manage">Manage properties</a><a className="primary-button compact" href="/properties/new">+ Add property</a><AccountMenu /></header><div className="content"><section className="welcome-row"><div><p className="eyebrow">RMS / PORTFOLIO</p><h1>Properties.</h1><p className="subtle">Your owner-scoped buildings and their current units.</p></div></section>{message && <p className="error">{message}</p>}<section className="property-grid">{properties.map((property) => <article className="dashboard-card" key={property.id}><p className="card-kicker">{property.propertyType}</p><h2>{property.name}</h2><p className="subtle">{property.address}</p><div className="property-meta"><strong>{property.units.length}</strong><span>units</span><span>{property.units.filter((unit) => unit.status === 'OCCUPIED').length} occupied</span></div><div className="report-actions"><a className="quiet-button export-button" href="/units/manage">Manage Units</a><a className="primary-button" href="/units/new">+ Add Unit</a></div></article>)}{!properties.length && !message && <p className="empty-state">No properties yet. Add your first one to begin.</p>}</section></div></main>;
}

function Tenants({ token }: { token: string }) {
  const [tenants, setTenants] = useState<Array<{ id: string; name: string; phone: string; status: string; unit?: { unitNo: string; property?: { name: string } } }>>([]); const [message, setMessage] = useState(''); const [tab, setTab] = useState<'PRESENT' | 'PAST'>('PRESENT');
  useEffect(() => { fetch(`${apiUrl}/tenants`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { if (!response.ok) throw new Error('Unable to load tenants.'); return response.json(); }).then(setTenants).catch((reason: Error) => setMessage(reason.message)); }, [token]);
  const presentTenants = tenants.filter((tenant) => tenant.status === 'ACTIVE');
  const pastTenants = tenants.filter((tenant) => tenant.status !== 'ACTIVE');
  const visibleTenants = tab === 'PRESENT' ? presentTenants : pastTenants;
  return <main className="app-shell"><header className="topbar"><div className="brand"><img className="brand-mark" src="/icon-192.png" alt="RMS" /><span>RMS</span></div><TopNav active="tenants" /><AccountMenu /></header><div className="content"><section className="welcome-row"><div><p className="eyebrow">RMS / PEOPLE</p><h1>Tenants.</h1><p className="subtle">Active and past tenants across your owner account.</p></div><a className="primary-button compact" href="/tenants/new">+ Add tenant</a></section>{message && <p className="error">{message}</p>}<div className="tab-bar"><button type="button" className={tab === 'PRESENT' ? 'tab active' : 'tab'} onClick={() => setTab('PRESENT')}>Present ({presentTenants.length})</button><button type="button" className={tab === 'PAST' ? 'tab active' : 'tab'} onClick={() => setTab('PAST')}>Past / moved out ({pastTenants.length})</button></div><section className="tenant-list">{visibleTenants.map((tenant) => <article className="dashboard-card tenant-row" key={tenant.id}><div className="avatar">{tenant.name.slice(0, 1).toUpperCase()}</div><div className="tenant-main"><h2>{tenant.name}</h2><p>{tenant.phone}</p></div><div className="tenant-unit"><strong>{tenant.unit?.property?.name ?? 'Past tenancy'}</strong><span>{tenant.unit?.unitNo ?? 'No current unit'}</span></div><span className={`tenant-status ${tenant.status.toLowerCase()}`}>{tenant.status.replace('_', ' ')}</span>{tenant.status === 'ACTIVE' && (<a className="quiet-button export-button" href={`/tenants/move-out?tenantId=${tenant.id}`}>Move out</a>)}</article>)}{!visibleTenants.length && !message && <p className="empty-state">{tab === 'PRESENT' ? 'No active tenants right now.' : 'No past tenants yet.'}</p>}</section></div></main>;
}

function AddTenant({ token }: { token: string }) {
  const [units, setUnits] = useState<Array<{id: string;unitNo: string;status: string;rent: string;property: { name: string };}>>([]); const [fields, setFields] = useState({ unitId: '', name: '', phone: '', email: '', address: '', moveInDate: new Date().toISOString().slice(0, 10), securityDeposit: '' }); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { fetch(`${apiUrl}/portfolio/properties`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((properties: Array<{name: string;units: Array<{id: string;unitNo: string;status: string;rent: string;}>;}>) => setUnits(properties.flatMap((property) => property.units.filter((unit) => unit.status === 'AVAILABLE').map((unit) => ({ ...unit, property: { name: property.name } }))))).catch(() => setMessage('Unable to load available units.')); }, [token]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    try {
      const selectedUnit = units.find((unit) => unit.id === fields.unitId);
      if (!selectedUnit) {
        throw new Error('Please select an available unit.');
      }

      const monthlyRent = selectedUnit.rent;

      const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const response = await fetch(`${apiUrl}/tenants`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({...fields,monthlyRent: Number(monthlyRent),securityDeposit: Number(fields.securityDeposit),email: fields.email || undefined}) }); const body = await response.json(); if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to add tenant.'); window.location.href = '/tenants'; } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to add tenant.'); } finally { setBusy(false); } }
  const update = (key: keyof typeof fields) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFields({ ...fields, [key]: event.target.value });
  return <main className="auth-shell"><section className="auth-intro"><p className="eyebrow">RMS / TENANCY</p><h1>Give the lease a clear beginning.</h1><p className="lede">An available unit becomes occupied and receives an active dated lease in one transaction.</p></section><form className="auth-card" onSubmit={submit}><p className="card-kicker">New tenancy</p><h2>Add tenant</h2><label>Available unit<select value={fields.unitId} onChange={update('unitId')} required><option value="">Choose a unit</option>{units.map((unit) => <option value={unit.id} key={unit.id}>{unit.property.name} / {unit.unitNo}</option>)}</select></label><label>Name<input value={fields.name} onChange={update('name')} required /></label><label>Phone<input value={fields.phone} onChange={update('phone')} required /></label><label>Email<input type="email" value={fields.email} onChange={update('email')} /></label><label>Address<input value={fields.address} onChange={update('address')} required /></label><label>Move-in date<input type="date" value={fields.moveInDate} onChange={update('moveInDate')} required /></label><label>Monthly rent<input type="number" min="0" step="0.01" value={units.find((unit) => unit.id === fields.unitId)?.rent ?? ''} readOnly placeholder="Select a unit first" /></label><label>Security deposit<input type="number" min="0" step="0.01" value={fields.securityDeposit} onChange={update('securityDeposit')} required /></label>{message && <p className="error">{message}</p>}<button className="primary-button" disabled={busy || !units.length}>{busy ? 'Creating lease...' : 'Add tenant'} <span>↗</span></button><p className="form-note"><a href="/tenants">Return to tenants.</a></p></form></main>;
}

function MoveOut({ token }: { token: string }) {
  const tenantId = new URLSearchParams(window.location.search).get('tenantId') ?? ''; const [preview, setPreview] = useState<{ unpaidDue: string; securityDeposit: string; refundAmount: string; payableAmount: string; result: string } | null>(null); const [reason, setReason] = useState(''); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!tenantId) return; fetch(`${apiUrl}/tenants/${tenantId}/settlement-preview`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { if (!response.ok) throw new Error('Unable to calculate settlement.'); return response.json(); }).then(setPreview).catch((error: Error) => setMessage(error.message)); }, [tenantId, token]);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); try { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const response = await fetch(`${apiUrl}/tenants/${tenantId}/move-out`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ moveOutDate: date, moveOutReason: reason }) }); const body = await response.json(); if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to complete move-out.'); if (body.settlementId) { const query = new URLSearchParams({ settlementId: body.settlementId }); if (preview) { query.set('result', preview.result); query.set('refundAmount', preview.refundAmount); query.set('payableAmount', preview.payableAmount); } window.location.href = `/tenants/settle?${query}`; } else { window.location.href = '/tenants'; } } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to complete move-out.'); } finally { setBusy(false); } }
  return <main className="auth-shell"><section className="auth-intro"><p className="eyebrow">RMS / SETTLEMENT</p><h1>Close the tenancy with clarity.</h1><p className="lede">Review the live unpaid balance against the security deposit before confirming. Existing bills remain in the ledger.</p></section><form className="auth-card" onSubmit={submit}><p className="card-kicker">Move out</p><h2>Settlement preview</h2>{preview && <div className="settlement-preview"><div><span>Unpaid due</span><strong>{money(preview.unpaidDue)}</strong></div><div><span>Security deposit</span><strong>{money(preview.securityDeposit)}</strong></div><div className="settlement-result"><span>Result</span><strong>{preview.result === 'REFUND' ? `Refund ${money(preview.refundAmount)}` : preview.result === 'PAYABLE' ? `Payable ${money(preview.payableAmount)}` : 'Settled'}</strong></div></div>}<label>Move-out date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><label>Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} required /></label>{message && <p className="error">{message}</p>}<button className="primary-button" disabled={busy || !preview}>{busy ? 'Confirming...' : 'Confirm move-out'} <span>↗</span></button><p className="form-note"><a href="/tenants">Cancel and return.</a></p></form></main>;
}

function SettleTenant({ token }: { token: string }) {
  const settleParams = new URLSearchParams(window.location.search);
  const settlementId = settleParams.get('settlementId') ?? '';
  const [fields, setFields] = useState({ result: settleParams.get('result') ?? 'SETTLED', refundAmount: settleParams.get('refundAmount') ?? '0', payableAmount: settleParams.get('payableAmount') ?? '0', reason: '' }); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const update = (key: keyof typeof fields) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setFields({ ...fields, [key]: event.target.value });
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); try { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const response = await fetch(`${apiUrl}/tenants/settlements/${settlementId}/settle`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ ...fields, refundAmount: Number(fields.refundAmount), payableAmount: Number(fields.payableAmount) }) }); const body = await response.json(); if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to update settlement.'); window.location.href = '/tenants'; } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update settlement.'); } finally { setBusy(false); } }
  return <main className="auth-shell"><section className="auth-intro"><p className="eyebrow">RMS / SETTLEMENT</p><h1>Make the final outcome explicit.</h1><p className="lede">Record the final refund or payable amount without changing the historical bills that produced the settlement. Amounts are pre-filled from the move-out preview — adjust if needed.</p></section><form className="auth-card" onSubmit={submit}><p className="card-kicker">Settlement update</p><h2>Settle move-out</h2><label>Result<select value={fields.result} onChange={update('result')}><option value="REFUND">Refund</option><option value="PAYABLE">Payable</option><option value="SETTLED">Settled</option></select></label><label>Refund amount<input type="number" min="0" step="0.01" value={fields.refundAmount} onChange={update('refundAmount')} required /></label><label>Payable amount<input type="number" min="0" step="0.01" value={fields.payableAmount} onChange={update('payableAmount')} required /></label><label>Reason<textarea value={fields.reason} onChange={update('reason')} rows={4} required /></label>{message && <p className="error">{message}</p>}<button className="primary-button" disabled={busy || !settlementId}>{busy ? 'Saving...' : 'Save settlement'} <span>↗</span></button><p className="form-note"><a href="/tenants">Return to tenants.</a></p></form></main>;
}

function BillingDefaults({ token }: { token: string }) {
  const [fields, setFields] = useState({ electricity: '0', water: '0', gas: '0', dueDay: '5' }); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const update = (key: keyof typeof fields) => (event: ChangeEvent<HTMLInputElement>) => setFields({ ...fields, [key]: event.target.value });
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); try { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const response = await fetch(`${apiUrl}/billing/defaults`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ electricity: Number(fields.electricity), water: Number(fields.water), gas: Number(fields.gas), dueDay: Number(fields.dueDay) }) }); const body = await response.json(); if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to save billing defaults.'); setMessage('Billing defaults saved. Unpaid bills were updated.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save billing defaults.'); } finally { setBusy(false); } }
  return <main className="auth-shell"><section className="auth-intro"><p className="eyebrow">RMS / BILLING</p><h1>Set the month’s steady assumptions.</h1><p className="lede">Defaults flow into new bills and recalculate unpaid bills while paid history remains unchanged.</p></section><form className="auth-card" onSubmit={submit}><p className="card-kicker">Billing defaults</p><h2>Monthly defaults</h2><label>Electricity<input type="number" min="0" step="0.01" value={fields.electricity} onChange={update('electricity')} required /></label><label>Water<input type="number" min="0" step="0.01" value={fields.water} onChange={update('water')} required /></label><label>Gas<input type="number" min="0" step="0.01" value={fields.gas} onChange={update('gas')} required /></label><label>Due day<input type="number" min="1" max="28" value={fields.dueDay} onChange={update('dueDay')} required /></label>{message && <p className={message.includes('saved') ? 'form-note' : 'error'} role="status">{message}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Saving...' : 'Save defaults'} <span>↗</span></button><p className="form-note"><a href="/payments">Return to payments.</a></p></form></main>;
}

function GenerateBills({ token }: { token: string }) {
  const [billMonth, setBillMonth] = useState(new Date().toISOString().slice(0, 7) + '-01'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); try { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const response = await fetch(`${apiUrl}/billing/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ billMonth }) }); const body = await response.json(); if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to generate bills.'); setMessage(`${body.created} bill${body.created === 1 ? '' : 's'} generated.`); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to generate bills.'); } finally { setBusy(false); } }
  return <main className="auth-shell"><section className="auth-intro"><p className="eyebrow">RMS / BILLING</p><h1>Turn active leases into a clear monthly ledger.</h1><p className="lede">Generate one bill per active lease for the selected month. Existing bills are left unchanged.</p></section><form className="auth-card" onSubmit={submit}><p className="card-kicker">Monthly billing</p><h2>Generate bills</h2><label>Billing month<input type="date" value={billMonth} onChange={(event) => setBillMonth(event.target.value)} required /></label>{message && <p className={message.includes('generated') ? 'form-note' : 'error'} role="status">{message}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Generating...' : 'Generate bills'} <span>↗</span></button><p className="form-note"><a href="/payments">Return to payments.</a> · <a href="/billing/defaults">Billing defaults</a></p></form></main>;
}

function Payments({ token }: { token: string }) {
  const [bills, setBills] = useState<Array<{ id: string; billMonth: string; status: string; houseRent: string; electricity: string; water: string; gas: string; otherBills: string; fine: string; discount: string; total: string; paidAmount: string; dueDate: string; receiptNo: string | null; lease: { tenant: { name: string } }; unit: { unitNo: string; property: { name: string } }; payments: Array<{ id: string; amount: string; paidOn: string; method: string; notes: string | null; recordedBy: { id: string; name: string; email: string } }> }>>([]); const [message, setMessage] = useState(''); const [search, setSearch] = useState(''); const [statusFilter, setStatusFilter] = useState('ALL'); const [monthFilter, setMonthFilter] = useState('ALL'); const [tab, setTab] = useState<'BILLS' | 'HISTORY'>('BILLS'); const [selectedPayment, setSelectedPayment] = useState<{ payment: { id: string; amount: string; paidOn: string; method: string; notes: string | null; recordedBy: { id: string; name: string; email: string } }; bill: { id: string; billMonth: string; receiptNo: string | null; lease: { tenant: { name: string } }; unit: { unitNo: string; property: { name: string } } } } | null>(null); const [editFields, setEditFields] = useState({ amount: '', paidOn: '', method: 'CASH', notes: '' }); const [busy, setBusy] = useState(false);

  useEffect(() => { fetch(`${apiUrl}/billing/bills`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { if (!response.ok) throw new Error('Unable to load payment data.'); return response.json(); }).then(setBills).catch((reason: Error) => setMessage(reason.message)); }, [token]);

  const months = Array.from(new Set(bills.map((bill) => bill.billMonth.slice(0, 7)))).sort().reverse();

  const filteredBills = bills.filter((bill) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || bill.lease.tenant.name.toLowerCase().includes(query) || bill.unit.unitNo.toLowerCase().includes(query) || bill.unit.property.name.toLowerCase().includes(query);
    const matchesStatus = statusFilter === 'ALL' || bill.status === statusFilter;
    const matchesMonth = monthFilter === 'ALL' || bill.billMonth.slice(0, 7) === monthFilter;
    return matchesSearch && matchesStatus && matchesMonth;
  });

  const paymentHistory = filteredBills.flatMap((bill) => bill.payments.map((payment, index) => ({
    payment,
    bill,
    isLatest: index === 0
  })));

  const totalBilled = bills.reduce((sum, bill) => sum + Number(bill.total), 0);
  const totalPaid = bills.reduce((sum, bill) => sum + Number(bill.paidAmount), 0);
  const totalOutstanding = Math.max(0, totalBilled - totalPaid);
  const paidBills = bills.filter((bill) => bill.status === 'PAID').length;
  const openBills = bills.filter((bill) => bill.status !== 'PAID').length;

  async function undoLatestPayment(billId: string) {
    if (!window.confirm('Undo the latest payment for this bill? This cannot be undone automatically.')) return;

    setBusy(true);
    setMessage('');

    try {
      const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' });
      const { csrfToken } = await csrfResponse.json();

      const response = await fetch(`${apiUrl}/billing/bills/${billId}/undo-latest-payment`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-CSRF-Token': csrfToken
        },
        credentials: 'include'
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to undo payment.');
      }

      const refresh = await fetch(`${apiUrl}/billing/bills`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!refresh.ok) throw new Error('Payment was changed, but the payment list could not be refreshed.');

      setBills(await refresh.json());
      setSelectedPayment(null);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to undo payment.');
    } finally {
      setBusy(false);
    }
  }

  function openPayment(payment: typeof paymentHistory[number]['payment'], bill: typeof paymentHistory[number]['bill']) {
    setSelectedPayment({ payment, bill });
    setEditFields({
      amount: Number(payment.amount).toFixed(2),
      paidOn: payment.paidOn.slice(0, 10),
      method: payment.method,
      notes: payment.notes ?? ''
    });
  }

  async function correctPayment(event: FormEvent) {
    event.preventDefault();

    if (!selectedPayment) return;

    setBusy(true);
    setMessage('');

    try {
      const amount = Number(editFields.amount);

      if (amount <= 0) {
        throw new Error('Payment amount must be greater than zero.');
      }

      const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' });
      const { csrfToken } = await csrfResponse.json();

      const response = await fetch(`${apiUrl}/billing/payments/${selectedPayment.payment.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-CSRF-Token': csrfToken
        },
        credentials: 'include',
        body: JSON.stringify({
          amount,
          paidOn: editFields.paidOn,
          method: editFields.method,
          notes: editFields.notes || undefined
        })
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to correct payment.');
      }

      const refresh = await fetch(`${apiUrl}/billing/bills`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!refresh.ok) throw new Error('Payment was corrected, but the payment list could not be refreshed.');

      setBills(await refresh.json());
      setSelectedPayment(null);
      setMessage('Payment corrected successfully.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to correct payment.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="app-shell"><header className="topbar"><div className="brand"><img className="brand-mark" src="/icon-192.png" alt="RMS" /><span>RMS</span></div><TopNav active="payments" /><AccountMenu /></header><div className="content"><section className="welcome-row"><div><p className="eyebrow">RMS / BILLING</p><h1>Payments.</h1><p className="subtle">Track bills, collections, outstanding rent, and payment activity across your portfolio.</p></div><div className="report-actions"><a className="quiet-button export-button" href="/billing/defaults">Billing defaults</a><a className="primary-button compact" href="/billing/generate">Generate bills</a></div></section>{message && <p className="error">{message}</p>}<section className="metric-grid"><Metric label="Total billed" value={money(totalBilled)} note={`${bills.length} bills`} accent="blue" /><Metric label="Collected" value={money(totalPaid)} note={`${paidBills} paid bills`} accent="green" /><Metric label="Outstanding" value={money(totalOutstanding)} note={`${openBills} open bills`} accent="amber" /></section><div className="tab-bar"><button type="button" className={tab === 'BILLS' ? 'tab active' : 'tab'} onClick={() => setTab('BILLS')}>Bills ({filteredBills.length})</button><button type="button" className={tab === 'HISTORY' ? 'tab active' : 'tab'} onClick={() => setTab('HISTORY')}>Payment history ({paymentHistory.length})</button></div>{tab === 'BILLS' && <section className="dashboard-card payment-list-card"><div className="section-heading"><div><p className="card-kicker">Bill ledger</p><h2>Monthly bills</h2></div><span className="subtle">{filteredBills.length} of {bills.length}</span></div><div className="payment-toolbar"><label className="payment-search">Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tenant, property, or unit" /></label><label>Month<select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}><option value="ALL">All months</option>{months.map((month) => <option value={month} key={month}>{month}</option>)}</select></label><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">All statuses</option><option value="DUE">Due</option><option value="PARTIAL">Partial</option><option value="PAID">Paid</option><option value="LATE">Late</option></select></label></div><div className="payment-table-wrap"><table className="payment-table"><thead><tr><th>Bill</th><th>Tenant</th><th>Unit</th><th>Total</th><th>Paid</th><th>Outstanding</th><th>Due</th><th>Status</th><th>Action</th></tr></thead><tbody>{filteredBills.map((bill) => { const outstanding = Math.max(0, Number(bill.total) - Number(bill.paidAmount)); return <tr key={bill.id}><td><strong>{bill.billMonth.slice(0, 7)}</strong><small>{bill.unit.property.name}</small></td><td>{bill.lease.tenant.name}</td><td>{bill.unit.unitNo}</td><td><strong>{money(Number(bill.total))}</strong></td><td>{money(Number(bill.paidAmount))}</td><td><strong>{money(outstanding)}</strong></td><td>{new Date(bill.dueDate).toLocaleDateString()}</td><td><span className={`bill-status ${bill.status.toLowerCase()}`}>{bill.status}</span></td><td>{bill.status !== 'PAID' && outstanding > 0 ? <a className="quiet-button export-button" href={`/payments/record?billId=${bill.id}`}>Record payment</a> : <span className="subtle">Settled</span>}</td></tr>; })}</tbody></table></div>{!filteredBills.length && !message && <p className="empty-state">{bills.length ? 'No bills match your filters.' : 'No bills yet. Generate the current month’s bills from the billing engine.'}</p>}</section>}{tab === 'HISTORY' && <><section className="dashboard-card payment-list-card"><div className="section-heading"><div><p className="card-kicker">Collection history</p><h2>Payment history</h2></div><span className="subtle">{paymentHistory.length} payments</span></div><div className="payment-table-wrap"><table className="payment-table"><thead><tr><th>Date</th><th>Receipt</th><th>Tenant</th><th>Unit</th><th>Bill month</th><th>Amount</th><th>Method</th><th>Recorded by</th><th>Action</th></tr></thead><tbody>{paymentHistory.map(({ payment, bill, isLatest }) => <tr key={payment.id}><td>{new Date(payment.paidOn).toLocaleDateString()}</td><td>{bill.receiptNo ?? <span className="subtle">—</span>}</td><td>{bill.lease.tenant.name}</td><td>{bill.unit.unitNo}</td><td>{bill.billMonth.slice(0, 7)}</td><td><strong>{money(Number(payment.amount))}</strong></td><td>{payment.method.replace('_', ' ')}</td><td>{payment.recordedBy.name}</td><td><div className="report-actions"><button className="quiet-button export-button" type="button" onClick={() => openPayment(payment, bill)}>View / correct</button>{isLatest && <button className="quiet-button export-button" type="button" disabled={busy} onClick={() => undoLatestPayment(bill.id)}>Undo latest</button>}</div></td></tr>)}</tbody></table></div>{!paymentHistory.length && <p className="empty-state">No payments have been recorded yet.</p>}</section>{selectedPayment && <section className="dashboard-card payment-list-card payment-correction-card"><div className="section-heading"><div><p className="card-kicker">Payment details</p><h2>View / correct payment</h2></div><button className="quiet-button" type="button" onClick={() => setSelectedPayment(null)}>Close</button></div><div className="payment-summary"><div><span>Tenant</span><strong>{selectedPayment.bill.lease.tenant.name}</strong></div><div><span>Property / Unit</span><strong>{selectedPayment.bill.unit.property.name} / {selectedPayment.bill.unit.unitNo}</strong></div><div><span>Billing month</span><strong>{selectedPayment.bill.billMonth.slice(0, 7)}</strong></div><div><span>Payment ID</span><strong>{selectedPayment.payment.id}</strong></div></div><form className="payment-correction-form" onSubmit={correctPayment}><label>Amount<input type="number" min="0.01" step="0.01" value={editFields.amount} onChange={(event) => setEditFields({ ...editFields, amount: event.target.value })} required /></label><label>Paid on<input type="date" value={editFields.paidOn} onChange={(event) => setEditFields({ ...editFields, paidOn: event.target.value })} required /></label><label>Method<select value={editFields.method} onChange={(event) => setEditFields({ ...editFields, method: event.target.value })}><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CARD">Card</option><option value="OTHER">Other</option></select></label><label>Notes<textarea value={editFields.notes} onChange={(event) => setEditFields({ ...editFields, notes: event.target.value })} rows={3} /></label><div className="report-actions"><button className="quiet-button" type="button" onClick={() => setSelectedPayment(null)}>Cancel</button><button className="primary-button compact" disabled={busy}>{busy ? 'Saving...' : 'Save correction'} <span>↗</span></button></div></form></section>}</>}</div></main>;
}

function RecordPayment({ token }: { token: string }) {
  const billId = new URLSearchParams(window.location.search).get('billId') ?? ''; const [bill, setBill] = useState<{ id: string; billMonth: string; status: string; houseRent: string; electricity: string; water: string; gas: string; otherBills: string; fine: string; discount: string; total: string; paidAmount: string; dueDate: string; lease: { tenant: { name: string; phone: string } }; unit: { unitNo: string; property: { name: string; address: string } } } | null>(null); const [fields, setFields] = useState({ amount: '', paidOn: new Date().toISOString().slice(0, 10), method: 'CASH', notes: '' }); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ payment: { id: string; amount: string; paidOn: string; method: string }; bill: { total: string; paidAmount: string; status: string; receiptNo: string | null } } | null>(null);
  const [wantsSlip, setWantsSlip] = useState<boolean | null>(null);
  useEffect(() => { if (!billId) { setMessage('No bill selected.'); return; } fetch(`${apiUrl}/billing/bills`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { if (!response.ok) throw new Error('Unable to load bill.'); return response.json(); }).then((bills: Array<{ id: string; billMonth: string; status: string; houseRent: string; electricity: string; water: string; gas: string; otherBills: string; fine: string; discount: string; total: string; paidAmount: string; dueDate: string; lease: { tenant: { name: string; phone: string } }; unit: { unitNo: string; property: { name: string; address: string } } }>) => { const selectedBill = bills.find((item) => item.id === billId); if (!selectedBill) throw new Error('Bill not found.'); setBill(selectedBill); setFields((current) => ({ ...current, amount: Math.max(0, Number(selectedBill.total) - Number(selectedBill.paidAmount)).toFixed(2) })); }).catch((error: Error) => setMessage(error.message)); }, [billId, token]);
  const update = (key: keyof typeof fields) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setFields({ ...fields, [key]: event.target.value });
  const totalAmount = bill ? Number(bill.houseRent) + Number(bill.electricity) + Number(bill.water) + Number(bill.gas) + Number(bill.otherBills) + Number(bill.fine) - Number(bill.discount) : 0; const alreadyPaid = bill ? Number(bill.paidAmount) : 0; const outstanding = Math.max(0, totalAmount - alreadyPaid);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); try { if (!bill) throw new Error('Bill information is not available.'); const paymentAmount = Number(fields.amount); if (paymentAmount <= 0) throw new Error('Payment amount must be greater than zero.'); if (paymentAmount > outstanding) throw new Error(`Payment cannot exceed the outstanding amount of ${money(outstanding)}.`); const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const payload = { amount: paymentAmount, paidOn: fields.paidOn, method: fields.method, notes: fields.notes || undefined }; const response = await fetch(`${apiUrl}/billing/bills/${billId}/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify(payload) }); const body = await response.json(); if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to record payment.'); setReceipt(body); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to record payment.'); } finally { setBusy(false); } }
  if (receipt && bill) {
    // Printing isn't mandatory — ask first, rather than dropping a print
    // dialog on every payment regardless of whether the owner wants one.
    if (wantsSlip === null) return <PrintPromptScreen onChoice={setWantsSlip} />;
    if (wantsSlip === false) return <main className="auth-shell"><section className="auth-intro"><p className="eyebrow">RMS / BILLING</p><h1>Payment recorded.</h1><p className="lede">No slip was printed. You can always come back and print one later from the payment history.</p></section><div className="auth-card"><p className="card-kicker">Bill payment</p><h2>All set</h2><p className="form-note"><a href="/payments">Return to payments.</a></p></div></main>;
    return <PaymentSlipScreen bill={bill} receipt={receipt} />;
  }
  return <main className="auth-shell"><section className="auth-intro"><p className="eyebrow">RMS / BILLING</p><h1>Settle the bill clearly.</h1><p className="lede">Review the bill first, then record the amount actually received. Partial payments remain part of the payment history.</p></section><form className="auth-card" onSubmit={submit}><p className="card-kicker">Bill payment</p><h2>Record payment</h2>{bill && <><div className="form-section"><p className="card-kicker">Bill information</p><div className="payment-summary"><div><span>Tenant</span><strong>{bill.lease.tenant.name}</strong></div><div><span>Property / Unit</span><strong>{bill.unit.property.name} / {bill.unit.unitNo}</strong></div><div><span>Billing month</span><strong>{bill.billMonth.slice(0, 7)}</strong></div><div><span>Due date</span><strong>{new Date(bill.dueDate).toLocaleDateString()}</strong></div></div></div><div className="form-section"><p className="card-kicker">Bill details</p><label>Rent<input type="number" value={bill.houseRent} readOnly /></label><label>Electricity<input type="number" value={bill.electricity} readOnly /></label><label>Water<input type="number" value={bill.water} readOnly /></label><label>Gas<input type="number" value={bill.gas} readOnly /></label><label>Other bills<input type="number" value={bill.otherBills} readOnly /></label><label>Fine<input type="number" value={bill.fine} readOnly /></label><label>Discount<input type="number" value={bill.discount} readOnly /></label><label>Total amount<input type="number" value={totalAmount.toFixed(2)} readOnly /></label><div className="payment-balance"><span>Already paid</span><strong>{money(alreadyPaid)}</strong><span>Outstanding</span><strong>{money(outstanding)}</strong></div></div></>}{bill && <div className="form-section"><p className="card-kicker">Payment</p><label>Amount to pay<input type="number" min="0.01" max={outstanding} step="0.01" value={fields.amount} onChange={update('amount')} required /></label><label>Paid on<input type="date" value={fields.paidOn} onChange={update('paidOn')} required /></label><label>Method<select value={fields.method} onChange={update('method')}><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CARD">Card</option><option value="OTHER">Other</option></select></label><label>Notes<textarea value={fields.notes} onChange={update('notes')} rows={3} /></label></div>}{message && <p className="error">{message}</p>}<button className="primary-button" disabled={busy || !bill || outstanding <= 0}>{busy ? 'Recording...' : outstanding <= 0 ? 'Bill fully paid' : 'Record payment'} <span>↗</span></button><p className="form-note"><a href="/payments">Return to payments.</a></p></form></main>;
}

type SlipBill = { billMonth: string; dueDate: string; houseRent: string; electricity: string; water: string; gas: string; otherBills: string; fine: string; discount: string; lease: { tenant: { name: string; phone: string } }; unit: { unitNo: string; property: { name: string; address: string } } };
type SlipReceipt = { payment: { amount: string; paidOn: string; method: string }; bill: { total: string; paidAmount: string; status: string; receiptNo: string | null } };

// Printing isn't mandatory — this asks first instead of putting a print
// dialog (or even just an unwanted extra screen) in front of every owner on
// every payment.
function PrintPromptScreen({ onChoice }: { onChoice: (value: boolean) => void }) {
  return <main className="auth-shell"><section className="auth-intro"><p className="eyebrow">RMS / BILLING</p><h1>Payment recorded.</h1><p className="lede">Would you like to print a payment slip for the tenant?</p></section><div className="auth-card"><p className="card-kicker">Bill payment</p><h2>Print a slip?</h2><p className="subtle">You can skip this — it's just a printable proof of payment, not required to keep the payment on record.</p><div className="report-actions"><button type="button" className="primary-button" onClick={() => onChoice(true)}>Yes, show slip <span>🖶</span></button><button type="button" className="quiet-button export-button" onClick={() => onChoice(false)}>No thanks</button></div></div></main>;
}

// The printable slip itself: pure black text/borders on white, no filled
// colors or images, by design — so an owner can print a stack of these on a
// cheap inkjet without burning through color cartridges. `@media print`
// (see styles.css) hides everything else on the page and prints only this.
function ReceiptSlip({ bill, receipt }: { bill: SlipBill; receipt: SlipReceipt }) {
  const total = Number(receipt.bill.total);
  const thisPayment = Number(receipt.payment.amount);
  const previouslyPaid = Math.max(0, Number(receipt.bill.paidAmount) - thisPayment);
  const balanceDue = Math.max(0, total - Number(receipt.bill.paidAmount));
  const statusLabel = receipt.bill.status === 'PAID' ? 'PAID' : receipt.bill.status === 'PARTIAL' ? 'PARTIALLY PAID' : receipt.bill.status;
  const billingPeriod = new Date(`${bill.billMonth.slice(0, 7)}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const lineItems: Array<[string, number]> = ([
    ['House rent', Number(bill.houseRent)],
    ['Electricity', Number(bill.electricity)],
    ['Water', Number(bill.water)],
    ['Gas', Number(bill.gas)],
    ['Other charges', Number(bill.otherBills)],
    ['Fine', Number(bill.fine)],
  ] as Array<[string, number]>).filter(([, amount]) => amount > 0);
  return (
    <div className="receipt-slip">
      <div className="receipt-brand-block">
        <img src="/icon-192.png" alt="" className="receipt-logo" />
        <strong className="receipt-property-name">{bill.unit.property.name}</strong>
        <span className="receipt-property-address">{bill.unit.property.address}</span>
        <span className="receipt-property-address">Unit {bill.unit.unitNo}</span>
      </div>
      <hr />
      <div className="receipt-status-row">
        <div className="receipt-fields">
          <div><span>Tenant Name:</span><strong>{bill.lease.tenant.name}</strong></div>
          <div><span>Tenant Mobile No:</span><strong>{bill.lease.tenant.phone}</strong></div>
          <div><span>Billing Period:</span><strong>{billingPeriod}</strong></div>
        </div>
        <div className="receipt-status-box">{statusLabel}</div>
      </div>
      <p className="receipt-subnote">Payment date: {new Date(receipt.payment.paidOn).toLocaleDateString()} &nbsp;·&nbsp; Method: {receipt.payment.method.replace('_', ' ')} &nbsp;·&nbsp; {receipt.bill.receiptNo ? `Receipt No. ${receipt.bill.receiptNo}` : `Due: ${new Date(bill.dueDate).toLocaleDateString()}`}</p>
      <table className="receipt-table">
        <thead><tr><th>Description</th><th>Amount</th></tr></thead>
        <tbody>
          {lineItems.map(([label, amount]) => <tr key={label}><td>{label}</td><td>{money(amount)}</td></tr>)}
          {Number(bill.discount) > 0 && <tr><td>Discount</td><td>-{money(bill.discount)}</td></tr>}
          {previouslyPaid > 0 && <tr><td>Previously paid</td><td>-{money(previouslyPaid)}</td></tr>}
          <tr className="receipt-total-row"><td>Total Amount Paid</td><td>{money(thisPayment)}</td></tr>
        </tbody>
      </table>
      {balanceDue > 0 && <p className="receipt-balance-note">Remaining balance on this bill: {money(balanceDue)}</p>}
      <p className="receipt-words"><span>In words:</span> {amountInWords(thisPayment)}</p>
      <p className="receipt-footnote">This is a computer-generated bill. No signature is required.</p>
    </div>
  );
}

function PaymentSlipScreen({ bill, receipt }: { bill: SlipBill & { id: string }; receipt: SlipReceipt }) {
  const balanceDue = Math.max(0, Number(receipt.bill.total) - Number(receipt.bill.paidAmount));
  return <main className="auth-shell"><section className="auth-intro no-print"><p className="eyebrow">RMS / BILLING</p><h1>Payment recorded.</h1><p className="lede">Print or save the slip below as proof of payment for the tenant. It's designed to be clear on plain paper without using colored ink.</p></section><div className="auth-card"><p className="card-kicker no-print">Bill payment</p><h2 className="no-print">Payment recorded</h2><div className="report-actions no-print"><button type="button" className="primary-button" onClick={() => window.print()}>Print slip <span>🖶</span></button>{balanceDue > 0 && <a className="quiet-button export-button" href={`/payments/record?billId=${bill.id}`}>Record another payment</a>}<a className="quiet-button export-button" href="/payments">Return to payments</a></div><ReceiptSlip bill={bill} receipt={receipt} /></div></main>;
}

const REPORT_TYPES: Array<{ value: string; label: string; description: string }> = [
  { value: 'transactions', label: 'Transactions', description: 'Full bill-by-bill ledger with billed, paid, outstanding and net income.' },
  { value: 'summary', label: 'Summary', description: 'Portfolio-wide totals for the selected period.' },
  { value: 'utilities', label: 'Utilities', description: 'Electricity, water, gas and other charges billed per tenant.' },
  { value: 'outstanding', label: 'Outstanding balances', description: 'Only bills that still have an unpaid amount.' },
  { value: 'repairs', label: 'Repairs & maintenance', description: 'Logged repair work and cost across the portfolio.' },
  { value: 'income/property', label: 'Income by property', description: 'Net house-rent income grouped by property.' },
  { value: 'income/unit', label: 'Income by unit', description: 'Net house-rent income grouped by unit.' },
  { value: 'income/tenant', label: 'Income by tenant', description: 'Net house-rent income grouped by tenant.' },
  { value: 'income/month', label: 'Monthly income', description: 'Net house-rent income grouped by month.' },
  { value: 'income/year', label: 'Yearly income', description: 'Net house-rent income grouped by year.' },
];

function Reports({ token }: { token: string }) {
  const [reportType, setReportType] = useState('transactions');
  const [dateFrom, setDateFrom] = useState(''); const [dateTo, setDateTo] = useState(''); const [status, setStatus] = useState(''); const [search, setSearch] = useState(''); const [message, setMessage] = useState('');
  const selected = REPORT_TYPES.find((option) => option.value === reportType) ?? REPORT_TYPES[0];
  const usesStatus = reportType === 'transactions' || reportType === 'utilities';
  const usesSearch = reportType === 'transactions';
  async function download(extension: 'pdf' | 'xlsx') { setMessage(''); try { const query = new URLSearchParams(); if (dateFrom) query.set('dateFrom', dateFrom); if (dateTo) query.set('dateTo', dateTo); if (usesStatus && status) query.set('status', status); if (usesSearch && search) query.set('search', search); const path = reportType === 'transactions' ? `transactions.${extension}` : `${reportType}/export/${extension}`; const response = await fetch(`${apiUrl}/reports/${path}?${query}`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('Unable to generate report.'); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `rms-${reportType.split('/').join('-')}.${extension}`; link.click(); URL.revokeObjectURL(url); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to generate report.'); } }
  return <main className="app-shell"><header className="topbar"><div className="brand"><img className="brand-mark" src="/icon-192.png" alt="RMS" /><span>RMS</span></div><TopNav active="reports" /><AccountMenu /></header><div className="content"><section className="welcome-row"><div><p className="eyebrow">RMS / REPORTING</p><h1>Reports.</h1><p className="subtle">Export owner-scoped reports using the same income definitions as the dashboard.</p></div></section><section className="dashboard-card report-form"><p className="card-kicker">{selected.label} report</p><h2>Filter and export</h2><p className="subtle">{selected.description}</p><div className="report-fields"><label>Report type<select value={reportType} onChange={(event) => setReportType(event.target.value)}>{REPORT_TYPES.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>From<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label>To<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>{usesStatus && <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="DUE">Due</option><option value="PARTIAL">Partial</option><option value="LATE">Late</option><option value="PAID">Paid</option></select></label>}{usesSearch && <label>Search tenant or unit<input value={search} onChange={(event) => setSearch(event.target.value)} /></label>}</div>{message && <p className="error">{message}</p>}<div className="report-actions"><button className="primary-button" onClick={() => download('pdf')}>Export PDF <span>↓</span></button><button className="quiet-button export-button" onClick={() => download('xlsx')}>Export Excel <span>↓</span></button></div></section></div></main>;
}

function Repairs({ token }: { token: string }) {
  const [repairs, setRepairs] = useState<Array<{ id: string; repairDate: string; category: string; description: string; cost: string; paidBy: string; status: string; unit: { unitNo: string; property: { name: string } } }>>([]); const [message, setMessage] = useState('');
  useEffect(() => { fetch(`${apiUrl}/repairs`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { if (!response.ok) throw new Error('Unable to load repairs.'); return response.json(); }).then(setRepairs).catch((error: Error) => setMessage(error.message)); }, [token]);
  return <main className="app-shell"><header className="topbar"><div className="brand"><img className="brand-mark" src="/icon-192.png" alt="RMS" /><span>RMS</span></div><TopNav active="repairs" /><AccountMenu /></header><div className="content"><section className="welcome-row"><div><p className="eyebrow">RMS / EXPENSES</p><h1>Repairs.</h1><p className="subtle">Track costs by unit and keep owner expenses separate from tenant-paid work.</p></div><div className="report-actions"><a className="quiet-button export-button" href="/repairs/manage">Manage repairs</a><a className="primary-button compact" href="/repairs/new">+ Add repair</a></div></section>{message && <p className="error">{message}</p>}<section className="repair-list">{repairs.map((repair) => <article className="dashboard-card repair-row" key={repair.id}><div className="repair-main"><p className="card-kicker">{repair.unit.property.name} / {repair.unit.unitNo} · {new Date(repair.repairDate).toLocaleDateString()}</p><h2>{repair.category}</h2><p>{repair.description}</p></div><div className="repair-cost"><strong>{money(repair.cost)}</strong><span>{repair.paidBy} paid</span></div><span className="tenant-status">{repair.status}</span></article>)}{!repairs.length && !message && <p className="empty-state">No repairs recorded yet.</p>}</section></div></main>;
}

function ManageRepairs({ token }: { token: string }) {
  const [repairs, setRepairs] = useState<Array<{ id: string; repairDate: string; category: string; description: string; cost: string; status: string; unit: { unitNo: string; property: { name: string } } }>>([]); const [message, setMessage] = useState(''); const [busy, setBusy] = useState('');
  const load = () => fetch(`${apiUrl}/repairs`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { if (!response.ok) throw new Error('Unable to load repairs.'); return response.json(); }).then(setRepairs).catch((error: Error) => setMessage(error.message));
  useEffect(() => { void load(); }, [token]);
  async function save(repair: typeof repairs[number], event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(repair.id); setMessage(''); const data = new FormData(event.currentTarget); try { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const response = await fetch(`${apiUrl}/repairs/${repair.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ repairDate: data.get('repairDate'), category: data.get('category'), description: data.get('description'), cost: Number(data.get('cost')), status: data.get('status') }) }); const body = await response.json(); if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to update repair.'); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update repair.'); } finally { setBusy(''); } }
  async function remove(repair: typeof repairs[number]) { if (!window.confirm(`Delete ${repair.category}?`)) return; setBusy(repair.id); setMessage(''); try { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const response = await fetch(`${apiUrl}/repairs/${repair.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include' }); const body = await response.json(); if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to delete repair.'); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to delete repair.'); } finally { setBusy(''); } }
  return <main className="app-shell"><header className="topbar"><div className="brand"><img className="brand-mark" src="/icon-192.png" alt="RMS" /><span>RMS</span></div><TopNav active="repairs" /><a className="quiet-button" href="/repairs">Back</a><AccountMenu /></header><div className="content"><section className="welcome-row"><div><p className="eyebrow">RMS / EXPENSES</p><h1>Manage repairs.</h1><p className="subtle">Update repair details or remove an incorrect expense.</p></div><a className="primary-button compact" href="/repairs/new">+ Add repair</a></section>{message && <p className="error">{message}</p>}<section className="tenant-list">{repairs.map((repair) => <form className="dashboard-card" key={repair.id} onSubmit={(event) => save(repair, event)}><p className="card-kicker">{repair.unit.property.name} / {repair.unit.unitNo}</p><label>Date<input name="repairDate" type="date" defaultValue={repair.repairDate.slice(0, 10)} required /></label><label>Category<input name="category" defaultValue={repair.category} required /></label><label>Description<textarea name="description" defaultValue={repair.description} rows={3} required /></label><label>Cost<input name="cost" type="number" min="0" step="0.01" defaultValue={repair.cost} required /></label><label>Status<select name="status" defaultValue={repair.status}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></label><div className="report-actions"><button className="primary-button" disabled={busy === repair.id}>{busy === repair.id ? 'Saving...' : 'Save changes'}</button><button type="button" className="quiet-button export-button" onClick={() => remove(repair)} disabled={busy === repair.id}>Delete repair</button></div></form>)}{!repairs.length && !message && <p className="empty-state">No repairs yet.</p>}</section></div></main>;
}

function AddRepair({ token }: { token: string }) {
  const [units, setUnits] = useState<Array<{ id: string; unitNo: string; property: { name: string } }>>([]);
  const [fields, setFields] = useState({ unitId: '', repairDate: new Date().toISOString().slice(0, 10), category: '', description: '', cost: '', paidBy: 'OWNER', status: 'OPEN', vendorName: '', vendorPhone: '', invoiceNo: '' });
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { fetch(`${apiUrl}/portfolio/properties`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { if (!response.ok) throw new Error('Unable to load units.'); return response.json(); }).then((properties: Array<{ name: string; units: Array<{ id: string; unitNo: string; deletedAt?: string }> }>) => setUnits(properties.flatMap((property) => property.units.filter((unit) => !unit.deletedAt).map((unit) => ({ id: unit.id, unitNo: unit.unitNo, property: { name: property.name } }))))).catch((error: Error) => setMessage(error.message)); }, [token]);
  const update = (key: keyof typeof fields) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setFields({ ...fields, [key]: event.target.value });
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); try { const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' }); const { csrfToken } = await csrfResponse.json(); const response = await fetch(`${apiUrl}/repairs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ ...fields, cost: Number(fields.cost) }) }); const body = await response.json(); if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to add repair.'); window.location.href = '/repairs'; } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to add repair.'); } finally { setBusy(false); } }
  return <main className="auth-shell"><section className="auth-intro"><p className="eyebrow">RMS / EXPENSES</p><h1>Record the work while it is fresh.</h1><p className="lede">Attach an owner or tenant-paid repair to the correct unit and keep the portfolio costs traceable.</p></section><form className="auth-card" onSubmit={submit}><p className="card-kicker">New repair</p><h2>Add repair</h2><label>Unit<select value={fields.unitId} onChange={update('unitId')} required><option value="">Choose a unit</option>{units.map((unit) => <option value={unit.id} key={unit.id}>{unit.property.name} / {unit.unitNo}</option>)}</select></label><label>Date<input type="date" value={fields.repairDate} onChange={update('repairDate')} required /></label><label>Category<input value={fields.category} onChange={update('category')} required /></label><label>Description<textarea value={fields.description} onChange={update('description')} rows={3} required /></label><label>Cost<input type="number" min="0" step="0.01" value={fields.cost} onChange={update('cost')} required /></label><label>Paid by<select value={fields.paidBy} onChange={update('paidBy')}><option value="OWNER">Owner</option><option value="TENANT">Tenant</option></select></label><label>Status<select value={fields.status} onChange={update('status')}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></label><label>Vendor name<input value={fields.vendorName} onChange={update('vendorName')} /></label><label>Vendor phone<input value={fields.vendorPhone} onChange={update('vendorPhone')} /></label><label>Invoice number<input value={fields.invoiceNo} onChange={update('invoiceNo')} /></label>{message && <p className="error">{message}</p>}<button className="primary-button" disabled={busy || !units.length}>{busy ? 'Adding repair...' : 'Add repair'} <span>↗</span></button><p className="form-note"><a href="/repairs">Return to repairs.</a></p></form></main>;
}

function Admin({ token }: { token: string }) {
  type AdminUser = { id: string; fullName: string; email: string; phone: string; status: string; emailVerifiedAt: string | null; lastLoginAt: string | null; createdAt: string; userRoles?: Array<{ role: { id: string; name: string } }>; _count?: { properties: number; tenants: number; units: number } };
  type AdminOverview = { users: { total: number; active: number; suspended: number; disabled: number; unverified: number }; portfolio: { totalOwners: number; totalProperties: number; totalUnits: number; occupiedUnits: number; totalTenants: number }; billing: { thisMonthIncome: string; totalOutstanding: string } };
  type AdminLog = { id: string; action: string; createdAt: string; actor: { fullName: string } | null };

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Array<{ id: string; name: string }>>([]);
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [message, setMessage] = useState('');
  const [cleaning, setCleaning] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [resendingUserId, setResendingUserId] = useState<string | null>(null);

  const load = () => Promise.all([
    fetch(`${apiUrl}/admin/overview`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${apiUrl}/admin/users`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${apiUrl}/admin/roles`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${apiUrl}/admin/audit-logs`, { headers: { Authorization: `Bearer ${token}` } }),
  ]).then(async ([overviewResponse, usersResponse, rolesResponse, logsResponse]) => {
    if (!overviewResponse.ok || !usersResponse.ok || !rolesResponse.ok || !logsResponse.ok) throw new Error('Admin access is required.');
    return Promise.all([overviewResponse.json(), usersResponse.json(), rolesResponse.json(), logsResponse.json()]);
  }).then(([nextOverview, nextUsers, nextRoles, nextLogs]) => { setOverview(nextOverview); setUsers(nextUsers); setRoles(nextRoles); setLogs(nextLogs); });

  useEffect(() => { void load().catch((error: Error) => setMessage(error.message)); }, [token]);

  async function updateStatus(user: AdminUser) {
    setMessage('');
    try {
      const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' });
      const { csrfToken } = await csrfResponse.json();
      const response = await fetch(`${apiUrl}/admin/users/${user.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ status: user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? 'Unable to update user status.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update user status.');
    }
  }

  async function updateRole(user: AdminUser, roleId: string) {
    if (!roleId) return;
    setMessage('');
    try {
      const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' });
      const { csrfToken } = await csrfResponse.json();
      const response = await fetch(`${apiUrl}/admin/users/${user.id}/role`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ roleId, reason: 'Updated from admin panel' }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? 'Unable to update user role.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update user role.');
    }
  }

  async function resendVerification(user: AdminUser) {
    setMessage(''); setResendingUserId(user.id);
    try {
      const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' });
      const { csrfToken } = await csrfResponse.json();
      await fetch(`${apiUrl}/auth/resend-activation`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ email: user.email }) });
      setMessage(`Verification link re-sent to ${user.email}.`);
    } finally {
      setResendingUserId(null);
    }
  }

  async function deleteUser(user: AdminUser) {
    const typed = window.prompt(`This permanently deletes ${user.fullName}'s account and every property, unit, tenant, lease, bill, payment, repair, and settlement they own. This cannot be undone.\n\nType the account's email (${user.email}) to confirm.`);
    if (typed === null) return;
    setMessage(''); setDeletingUserId(user.id);
    try {
      const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' });
      const { csrfToken } = await csrfResponse.json();
      const response = await fetch(`${apiUrl}/admin/users/${user.id}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ confirmation: typed }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? 'Unable to delete this account.');
      setMessage(`Deleted ${user.email} and all of their owned data.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete this account.');
    } finally {
      setDeletingUserId(null);
    }
  }

  async function cleanDatabase() {
    const confirmation = window.prompt('This permanently deletes all properties, units, tenants, leases, bills, payments, repairs, and settlements for every owner. User accounts are kept. Type DELETE ALL DATA to confirm.');
    if (confirmation === null) return;
    setMessage(''); setCleaning(true);
    try {
      const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' });
      const { csrfToken } = await csrfResponse.json();
      const response = await fetch(`${apiUrl}/admin/database/clean`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ confirmation }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? 'Unable to clean the database.');
      setMessage(`Database cleaned. ${Object.entries(body.deleted as Record<string, number>).map(([key, count]) => `${key}: ${count}`).join(', ')}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to clean the database.');
    } finally {
      setCleaning(false);
    }
  }

  const filteredUsers = users.filter((user) => {
    const matchesStatus = statusFilter === 'ALL' || user.status === statusFilter;
    const query = search.trim().toLowerCase();
    const matchesSearch = query === '' || user.fullName.toLowerCase().includes(query) || user.email.toLowerCase().includes(query);
    return matchesStatus && matchesSearch;
  });

  return <main className="app-shell"><header className="topbar"><div className="brand"><img className="brand-mark" src="/icon-192.png" alt="RMS" /><span>RMS ADMIN</span></div><AccountMenu /></header><div className="content"><section className="welcome-row"><div><p className="eyebrow">RMS / ADMINISTRATION</p><h1>Control room.</h1><p className="subtle">Platform accounts, portfolio totals, and recent security-sensitive actions.</p></div></section>{message && <p className="error" role="status">{message}</p>}{overview && <section className="metric-grid"><Metric label="Total users" value={String(overview.users.total)} note={`${overview.users.active} active`} accent="green" /><Metric label="Suspended / disabled" value={String(overview.users.suspended + overview.users.disabled)} note={`${overview.users.suspended} suspended · ${overview.users.disabled} disabled`} accent="amber" /><Metric label="Unverified email" value={String(overview.users.unverified)} note="Awaiting activation" accent="rose" /><Metric label="Owners" value={String(overview.portfolio.totalOwners)} note="Accounts with OWNER_ADMIN" accent="blue" /><Metric label="Properties" value={String(overview.portfolio.totalProperties)} note={`${overview.portfolio.totalTenants} active tenants`} accent="green" /><Metric label="Units occupied" value={`${overview.portfolio.occupiedUnits} / ${overview.portfolio.totalUnits}`} note="Across every owner" accent="blue" /><Metric label="This month income" value={money(overview.billing.thisMonthIncome)} note="Platform-wide" accent="green" /><Metric label="Total outstanding" value={money(overview.billing.totalOutstanding)} note="Across open bills" accent="amber" /></section>}<section className="dashboard-grid"><article className="dashboard-card payments-card"><div className="card-heading"><div><p className="card-kicker">Accounts</p><h2>Users</h2></div></div><div className="admin-toolbar"><input type="search" placeholder="Search by name or email" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search users" /><select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="DISABLED">Disabled</option></select></div>{filteredUsers.length === 0 && <p className="empty-state">No users match this search.</p>}{filteredUsers.map((user) => <div className="payment-row" key={user.id}><div><strong>{user.fullName}</strong><small>{user.email} · {user.phone}</small><small>{user._count?.properties ?? 0} properties · {user._count?.units ?? 0} units · {user._count?.tenants ?? 0} tenants</small></div><div className="user-row-actions"><span className={`tenant-status ${user.status.toLowerCase()}`}>{user.status}</span>{!user.emailVerifiedAt && <span className="tenant-status unverified-badge">Unverified</span>}{!user.emailVerifiedAt && <button className="quiet-button export-button" disabled={resendingUserId === user.id} onClick={() => resendVerification(user)}>{resendingUserId === user.id ? 'Sending…' : 'Resend link'}</button>}<select aria-label={`Role for ${user.fullName}`} value={user.userRoles?.[0]?.role.id ?? ''} onChange={(event) => updateRole(user, event.target.value)}>{roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select><button className="quiet-button export-button" onClick={() => updateStatus(user)}>{user.status === 'ACTIVE' ? 'Suspend' : 'Enable'}</button><button className="danger-button" disabled={deletingUserId === user.id} onClick={() => deleteUser(user)}>{deletingUserId === user.id ? 'Deleting…' : 'Delete'}</button></div></div>)}</article><article className="dashboard-card"><div className="card-heading"><div><p className="card-kicker">Audit</p><h2>Recent events</h2></div></div>{logs.slice(0, 15).map((log) => <div className="payment-row" key={log.id}><div><strong>{log.action.replace(/_/g, ' ')}</strong><small>{log.actor?.fullName ?? 'Deleted user'} · {new Date(log.createdAt).toLocaleString()}</small></div></div>)}</article><article className="dashboard-card danger-card"><div className="card-heading"><div><p className="card-kicker">Danger zone</p><h2>Clean database</h2></div></div><p className="subtle">Permanently deletes properties, units, tenants, leases, bills, payments, repairs, and settlements for every owner. User accounts and roles are kept. This cannot be undone.</p><button className="danger-button" disabled={cleaning} onClick={cleanDatabase}>{cleaning ? 'Cleaning…' : 'Clean database'}</button></article></section></div></main>;
}
function greetingForHour(hour: number) {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

function Dashboard({ summary, firstName, onSignOut }: { summary: Summary; firstName: string; onSignOut: () => void }) {
  // Uses the device's own local clock and timezone, so this always reads
  // correctly wherever the person actually is instead of a fixed offset.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(id); }, []);
  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const timeLabel = formatClockTime(now);
  const greeting = greetingForHour(now.getHours());
  const max = Math.max(...summary.monthlyIncomeTrend.map((item) => Number(item.income)), 1); const occupancy = summary.totalUnits ? summary.occupiedUnits / summary.totalUnits * 100 : 0;
  const netProfit = Math.max(0, Number(summary.thisMonthNetProfit));
  const repairCost = Math.max(0, Number(summary.thisMonthOwnerRepairCost));
  const PAYMENT_METHOD_COLORS: Record<string, string> = { CASH: '#5e8b6e', BANK_TRANSFER: '#7b9cb0', CARD: '#d4a25d', OTHER: '#bd7c75' };
  const paymentMethodTotals = summary.recentPayments.reduce((totals, payment) => { totals[payment.method] = (totals[payment.method] ?? 0) + Number(payment.amount); return totals; }, {} as Record<string, number>);
  const paymentMethodSegments = Object.entries(paymentMethodTotals).map(([method, total]) => ({ label: method.replace('_', ' '), value: total, color: PAYMENT_METHOD_COLORS[method] ?? '#8a978f' }));
  return <main className="app-shell"><header className="topbar"><div className="brand"><img className="brand-mark" src="/icon-192.png" alt="RMS" /><span>RMS</span></div><TopNav active="dashboard" /><AccountMenu onSignOut={onSignOut} /></header><div className="content" id="dashboard"><section className="welcome-row"><div><p className="eyebrow">{dateLabel} · {timeLabel}</p><h1>{greeting}, {firstName || 'there'}.</h1><p className="subtle">Here is the pulse of your portfolio this month.</p></div></section><section className="metric-grid"><Metric label="This month income" value={money(summary.thisMonthIncome)} note="Net house rent" accent="green" /><Metric label="Total outstanding" value={money(summary.totalOutstanding)} note="Across all open bills" accent="amber" /><Metric label="This month due" value={money(summary.thisMonthDue)} note="Current billing month" accent="blue" /><Metric label="Net profit" value={money(summary.thisMonthNetProfit)} note="After owner repairs" accent="rose" /></section><section className="dashboard-grid"><article className="dashboard-card trend-card"><div className="card-heading"><div><p className="card-kicker">Cash flow</p><h2>Income trend</h2></div><span className="range-label">Last 6 months</span></div><div className="bars">{summary.monthlyIncomeTrend.map((item) => <div className="bar-group" key={item.month}><div className="bar-track"><div className="bar" style={{ height: `${Math.max(5, Number(item.income) / max * 100)}%` }} /></div><span>{item.month.slice(5)}</span></div>)}</div></article><article className="dashboard-card occupancy-card"><div className="card-heading"><div><p className="card-kicker">Occupancy</p><h2>Units at a glance</h2></div><span className="occupancy-rate">{Math.round(occupancy)}%</span></div><PieChart segments={[{ label: 'Occupied', value: summary.occupiedUnits, color: '#5e8b6e' }, { label: 'Available', value: summary.availableUnits, color: '#c1d0c4' }]} centerLabel={String(summary.occupiedUnits)} centerNote={`of ${summary.totalUnits} units`} /></article><article className="dashboard-card"><div className="card-heading"><div><p className="card-kicker">This month</p><h2>Income split</h2></div></div><PieChart segments={[{ label: 'Net profit', value: netProfit, color: '#5e8b6e' }, { label: 'Owner repairs', value: repairCost, color: '#bd7c75' }]} centerLabel={money(summary.thisMonthIncome)} centerNote="collected" /></article><article className="dashboard-card"><div className="card-heading"><div><p className="card-kicker">Recent activity</p><h2>Payment methods</h2></div></div>{paymentMethodSegments.length ? <PieChart segments={paymentMethodSegments} centerLabel={String(summary.recentPayments.length)} centerNote="payments" /> : <p className="empty-state">No payments recorded yet.</p>}</article><article className="dashboard-card payments-card" id="payments"><div className="card-heading"><div><p className="card-kicker">Recent activity</p><h2>Latest payments</h2></div><a href="#payments">View all</a></div>{summary.recentPayments.length ? summary.recentPayments.slice(0, 5).map((payment) => <div className="payment-row" key={payment.id}><span className="payment-icon">↗</span><div><strong>{payment.method.replace('_', ' ')}</strong><small>{new Date(payment.paidOn).toLocaleDateString()}</small></div><b>{money(payment.amount)}</b></div>) : <p className="empty-state">No payments recorded yet.</p>}</article></section></div></main>;
}

function Metric({
  label,
  value,
  note,
  accent
}: {
  label: string;
  value: string | number;
  note?: string;
  accent?: string;
}) {
  return (
    <article className={`metric${accent ? ` metric-${accent}` : ''}`}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </article>
  );
}

type ProfileData = { id: string; email: string; fullName: string; phone: string; themePreference: string; emailVerifiedAt: string | null; createdAt: string };

// Dependency-free donut chart: plain SVG stroke-dasharray segments around a
// circle, in the same spirit as the hand-rolled bar/progress visuals already
// used elsewhere on the dashboard (no charting library in this app).
function PieChart({ segments, size = 128, thickness = 18, centerLabel, centerNote }: { segments: Array<{ label: string; value: number; color: string }>; size?: number; thickness?: number; centerLabel?: string; centerNote?: string }) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="pie-chart">
      <div className="pie-chart-svg-wrap">
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          {total <= 0
            ? <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#dce4dc" strokeWidth={thickness} />
            : segments.filter((segment) => segment.value > 0).map((segment) => {
              const dash = (segment.value / total) * circumference;
              const circle = <circle key={segment.label} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={segment.color} strokeWidth={thickness} strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} strokeLinecap={segments.filter((s) => s.value > 0).length > 1 ? 'butt' : 'round'} />;
              offset += dash;
              return circle;
            })}
        </svg>
        {(centerLabel || centerNote) && <div className="pie-chart-center"><strong>{centerLabel}</strong>{centerNote && <small>{centerNote}</small>}</div>}
      </div>
      <ul className="pie-chart-legend">
        {segments.map((segment) => <li key={segment.label}><i style={{ background: segment.color }} />{segment.label}<b>{total > 0 ? Math.round((Math.max(0, segment.value) / total) * 100) : 0}%</b></li>)}
      </ul>
    </div>
  );
}

function Profile({ token }: { token: string }) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');

  useEffect(() => {
    fetch(`${apiUrl}/auth/profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.json())
      .then((data: ProfileData) => { setProfile(data); setFullName(data.fullName); setPhone(data.phone); });
  }, [token]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setSavingProfile(true); setProfileMessage('');
    try {
      const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' });
      const { csrfToken } = await csrfResponse.json();
      const response = await fetch(`${apiUrl}/auth/profile`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ fullName, phone }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? 'Unable to update your profile.');
      setProfile((current) => current ? { ...current, fullName: body.fullName, phone: body.phone } : current);
      setProfileMessage('Profile updated. The dashboard greeting picks up your new name the next time you sign in.');
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : 'Unable to update your profile.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordMessage('');
    if (newPassword !== confirmNewPassword) { setPasswordMessage('New password and confirmation must match.'); return; }
    setChangingPassword(true);
    try {
      const csrfResponse = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' });
      const { csrfToken } = await csrfResponse.json();
      const response = await fetch(`${apiUrl}/auth/change-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrfToken }, credentials: 'include', body: JSON.stringify({ currentPassword, newPassword, confirmNewPassword }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? 'Unable to change your password.');
      // Changing the password revokes every session on the server, so send
      // the person back to log in fresh with the new one.
      await fetch(`${apiUrl}/auth/logout`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, credentials: 'include' }).catch(() => undefined);
      localStorage.removeItem('rms_access_token');
      window.location.href = '/';
    } catch (error) {
      setPasswordMessage(error instanceof Error ? error.message : 'Unable to change your password.');
      setChangingPassword(false);
    }
  }

  if (!profile) return <main className="loading-screen"><span className="status-dot" /> Loading profile</main>;

  return <main className="app-shell"><header className="topbar"><div className="brand"><img className="brand-mark" src="/icon-192.png" alt="RMS" /><span>RMS</span></div><TopNav active="" /><AccountMenu /></header><div className="content"><section className="welcome-row"><div><p className="eyebrow">RMS / ACCOUNT</p><h1>Profile.</h1><p className="subtle">Your account details and security settings.</p></div></section><section className="dashboard-grid"><form className="dashboard-card" onSubmit={saveProfile}><div className="card-heading"><div><p className="card-kicker">Account</p><h2>Personal details</h2></div></div><label>Email<input value={profile.email} disabled /></label><label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} required minLength={1} /></label><label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} required minLength={7} /></label>{profileMessage && <p className={profileMessage.startsWith('Profile updated') ? 'form-note' : 'error'} role="status">{profileMessage}</p>}<button className="primary-button" disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save changes'}</button></form><form className="dashboard-card" onSubmit={changePassword}><div className="card-heading"><div><p className="card-kicker">Security</p><h2>Change password</h2></div></div><label>Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoComplete="current-password" /></label><label>New password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={10} required autoComplete="new-password" /></label><label>Confirm new password<input type="password" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} minLength={10} required autoComplete="new-password" /></label>{passwordMessage && <p className="error" role="status">{passwordMessage}</p>}<button className="primary-button" disabled={changingPassword}>{changingPassword ? 'Updating...' : 'Change password'}</button><p className="form-note">Changing your password signs you out everywhere. You will need to log in again.</p></form></section></div></main>;
}

function Settings({ token }: { token: string }) {
  const [currency, setCurrency] = useState(() => getCurrencyCode());
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(() => getTimeFormat());
  const [saved, setSaved] = useState(false);

  function applyCurrency(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    localStorage.setItem(CURRENCY_STORAGE_KEY, next);
    setCurrency(next);
    setSaved(true);
    // The currency sign is read by the module-level `money()` helper used
    // across every page. Reloading is the simplest way to make every
    // already-mounted component pick up the new sign immediately and
    // consistently, without threading a currency context through the
    // whole app.
    window.setTimeout(() => window.location.reload(), 400);
  }

  function applyTimeFormat(next: TimeFormat) {
    localStorage.setItem(TIME_FORMAT_STORAGE_KEY, next);
    setTimeFormat(next);
    setSaved(true);
    window.setTimeout(() => window.location.reload(), 400);
  }

  return <main className="app-shell"><header className="topbar"><div className="brand"><img className="brand-mark" src="/icon-192.png" alt="RMS" /><span>RMS</span></div><TopNav active="" /><AccountMenu /></header><div className="content"><section className="welcome-row"><div><p className="eyebrow">RMS / ACCOUNT</p><h1>Settings.</h1><p className="subtle">Preferences for how RMS displays information on this device.</p></div></section><section className="dashboard-grid"><div className="dashboard-card"><div className="card-heading"><div><p className="card-kicker">Display</p><h2>Currency</h2></div></div><label>Currency sign<select value={currency} onChange={applyCurrency}>{CURRENCIES.map((option) => <option value={option.code} key={option.code}>{option.label}</option>)}</select></label><p className="subtle">Applies to every amount shown across the dashboard, payments, tenants, and reports on this device.</p></div><div className="dashboard-card"><div className="card-heading"><div><p className="card-kicker">Display</p><h2>Time format</h2></div></div><div className="report-actions"><button type="button" className={timeFormat === '12h' ? 'primary-button compact' : 'quiet-button export-button'} onClick={() => applyTimeFormat('12h')}>12-hour (2:30 PM)</button><button type="button" className={timeFormat === '24h' ? 'primary-button compact' : 'quiet-button export-button'} onClick={() => applyTimeFormat('24h')}>24-hour (14:30)</button></div><p className="subtle">Controls how the clock on the Dashboard is displayed on this device.</p></div>{saved && <p className="form-note" role="status">Saved. Refreshing…</p>}</section></div></main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><ServerWakeGate><App /></ServerWakeGate></StrictMode>);
