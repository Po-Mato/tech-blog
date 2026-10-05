import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPagesAnalytics } from './pages-analytics';
function browser() {
  const target = new EventTarget();
  return Object.assign(target, { location: { hostname:'po-mato.github.io', pathname:'/',search:'?private=secret',hash:'#private' },
    navigator:{onLine:true,webdriver:false,doNotTrack:null},crypto:{randomUUID:()=> '01234567-89ab-4def-8123-456789abcdef'},
    fetch:vi.fn().mockResolvedValue({ok:true,status:204}),setTimeout,clearTimeout });
}
describe('anonymous document visit',()=>{
 afterEach(()=>vi.useRealTimers());
 it('deduplicates StrictMode and SPA mounts; sends no URL or credentials',async()=>{
  vi.useFakeTimers();const w=browser();startPagesAnalytics(w as unknown as Window);w.location.pathname='/posts/example/';startPagesAnalytics(w as unknown as Window);
  await vi.advanceTimersByTimeAsync(1);expect(w.fetch).toHaveBeenCalledTimes(1);
  const [url,options]=w.fetch.mock.calls[0];expect(url).toBe('https://wedding-game-invitation.happyugn.workers.dev/api/pages/visits');
  expect(JSON.parse(options.body)).toEqual({site:'blog',event:'visit',eventId:'01234567-89ab-4def-8123-456789abcdef'});
  expect(options).toMatchObject({credentials:'omit',referrerPolicy:'no-referrer'});
 });
 it('retries at most three times with the same receipt and does not throw',async()=>{
  vi.useFakeTimers();const w=browser();w.fetch.mockRejectedValue(Error('offline'));startPagesAnalytics(w as unknown as Window);
  await vi.advanceTimersByTimeAsync(20000);expect(w.fetch).toHaveBeenCalledTimes(3);
  expect(new Set(w.fetch.mock.calls.map(c=>c[1].body)).size).toBe(1);
 });
 it('waits for online without storage; expires unsent visits',async()=>{
  vi.useFakeTimers();const w=browser();w.navigator.onLine=false;startPagesAnalytics(w as unknown as Window);expect(w.fetch).not.toHaveBeenCalled();
  w.navigator.onLine=true;w.dispatchEvent(new Event('online'));await vi.advanceTimersByTimeAsync(1);expect(w.fetch).toHaveBeenCalledTimes(1);
  const expired=browser();expired.navigator.onLine=false;startPagesAnalytics(expired as unknown as Window);await vi.advanceTimersByTimeAsync(16*60000);expired.navigator.onLine=true;expired.dispatchEvent(new Event('online'));expect(expired.fetch).not.toHaveBeenCalled();
 });
 it('skips local tests, automation, opt-out and the wedding subtree',()=>{
  vi.useFakeTimers();for(const kind of ['localhost','automation','privacy','wedding']){
   const w=browser();if(kind==='localhost')w.location.hostname='localhost';if(kind==='automation')w.navigator.webdriver=true;if(kind==='privacy')Object.assign(w.navigator,{globalPrivacyControl:true});if(kind==='wedding')w.location.pathname='/pixel-garden-invitation/';startPagesAnalytics(w as unknown as Window);expect(w.fetch).not.toHaveBeenCalled();
  }
 });
});
