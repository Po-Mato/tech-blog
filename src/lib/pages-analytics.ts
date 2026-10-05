const endpoint = 'https://wedding-game-invitation.happyugn.workers.dev/api/pages/visits';
const key = '__poMatoAnonymousVisit' as const;
type AnalyticsWindow = Window & { [key]?: boolean };
/** One document open, not one component mount or client-side route transition. */
export function startPagesAnalytics(win: AnalyticsWindow = window): void {
  if (win[key] || win.location.hostname !== 'po-mato.github.io'
    || win.location.pathname.startsWith('/pixel-garden-invitation')
    || win.navigator.webdriver || win.navigator.doNotTrack === '1'
    || (win.navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
  win[key] = true;
  let payload: string;
  try { payload = JSON.stringify({ site: 'blog', event: 'visit', eventId: win.crypto.randomUUID() }); }
  catch { return; }
  const expires = Date.now() + 15 * 60_000;
  let attempts = 0, busy = false, done = false;
  const dispose = () => { done = true; payload = ''; win.removeEventListener('online', online); win.clearTimeout(expiryTimer); };
  const send = async () => {
    if (done || busy || !win.navigator.onLine) return;
    if (Date.now() >= expires || attempts >= 3) { dispose(); return; }
    busy = true; attempts++;
    try {
      const response = await win.fetch(endpoint, { method: 'POST', body: payload,
        headers: { 'content-type': 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true });
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) dispose();
    } catch { /* Optional counts never interrupt navigation or show an error. */ }
    finally { busy = false; }
    if (!done) win.setTimeout(() => { void send(); }, attempts * 2_000);
  };
  const online = () => { void send(); };
  const expiryTimer = win.setTimeout(dispose, 15 * 60_000);
  win.addEventListener('online', online);
  void send();
}
