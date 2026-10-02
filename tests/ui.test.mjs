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
// Fake microphone for the Voice Stories recorder.
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const LOCAL = BASE.replace('127.0.0.1', 'localhost'); // WebAuthn needs a domain name, not an IP
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name); } };

async function open(path, mock = {}, opts = {}) {
  const { localhost, webauthn, ...ctxOpts } = opts;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block', acceptDownloads: true, ...ctxOpts });
  await ctx.addInitScript(m => {
    window.__MOCK = m;
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  }, mock);
  await ctx.route('**/*', route => {
    const url = route.request().url();
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

    const old = await open('/family/#invite', { signedIn: true, admin: false, oldRules: true });
    await old.waitForTimeout(SLOW * 1000);
    ok((await old.textContent('#rules-status')).includes('Not yet'), 'setup notices when the security rules aren’t published');
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
    const madridNow = () => p.evaluate(() => new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'Europe/Madrid' }));
    const before = await madridNow(), shown = await p.textContent('.clock[data-uid=u3] .clock-time b'), after = await madridNow();
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
