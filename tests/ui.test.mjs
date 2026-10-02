// End-to-end UI tests for the public site and the Family Hub, using Playwright and a
// fake Firebase (tests/mock-firebase.js). Hermetic: all external requests are blocked.
//   npm run test:ui
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { start } from './serve.mjs';

const SLOW = Number(process.env.SLOW) || 1; // CI runners can be slower: SLOW=2 doubles every wait
const MOCK = readFileSync(new URL('./mock-firebase.js', import.meta.url), 'utf8');
const server = await start(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name); } };

async function open(path, mock = {}, ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block', acceptDownloads: true, ...ctxOpts });
  await ctx.addInitScript(m => {
    window.__MOCK = m;
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  }, mock);
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(BASE)) return route.continue();
    if (url.startsWith('https://www.gstatic.com/firebasejs/')) {
      return route.fulfill({ contentType: 'text/javascript', body: url.includes('firebase-app-compat') ? MOCK : '/* stub */' });
    }
    return route.abort();
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  if (ctxOpts.clockTime) await page.clock.install({ time: ctxOpts.clockTime });
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
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
    await dawn.context().close();
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
    ok(body.includes('role') && body.includes('admin'), 'without any admin, the page explains how to become one');
    await done(member, 'invite (member)');

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
