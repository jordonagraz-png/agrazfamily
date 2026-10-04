// End-to-end UI tests for the public site and the Family Hub, using Playwright and a
// fake Firebase (tests/mock-firebase.js). Hermetic: all external requests are blocked.
//   npm run test:ui
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { start } from './serve.mjs';
import { zipOf } from './zip.mjs';

const SLOW = Number(process.env.SLOW) || 1; // CI runners can be slower: SLOW=2 doubles every wait
const MOCK = readFileSync(new URL('./mock-firebase.js', import.meta.url), 'utf8');
const server = await start(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
// Fake microphone for the Voice Stories recorder.
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const LOCAL = BASE.replace('127.0.0.1', 'localhost'); // WebAuthn needs a domain name, not an IP
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name); } };

async function open(path, mock = {}, opts = {}) {
  const { localhost, webauthn, lockedTree, gate, ...ctxOpts } = opts;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block', acceptDownloads: true, ...ctxOpts });
  await ctx.addInitScript(([m, gate]) => {
    window.__MOCK = m;
    if (!gate) { try { sessionStorage.setItem('agraz-seen-public', '1'); } catch (e) {} } // most tests have "been to the public site"
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  }, [mock, !!gate]);
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (lockedTree && /\/assets\/data\/tree-import\.bin(\?|$)/.test(url)) return route.fulfill({ contentType: 'application/octet-stream', body: lockedTree });
    if (url.startsWith(BASE) || url.startsWith(LOCAL)) return route.continue();
    if (url.startsWith('https://www.gstatic.com/firebasejs/')) {
      return route.fulfill({ contentType: 'text/javascript', body: url.includes('firebase-app-compat') ? MOCK : '/* stub */' });
    }
    return route.abort();
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  if (ctxOpts.clockTime) await page.clock.install({ time: ctxOpts.clockTime });
  if (webauthn) {
    // A virtual Face ID / fingerprint sensor that always recognizes you.
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  }
  await page.goto((localhost ? LOCAL : BASE) + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(SLOW * 500);
  return page;
}
const state = p => p.evaluate(() => document.body.dataset.state);
const go = async (p, hash) => { await p.evaluate(h => { location.hash = h; }, hash); await p.waitForTimeout(SLOW * 450); };
const store = (p, fn) => p.evaluate(fn);
async function done(p, label) {
  ok(p.errors.length === 0, `${label}: no script errors ${p.errors.length ? JSON.stringify(p.errors) : ''}`);
  const csp = await p.evaluate(() => window.__csp);
  ok(csp.length === 0, `${label}: no CSP violations ${csp.length ? JSON.stringify(csp) : ''}`);
  await p.context().close();
}

try {
  console.log('— public site');
  {
    const night = await open('/', {}, { clockTime: new Date(2026, 9, 2, 22, 0) });
    ok(await night.evaluate(() => document.documentElement.dataset.tod) === 'night', 'hero follows the sun: night at 10pm');
    ok((await night.getAttribute('#hero-img', 'src') || '').includes('1534447677768'), 'night hero photo chosen');
    await done(night, 'homepage');
    const dawn = await open('/', {}, { clockTime: new Date(2026, 9, 2, 7, 30) });
    ok((await dawn.getAttribute('#hero-img', 'src') || '').includes('1473116763249'), 'dawn hero photo chosen at 7:30am');
    await done(dawn, 'homepage (dawn)');

    // Every way into the hub passes through the public site first, once per visit.
    const gated = await open('/family/#tree?key=abc-123', { signedIn: true }, { gate: true });
    await gated.waitForTimeout(SLOW * 600);
    ok(new URL(gated.url()).pathname === '/' && !gated.url().includes('abc-123'), 'a direct hub link lands on the public site first — and the key never shows in the address bar');
    ok(await gated.evaluate(() => [...document.querySelectorAll('a[href^="/family/"]')].every(a => a.getAttribute('href') === '/family/#tree?key=abc-123')), 'every Family Login button carries you on to where you were going');
    ok(await gated.isVisible('.hub-continue'), 'and a quiet “Continue to the Family Hub” waits at the foot of the page');
    await gated.click('.hub-continue');
    await gated.waitForTimeout(SLOW * 900);
    ok(new URL(gated.url()).pathname === '/family/' && await gated.evaluate(() => document.body.dataset.state) === 'app', 'then the hub opens as usual');
    await done(gated, 'front porch first');
    const seen = await open('/family/#home', { signedIn: true });
    ok(new URL(seen.url()).pathname === '/family/', 'having seen the public site this visit, the hub opens straight away');
    await seen.context().close();
    const legacy = await open('/#memories');
    await legacy.waitForTimeout(SLOW * 300);
    ok(legacy.url().endsWith('/family/#photos'), 'old /#memories links forward to the hub');
    await legacy.context().close();
  }

  console.log('— sign in');
  {
    const p = await open('/family/', { signedIn: false });
    ok(await state(p) === 'auth', 'signed-out visitors see sign-in');
    await p.fill('#login-email', 'jordon@example.com');
    await p.fill('#login-pass', 'nope');
    await p.click('#form-login button[type=submit]');
    await p.waitForTimeout(SLOW * 300);
    ok((await p.textContent('#auth-msg')).includes('don’t match'), 'wrong password is rejected politely');
    await p.fill('#login-pass', 'password123');
    await p.click('#form-login button[type=submit]');
    await p.waitForTimeout(SLOW * 900);
    ok(await state(p) === 'app', 'correct password opens the hub');
    ok((await p.textContent('#home-title')).includes('Jordon'), 'greeting uses first name');
    ok(['dawn', 'day', 'dusk', 'night'].includes(await p.evaluate(() => document.documentElement.dataset.tod)), 'hub follows the sun');
    await done(p, 'sign in');
  }

  console.log('— joining');
  {
    const p = await open('/family/#join', { signedIn: false, newUser: true });
    await p.fill('#join-name', 'New Cousin');
    await p.fill('#join-email', 'cousin@example.com');
    await p.fill('#join-pass', 'longenough1');
    await p.fill('#join-code', 'wrong');
    await p.click('#form-join button[type=submit]');
    await p.waitForTimeout(SLOW * 800);
    ok((await p.textContent('#auth-msg')).includes('invite code isn’t right'), 'wrong invite code rejected');
    ok(await p.evaluate(() => !firebase.auth().currentUser), 'half-made account removed');
    ok(await store(p, () => !window.__store.users.new1), 'no member doc without a valid code');
    await p.fill('#join-code', 'seashell');
    await p.click('#form-join button[type=submit]');
    await p.waitForTimeout(SLOW * 1200);
    ok(await state(p) === 'app', 'right invite code joins the family');
    await done(p, 'joining');

    const a = await open('/family/#join', { signedIn: false, newUser: true, requireApproval: true });
    await a.fill('#join-name', 'Approval Pending');
    await a.fill('#join-email', 'pending@example.com');
    await a.fill('#join-pass', 'longenough1');
    await a.fill('#join-code', 'seashell');
    await a.click('#form-join button[type=submit]');
    await a.waitForTimeout(SLOW * 1200);
    ok(!(await a.evaluate(() => document.getElementById('form-pending').hidden)), 'approval required: new member sees "waiting for approval"');
    ok(await store(a, () => window.__store.users.new1.approved === false), 'member doc created as pending');
    await a.click('[data-action=check-approval]');
    await a.waitForTimeout(SLOW * 400);
    ok((await a.textContent('#auth-msg')).includes('Still waiting'), '"Check again" while still pending');
    await store(a, () => { window.__store.users.new1.approved = true; });
    await a.click('[data-action=check-approval]');
    await a.waitForTimeout(SLOW * 900);
    ok(await state(a) === 'app', 'after approval, "Check again" lets them in');
    await done(a, 'approval flow');
  }

  console.log('— coming back after being removed');
  {
    // Their account outlived their removal: signing up again with the same email and old password lets them back in.
    const r = await open('/family/#join', { signedIn: false, newUser: true, returning: { email: 'back@example.com', uid: 'r1', name: 'Elena Ruiz' } });
    await r.fill('#join-name', 'Elena Ruiz');
    await r.fill('#join-email', 'back@example.com');
    await r.fill('#join-pass', 'password123');
    await r.fill('#join-code', 'seashell');
    await r.click('#form-join button[type=submit]');
    await r.waitForTimeout(SLOW * 1200);
    ok(await state(r) === 'app', 'signing up again with an email from before (and its password) lets a removed member back in');
    ok(await store(r, () => window.__store.users.r1 && window.__store.users.r1.email === 'back@example.com'), 'their member doc is back');
    ok(await r.evaluate(() => !!firebase.auth().currentUser), 'their old account is kept, never deleted');
    await done(r, 'coming back');

    // Forgot the password too: they're offered a reset link instead of "already exists".
    const f = await open('/family/#join', { signedIn: false, newUser: true, returning: { email: 'back@example.com', uid: 'r1' } });
    await f.fill('#join-name', 'Elena Ruiz');
    await f.fill('#join-email', 'back@example.com');
    await f.fill('#join-pass', 'forgotten-it');
    await f.fill('#join-code', 'seashell');
    await f.click('#form-join button[type=submit]');
    await f.waitForTimeout(SLOW * 600);
    ok(!(await f.isHidden('#form-reset')) && (await f.textContent('#auth-title')) === 'Welcome back', 'a returning email with a forgotten password gets "Welcome back", not "already exists"');
    ok(await f.inputValue('#reset-email') === 'back@example.com', 'their email is filled in for the reset link');
    await f.click('#form-reset button[type=submit]');
    await f.waitForTimeout(SLOW * 400);
    ok((await f.textContent('#auth-msg')).includes('reset link is on its way') && await store(f, () => window.__resets.some(x => x.email === 'back@example.com')), 'one tap sends them a reset link');
    ok(await store(f, () => !window.__resets[0].url), 'the reset email is sent plain (no continue link Firebase could refuse)');
    // …they choose a new password from the email and sign in: the code they typed is waiting for them.
    await f.click('#form-reset [data-auth=login]');
    await f.fill('#login-email', 'back@example.com');
    await f.fill('#login-pass', 'password123');
    await f.click('#form-login button[type=submit]');
    await f.waitForTimeout(SLOW * 800);
    ok(!(await f.isHidden('#form-finish')) && await f.inputValue('#finish-code') === 'seashell', 'after the reset and signing in, their invite code is already filled in');
    await f.click('#form-finish button[type=submit]');
    await f.waitForTimeout(SLOW * 1000);
    ok(await state(f) === 'app' && await store(f, () => window.__store.users.r1.name === 'Elena Ruiz'), 'one tap on Finish joining and they’re back in, under the name they typed');
    ok(await f.evaluate(() => !localStorage.getItem('agraz-rejoin')), 'the remembered code is cleared once they’re in');
    await done(f, 'coming back (forgot password)');
  }

  console.log('— keeping up with updates');
  {
    // The server now has a newer hub than the one this tab is running.
    const newer = async page => page.route(BASE + '/family/', async route => {
      if (route.request().resourceType() !== 'fetch') return route.continue();
      const r = await route.fetch();
      await route.fulfill({ response: r, body: (await r.text()).replace(/portal\.js\?v=\d+/, 'portal.js?v=299912312359') });
    });
    const a = await open('/family/', { signedIn: false });
    await newer(a);
    await a.evaluate(() => { window.__old = true; window.dispatchEvent(new Event('focus')); });
    await a.waitForTimeout(SLOW * 1500);
    ok(await a.evaluate(() => !window.__old), 'an older hub on the sign-in screen refreshes itself when a newer one is published');
    await a.evaluate(() => window.dispatchEvent(new Event('focus')));
    await a.waitForTimeout(SLOW * 800);
    ok(!!(await a.$('.update-bar')), '…once: after that it offers a Refresh button instead of reloading again');
    await done(a, 'updates (sign-in screen)');

    const b = await open('/family/#home', { signedIn: true });
    await b.waitForTimeout(SLOW * 600);
    await newer(b);
    await b.evaluate(() => { window.__old = true; window.dispatchEvent(new Event('focus')); });
    await b.waitForTimeout(SLOW * 800);
    ok(await b.evaluate(() => window.__old === true) && !!(await b.$('.update-bar [data-action=reload-app]')), 'signed in, it never reloads by itself: a bar offers Refresh');
    await done(b, 'updates (signed in)');
  }

  console.log('— admin approvals');
  {
    const p = await open('/family/#directory', { signedIn: true });
    await p.waitForTimeout(SLOW * 900);
    ok(await p.evaluate(() => !document.getElementById('pending-panel').hidden), 'admin sees pending members');
    ok((await p.textContent('.side-nav [data-pending-badge]')).trim() === '1', 'sidebar badge counts pending members');
    await p.click('[data-action=approve-member][data-uid=u7]');
    await p.waitForTimeout(SLOW * 800);
    ok(await store(p, () => window.__store.users.u7.approved === true), 'approve updates the member');
    ok(await p.evaluate(() => document.getElementById('pending-panel').hidden), 'pending panel clears');
    ok((await p.textContent('#people')).includes('Lucia Torres'), 'approved member appears in the directory');
    await done(p, 'admin');
    const n = await open('/family/#directory', { signedIn: true, admin: false });
    await n.waitForTimeout(SLOW * 900);
    ok(await n.evaluate(() => document.getElementById('pending-panel').hidden), 'non-admins never see pending members');
    ok(!(await n.textContent('#people')).includes('Lucia Torres'), 'pending members hidden from the directory');
    await n.context().close();
  }

  console.log('— calendar: RSVP + add to calendar');
  {
    const p = await open('/family/#calendar', { signedIn: true });
    await p.waitForTimeout(SLOW * 900);
    const ev = '#cal-agenda [data-action=rsvp][data-id=e3]';
    await p.click(`${ev}[data-v=yes]`);
    await p.waitForTimeout(SLOW * 300);
    ok(await store(p, () => window.__store.events.e3.rsvp.u1 === 'yes'), 'RSVP "Going" saved');
    ok(await p.getAttribute(`${ev}[data-v=yes]`, 'aria-pressed') === 'true', 'RSVP button shows your choice');
    await p.click(`${ev}[data-v=maybe]`);
    await p.waitForTimeout(SLOW * 300);
    ok(await store(p, () => window.__store.events.e3.rsvp.u1 === 'maybe'), 'RSVP can be changed');
    ok((await p.textContent('#cal-agenda')).includes('3 going'), 'RSVP summary shows who’s going');
    await p.click('#cal-agenda [data-action=add-cal][data-id=e1]');
    await p.waitForTimeout(SLOW * 200);
    const g = await p.getAttribute('#addcal-google', 'href');
    ok(g.startsWith('https://calendar.google.com/calendar/render?') && /dates=\d{8}T173000%2F\d{8}T193000/.test(g), 'Google Calendar link has the right time');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-action=addcal-ics]')]);
    const ics = readFileSync(await dl.path(), 'utf8');
    ok(ics.startsWith('BEGIN:VCALENDAR') && /DTSTART:\d{8}T173000/.test(ics) && ics.includes('SUMMARY:Sunday dinner at Grandma’s') && ics.includes('\r\n'), 'calendar invite (.ics) is valid');
    ok(dl.suggestedFilename() === 'sunday-dinner-at-grandma-s.ics', 'invite has a friendly file name');
    await p.click('#view-calendar [data-action=new-event]');
    await p.fill('#ev-title', 'Test picnic <b>bold</b>');
    await p.click('#ev-save');
    await p.waitForTimeout(SLOW * 600);
    ok((await p.innerHTML('#cal-agenda')).includes('Test picnic &lt;b&gt;bold&lt;/b&gt;'), 'new event added, HTML escaped');
    await done(p, 'calendar');
  }

  console.log('— updates: hearts + comments');
  {
    const p = await open('/family/#updates', { signedIn: true });
    await p.waitForTimeout(SLOW * 900);
    await p.click('[data-action=heart][data-id=p3]');
    await p.waitForTimeout(SLOW * 300);
    ok(await store(p, () => window.__store.updates.p3.hearts.u1 === true), 'heart saved');
    ok((await p.textContent('[data-action=heart][data-id=p3]')).trim() === '1', 'heart count updates');
    await p.click('[data-action=heart][data-id=p3]');
    await p.waitForTimeout(SLOW * 300);
    ok(await store(p, () => window.__store.updates.p3.hearts.u1 === false), 'heart can be taken back');
    ok((await p.textContent('[data-action=toggle-thread][data-parent="updates/p1"]')).includes('2 comments'), 'comment count shown');
    await p.click('[data-action=toggle-thread][data-parent="updates/p1"]');
    await p.waitForTimeout(SLOW * 200);
    await p.fill('[data-thread="updates/p1"] .comment-input', 'Welcome home <img src=x onerror=alert(1)>');
    await p.press('[data-thread="updates/p1"] .comment-input', 'Enter');
    await p.waitForTimeout(SLOW * 500);
    const thread = await p.innerHTML('[data-thread="updates/p1"]');
    ok(thread.includes('Welcome home &lt;img') && !thread.includes('<img src="x"'), 'comment posted and escaped');
    ok((await p.textContent('[data-action=toggle-thread][data-parent="updates/p1"]')).includes('3 comments'), 'comment count updates');
    await p.click('[data-thread="updates/p1"] [data-action=delete-comment]');
    await p.click('#confirm-ok');
    await p.waitForTimeout(SLOW * 500);
    ok((await p.textContent('[data-action=toggle-thread][data-parent="updates/p1"]')).includes('2 comments'), 'own comment deleted');
    await done(p, 'updates');
  }

  console.log('— photos: lightbox hearts + comments');
  {
    const p = await open('/family/#photos', { signedIn: true });
    await p.waitForTimeout(SLOW * 900);
    await p.click('#photo-grid .photo >> nth=0');
    await p.waitForTimeout(SLOW * 400);
    ok((await p.textContent('#lb-actions')).includes('1 comment'), 'photo shows its comments count');
    await p.click('#lb-actions [data-action=heart]');
    await p.waitForTimeout(SLOW * 300);
    const first = await store(p, () => Object.keys(window.__store.memories).find(k => window.__store.memories[k].hearts && window.__store.memories[k].hearts.u1));
    ok(!!first, 'heart a photo from the viewer');
    await p.click('#lb-actions [data-action=lb-thread]');
    await p.waitForTimeout(SLOW * 300);
    ok(!(await p.evaluate(() => document.getElementById('lb-thread').hidden)), 'comments panel opens');
    await p.fill('#lb-thread .comment-input', 'Frame this one!');
    await p.press('#lb-thread .comment-input', 'Enter');
    await p.waitForTimeout(SLOW * 500);
    ok((await p.textContent('#lb-thread')).includes('Frame this one!'), 'comment on a photo');
    await p.keyboard.press('Escape');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(SLOW * 200);
    ok(await p.evaluate(() => document.getElementById('lightbox').hidden), 'viewer closes');
    await done(p, 'photos');
  }

  console.log('— home: birthdays + on this day');
  {
    const p = await open('/family/#home', { signedIn: true, bdayToday: true });
    await p.waitForTimeout(SLOW * 1500);
    ok(await p.evaluate(() => !document.getElementById('home-bday').hidden), 'birthday banner on the day');
    ok((await p.textContent('#home-bday')).includes('Maria’s birthday'), 'banner names the birthday person');
    ok(await p.evaluate(() => !!document.querySelector('canvas.confetti')), 'confetti!');
    ok(await p.evaluate(() => !document.getElementById('home-otd').hidden), '"On this day" shows last year’s photos');
    ok((await p.textContent('#home-otd')).includes('1 year ago'), '"On this day" labels how long ago');
    await p.click('[data-action=bday-wish]');
    await p.waitForTimeout(SLOW * 600);
    ok((await p.inputValue('#post-text')).startsWith('Happy birthday, Maria!'), '"Send wishes" starts a birthday post');
    await done(p, 'home');
  }

  console.log('— recipes');
  {
    const p = await open('/family/#recipes', { signedIn: true });
    await p.waitForTimeout(SLOW * 900);
    ok(await p.$$eval('.recipe-card', e => e.length) === 3, 'recipe book lists recipes');
    await p.click('[data-action=recipe-filter][data-cat=desserts]');
    ok(await p.$$eval('.recipe-card', e => e.length) === 1, 'filter by category');
    await p.click('[data-action=recipe-filter][data-cat=all]');
    await p.fill('#recipe-search', 'paprika');
    ok(await p.$$eval('.recipe-card', e => e.length) === 1, 'search finds ingredients');
    await p.fill('#recipe-search', '');
    await p.click('.recipe-card >> text=Grandma’s Flan');
    await p.waitForTimeout(SLOW * 200);
    ok(await p.$$eval('#rv-ingredients input[type=checkbox]', e => e.length) === 5, 'recipe shows tick-off ingredients');
    ok(await p.$$eval('#rv-steps li', e => e.length) === 4, 'recipe shows numbered steps');
    await p.evaluate(() => document.body.classList.add('printing-recipe'));
    await p.emulateMedia({ media: 'print' });
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('.app')).display === 'none' && getComputedStyle(document.getElementById('recipe-dialog')).display !== 'none'), 'printing shows only the recipe');
    await p.emulateMedia({ media: 'screen' });
    await p.evaluate(() => document.body.classList.remove('printing-recipe'));
    await p.click('[data-action=edit-recipe]');
    await p.fill('#rf-time', '2 hrs');
    await p.click('#rf-save');
    await p.waitForTimeout(SLOW * 600);
    ok(await store(p, () => window.__store.recipes.r1.time === '2 hrs' && window.__store.recipes.r1.uid === 'u2'), 'edit a recipe (owner kept)');
    await p.keyboard.press('Escape');
    await p.click('#view-recipes .view-head [data-action=new-recipe]');
    await p.fill('#rf-name', 'Café con leche');
    await p.selectOption('#rf-cat', 'drinks');
    await p.fill('#rf-ingredients', 'Espresso\nHot milk\nSugar');
    await p.fill('#rf-steps', 'Brew.\nPour.\nStir.');
    await p.setInputFiles('#rf-photo-input', { name: 'cafe.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDKgAQYGBgB4tgX9u4oIYQAAAABJRU5ErkJggg==', 'base64') });
    await p.waitForTimeout(SLOW * 500);
    await p.click('#rf-save');
    await p.waitForTimeout(SLOW * 700);
    const added = await store(p, () => Object.values(window.__store.recipes).find(r => r.title === 'Café con leche'));
    const why = added ? '' : JSON.stringify(await p.evaluate(() => ({ titles: Object.values(window.__store.recipes).map(r => r.title), open: [...document.querySelectorAll('dialog[open]')].map(d => d.id), toast: document.getElementById('toast').textContent, name: document.getElementById('rf-name').value, photoReady: !document.getElementById('rf-photo-remove').hidden })));
    ok(added && added.category === 'drinks' && /^data:image\/jpeg;base64,/.test(added.photo), 'add a recipe with a photo ' + why);
    ok(await p.evaluate(() => document.getElementById('recipe-dialog').open && document.getElementById('rv-title').textContent === 'Café con leche'), 'new recipe opens');
    await p.click('[data-action=delete-recipe]');
    await p.click('#confirm-ok');
    await p.waitForTimeout(SLOW * 600);
    ok(await p.$$eval('.recipe-card', e => e.length) === 3, 'delete a recipe');
    await done(p, 'recipes');
  }

  console.log('— memorial: candles + guestbook');
  {
    const p = await open('/family/#memorial', { signedIn: true });
    await p.waitForTimeout(SLOW * 900);
    ok(await p.$$eval('#candle-row .mini-candle', e => e.length) === 4, 'candles lit by the family are shown');
    ok((await p.textContent('#candles-who')).includes('4 candles lit by'), 'candle summary');
    await p.click('#candle-btn');
    await p.waitForTimeout(SLOW * 500);
    ok(await store(p, () => !!window.__store.candles.u1), 'light a candle');
    ok((await p.textContent('#candle-btn')).includes('Your candle is lit') && await p.isDisabled('#candle-btn'), 'candle stays lit');
    ok(await p.$$eval('.tribute', e => e.length) === 2, 'guestbook shows memories');
    await p.fill('#tribute-text', 'He always had a joke ready. <script>x</script>');
    await p.click('#tribute-btn');
    await p.waitForTimeout(SLOW * 600);
    ok(await p.$$eval('.tribute', e => e.length) === 3 && (await p.innerHTML('#tributes')).includes('&lt;script&gt;'), 'share a memory (escaped)');
    await done(p, 'memorial');
  }

  console.log('— vault lock');
  {
    const p = await open('/family/#vault', { signedIn: true }, { clockTime: new Date() });
    await p.waitForTimeout(SLOW * 800);
    ok(!(await p.isHidden('#vault-lock')) && await p.isHidden('#vault-content'), 'vault starts locked');
    ok(await store(p, () => document.getElementById('notes').innerHTML === ''), 'no vault data loaded while locked');
    await p.fill('#vault-pass', 'wrong');
    await p.click('#vault-unlock');
    await p.waitForTimeout(SLOW * 300);
    ok((await p.textContent('#vault-msg')).includes('isn’t right'), 'wrong password keeps it locked');
    await p.fill('#vault-pass', 'password123');
    await p.click('#vault-unlock');
    await p.waitForTimeout(SLOW * 700);
    ok(await p.$$eval('.note', e => e.length) === 3, 'right password opens the vault');
    ok(await p.$$eval('.note-body.concealed', e => e.length) === 3, 'notes stay hidden until tapped');
    await p.clock.fastForward('06:00');
    await p.waitForTimeout(SLOW * 300);
    ok(!(await p.isHidden('#vault-lock')) && (await p.innerHTML('#notes')) === '', 'vault relocks after 5 idle minutes');
    await done(p, 'vault');
  }

  console.log('— invite family');
  {
    const p = await open('/family/#invite', { signedIn: true }, { permissions: ['clipboard-read', 'clipboard-write'] });
    await p.waitForTimeout(SLOW * 900);
    const link = await p.inputValue('#invite-link');
    ok(link.endsWith('/family/#join?code=seashell'), 'admin sees the invite link with the code built in');
    ok(await p.$$eval('#invite-qr svg path', e => e.length) === 1, 'QR code drawn for in-person invites');
    ok((await p.textContent('.side-nav a[href="#invite"] [data-pending-badge]')).trim() === '1', 'Invite menu item shows people waiting');
    await p.click('[data-action=copy-invite-link]');
    await p.waitForTimeout(SLOW * 200);
    ok(await p.evaluate(() => navigator.clipboard.readText()) === link, 'Copy link puts the invite link on the clipboard');
    const sms = await p.getAttribute('.share-row a[href^="sms:"]', 'href');
    ok(sms.includes(encodeURIComponent(link)), 'Text message button carries the link');
    ok((await p.getAttribute('.share-row a[href^="mailto:"]', 'href')).includes('subject='), 'Email button has a subject and message');
    await p.click('[data-action=copy-invite-message]');
    await p.waitForTimeout(SLOW * 200);
    ok((await p.evaluate(() => navigator.clipboard.readText())).includes('Invite code: seashell'), 'Copy invite message includes the link and code');
    await p.check('#invite-approval');
    await p.waitForTimeout(SLOW * 400);
    ok(await store(p, () => window.__store.config.invite.requireApproval === true), 'approval switch saves');
    await p.fill('#help-reset-email', 'not-an-email');
    await p.click('#help-reset-form button[type=submit]');
    await p.waitForTimeout(SLOW * 100);
    ok((await p.textContent('#help-reset-msg')).includes('valid email') && await store(p, () => !window.__resets.length), '"Help someone sign in" checks the email first');
    await p.fill('#help-reset-email', 'removed@example.com');
    await p.click('#help-reset-form button[type=submit]');
    await p.waitForTimeout(SLOW * 400);
    ok((await p.textContent('#help-reset-msg')).includes('Reset link sent to removed@example.com') && await store(p, () => window.__resets[0].email === 'removed@example.com'), '"Help someone sign in" sends a reset link to anyone, even someone removed');
    ok((await p.textContent('.invite-how')).includes('You approve them'), '"How it works" reflects approval');
    await p.click('#invite-body [data-action=approve-member][data-uid=u7]');
    await p.waitForTimeout(SLOW * 800);
    ok(await store(p, () => window.__store.users.u7.approved === true), 'approve a waiting member right from the Invite page');
    await p.click('[data-action=new-invite-code]');
    await p.click('#confirm-ok');
    await p.waitForTimeout(SLOW * 500);
    const code = await store(p, () => window.__store.config.invite.code);
    ok(/^[a-z]+-[a-z]+-\d{4}$/.test(code) && code !== 'seashell', `"Make a new code" creates a friendly code (${code})`);
    ok((await p.inputValue('#invite-link')).endsWith(`#join?code=${code}`), 'invite link updates with the new code');
    await p.click('[data-action=custom-invite-code]');
    await p.fill('#custom-code', 'abc');
    await p.press('#custom-code', 'Enter');
    await p.waitForTimeout(SLOW * 300);
    ok(await store(p, () => window.__store.config.invite.code) === code, 'too-short custom code is refused');
    await p.fill('#custom-code', 'agraz-sunday-dinner');
    await p.press('#custom-code', 'Enter');
    await p.waitForTimeout(SLOW * 500);
    ok(await store(p, () => window.__store.config.invite.code) === 'agraz-sunday-dinner', 'choose your own invite code');
    ok((await p.textContent('#rules-card')).includes('Up to date') && !!(await p.$('#rules-card [data-action=copy-rules]')), 'the Invite page always shows whether the security rules are current, with one tap to copy them');
    await p.click('#rules-card [data-action=copy-rules]');
    await p.waitForTimeout(SLOW * 400);
    ok((await p.evaluate(() => navigator.clipboard.readText())).startsWith('rules_version'), 'Copy the rules puts the whole rules file on the clipboard');
    await go(p, 'directory');
    ok(await p.isVisible('#view-directory a[href="#invite"]'), 'Directory has an "Invite family" button');
    await done(p, 'invite (admin)');

    const first = await open('/family/#invite', { signedIn: true, noInvite: true });
    await first.waitForTimeout(SLOW * 900);
    await first.click('[data-action=create-invite]');
    await first.waitForTimeout(SLOW * 500);
    ok(await store(first, () => /^[a-z]+-[a-z]+-\d{4}$/.test(window.__store.config.invite.code) && window.__store.config.invite.requireApproval === true), 'first-time setup: create the invite code from the hub');
    ok(await first.$$eval('#invite-qr svg', e => e.length) === 1, 'invite link + QR appear right after setup');
    await done(first, 'invite (setup)');

    const member = await open('/family/#invite', { signedIn: true, admin: false });
    await member.waitForTimeout(SLOW * 900);
    const body = await member.textContent('#invite-body');
    ok(!body.includes('seashell'), 'non-admins never see the invite code');
    ok(body.includes('Become the owner'), 'without any admin, the page offers first-time setup');
    await done(member, 'invite (member)');

    const setup = await open('/family/#invite', { signedIn: true, admin: false, noInvite: true });
    await setup.waitForTimeout(SLOW * 1000);
    ok((await setup.textContent('#rules-status')).includes('Published'), 'setup checks that the latest security rules are published');
    await setup.fill('#owner-key', 'not-the-key');
    await setup.click('#owner-go');
    await setup.waitForTimeout(SLOW * 600);
    ok((await setup.textContent('#owner-msg')).includes('didn’t work'), 'a wrong owner key is refused');
    ok(await store(setup, () => !window.__store.users.u1.role && !window.__store.config.owner), '…and changes nothing');
    ok(await setup.inputValue('#owner-key') === 'not-the-key', '…without wiping what you typed');
    await setup.fill('#owner-key', 'https://www.agrazfamily.com/family/#claim?key=test-owner-key');
    await setup.click('#owner-go');
    await setup.waitForTimeout(SLOW * 1200);
    ok(await store(setup, () => window.__store.users.u1.role === 'owner' && window.__store.config.owner.uid === 'u1'), 'pasting the owner link on the Invite page makes you the owner');
    ok(await store(setup, () => /^[a-z]+-[a-z]+-\d{4}$/.test((window.__store.config.invite || {}).code || '')), '…and creates the family invite code right away');
    ok((await setup.inputValue('#invite-link')).includes('#join?code='), '…with the invite link ready to share');
    ok((await setup.textContent('#toast')).includes('invite code is ready'), '…and says so');
    await done(setup, 'invite (owner setup)');

    const old = await open('/family/#invite', { signedIn: true, admin: false, oldRules: true }, { permissions: ['clipboard-read', 'clipboard-write'] });
    await old.waitForTimeout(SLOW * 1000);
    ok((await old.textContent('#rules-status')).includes('Not yet'), 'setup notices when the security rules aren’t published');
    ok((await old.getAttribute('.mini-steps a', 'href')).includes('/project/agrazfamily/firestore/'), '…links straight to the rules editor');
    await old.click('[data-action=copy-rules]');
    await old.waitForTimeout(SLOW * 300);
    const copied = await old.evaluate(() => navigator.clipboard.readText());
    ok(copied.startsWith('rules_version') && copied.includes('match /capsuleLetters/{id}') && copied.includes('function ownerKeyHash()'), '…and copies the latest rules to paste in');
    await old.fill('#owner-key', 'test-owner-key');
    await old.click('#owner-go');
    await old.waitForTimeout(SLOW * 600);
    ok((await old.textContent('#owner-msg')).includes('aren’t published'), '…and says to publish them before claiming');
    await done(old, 'invite (rules not published)');

    const guest = await open('/family/#join?code=seashell', { signedIn: false, newUser: true });
    ok(await guest.inputValue('#join-code') === 'seashell', 'invite link fills in the code for the new person');
    ok((await guest.textContent('#auth-sub')).includes('You’ve been invited'), 'invite link greets them');
    await guest.fill('#join-name', 'Invited Cousin');
    await guest.fill('#join-email', 'invited@example.com');
    await guest.fill('#join-pass', 'longenough1');
    await guest.click('#form-join button[type=submit]');
    await guest.waitForTimeout(SLOW * 1200);
    ok(await state(guest) === 'app', 'they join with just name, email and password');
    ok(!guest.url().includes('code='), 'the code is cleared from the address bar after joining');
    await done(guest, 'invite link');
  }

  console.log('— owner + admin powers');
  {
    const bad = await open('/family/#claim?key=wrong-key', { signedIn: true, admin: false });
    await bad.waitForTimeout(SLOW * 900);
    ok(await store(bad, () => !window.__store.users.u1.role && !window.__store.config.owner), 'a wrong owner key changes nothing');
    ok(!bad.url().includes('key='), 'the key is wiped from the address bar either way');
    await bad.context().close();

    const p = await open('/family/#claim?key=test-owner-key', { signedIn: true, admin: false });
    await p.waitForTimeout(SLOW * 1200);
    ok(await store(p, () => window.__store.users.u1.role === 'owner' && window.__store.config.owner.uid === 'u1'), 'the one-time owner link makes your account the owner');
    ok(!p.url().includes('key='), 'the owner key never stays in the address bar');
    ok((await p.textContent('#toast')).includes('You’re now the owner'), 'confirms you’re the owner');
    await go(p, 'profile');
    ok((await p.textContent('#profile-role')).includes('Owner'), 'profile shows the Owner badge');
    await go(p, 'invite');
    ok(!!(await p.$('#invite-link')), 'the owner manages invites');
    await go(p, 'directory');
    ok((await p.textContent('#people')).includes('Owner'), 'directory shows who the owner is');
    await p.click('[data-action=manage-member][data-uid=u3]');
    await p.waitForTimeout(SLOW * 200);
    ok(!(await p.isHidden('#md-admin-row')), 'owner can make someone an admin');
    await p.fill('#md-phone', '(786) 555-0199');
    await p.check('#md-admin');
    await p.click('#md-save');
    await p.waitForTimeout(SLOW * 600);
    ok(await store(p, () => window.__store.users.u3.phone === '(786) 555-0199' && window.__store.users.u3.role === 'admin'), 'owner edits Daniel’s details and makes him an admin');
    ok((await p.textContent('#people')).includes('Admin'), 'new admin gets an Admin badge');
    await p.click('[data-action=manage-member][data-uid=u5]');
    await p.waitForTimeout(SLOW * 200);
    await p.click('#md-reset');
    await p.waitForTimeout(SLOW * 400);
    ok(await store(p, () => window.__resets.length === 1 && window.__resets[0].email === window.__store.users.u5.email), 'the owner sends a member a password reset link');
    ok((await p.textContent('#toast')).includes('Password reset link sent'), 'and is told it was sent');
    await p.click('#md-remove');
    await p.click('#confirm-ok');
    await p.waitForTimeout(SLOW * 600);
    ok(await store(p, () => !window.__store.users.u5), 'owner removes a member');
    ok(!(await p.textContent('#people')).includes('Elena Ruiz'), 'removed member leaves the directory');
    await go(p, 'updates');
    ok(await p.$$eval('#feed [data-action=delete-update]', e => e.length) === 4, 'owner can remove any update');
    await done(p, 'owner');

    const adm = await open('/family/#directory', { signedIn: true, role: 'admin' });
    await adm.waitForTimeout(SLOW * 900);
    await adm.click('[data-action=manage-member][data-uid=u3]');
    await adm.waitForTimeout(SLOW * 200);
    ok(await adm.isHidden('#md-admin-row'), 'admins can’t hand out admin (owner only)');
    ok(!(await adm.isHidden('#md-remove')), 'admins can remove regular members');
    await adm.keyboard.press('Escape');
    await go(adm, 'updates');
    await adm.click('#feed [data-action=delete-update][data-id=p4]');
    await adm.click('#confirm-ok');
    await adm.waitForTimeout(SLOW * 600);
    ok(await store(adm, () => !window.__store.updates.p4), 'admin removes someone else’s update');
    await adm.click('[data-action=toggle-thread][data-parent="updates/p1"]');
    ok(await adm.$$eval('[data-thread="updates/p1"] [data-action=delete-comment]', e => e.length) === 2, 'admin can remove anyone’s comments');
    await done(adm, 'admin');

    const mem = await open('/family/#updates', { signedIn: true, admin: false });
    await mem.waitForTimeout(SLOW * 900);
    ok(await mem.$$eval('#feed [data-action=delete-update]', e => e.length) === 1, 'members only see delete on their own updates');
    await go(mem, 'directory');
    ok(await mem.$$eval('[data-action=manage-member]', e => e.length) === 0, 'members can’t manage other members');
    await done(mem, 'member');
  }

  console.log('— family globe');
  {
    const p = await open('/family/#globe', { signedIn: true, placed: true });
    await p.waitForTimeout(SLOW * 1600);
    ok(await p.evaluate(() => !!window.AgrazGlobe), 'the globe loads on demand');
    ok(await p.evaluate(() => {
      const c = document.getElementById('globe-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0; for (let i = 3; i < d.length; i += 4 * 61) if (d[i] > 0) lit++;
      return lit > 1000;
    }), 'the Earth is drawn with live daylight');
    ok(await p.$$eval('.gpin', e => e.length) === 3, 'family pins: Miami (3 of us), Austin and Madrid');
    ok(await p.$$eval('#globe-clocks .clock', e => e.length) === 5, 'a clock for everyone on the globe');
    ok((await p.textContent('#globe-clocks')).includes('Madrid, Spain'), 'clocks say where each person is');
    ok((await p.textContent('#globe-clocks')).includes('mi away'), '…and how far they are from you');
    ok((await p.textContent('#globe-missing')).includes('Sofia'), 'lists who isn’t on the globe yet');
    ok((await p.textContent('#globe-best')).includes('Best time for a family call'), 'finds the best time for a family call');
    ok(await p.$$eval('#globe-strip .gt-cell', e => e.length) === 24, 'shows who’s awake hour by hour');
    // the clocks tick every few seconds, so allow for a minute that has only just turned
    const madridAt = ago => p.evaluate(ms => new Date(Date.now() - ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'Europe/Madrid' }), ago);
    const before = await madridAt(8000), shown = await p.textContent('.clock[data-uid=u3] .clock-time b'), after = await madridAt(0);
    ok(shown === before || shown === after, 'Daniel’s clock shows the time in Madrid');
    await p.evaluate(() => { const r = document.getElementById('globe-time'); r.value = '48'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    await p.waitForTimeout(SLOW * 200);
    ok((await p.textContent('#globe-time-label')) !== 'Now', 'slide forward in time');
    ok((await p.textContent('.clock[data-uid=u3] .clock-time b')) !== shown, '…and everyone’s clocks move with it');
    ok(await p.evaluate(() => document.getElementById('globe-live').classList.contains('travel')), '…and so does the daylight');
    await p.click('#globe-now');
    ok((await p.textContent('#globe-time-label')) === 'Now', 'back to now');
    await p.click('.clock[data-uid=u3]');
    await p.waitForTimeout(SLOW * 300);
    ok(await p.evaluate(() => document.querySelector('.gpin[data-ids="u3"]').classList.contains('is-active')), 'choosing someone highlights their pin');
    await p.click('#globe-spin');
    ok(await p.getAttribute('#globe-spin', 'aria-pressed') === 'false', 'the spin can be paused');
    await p.click('#globe-place-btn');
    ok(!(await p.isHidden('#globe-remove')), 'you can take yourself off the globe');
    await p.click('#globe-remove');
    await p.waitForTimeout(SLOW * 500);
    ok(await store(p, () => window.__store.users.u1.place === null), '…and your spot is removed');
    await done(p, 'globe');

    const q = await open('/family/#globe', { signedIn: true }, { geolocation: { latitude: 25.76168, longitude: -80.19179 }, permissions: ['geolocation'] });
    await q.waitForTimeout(SLOW * 1600);
    ok((await q.textContent('#globe-place-btn')).includes('Put me on the globe'), 'invites you to put yourself on the globe');
    await q.click('#globe-spin');
    await q.click('#globe-place-btn');
    ok(await q.isDisabled('#globe-save'), 'can’t save before choosing a spot');
    const box = await (await q.$('#globe-canvas')).boundingBox();
    await q.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await q.waitForTimeout(SLOW * 150);
    ok((await q.textContent('#globe-pick-title')).startsWith('Your spot:'), 'tap the globe to pick your spot');
    await q.click('#globe-locate');
    await q.waitForTimeout(SLOW * 500);
    ok((await q.textContent('#globe-pick-title')).includes('25.8°N, 80.2°W'), '“Use my location” finds you (rounded)');
    await q.fill('#globe-label', 'Miami, FL');
    await q.click('#globe-save');
    await q.waitForTimeout(SLOW * 600);
    const place = await store(q, () => window.__store.users.u1.place);
    ok(place && place.label === 'Miami, FL' && place.lat === 25.8 && place.lng === -80.2 && !!place.tz, 'your spot is saved, rounded, with your time zone');
    ok(await q.$$eval('#globe-clocks .clock', e => e.length) === 5, 'you join the family clocks');
    ok((await q.textContent('#globe-place-btn')).includes('Move my pin'), '…and can move your pin later');
    await done(q, 'globe picking');
  }

  console.log('— time capsules');
  {
    const p = await open('/family/#home', { signedIn: true });
    await p.waitForTimeout(SLOW * 1200);
    ok(!(await p.isHidden('#home-capsule')), 'home announces a time capsule that’s ready');
    ok(await p.evaluate(() => [...document.querySelectorAll('[data-capsule-badge]')].some(b => !b.hidden && b.textContent === '1')), 'the menu shows one waiting');
    await go(p, 'capsules');
    await p.waitForTimeout(SLOW * 300);
    ok(await p.$$eval('#capsules .capsule', e => e.length) === 3, 'all capsules are listed');
    ok(await p.$$eval('#capsules .capsule.is-sealed', e => e.length) === 2, 'two are still sealed');
    ok((await p.textContent('#capsules')).includes('in 4 years'), 'sealed ones count down to their day');
    ok(await p.$$eval('#capsules .is-sealed [data-action=open-capsule]', e => e.length) === 0, 'sealed capsules can’t be opened');
    ok(await p.evaluate(async () => { try { await firebase.firestore().collection('capsuleLetters').doc('k1').get(); return false; } catch (e) { return e.code === 'permission-denied'; } }), 'a sealed letter can’t be fetched early');
    await p.click('#capsules [data-action=open-capsule][data-id=k2]');
    await p.waitForTimeout(SLOW * 3000);
    ok((await p.textContent('#co-text')).includes('Look how far we’ve come'), 'opening it reveals the letter');
    ok(await p.evaluate(() => !document.getElementById('co-photo').hidden), '…and the photo tucked inside');
    ok((await p.textContent('#co-sealed')).includes('kept sealed for'), 'says how long it was sealed');
    ok(await store(p, () => window.__store.capsules.k2.openedBy.u1 === true), 'remembers that you read it');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(SLOW * 200);
    ok(await p.evaluate(() => [...document.querySelectorAll('[data-capsule-badge]')].every(b => b.hidden)), 'the badge clears once you’ve read it');
    ok(await p.$$eval('#capsules .capsule.is-opened', e => e.length) === 1, 'it moves to “Opened”');

    await p.click('.view-head [data-action=new-capsule]');
    await p.fill('#cap-title', 'For the grandkids');
    await p.fill('#cap-text', 'Dear ones, this is what 2026 was like.');
    ok((await p.textContent('#cap-presets')).includes('Sofia turns 18'), 'suggests a child’s 18th birthday');
    await p.click('#cap-presets [data-day]');
    ok((await p.textContent('#cap-hint')).includes('in 1 year'), 'quick picks set the opening day');
    await p.click('#cap-save');
    await p.waitForTimeout(SLOW * 300);
    ok((await p.textContent('#confirm-title')).includes('Seal it until'), 'asks before sealing it for good');
    await p.click('#confirm-ok');
    await p.waitForTimeout(SLOW * 900);
    const made = await store(p, () => {
      const id = Object.keys(window.__store.capsules).find(k => window.__store.capsules[k].title === 'For the grandkids');
      return id ? { cap: window.__store.capsules[id], letter: window.__store.capsuleLetters[id] } : null;
    });
    ok(!!made && !!made.letter && made.letter.text.includes('2026') && made.cap.openAt > Date.now() + 300 * 864e5 && made.cap.uid === 'u1', 'the capsule and its letter are sealed together');
    ok(await p.$$eval('#capsules .capsule.is-sealed', e => e.length) === 3, 'it joins the sealed capsules');
    await p.click('#capsules [data-action=delete-capsule][data-id=k2]');
    await p.click('#confirm-ok');
    await p.waitForTimeout(SLOW * 600);
    ok(await store(p, () => !window.__store.capsules.k2 && !window.__store.capsuleLetters.k2), 'you can delete your own capsule (letter and all)');
    await done(p, 'time capsules');

    const mem = await open('/family/#capsules', { signedIn: true, admin: false });
    await mem.waitForTimeout(SLOW * 1200);
    ok(await mem.$$eval('[data-action=delete-capsule]', e => e.map(b => b.dataset.id).join()) === 'k2', 'members can only delete their own capsules');
    await done(mem, 'capsules (member)');
  }

  console.log('— voice stories');
  {
    const p = await open('/family/#stories', { signedIn: true }, { permissions: ['microphone'] });
    await p.waitForTimeout(SLOW * 1200);
    ok(await p.$$eval('#stories .story', e => e.length) === 3, 'stories are listed');
    ok(await p.$$eval('#stories .wave-base svg rect', e => e.length) === 3 * 96, 'each story shows its waveform');
    await p.click('[data-action=story-play][data-id=st1]');
    await p.waitForTimeout(SLOW * 1200);
    ok(await p.evaluate(() => document.querySelector('.story-play[data-id=st1]').classList.contains('is-playing')), 'tap play and the story plays');
    ok((await p.textContent('[data-story-time=st1]')).includes(' / '), 'shows how far along it is');
    await p.click('[data-action=story-play][data-id=st1]');
    await p.waitForTimeout(SLOW * 200);
    ok(!(await p.evaluate(() => document.querySelector('.story-play[data-id=st1]').classList.contains('is-playing'))), 'tap again to pause');
    await p.click('[data-action=heart][data-col=stories][data-id=st2]');
    await p.waitForTimeout(SLOW * 300);
    ok(await store(p, () => window.__store.stories.st2.hearts.u1 === true), 'send a heart');

    await p.click('.view-head [data-action=new-story]');
    await p.click('#rec-prompts button');
    ok((await p.textContent('#rec-prompt')).includes('How did you two meet?'), 'story starters help you begin');
    await p.click('#rec-btn');
    await p.waitForTimeout(2600);
    ok(await p.evaluate(() => document.getElementById('rec-stage').dataset.state) === 'recording', 'records from the microphone');
    ok((await p.textContent('#rec-time')) !== '0:00', 'with a running timer');
    await p.click('#rec-btn');
    await p.waitForTimeout(SLOW * 800);
    ok(await p.evaluate(() => document.getElementById('rec-stage').dataset.state) === 'review', 'stop, then listen back');
    ok(!(await p.isDisabled('#story-save')), 'ready to save');
    await p.fill('#story-title', 'A test story');
    await p.click('#story-save');
    await p.waitForTimeout(SLOW * 1000);
    const saved = await store(p, () => {
      const id = Object.keys(window.__store.stories).find(k => window.__store.stories[k].title === 'A test story');
      return id ? { st: window.__store.stories[id], audio: window.__store.storyAudio[id + '_0'], id } : null;
    });
    ok(!!saved && !!saved.audio && saved.st.duration >= 2 && /^audio\//.test(saved.st.mime) && saved.st.peaks.length > 20 && saved.st.prompt === 'How did you two meet?', 'the recording is saved with its waveform and prompt');
    ok((await p.textContent('#stories .story:first-child h3')) === 'A test story', 'the new story appears at the top');
    await p.click('#stories .story:first-child [data-action=delete-story]');
    await p.click('#confirm-ok');
    await p.waitForTimeout(SLOW * 600);
    ok(await store(p, () => !Object.values(window.__store.stories).some(s => s.title === 'A test story') && !Object.keys(window.__store.storyAudio).some(k => !/^st\d_/.test(k))), 'you can delete your own story (audio and all)');
    await done(p, 'voice stories');

    const mem = await open('/family/#stories', { signedIn: true, admin: false });
    await mem.waitForTimeout(SLOW * 1200);
    ok(await mem.$$eval('[data-action=delete-story]', e => e.length) === 0, 'members can’t delete other people’s stories');
    await done(mem, 'stories (member)');
  }

  console.log('— vault quick unlock (Face ID / fingerprint)');
  {
    const p = await open('/family/#vault', { signedIn: true }, { localhost: true, webauthn: true });
    await p.waitForTimeout(SLOW * 900);
    ok(await p.isHidden('#vault-bio'), 'no quick unlock until you turn it on');
    await p.fill('#vault-pass', 'password123');
    await p.click('#vault-unlock');
    await p.waitForTimeout(SLOW * 600);
    ok((await p.textContent('#vault-bio-offer')).includes('Unlock faster'), 'offers quick unlock on this device');
    await p.click('[data-action=vault-bio-on]');
    await p.waitForTimeout(SLOW * 800);
    ok((await p.textContent('#vault-bio-offer')).includes('Quick unlock is on'), 'quick unlock is set up with a passkey');
    await p.click('[data-action=lock-vault]');
    await p.waitForTimeout(SLOW * 300);
    ok(!(await p.isHidden('#vault-bio')), 'the locked vault offers quick unlock');
    await p.click('#vault-bio');
    await p.waitForTimeout(SLOW * 800);
    ok(!(await p.isHidden('#vault-content')), 'Face ID / fingerprint opens the vault');
    await p.click('[data-action=vault-bio-off]');
    await p.click('[data-action=lock-vault]');
    await p.waitForTimeout(SLOW * 300);
    ok(await p.isHidden('#vault-bio'), 'quick unlock can be turned off again');
    await done(p, 'quick unlock');
  }

  console.log('— family tree');
  {
    // A small fictional family (tests/fixtures/sample-tree.ged), read by the same engine the hub uses.
    vm.runInThisContext(readFileSync(new URL('../assets/js/tree.js', import.meta.url), 'utf8'));
    const TR = globalThis.AgrazTree;
    const GED = readFileSync(new URL('./fixtures/sample-tree.ged', import.meta.url), 'utf8');
    const model = TR.parse(GED);
    const treeDocs = { meta: { v: model.v, name: model.name, treeId: model.treeId, source: model.source, people: model.people.length, families: model.families.length, portraits: model.portraits, earliest: model.earliest, generations: model.generations, parts: 1, importedAt: new Date().toISOString(), importedBy: 'Jordon Agraz' }, part0: TR.chunk(model)[0] };
    const dir = join(tmpdir(), 'agraz-tree-test');
    mkdirSync(dir, { recursive: true });
    const zipPath = join(dir, 'Sample Family Tree.zip');
    writeFileSync(zipPath, zipOf('Sample Family Tree.ged', GED));

    const a = await open('/family/#tree', { signedIn: true, role: 'owner' });
    await a.waitForTimeout(SLOW * 1000);
    ok(!!(await a.$('#tree-file')), 'admins are offered the Ancestry import');
    ok(await a.evaluate(() => [...document.querySelectorAll('a')].filter(x => /family tree/i.test(x.textContent)).every(x => x.getAttribute('href') === '#tree' && !x.target)), 'every “Family Tree” link opens the tree in the hub, not another site');
    await a.setInputFiles('#tree-file', zipPath);
    await a.waitForTimeout(SLOW * 700);
    ok((await a.textContent('#tree-preview')).includes('16 people'), 'the .zip is read right in the browser: 16 people');
    await a.click('#tree-import-go');
    await a.waitForTimeout(SLOW * 1200);
    const saved = await store(a, () => ({ meta: window.__store.tree.meta, jordon: window.__store.tree.part0.people.find(p => p.id === 'I11') }));
    ok(saved.meta.people === 16 && saved.meta.parts === 1 && saved.meta.importedBy === 'Jordon Agraz', 'the tree is saved privately for the family');
    ok(saved.jordon.b.d === '1990' && !saved.jordon.b.p, 'living relatives are saved with their birth year only');
    ok((await a.textContent('.tcard.is-focus')).includes('Hector Agraz'), 'the tree opens on the home person, Hector');
    ok(await a.$eval('.tcard.is-focus img', i => i.src.startsWith('data:image/jpeg')), 'Hector’s card uses his memorial photo');
    ok((await a.textContent('.fam-g1')).includes('Rafael Agraz') && (await a.textContent('.fam-g2')).includes('Mateo Agraz'), 'parents and grandparents');
    ok((await a.textContent('.fam-kids')).includes('with Ana') && (await a.textContent('.fam-kids')).includes('with Patricia'), 'children grouped by partner');
    ok(await a.$$eval('#fam-lines path', e => e.length) >= 8, 'connector lines join the family');
    ok((await a.textContent('#ts-photos')) === '1', 'counts who has a photo');
    ok((await a.textContent('.tree-me')).includes('Jordon Agraz'), 'suggests which person is you');
    await a.click('.tree-me [data-action=tree-me]');
    await a.waitForTimeout(SLOW * 600);
    ok(await store(a, () => window.__store.users.u1.treeId === 'I11'), 'links you to your place in the tree');
    ok((await a.textContent('#tree-panel .tp-rel')).includes('This is you'), 'the tree centers on you');
    ok((await a.textContent('.fam-g1')).includes('Father') && (await a.textContent('.fam-g2')).includes('Grandfather'), 'every card says how you’re related');
    await a.click('.fam-g1 [data-pid="I182483266401"]');
    await a.waitForTimeout(SLOW * 400);
    const panel = await a.textContent('#tree-panel');
    ok(panel.includes('Your father') && panel.includes('3 Apr 1950 · Chicago, Illinois, USA') && panel.includes('Married 1986') && panel.includes('Divorced'), 'profile: relationship, birth, marriages');
    ok(!(await a.$('a[href*="ancestry."]')), 'nothing in the hub links out to Ancestry');
    await a.fill('#tree-search', 'carm');
    await a.waitForTimeout(SLOW * 200);
    await a.click('#tree-results [data-pid="I4"]');
    await a.waitForTimeout(SLOW * 400);
    ok((await a.textContent('#tree-panel .tp-rel')).includes('Your great-aunt'), 'search finds Carmen — your great-aunt');
    await a.click('#tree-back');
    await a.waitForTimeout(SLOW * 300);
    ok((await a.textContent('#tree-panel .tp-name')) === 'Hector Agraz', 'back returns to the previous person');
    await a.click('[data-action=tree-view][data-v=fan]');
    await a.waitForTimeout(SLOW * 400);
    ok(await a.$$eval('.fan-seg[data-pid]', e => e.length) === 4, 'the ancestor fan shows Hector’s parents and grandparents');
    await a.click('.fan-seg[data-pid="I1"]');
    await a.waitForTimeout(SLOW * 400);
    ok((await a.textContent('#tree-panel')).includes('Your great-grandfather'), 'tap the fan to step back in time — Mateo, your great-grandfather');
    await a.click('[data-action=tree-view][data-v=family]');
    await a.fill('#tree-search', 'carmen');
    await a.waitForTimeout(SLOW * 200);
    await a.click('#tree-results [data-pid="I4"]');
    await a.waitForTimeout(SLOW * 300);
    // test photos, drawn in the browser
    const png = async (w, h, color) => Buffer.from(await a.evaluate(([w, h, color]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); return c.toDataURL('image/png').split(',')[1]; }, [w, h, color]), 'base64');
    const pic = (name, buf) => { const f = join(dir, name); writeFileSync(f, buf); return f; };
    const carmenPng = pic('Carmen Agraz.png', await png(90, 120, '#a65'));
    const [chooser] = await Promise.all([a.waitForEvent('filechooser'), a.click('#tree-panel [data-action=tree-photo]')]);
    await chooser.setFiles(carmenPng);
    await a.waitForTimeout(SLOW * 800);
    ok(await store(a, () => /^data:image\/jpeg/.test((window.__store.treePhotos.I4 || {}).img || '')), 'add a photo to anyone in the tree');
    ok(await a.$eval('.tcard.is-focus img', i => !!i.src), '…and it shows on their card');
    const mateo = await png(400, 500, '#68a');
    const files = [pic('download.png', Buffer.concat([mateo, Buffer.alloc(12345 - mateo.length)])), pic('IMG_3047.png', await png(60, 80, '#a86')), carmenPng, pic('beach.png', await png(30, 30, '#6a8'))];
    await a.click('#tree-photos-btn');
    await a.setInputFiles('#match-input', files);
    await a.waitForTimeout(SLOW * 1000);
    const how = await a.$$eval('#match-list .minfo small', e => e.map(x => x.textContent));
    ok(how[0].includes('Exact match') && how[1].includes('Ancestry title') && how[2].includes('name in the file name'), 'photos are matched to people by exact size, Ancestry title, or name', how);
    ok(how[3].includes('who is this'), 'a photo nobody can be matched to waits for you to choose');
    await a.fill('#match-list .match-q', 'luis');
    await a.waitForTimeout(SLOW * 150);
    await a.click('.match-res [data-pid="I9"]');
    ok((await a.textContent('#match-save')).includes('Save 4 photos'), 'choose who it is, then save them all');
    await a.click('#match-save');
    await a.waitForTimeout(SLOW * 1500);
    ok(await store(a, () => ['I1', 'I182483266401', 'I4', 'I9'].every(id => /^data:image\/jpeg/.test((window.__store.treePhotos[id] || {}).img || ''))), 'every photo lands on the right person');
    ok((await a.textContent('#toast')).includes('4 photos added'), '…and says so');
    // research from public records
    const researchPath = join(dir, 'research.json');
    writeFileSync(researchPath, JSON.stringify({ kind: 'agraz-research', v: 1, people: {
      I1: { doc: [{ k: 'grave', t: 'Mateo Agraz — memorial', u: 'https://www.findagrave.com/memorial/123' }, { k: 'photo', t: 'bad link', u: 'javascript:alert(1)' }],
        f: [{ t: 'death', v: '4 Feb 1961, Miami, Florida', s: 'Florida Death Index', u: 'https://example.org/fdi', c: 'm', d: 1 }],
        rel: [{ r: 'father', n: 'Tomas Agraz', b: '1860', d: '1931', s: 'Baptism index', u: 'https://example.org/bap', c: 'l', w: 'Same parish and godparents' }] },
      I11: { note: 'living — must be dropped' },
      I999: { note: 'not in the tree — dropped' } } }));
    await a.setInputFiles('#research-file', researchPath);
    await a.waitForTimeout(SLOW * 800);
    const stored = await store(a, () => window.__store.tree.research);
    ok(stored && stored.count === 1 && stored.people.I1 && !stored.people.I11 && !stored.people.I999, 'research is added for people who have passed — never for living relatives');
    ok(stored && stored.people.I1.doc.length === 1, 'unsafe links are dropped');
    await a.fill('#tree-search', 'mateo');
    await a.waitForTimeout(SLOW * 200);
    await a.click('#tree-results [data-pid="I1"]');
    await a.waitForTimeout(SLOW * 400);
    const arch = await a.textContent('#tree-panel .tp-research');
    ok(arch.includes('From the archives') && arch.includes('Likely') && arch.includes('Differs from the tree') && arch.includes('Possible father') && arch.includes('Tomas Agraz'), 'profiles show records, facts with confidence, and possible new ancestors');
    ok((await a.getAttribute('#tree-panel .rdoc a', 'href')) === 'https://www.findagrave.com/memorial/123', 'documents link to their source');
    ok(!!(await a.$('.tcard.is-focus .tc-badge')), 'cards with records found get a badge');
    ok((await a.textContent('#tree-panel .tp-records')).includes('1930 United States Federal Census') && !!(await a.$('#tree-panel .tp-records a[href="https://www.newspapers.com/clip/1/mateo-agraz-born/"]')) && !(await a.$('#tree-panel a[href*="ancestry."]')), 'profiles list every record from the export, with newspaper links but no links out to Ancestry');
    ok((await a.textContent('#tree-panel .tp-docs')).includes('Mateo naturalization papers') && (await a.textContent('#tree-panel .tp-docs')).includes('Certificate of naturalization'), 'and every photo and document, with its description');
    const story = await a.textContent('#tree-story');
    ok(story.includes('Life & times') && story.includes('Arrival') && story.includes('Ellis Island opens to immigrants') && story.includes('Mateo was 2'), 'under the chart: their life & times, woven with the history around them');
    ok(story.includes('From Mateo down to you') && story.includes('Where this branch begins') && !!(await a.$('#tree-story a[href^="https://www.familysearch.org/search/record/results?"]')), 'the line from them down to you, and where to search for parents nobody has found');
    await a.click('[data-action=tree-view][data-v=fan]');
    await a.waitForTimeout(SLOW * 700);
    ok(!!(await a.$('.fan-seg.ghost')) && (await a.textContent('.fan-legend')).includes('Possible'), 'possible ancestors from the research fill the fan, dashed');
    await a.click('.fan-seg.ghost', { force: true });
    await a.waitForTimeout(SLOW * 300);
    ok((await a.textContent('#tree-panel')).includes('Possible father of Mateo Agraz'), 'tap one to see why the research thinks so');
    await a.click('#tree-panel [data-action=tree-focus]');
    await a.waitForTimeout(SLOW * 400);
    await a.click('[data-action=tree-view][data-v=family]');
    await a.waitForTimeout(SLOW * 500);
    ok(!!(await a.$('.tcard.ghost[data-slot="p0"]')), 'and the family chart shows them as dashed parent cards');
    await done(a, 'family tree (owner)');

    const mbr = await open('/family/#tree', { signedIn: true, admin: false, treeDocs, memberTreeIds: { u2: 'I10' } });
    await mbr.waitForTimeout(SLOW * 1200);
    ok(await mbr.isHidden('#tree-photos-btn') && !(await mbr.$('[data-action=tree-update]')), 'only admins add photos in bulk or update the tree');
    ok(await mbr.$eval('.tcard[data-pid="I10"] img', i => i.src.startsWith('data:image/')), 'a member’s profile photo appears on their card in the tree');
    ok((await mbr.textContent('.tree-me')).includes('Jordon Agraz'), 'members can find themselves too');
    await done(mbr, 'family tree (member)');

    const none = await open('/family/#tree', { signedIn: true, admin: false });
    await none.waitForTimeout(SLOW * 1000);
    ok((await none.textContent('#tree-body')).includes('on its way') && !(await none.$('#tree-file')), 'before it’s added, members see that it’s on its way');
    await done(none, 'family tree (not added yet)');

    const old = await open('/family/#tree', { signedIn: true, role: 'owner', oldRules: true });
    await old.waitForTimeout(SLOW * 1000);
    ok(!!(await old.$('.rules-needed [data-action=copy-rules]')), 'without the latest rules, admins are shown how to publish them');
    await done(old, 'family tree (rules not published)');

    // The rules fall behind after the tree is in (e.g. a newer hub): every "needs the rules" message
    // comes with the copy button, so an admin can fix it on the spot.
    const stale = await open('/family/#tree', { signedIn: true, role: 'owner', treeDocs }, { permissions: ['clipboard-read', 'clipboard-write'] });
    await stale.waitForTimeout(SLOW * 1200);
    await stale.evaluate(() => { window.__MOCK.oldRules = true; });
    await stale.click('.tree-me [data-action=tree-me]');
    await stale.waitForTimeout(SLOW * 500);
    ok((await stale.textContent('#toast')).includes('aren’t published yet') && !!(await stale.$('#toast [data-action=copy-rules]')), 'when a save needs newer rules, the message itself offers to copy them');
    await stale.click('#toast [data-action=copy-rules]');
    await stale.waitForTimeout(SLOW * 400);
    ok((await stale.evaluate(() => navigator.clipboard.readText())).startsWith('rules_version'), '…and the copy works');
    await done(stale, 'family tree (rules fell behind)');

    // One-tap import: the tree and its research ship locked, and a private link holds the key.
    const { lockTree } = await import('../tools/lock-tree.mjs');
    const TOWN = 'data:image/jpeg;base64,' + Buffer.from('town photo'.repeat(40)).toString('base64');
    const locked = lockTree({ kind: 'agraz-tree', v: 1, tree: model, research: { kind: 'agraz-research', v: 1, people: {
      I1: { rel: [{ r: 'father', n: 'Tomas Agraz', of: 'Mateo Agraz', c: 'l' }], pl: [{ p: 'place-tampa', n: 'Tampa, Florida', y: 'Lived here 1930', c: 'Photo: A. Photographer · Public domain', u: 'https://commons.wikimedia.org/wiki/File:Tampa.jpg' }] },
      I11: { note: 'living — must be dropped', pl: [{ p: 'place-tampa', n: 'Miami' }] } } },
      places: { 'place-tampa': { img: TOWN }, 'bad id!': { img: TOWN } } });
    const tap = await open(`/family/#tree?key=${locked.key}`, { signedIn: true, role: 'owner' }, { lockedTree: locked.bin });
    await tap.waitForTimeout(SLOW * 1500);
    ok(await tap.evaluate(() => location.hash) === '#tree', 'the key is wiped from the address bar on arrival');
    const got = await store(tap, () => ({ meta: window.__store.tree.meta, research: window.__store.tree.research }));
    ok(got.meta && got.meta.people === 16 && got.research && got.research.count === 1 && !got.research.people.I11, 'one tap brings in the whole tree and its research — never research on living relatives');
    ok(got.research && got.research.people.I1.rel[0].of === 'Mateo Agraz', 'possible ancestors remember whose parent they’d be');
    ok((await tap.textContent('.tcard.is-focus')).includes('Hector Agraz') && !(await tap.$('#tree-file')), 'the tree opens straight away — no file to choose');
    const towns = await store(tap, () => ({ ids: Object.keys(window.__store.treePhotos), pl: window.__store.tree.research.people.I1.pl }));
    ok(towns.ids.join() === 'place-tampa' && towns.pl && towns.pl[0].p === 'place-tampa', 'it brings photos of the towns in the family’s story (and refuses odd names)');
    await tap.fill('#tree-search', 'mateo');
    await tap.waitForTimeout(SLOW * 200);
    await tap.click('#tree-results [data-pid="I1"]');
    await tap.waitForTimeout(SLOW * 500);
    ok((await tap.textContent('#tree-panel .tp-places')).includes('Tampa, Florida') && (await tap.textContent('#tree-panel .tp-places')).includes('Public domain') && !!(await tap.$('#tree-story .lt-cover img')), 'profiles show the places in their life, with credit — and their life & times opens with one');
    await done(tap, 'family tree (one-tap link)');

    // An older saved reading of the tree is replaced by the fuller one; research stays.
    const oldTree = JSON.parse(JSON.stringify(treeDocs));
    oldTree.meta.v = 1;
    oldTree.research = { people: { I1: { note: 'kept' } }, count: 1, createdAt: '2026-01-01', by: 'Jordon Agraz' };
    const upg = await open(`/family/#tree?key=${locked.key}`, { signedIn: true, role: 'owner', treeDocs: oldTree }, { lockedTree: locked.bin });
    await upg.waitForTimeout(SLOW * 1500);
    const up = await store(upg, () => ({ v: window.__store.tree.meta.v, res: window.__store.tree.research }));
    ok(up.v === 2 && up.res && up.res.people.I1 && (await upg.textContent('#toast')).includes('The family tree is in') && (await upg.textContent('.tree-stats')).includes('records'), 'the link upgrades an older saved tree to the full harvest', up);
    await done(upg, 'family tree (link upgrades the tree)');
    const same = await open(`/family/#tree?key=${locked.key}`, { signedIn: true, role: 'owner', treeDocs: Object.assign(JSON.parse(JSON.stringify(treeDocs)), { research: { people: { I1: { note: 'x' } }, count: 1 } }), treePhotos: { 'place-tampa': { img: TOWN, uid: 'u1' } } }, { lockedTree: locked.bin });
    await same.waitForTimeout(SLOW * 1300);
    ok((await same.textContent('#toast')).includes('already up to date'), 'opening it again changes nothing');
    await done(same, 'family tree (link, already up to date)');

    const wrong = await open(`/family/#tree?key=${'A'.repeat(43)}`, { signedIn: true, role: 'owner' }, { lockedTree: locked.bin });
    await wrong.waitForTimeout(SLOW * 1200);
    ok((await wrong.textContent('#toast')).includes('didn’t unlock') && !!(await wrong.$('#tree-file')) && await store(wrong, () => !window.__store.tree.meta), 'a wrong key unlocks nothing — the usual import is still there');
    await done(wrong, 'family tree (wrong key)');

    const notAdmin = await open(`/family/#tree?key=${locked.key}`, { signedIn: true, admin: false }, { lockedTree: locked.bin });
    await notAdmin.waitForTimeout(SLOW * 1200);
    ok(await store(notAdmin, () => !window.__store.tree.meta) && (await notAdmin.textContent('#tree-body')).includes('on its way'), 'only a family admin can use the link');
    await done(notAdmin, 'family tree (link, not an admin)');
  }

  console.log('— game night');
  {
    const g = await open('/family/#games', { signedIn: true, scores: { u2_gull: { uid: 'u2', game: 'gull', best: 23, name: 'Maria Agraz', at: '2026-09-01' } } });
    await g.waitForTimeout(SLOW * 1200);
    const lobby = await g.textContent('#games-lobby');
    ok((await g.$$('.game-card')).length === 2 && lobby.includes('Gaviota') && lobby.includes('La Nevería'), 'Game Night has Gaviota and La Nevería');
    ok((await g.textContent('.gc-gull .gc-board')).includes('Maria') && (await g.textContent('.gc-gull .gc-board')).includes('23'), 'each game shows the family leaderboard');
    await g.click('.gc-gull .btn-accent');
    await g.waitForTimeout(SLOW * 1200);
    const phase = () => g.evaluate(() => document.getElementById('game-host').gameApi.state().phase);
    ok(await g.evaluate(() => !!document.querySelector('#game-host canvas')) && (await phase()) === 'ready', 'Gaviota opens, ready to fly');
    await g.keyboard.press('Space');
    await g.waitForTimeout(SLOW * 300);
    ok((await phase()) === 'playing', 'Space (or a tap) takes off');
    await g.waitForTimeout(SLOW * 2500);
    const saved = await store(g, () => window.__store.scores.u1_gull);
    ok((await phase()) === 'over' && saved && saved.best === 0 && saved.uid === 'u1' && saved.name === 'Jordon Agraz', 'without flapping the gull lands in the sea, and the score goes on the family board');
    ok((await g.textContent('#game-board')).includes('Jordon'), 'you appear on the board beside the game');
    await g.click('[data-action=game-sound]');
    ok((await g.getAttribute('#game-sound', 'aria-pressed')) === 'false', 'sound can be switched off');
    await g.click('[data-action=game-exit]');
    await g.waitForTimeout(SLOW * 400);
    ok(await g.evaluate(() => !document.querySelector('#game-host canvas')) && await g.isVisible('#games-lobby'), 'back to all games, and the game is put away');
    await g.click('.gc-neveria .btn-accent');
    await g.waitForTimeout(SLOW * 1500);
    const res = await g.evaluate(() => {
      const api = document.getElementById('game-host').gameApi, d = api.debug;
      api.start(); d.arrive(); d.take(); d.makePerfect(); d.serve();
      const last = (api.state().results || []).slice(-1)[0] || {};
      return { stars: last.stars, tip: last.tip };
    });
    ok(res.stars === 5 && res.tip > 0, 'La Nevería: a perfectly made order earns five stars and a tip');
    await g.evaluate(() => { const d = document.getElementById('game-host').gameApi.debug; d.dismiss(); d.fastForward(900); });
    await g.waitForTimeout(SLOW * 900);
    const nev = await store(g, () => window.__store.scores.u1_neveria);
    ok((await phase()) === 'over' && nev && nev.best >= res.tip, 'when the shift ends, the tips go on the family board');
    await go(g, 'home');
    ok(await g.evaluate(() => !document.querySelector('#game-host canvas')), 'leaving Game Night puts the game away');
    await done(g, 'game night');

    const old = await open('/family/#games', { signedIn: true, role: 'owner', oldRules: true });
    await old.waitForTimeout(SLOW * 1200);
    ok(!!(await old.$('#games-lobby .rules-needed')) && (await old.$$('.game-card')).length === 2, 'before the leaderboard rules are published the games still work, and admins see how to switch the board on');
    await done(old, 'game night (rules not published)');
  }

  console.log('— install prompt + sign out');
  {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const p = await open('/family/#home', { signedIn: true }, { userAgent: ua, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await p.waitForTimeout(SLOW * 900);
    ok(await p.evaluate(() => !document.getElementById('home-install').hidden), 'iPhone users get "Add to Home Screen" help');
    await p.click('[data-action=dismiss-install]');
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(SLOW * 900);
    ok(await p.evaluate(() => document.getElementById('home-install').hidden), 'dismissed install card stays dismissed');
    await p.click('.tabbar [data-action=more]');
    await p.click('#more-sheet [data-action=signout]');
    await p.waitForTimeout(SLOW * 500);
    ok(await state(p) === 'auth', 'sign out');
    const leftovers = await p.evaluate(() => ['#feed', '#people', '#notes', '#recipes', '#tributes', '#home-updates', '#home-otd-strip'].reduce((n, s) => n + document.querySelector(s).innerHTML.length, 0));
    ok(leftovers === 0, 'private content cleared from the page on sign-out');
    await done(p, 'install + sign out');
  }
} catch (e) {
  fail++;
  console.log('  FAIL (exception)', e.stack || e);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
