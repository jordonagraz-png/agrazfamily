/* ==========================================================================
   Agraz Family — private family hub
   Sign-in: Firebase Authentication (email + password).
   Data: Cloud Firestore. Everything private lives there, never in this file,
   and is protected server-side by firestore.rules: you're a member only if
   you have a users/{uid} doc, which can only be created with the invite code
   stored (unreadably) in config/invite.
   ========================================================================== */
(function () {
  'use strict';

  // Clickjacking guard: hide the page if it's framed by a different origin.
  try { if (self !== top && top.location.origin !== self.location.origin) document.documentElement.style.visibility = 'hidden'; }
  catch (e) { document.documentElement.style.visibility = 'hidden'; }

  /* ===================== Config ===================== */
  const FIREBASE = {
    apiKey: 'AIzaSyDXmJkA5_ZJf0tIj983JfbY9WgNy_gzV8o',
    authDomain: 'agrazfamily.firebaseapp.com',
    projectId: 'agrazfamily',
    storageBucket: 'agrazfamily.firebasestorage.app',
    messagingSenderId: '50763592692',
    appId: '1:50763592692:web:d8e1cad550d2b1ff1b3fa1'
  };
  const ANCESTRY_URL = 'https://www.ancestry.com/family-tree/tree/191301314/family?cfpid=182483266401';
  // JARVIS runs on the family network. Its address is saved per device (My Profile →
  // Preferences) so a private hostname is never published in this public file.
  const JARVIS_DEFAULT = 'http://localhost:8765/index.html';
  const PAGE = 24;

  const VIEWS = ['home', 'photos', 'calendar', 'updates', 'directory', 'vault', 'memorial', 'profile'];
  const ALIASES = { memories: 'photos', events: 'calendar' };
  const TITLES = { home: 'Home', photos: 'Photos', calendar: 'Calendar', updates: 'Updates', directory: 'Directory', vault: 'Family Vault', memorial: 'In Memory', profile: 'My Profile' };
  const SECONDARY = ['directory', 'vault', 'memorial', 'profile'];
  const CATS = {
    emergency: { label: 'Emergency', icon: 'siren' },
    medical: { label: 'Medical', icon: 'medical' },
    household: { label: 'Household', icon: 'home' },
    documents: { label: 'Documents', icon: 'note' },
    other: { label: 'Other', icon: 'sparkle' }
  };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MON = MONTHS.map(m => m.slice(0, 3));
  const IMG_RE = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+=*$/;
  const DAY = /^\d{4}-\d{2}-\d{2}$/;

  /* ===================== Helpers ===================== */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ESC[c]);
  const icon = (n, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="/assets/icons.svg#${n}"/></svg>`;
  const okImg = s => typeof s === 'string' && IMG_RE.test(s);
  const pad = n => String(n).padStart(2, '0');
  const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayStr = () => isoDay(new Date());
  const nowIso = () => new Date().toISOString();
  const denied = e => !!e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const canHover = window.matchMedia('(hover: hover)').matches;

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'friend';
  function colorClass(seed) {
    let h = 0;
    for (const ch of String(seed || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const n = h % 6;
    return n ? ` av-c${n}` : '';
  }
  function avatarHTML(p, size) {
    const name = (p && (p.name || p.email)) || '?';
    if (p && okImg(p.avatar)) return `<span class="av av-${size}"><img src="${p.avatar}" alt=""></span>`;
    return `<span class="av av-${size}${colorClass((p && p.uid) || name)}" aria-hidden="true">${esc(initials(name))}</span>`;
  }
  function paintAvatar(el, p) {
    const size = (el.className.match(/av-(\d+)/) || [])[1] || '40';
    const has = p && okImg(p.avatar);
    el.className = `av av-${size}${has ? '' : colorClass((p && p.uid) || (p && p.name))}`;
    el.innerHTML = has ? `<img src="${p.avatar}" alt="">` : esc(initials(p && (p.name || p.email)));
  }
  function timeAgo(iso) {
    const t = new Date(iso);
    const s = (Date.now() - t) / 1000;
    if (isNaN(s)) return '';
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
    return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: t.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }
  function relDay(ds) {
    const d = parseDay(ds);
    const diff = Math.round((d - parseDay(todayStr())) / 864e5);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function fmtTime(t) {
    if (!/^\d{2}:\d{2}$/.test(t || '')) return '';
    const [h, m] = t.split(':').map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  const fmtBirthday = s => { const d = parseDay(s); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
  const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
  const mapsUrl = q => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

  let toastTimer;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 3400);
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) {
      if (!btn.dataset.html) btn.dataset.html = btn.innerHTML;
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
      if (label) btn.textContent = label;
    } else {
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
      if (btn.dataset.html) { btn.innerHTML = btn.dataset.html; delete btn.dataset.html; }
    }
  }
  function confirmBox(title, body, okLabel) {
    const d = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body || '';
    $('#confirm-ok').textContent = okLabel || 'Delete';
    d.returnValue = '';
    d.showModal();
    return new Promise(res => d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true }));
  }
  const emptyHTML = (ico, title, text, extra = '') =>
    `<div class="empty"><span class="em-icon">${icon(ico)}</span><strong>${esc(title)}</strong>${text ? `<p>${esc(text)}</p>` : ''}${extra}</div>`;
  const errorHTML = what => emptyHTML('sparkle', `Couldn’t load ${what}`, 'Check your connection and try again.', '<button class="btn btn-ghost btn-sm" type="button" data-action="retry">Try again</button>');
  const skelRows = n => Array.from({ length: n }, () => '<div class="skel skel-row"></div>').join('');

  /* ===================== Theme ===================== */
  const root = document.documentElement;
  function effectiveTheme() {
    return root.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function setTheme(v) {
    if (v === 'light' || v === 'dark') {
      root.setAttribute('data-theme', v);
      try { localStorage.setItem('agraz-theme', v); } catch (e) {}
    } else {
      root.removeAttribute('data-theme');
      try { localStorage.removeItem('agraz-theme'); } catch (e) {}
    }
    paintThemeSeg();
  }
  function paintThemeSeg() {
    const cur = root.getAttribute('data-theme') || 'system';
    $$('[data-theme-set]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.themeSet === cur)));
  }

  /* ===================== JARVIS ===================== */
  function jarvisUrl() { try { return localStorage.getItem('jarvisUrl') || JARVIS_DEFAULT; } catch (e) { return JARVIS_DEFAULT; } }
  function openJarvis() { window.open(jarvisUrl(), '_blank', 'noopener'); }

  /* ===================== Firebase ===================== */
  if (!window.firebase || !firebase.auth || !firebase.firestore) {
    document.body.dataset.state = 'auth';
    $('#auth-msg').textContent = 'We couldn’t load the sign-in service. Check your connection and refresh the page.';
    $$('.auth-form button[type="submit"]').forEach(b => { b.disabled = true; });
    return;
  }
  firebase.initializeApp(FIREBASE);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const col = name => db.collection(name);

  /* ===================== State ===================== */
  const S = {
    user: null, me: null, members: [], byUid: {}, view: null, joining: false,
    events: null, updates: null, vault: null, memorial: null, recent: null,
    photos: { items: [], last: null, done: false, loading: false, loaded: false, rendered: 0 },
    cal: { y: new Date().getFullYear(), m: new Date().getMonth() },
    vaultCat: 'all', revealed: new Set(), editingNote: null,
    lb: { kind: null, list: [], i: 0, opener: null },
    pending: { photos: [], memorial: [] }, thumbUrls: { photos: [], memorial: [] },
    avatarDraft: undefined
  };
  const myName = () => (S.me && S.me.name) || (S.user && (S.user.displayName || S.user.email)) || 'Family member';

  /* ===================== Auth screens ===================== */
  const setScreen = s => { document.body.dataset.state = s; };
  const AUTH_COPY = {
    login: ['Welcome home', 'Sign in to the private family hub.'],
    join: ['Join the family', 'Create your account with the invite code a family member gave you.'],
    reset: ['Reset your password', 'We’ll email you a secure link to choose a new one.'],
    finish: ['Almost there', 'Enter the family invite code to finish setting up your account.']
  };
  function authMode(mode) {
    $('#auth-title').textContent = AUTH_COPY[mode][0];
    $('#auth-sub').textContent = AUTH_COPY[mode][1];
    ['login', 'join', 'reset', 'finish'].forEach(m => { $('#form-' + m).hidden = m !== mode; });
    $('#auth-seg').hidden = !(mode === 'login' || mode === 'join');
    $('#tab-login').setAttribute('aria-selected', String(mode === 'login'));
    $('#tab-join').setAttribute('aria-selected', String(mode === 'join'));
    if (mode === 'reset') $('#reset-email').value = $('#login-email').value;
    authMsg('');
    if (canHover && document.body.dataset.state === 'auth') {
      const first = $(`#form-${mode} input`);
      if (first) setTimeout(() => first.focus(), 30);
    }
  }
  function authMsg(text, ok) {
    const m = $('#auth-msg');
    m.textContent = text || '';
    m.classList.toggle('ok', !!ok);
  }
  function authErr(e) {
    const c = (e && e.code) || '';
    const bad = 'That email and password don’t match our records.';
    return ({
      'auth/invalid-credential': bad, 'auth/invalid-login-credentials': bad, 'auth/wrong-password': bad, 'auth/user-not-found': bad,
      'auth/invalid-email': 'Please enter a valid email address.',
      'auth/missing-password': 'Please enter your password.',
      'auth/email-already-in-use': 'An account with this email already exists — try signing in instead.',
      'auth/weak-password': 'Please choose a stronger password (at least 8 characters).',
      'auth/password-does-not-meet-requirements': 'Please choose a stronger password.',
      'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
      'auth/network-request-failed': 'Can’t reach the server. Check your connection and try again.',
      'auth/user-disabled': 'This account has been turned off. Ask a family admin for help.'
    })[c] || 'Something went wrong. Please try again.';
  }
  const submitBtn = form => form.querySelector('button[type="submit"]');

  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#login-email').value.trim();
    const pass = $('#login-pass').value;
    if (!email || !pass) return authMsg('Enter your email and password.');
    const btn = submitBtn(e.currentTarget);
    busy(btn, true, 'Signing in…');
    authMsg('');
    try {
      const P = firebase.auth.Auth.Persistence;
      await auth.setPersistence($('#login-remember').checked ? P.LOCAL : P.SESSION);
      await auth.signInWithEmailAndPassword(email, pass);
    } catch (err) {
      authMsg(authErr(err));
    } finally {
      busy(btn, false);
    }
  });

  $('#form-join').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = $('#join-name').value.trim().replace(/\s+/g, ' ');
    const email = $('#join-email').value.trim();
    const pass = $('#join-pass').value;
    const code = $('#join-code').value.trim();
    if (!name) return authMsg('Please enter your name.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return authMsg('Please enter a valid email address.');
    if (pass.length < 8) return authMsg('Please choose a password with at least 8 characters.');
    if (!code) return authMsg('Please enter the family invite code.');
    const btn = submitBtn(form);
    busy(btn, true, 'Creating your account…');
    authMsg('');
    S.joining = true;
    let cred;
    try {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      cred = await auth.createUserWithEmailAndPassword(email, pass);
    } catch (err) {
      S.joining = false;
      busy(btn, false);
      return authMsg(authErr(err));
    }
    try {
      await cred.user.updateProfile({ displayName: name });
      await completeMembership(cred.user, name, code);
      S.joining = false;
      busy(btn, false);
      form.reset();
      await enterApp(cred.user);
      toast(`Welcome to the family, ${firstName(name)}!`);
    } catch (err) {
      // Wrong code: remove the half-made account so the email can be reused.
      if (denied(err)) {
        try { await cred.user.delete(); } catch (_) { await auth.signOut().catch(() => {}); }
        authMsg('That invite code isn’t right. Please check with a family member.');
      } else {
        await auth.signOut().catch(() => {});
        authMsg('Your account was created, but setup didn’t finish. Sign in to try again.');
      }
      S.joining = false;
      busy(btn, false);
    }
  });

  // The server checks the code (firestore.rules → joins/{uid} must match config/invite)
  // before it will allow the users/{uid} doc that makes you a member.
  async function completeMembership(user, name, code) {
    const at = nowIso();
    let joinErr = null;
    try { await col('joins').doc(user.uid).set({ code, createdAt: at }); } catch (e) { joinErr = e; }
    try { await col('users').doc(user.uid).set({ name, email: user.email, uid: user.uid, joinedDate: at }); }
    catch (e) { throw joinErr || e; }
  }

  $('#form-finish').addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('#finish-code').value.trim();
    if (!code) return authMsg('Please enter the family invite code.');
    const btn = submitBtn(e.currentTarget);
    busy(btn, true, 'Checking…');
    try {
      const u = auth.currentUser;
      await completeMembership(u, u.displayName || u.email.split('@')[0], code);
      await enterApp(u);
      toast('Welcome to the family!');
    } catch (err) {
      authMsg(denied(err) ? 'That invite code isn’t right. Please check with a family member.' : 'Couldn’t finish setup. Check your connection and try again.');
    } finally {
      busy(btn, false);
    }
  });

  $('#form-reset').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#reset-email').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return authMsg('Please enter a valid email address.');
    const btn = submitBtn(e.currentTarget);
    busy(btn, true, 'Sending…');
    try {
      await auth.sendPasswordResetEmail(email);
      authMsg('If that email has an account, a reset link is on its way. Check your inbox.', true);
    } catch (err) {
      if (err && err.code === 'auth/user-not-found') authMsg('If that email has an account, a reset link is on its way. Check your inbox.', true);
      else authMsg(authErr(err));
    } finally {
      busy(btn, false);
    }
  });

  auth.onAuthStateChanged(async user => {
    S.user = user;
    if (S.joining) return;
    if (!user) {
      const wasAuth = document.body.dataset.state === 'auth';
      resetData();
      setScreen('auth');
      if (!wasAuth || !$('#form-finish').hidden) authMode(location.hash === '#join' ? 'join' : 'login');
      return;
    }
    try {
      const snap = await col('users').doc(user.uid).get();
      if (snap.exists) {
        await enterApp(user, snap);
      } else {
        setScreen('auth');
        authMode('finish');
        $('#finish-who').textContent = `You’re signed in as ${user.email}.`;
      }
    } catch (err) {
      setScreen('auth');
      authMode('login');
      if (denied(err)) {
        await auth.signOut().catch(() => {});
        authMsg('This account doesn’t have access to the family hub.');
      } else {
        authMsg('We couldn’t reach the family hub. Check your connection and try again.');
      }
    }
  });

  async function signOut() {
    try { await auth.signOut(); toast('Signed out. See you soon!'); }
    catch (e) { toast('Couldn’t sign out. Please try again.', true); }
  }

  /* ===================== App shell ===================== */
  async function enterApp(user, snap) {
    S.user = user;
    if (!snap) snap = await col('users').doc(user.uid).get();
    S.me = Object.assign({}, snap.data(), { uid: user.uid });
    setScreen('app');
    paintMe();
    route();
    loadMembers().catch(() => { if (S.view === 'home') $('#home-family').innerHTML = errorHTML('the family'); });
  }

  function paintMe() {
    if (!S.me) return;
    $$('[data-me-avatar]').forEach(el => paintAvatar(el, S.me));
    $$('[data-me-name]').forEach(el => { el.textContent = myName(); });
    $$('[data-me-email]').forEach(el => { el.textContent = (S.user && S.user.email) || ''; });
  }

  function resetData() {
    Object.assign(S, { me: null, members: [], byUid: {}, view: null, events: null, updates: null, vault: null, memorial: null, recent: null, vaultCat: 'all', avatarDraft: undefined });
    S.photos = { items: [], last: null, done: false, loading: false, loaded: false, rendered: 0 };
    S.revealed.clear();
    clearStaging('photos');
    clearStaging('memorial');
    // Don't leave private content in the page after signing out.
    ['#home-upcoming', '#home-family', '#home-photos', '#home-updates', '#photo-grid', '#cal-grid', '#cal-agenda', '#feed', '#people', '#notes', '#vault-filters', '#memorial-grid'].forEach(s => { const el = $(s); if (el) el.innerHTML = ''; });
    $('#memorial-cover').innerHTML = icon('candle');
    $$('.view').forEach(v => { v.hidden = true; });
    closeLightbox();
    $$('dialog[open]').forEach(d => d.close());
  }

  function route() {
    if (!S.me) return;
    let v = location.hash.slice(1);
    v = ALIASES[v] || v;
    if (!VIEWS.includes(v)) v = 'home';
    if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
    show(v);
  }
  window.addEventListener('hashchange', () => {
    if (S.me) route();
    else if (document.body.dataset.state === 'auth' && location.hash === '#join') authMode('join');
  });

  function show(v) {
    const changed = S.view !== v;
    S.view = v;
    $$('.view').forEach(el => { el.hidden = el.dataset.view !== v; });
    $$('[data-nav]').forEach(a => {
      const on = a.dataset.nav === v || (a.dataset.nav === 'more' && SECONDARY.includes(v));
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = `${TITLES[v]} — Agraz Family Hub`;
    const sheet = $('#more-sheet');
    if (sheet.open) sheet.close();
    if (changed) window.scrollTo(0, 0);
    RENDER[v]();
  }

  /* ===================== Data ===================== */
  async function loadMembers() {
    const snap = await col('users').get();
    S.members = snap.docs.map(d => Object.assign({}, d.data(), { uid: d.id }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    S.byUid = {};
    S.members.forEach(m => { S.byUid[m.uid] = m; });
    if (S.user && S.byUid[S.user.uid]) { S.me = S.byUid[S.user.uid]; paintMe(); }
    if (S.view === 'home') { renderHomeFamily(); if (S.events) renderHomeUpcoming(); if (S.updates) renderHomeUpdates(); }
    else if (S.view === 'directory') renderDirectory();
    else if (S.view === 'calendar' && S.events) renderCalendar();
    else if (S.view === 'updates' && S.updates) renderFeed();
  }
  async function loadEvents(force) {
    if (S.events && !force) return S.events;
    const snap = await col('events').orderBy('date', 'asc').get();
    S.events = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(e => DAY.test(e.date || ''));
    return S.events;
  }
  async function loadUpdates(force) {
    if (S.updates && !force) return S.updates;
    const snap = await col('updates').orderBy('createdAt', 'desc').limit(60).get();
    S.updates = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    return S.updates;
  }
  async function loadRecent(force) {
    if (S.recent && !force) return S.recent;
    if (!force && S.photos.items.length >= 6) return (S.recent = S.photos.items.slice(0, 6));
    const snap = await col('memories').orderBy('createdAt', 'desc').limit(6).get();
    S.recent = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(m => okImg(m.imageData));
    return S.recent;
  }
  async function loadPhotos(reset) {
    const P = S.photos;
    if (P.loading) return;
    if (reset) { P.items = []; P.last = null; P.done = false; P.rendered = 0; }
    if (P.done) return;
    P.loading = true;
    try {
      let q = col('memories').orderBy('createdAt', 'desc').limit(PAGE);
      if (P.last) q = q.startAfter(P.last);
      const snap = await q.get();
      if (snap.docs.length) P.last = snap.docs[snap.docs.length - 1];
      P.done = snap.docs.length < PAGE;
      P.items.push(...snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(m => okImg(m.imageData)));
      P.loaded = true;
    } finally {
      P.loading = false;
    }
  }
  async function loadVault(force) {
    if (S.vault && !force) return S.vault;
    const snap = await col('vault').orderBy('updatedAt', 'desc').get();
    S.vault = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    return S.vault;
  }
  async function loadMemorial(force) {
    if (S.memorial && !force) return S.memorial;
    const snap = await col('memorial').orderBy('order', 'asc').get();
    S.memorial = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(m => okImg(m.imageData));
    return S.memorial;
  }

  /* birthdays (from the directory) */
  function birthdaysBetween(from, to) {
    const out = [];
    S.members.forEach(m => {
      if (!DAY.test(m.birthday || '')) return;
      const [, mm, dd] = m.birthday.split('-').map(Number);
      for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
        let d = new Date(y, mm - 1, dd);
        if (d.getMonth() !== mm - 1) d = new Date(y, mm, 0); // Feb 29 → Feb 28
        if (d >= from && d <= to) out.push({ kind: 'bday', date: isoDay(d), title: `${firstName(m.name)}’s birthday`, uid: m.uid });
      }
    });
    return out;
  }
  function upcoming(days, limit) {
    const t0 = parseDay(todayStr());
    const t1 = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + days);
    const from = isoDay(t0), to = isoDay(t1);
    const ev = (S.events || []).filter(e => e.date >= from && e.date <= to).map(e => Object.assign({ kind: 'event' }, e));
    return ev.concat(birthdaysBetween(t0, t1))
      .sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || '')))
      .slice(0, limit || Infinity);
  }

  /* ===================== Shared renderers ===================== */
  function agendaItem(it, compact) {
    const d = parseDay(it.date);
    const bday = it.kind === 'bday';
    const today = it.date === todayStr();
    const when = esc(relDay(it.date)) + (it.time ? ' · ' + esc(fmtTime(it.time)) : '');
    const loc = it.location
      ? (compact ? `<span>${icon('pin')}${esc(it.location)}</span>` : `<a href="${esc(mapsUrl(it.location))}" target="_blank" rel="noopener noreferrer"><span>${icon('pin')}${esc(it.location)}</span></a>`)
      : '';
    return `<div class="ag-item${compact ? ' compact' : ''}">
      <div class="date-badge${bday ? ' is-bday' : ''}${today ? ' is-today' : ''}"><small>${MON[d.getMonth()]}</small><b>${d.getDate()}</b></div>
      <div class="ag-body">
        <div class="ag-title">${esc(it.title)}</div>
        <div class="ag-meta"><span>${icon(bday ? 'cake' : 'clock')}${when}</span>${loc}</div>
        ${!compact && it.description ? `<p class="ag-desc">${esc(it.description)}</p>` : ''}
        ${!compact && it.createdBy ? `<div class="ag-meta"><span>Added by ${esc(it.createdBy)}</span></div>` : ''}
      </div>
      ${!compact && !bday ? `<div class="ag-actions"><button class="icon-btn" type="button" data-action="delete-event" data-id="${esc(it.id)}" aria-label="Delete ${esc(it.title)}">${icon('trash')}</button></div>` : ''}
    </div>`;
  }

  function photoTile(item, i, kind) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'photo';
    b.dataset.action = 'open-photo';
    b.dataset.kind = kind;
    b.dataset.i = String(i);
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = item.caption || (kind === 'memorial' ? 'Photo of Hector Agraz' : `Family photo shared by ${item.uploadedBy || 'a family member'}`);
    img.src = item.imageData;
    b.appendChild(img);
    if (kind === 'photos') {
      const cap = document.createElement('span');
      cap.className = 'photo-cap';
      cap.textContent = item.caption || '';
      const meta = document.createElement('small');
      meta.textContent = [item.uploadedBy, fmtDate(item.createdAt)].filter(Boolean).join(' · ');
      cap.appendChild(meta);
      b.appendChild(cap);
    }
    return b;
  }

  /* ===================== Home ===================== */
  function renderHome() {
    const h = new Date().getHours();
    const part = h < 5 ? 'evening' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
    $('#home-title').innerHTML = `Good ${part}, <em>${esc(firstName(myName()))}</em>`;
    $('#home-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    $('#home-sub').textContent = 'Here’s what’s happening in the family.';
    renderHomeFamily();
    if (!S.events) $('#home-upcoming').innerHTML = skelRows(3);
    else renderHomeUpcoming();
    if (!S.recent) $('#home-photos').innerHTML = `<div class="thumbs">${'<div class="skel skel-tile"></div>'.repeat(6)}</div>`;
    else renderHomePhotos();
    if (!S.updates) $('#home-updates').innerHTML = skelRows(3);
    else renderHomeUpdates();
    loadEvents().then(renderHomeUpcoming).catch(() => { if (S.view === 'home') $('#home-upcoming').innerHTML = errorHTML('events'); });
    loadRecent().then(renderHomePhotos).catch(() => { if (S.view === 'home') $('#home-photos').innerHTML = errorHTML('photos'); });
    loadUpdates().then(renderHomeUpdates).catch(() => { if (S.view === 'home') $('#home-updates').innerHTML = errorHTML('updates'); });
  }
  function renderHomeUpcoming() {
    if (S.view !== 'home') return;
    const items = upcoming(90, 5);
    const next = items[0];
    const when = next ? relDay(next.date) : '';
    $('#home-sub').textContent = next ? `Next up: ${next.title} — ${/^(Today|Tomorrow)$/.test(when) ? when.toLowerCase() : when}.` : 'Here’s what’s happening in the family.';
    $('#home-upcoming').innerHTML = items.length
      ? items.map(it => agendaItem(it, true)).join('')
      : emptyHTML('calendar', 'Nothing on the calendar yet', 'Add a birthday dinner, a trip, or a get-together.', '<button class="btn btn-ghost btn-sm" type="button" data-action="new-event">Add an event</button>');
  }
  function renderHomeFamily() {
    if (S.view !== 'home') return;
    const el = $('#home-family');
    if (!S.members.length) { el.innerHTML = skelRows(2); return; }
    const me = S.me || {};
    const t0 = parseDay(todayStr());
    const bdays = birthdaysBetween(t0, new Date(t0.getFullYear() + 1, t0.getMonth(), t0.getDate() - 1))
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
    const missing = [!DAY.test(me.birthday || '') && 'birthday', !me.phone && 'phone number', !okImg(me.avatar) && 'photo'].filter(Boolean);
    el.innerHTML = `
      <div class="fam-stack">${S.members.slice(0, 7).map(m => avatarHTML(m, 44)).join('')}</div>
      <p class="fam-count">${S.members.length}<small>${S.members.length === 1 ? 'family member' : 'family members'} in the hub</small></p>
      ${bdays.length ? `<div class="bdays"><h3>Next birthdays</h3>${bdays.map(b => `<div class="bday-row">${avatarHTML(S.byUid[b.uid], 28)}<strong>${esc(S.byUid[b.uid].name || '')}</strong><span>${esc(relDay(b.date))}</span></div>`).join('')}</div>` : ''}
      ${missing.length ? `<div class="nudge">${icon('sparkle')}<span>Add your ${esc(missing.slice(0, 2).join(' and '))} so the family can reach — and celebrate — you. <a href="#profile">Update profile</a></span></div>` : ''}`;
  }
  function renderHomePhotos() {
    if (S.view !== 'home') return;
    const el = $('#home-photos');
    const list = S.recent || [];
    if (!list.length) {
      el.innerHTML = emptyHTML('image', 'No photos yet', 'Start the family album with a favorite picture.', '<a class="btn btn-ghost btn-sm" href="#photos">Upload photos</a>');
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'thumbs';
    list.slice(0, 6).forEach((m, i) => {
      const t = photoTile(m, i, 'recent');
      t.className = 'thumb';
      grid.appendChild(t);
    });
    el.replaceChildren(grid);
  }
  function renderHomeUpdates() {
    if (S.view !== 'home') return;
    const list = (S.updates || []).slice(0, 3);
    $('#home-updates').innerHTML = list.length
      ? list.map(p => {
        const person = S.byUid[p.uid] || { name: p.author, uid: p.uid };
        return `<div class="mini-post">${avatarHTML(person, 36)}<div><strong>${esc(person.name || p.author || 'Family member')}</strong><small>${esc(timeAgo(p.createdAt))}</small><p>${esc(p.text)}</p></div></div>`;
      }).join('')
      : emptyHTML('chat', 'No updates yet', 'Share a bit of news with everyone.', '<a class="btn btn-ghost btn-sm" href="#updates">Write an update</a>');
  }

  /* ===================== Photos ===================== */
  function openPhotos() {
    const grid = $('#photo-grid');
    if (!S.photos.loaded) {
      grid.replaceChildren(...Array.from({ length: 8 }, (_, i) => { const d = document.createElement('div'); d.className = 'photo skel'; d.style.height = [220, 300, 180, 260][i % 4] + 'px'; return d; }));
      loadPhotos(true).then(() => renderPhotos(true)).catch(() => { grid.innerHTML = errorHTML('photos'); });
    } else {
      renderPhotos(true);
    }
  }
  function renderPhotos(full) {
    const P = S.photos;
    const grid = $('#photo-grid');
    if (full) { grid.innerHTML = ''; P.rendered = 0; }
    if (!P.items.length) {
      grid.innerHTML = emptyHTML('image', 'The album is empty', 'Upload the first photo to get the family album started.');
    } else {
      const frag = document.createDocumentFragment();
      for (let i = P.rendered; i < P.items.length; i++) frag.appendChild(photoTile(P.items[i], i, 'photos'));
      grid.appendChild(frag);
      P.rendered = P.items.length;
    }
    $('#photo-more').hidden = P.done;
  }
  async function morePhotos(btn) {
    busy(btn, true, 'Loading…');
    try { await loadPhotos(false); renderPhotos(false); }
    catch (e) { toast('Couldn’t load more photos.', true); }
    finally { busy(btn, false); }
  }

  /* staging + upload (shared by Photos and In Memory) */
  function stageFiles(kind, fileList) {
    const files = Array.from(fileList || []).filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(f.name));
    if (!files.length) { toast('Please choose image files.', true); return; }
    clearStaging(kind);
    S.pending[kind] = files;
    const thumbs = $(`#${kind === 'photos' ? 'photo' : 'memorial'}-thumbs`);
    files.slice(0, 14).forEach(f => {
      const url = URL.createObjectURL(f);
      S.thumbUrls[kind].push(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      thumbs.appendChild(img);
    });
    const btn = $(`#${kind === 'photos' ? 'photo' : 'memorial'}-upload-btn`);
    btn.textContent = `Upload ${plural(files.length, 'photo')}`;
    if (kind === 'memorial') $('#memorial-count').textContent = `${plural(files.length, 'photo')} ready to add`;
    $(`#${kind === 'photos' ? 'photo' : 'memorial'}-staging`).hidden = false;
  }
  function clearStaging(kind) {
    const pre = kind === 'photos' ? 'photo' : 'memorial';
    S.thumbUrls[kind].forEach(u => URL.revokeObjectURL(u));
    S.thumbUrls[kind] = [];
    S.pending[kind] = [];
    const st = $(`#${pre}-staging`);
    if (!st) return;
    st.hidden = true;
    $(`#${pre}-thumbs`).innerHTML = '';
    $(`#${pre}-progress`).hidden = true;
    $(`#${pre}-progress span`).style.width = '0';
    $(`#${pre}-input`).value = '';
    if (kind === 'photos') $('#photo-caption').value = '';
  }
  function decodeImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unsupported')); };
      img.src = url;
    });
  }
  // Resize + re-encode as JPEG until it fits under Firestore's ~1 MB document limit.
  async function compressImage(file, maxDim, quality, maxLen, square) {
    const img = await decodeImage(file);
    let dim = maxDim, q = quality;
    for (let attempt = 0; attempt < 7; attempt++) {
      const w0 = img.naturalWidth, h0 = img.naturalHeight;
      let sx = 0, sy = 0, sw = w0, sh = h0;
      if (square) { const s = Math.min(w0, h0); sx = (w0 - s) / 2; sy = (h0 - s) / 2; sw = sh = s; }
      const scale = Math.min(1, dim / Math.max(sw, sh));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sw * scale));
      c.height = Math.max(1, Math.round(sh * scale));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', q);
      if (data.length <= maxLen) return data;
      q = Math.max(0.5, q - 0.08);
      dim = Math.round(dim * 0.85);
    }
    throw new Error('too-large');
  }
  async function uploadStaged(kind) {
    const files = S.pending[kind];
    if (!files.length) return;
    const pre = kind === 'photos' ? 'photo' : 'memorial';
    const btn = $(`#${pre}-upload-btn`);
    const bar = $(`#${pre}-progress`);
    const caption = kind === 'photos' ? $('#photo-caption').value.trim().slice(0, 1900) : '';
    const base = Date.now();
    let ok = 0, fail = 0;
    busy(btn, true, `Uploading 1 of ${files.length}…`);
    bar.hidden = false;
    for (let i = 0; i < files.length; i++) {
      btn.textContent = `Uploading ${i + 1} of ${files.length}…`;
      try {
        const data = await compressImage(files[i], kind === 'photos' ? 1600 : 1800, 0.82, 900000);
        const doc = kind === 'photos'
          ? { imageData: data, caption, uploadedBy: myName(), uid: S.user.uid, createdAt: nowIso() }
          : { imageData: data, uploadedBy: myName(), uid: S.user.uid, order: base + i, createdAt: nowIso() };
        await col(kind === 'photos' ? 'memories' : 'memorial').add(doc);
        ok++;
      } catch (e) {
        fail++;
      }
      $(`#${pre}-progress span`).style.width = `${Math.round(((i + 1) / files.length) * 100)}%`;
    }
    busy(btn, false);
    clearStaging(kind);
    if (ok && !fail) toast(kind === 'photos' ? `${plural(ok, 'photo')} added to the album` : `${plural(ok, 'photo')} added to the memorial`);
    else if (ok) toast(`${ok} added, ${fail} couldn’t be uploaded.`, true);
    else toast('Those photos couldn’t be uploaded. Please try again.', true);
    if (kind === 'photos') { S.recent = null; await loadPhotos(true).catch(() => {}); if (S.view === 'photos') renderPhotos(true); }
    else { await loadMemorial(true).catch(() => {}); if (S.view === 'memorial') renderMemorial(); }
  }

  /* ===================== Lightbox ===================== */
  function lbList(kind) { return kind === 'photos' ? S.photos.items : kind === 'memorial' ? (S.memorial || []) : (S.recent || []); }
  function openLightbox(kind, i, opener) {
    S.lb = { kind, list: lbList(kind), i, opener };
    $('#lightbox').hidden = false;
    document.body.style.overflow = 'hidden';
    paintLightbox();
    $('.lb-close').focus();
  }
  function paintLightbox() {
    const { list, i, kind } = S.lb;
    const it = list[i];
    if (!it) return closeLightbox();
    const img = $('#lb-img');
    img.src = it.imageData;
    img.alt = it.caption || (kind === 'memorial' ? 'Photo of Hector Agraz' : 'Family photo');
    $('#lb-text').textContent = it.caption || '';
    $('#lb-meta').textContent = [it.uploadedBy && `Shared by ${it.uploadedBy}`, fmtDate(it.createdAt), `${i + 1} of ${list.length}`].filter(Boolean).join(' · ');
    $('.lb-prev').hidden = list.length < 2;
    $('.lb-next').hidden = list.length < 2;
  }
  function stepLightbox(d) {
    const n = S.lb.list.length;
    if (n < 2) return;
    S.lb.i = (S.lb.i + d + n) % n;
    paintLightbox();
  }
  function closeLightbox() {
    const lb = $('#lightbox');
    if (lb.hidden) return;
    lb.hidden = true;
    $('#lb-img').removeAttribute('src');
    document.body.style.overflow = '';
    if (S.lb.opener && document.contains(S.lb.opener)) S.lb.opener.focus();
  }
  async function deleteFromLightbox() {
    const { kind, list, i } = S.lb;
    const it = list[i];
    if (!it) return;
    const isMem = kind === 'memorial';
    if (!(await confirmBox(isMem ? 'Remove this photo?' : 'Delete this photo?', 'It will be removed for everyone in the family.', isMem ? 'Remove' : 'Delete'))) return;
    try {
      await col(isMem ? 'memorial' : 'memories').doc(it.id).delete();
      toast(isMem ? 'Photo removed' : 'Photo deleted');
      closeLightbox();
      if (isMem) { await loadMemorial(true); if (S.view === 'memorial') renderMemorial(); }
      else {
        S.recent = null;
        await loadPhotos(true);
        if (S.view === 'photos') renderPhotos(true);
        if (S.view === 'home') { await loadRecent(true); renderHomePhotos(); }
      }
    } catch (e) {
      toast(denied(e) ? 'You don’t have permission to delete that.' : 'Couldn’t delete. Please try again.', true);
    }
  }
  (function swipe() {
    let x0 = null;
    const lb = $('#lightbox');
    lb.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', e => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) stepLightbox(dx < 0 ? 1 : -1);
      x0 = null;
    });
    lb.addEventListener('click', e => { if (e.target === lb || e.target.classList.contains('lb-figure')) closeLightbox(); });
  })();

  /* ===================== Calendar ===================== */
  function openCalendar() {
    if (!S.events) {
      $('#cal-agenda').innerHTML = skelRows(4);
      renderCalendar();
      loadEvents().then(() => { if (S.view === 'calendar') { renderCalendar(); renderAgenda(); } })
        .catch(() => { $('#cal-agenda').innerHTML = errorHTML('events'); });
    } else {
      renderCalendar();
      renderAgenda();
    }
  }
  function renderCalendar() {
    const { y, m } = S.cal;
    $('#cal-title').innerHTML = `${MONTHS[m]} <span>${y}</span>`;
    const lead = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const cells = Math.ceil((lead + days) / 7) * 7;
    const first = new Date(y, m, 1 - lead);
    const last = new Date(y, m, cells - lead);
    const byDay = {};
    (S.events || []).forEach(e => { (byDay[e.date] = byDay[e.date] || []).push(Object.assign({ kind: 'event' }, e)); });
    birthdaysBetween(first, last).forEach(b => { (byDay[b.date] = byDay[b.date] || []).unshift(b); });
    const today = todayStr();
    let html = '';
    for (let i = 0; i < cells; i++) {
      const d = new Date(y, m, 1 - lead + i);
      const ds = isoDay(d);
      const items = byDay[ds] || [];
      const chips = items.slice(0, 2).map(it => `<span class="chip${it.kind === 'bday' ? ' bday' : ''}">${esc(it.title)}</span>`).join('')
        + (items.length > 2 ? `<span class="chip more">+${items.length - 2} more</span>` : '');
      const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
        + (items.length ? `: ${items.map(it => it.title).join(', ')}` : '') + '. Add an event.';
      html += `<button type="button" class="cal-cell${d.getMonth() !== m ? ' out' : ''}${ds === today ? ' today' : ''}" data-action="new-event" data-date="${ds}" aria-label="${esc(label)}"><span class="cal-num">${d.getDate()}</span>${chips}</button>`;
    }
    $('#cal-grid').innerHTML = html;
  }
  function renderAgenda() {
    const items = upcoming(240);
    if (!items.length) {
      $('#cal-agenda').innerHTML = emptyHTML('calendar', 'Nothing coming up', 'Tap any day on the calendar to add an event.', '<button class="btn btn-ghost btn-sm" type="button" data-action="new-event">New event</button>');
      return;
    }
    let html = '', cur = '';
    items.forEach(it => {
      const d = parseDay(it.date);
      const key = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      if (key !== cur) { html += `<p class="ag-month">${key}</p>`; cur = key; }
      html += agendaItem(it, false);
    });
    $('#cal-agenda').innerHTML = html;
  }
  function moveMonth(delta) {
    const d = new Date(S.cal.y, S.cal.m + delta, 1);
    S.cal = { y: d.getFullYear(), m: d.getMonth() };
    renderCalendar();
  }
  function openEventDialog(date) {
    const f = $('#event-form');
    f.reset();
    $('#ev-date').value = DAY.test(date || '') ? date : todayStr();
    $('#event-dialog').showModal();
    if (canHover) setTimeout(() => $('#ev-title').focus(), 40);
  }
  $('#event-form').addEventListener('submit', async e => {
    e.preventDefault();
    const title = $('#ev-title').value.trim();
    const date = $('#ev-date').value;
    if (!title) { toast('Please give the event a name.', true); $('#ev-title').focus(); return; }
    if (!DAY.test(date)) { toast('Please choose a date.', true); return; }
    const doc = { title, date, description: $('#ev-desc').value.trim(), createdBy: myName(), uid: S.user.uid, createdAt: nowIso() };
    const time = $('#ev-time').value;
    const location = $('#ev-location').value.trim();
    if (/^\d{2}:\d{2}$/.test(time)) doc.time = time;
    if (location) doc.location = location;
    const btn = $('#ev-save');
    busy(btn, true, 'Adding…');
    try {
      await col('events').add(doc);
      $('#event-dialog').close();
      toast('Added to the family calendar');
      await loadEvents(true);
      if (S.view === 'calendar') {
        const d = parseDay(date);
        S.cal = { y: d.getFullYear(), m: d.getMonth() };
        renderCalendar();
        renderAgenda();
      } else if (S.view === 'home') renderHomeUpcoming();
    } catch (err) {
      toast(denied(err) ? 'You don’t have permission to add events.' : 'Couldn’t add the event. Please try again.', true);
    } finally {
      busy(btn, false);
    }
  });
  async function deleteEvent(id) {
    const ev = (S.events || []).find(x => x.id === id);
    if (!(await confirmBox('Delete this event?', ev ? `“${ev.title}” will be removed from everyone’s calendar.` : ''))) return;
    try {
      await col('events').doc(id).delete();
      toast('Event deleted');
      await loadEvents(true);
      if (S.view === 'calendar') { renderCalendar(); renderAgenda(); }
    } catch (e) {
      toast('Couldn’t delete the event.', true);
    }
  }

  /* ===================== Updates ===================== */
  function openUpdates() {
    paintMe();
    if (!S.updates) {
      $('#feed').innerHTML = skelRows(4);
      loadUpdates().then(() => { if (S.view === 'updates') renderFeed(); }).catch(() => { $('#feed').innerHTML = errorHTML('updates'); });
    } else {
      renderFeed();
    }
  }
  function renderFeed() {
    const list = S.updates || [];
    $('#feed').innerHTML = list.length
      ? list.map(p => {
        const person = S.byUid[p.uid] || { name: p.author, uid: p.uid };
        const mine = S.user && p.uid === S.user.uid;
        return `<article class="card post">
          ${avatarHTML(person, 44)}
          <div>
            <div class="post-head"><strong>${esc(person.name || p.author || 'Family member')}</strong><time datetime="${esc(p.createdAt)}">${esc(timeAgo(p.createdAt))}</time>
              ${mine ? `<span class="post-actions"><button class="icon-btn" type="button" data-action="delete-update" data-id="${esc(p.id)}" aria-label="Delete your update">${icon('trash')}</button></span>` : ''}
            </div>
            <p class="post-text">${esc(p.text)}</p>
          </div>
        </article>`;
      }).join('')
      : emptyHTML('chat', 'No updates yet', 'Be the first to share something with the family.');
  }
  const postText = $('#post-text');
  postText.addEventListener('input', () => { $('#post-count').textContent = `${postText.value.length} / 4000`; });
  postText.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#post-form').requestSubmit(); });
  $('#post-form').addEventListener('submit', async e => {
    e.preventDefault();
    const text = postText.value.trim();
    if (!text) { postText.focus(); return; }
    const btn = $('#post-btn');
    busy(btn, true, 'Posting…');
    try {
      await col('updates').add({ text, author: myName(), uid: S.user.uid, createdAt: nowIso() });
      postText.value = '';
      $('#post-count').textContent = '0 / 4000';
      toast('Shared with the family');
      await loadUpdates(true);
      renderFeed();
    } catch (err) {
      toast('Couldn’t post your update. Please try again.', true);
    } finally {
      busy(btn, false);
    }
  });
  async function deleteUpdate(id) {
    if (!(await confirmBox('Delete your update?', 'This can’t be undone.'))) return;
    try {
      await col('updates').doc(id).delete();
      toast('Update deleted');
      await loadUpdates(true);
      renderFeed();
    } catch (e) {
      toast('Couldn’t delete the update.', true);
    }
  }

  /* ===================== Directory ===================== */
  function renderDirectory() {
    const el = $('#people');
    if (!S.members.length) { el.innerHTML = skelRows(3); return; }
    const q = $('#dir-search').value.trim().toLowerCase();
    const list = S.members.filter(m => !q || [m.name, m.bio, m.email, m.phone, m.address].some(v => String(v || '').toLowerCase().includes(q)));
    $('#dir-count').textContent = q ? `${list.length} of ${plural(S.members.length, 'member')}` : plural(S.members.length, 'member');
    if (!list.length) { el.innerHTML = emptyHTML('search', 'No one matches that search', 'Try a first name or a city.'); return; }
    el.innerHTML = list.map(m => {
      const isMe = S.user && m.uid === S.user.uid;
      const rows = [];
      if (m.phone) rows.push(`<a href="tel:${esc(String(m.phone).replace(/[^\d+]/g, ''))}">${icon('phone')}${esc(m.phone)}</a>`);
      if (m.email) rows.push(`<a href="mailto:${esc(m.email)}">${icon('mail')}${esc(m.email)}</a>`);
      if (DAY.test(m.birthday || '')) rows.push(`<span>${icon('cake')}${esc(fmtBirthday(m.birthday))}</span>`);
      if (m.address) rows.push(`<a href="${esc(mapsUrl(m.address))}" target="_blank" rel="noopener noreferrer">${icon('pin')}<span>${esc(m.address)}</span></a>`);
      if (rows.length < 2 && isMe) rows.push(`<a href="#profile" class="missing">${icon('pencil')}Add your phone, birthday and address</a>`);
      return `<article class="card person">
        <div class="person-head">${avatarHTML(m, 64)}<div>
          <h2 class="person-name">${esc(m.name || 'Family member')}${isMe ? '<span class="you">You</span>' : ''}</h2>
          ${m.bio ? `<p class="person-bio">${esc(m.bio)}</p>` : `<p class="person-bio">Joined ${esc(fmtDate(m.joinedDate) || 'the hub')}</p>`}
        </div></div>
        <div class="contact">${rows.join('')}</div>
      </article>`;
    }).join('');
  }
  $('#dir-search').addEventListener('input', renderDirectory);

  /* ===================== Vault ===================== */
  function openVault() {
    if (!S.vault) {
      $('#notes').innerHTML = skelRows(3);
      loadVault().then(() => { if (S.view === 'vault') renderVault(); }).catch(err => {
        $('#notes').innerHTML = denied(err)
          ? emptyHTML('lock', 'The vault isn’t set up yet', 'A family admin needs to publish the latest security rules (see README).')
          : errorHTML('the vault');
      });
    } else {
      renderVault();
    }
  }
  function renderVault() {
    const notes = S.vault || [];
    const counts = { all: notes.length };
    Object.keys(CATS).forEach(c => { counts[c] = notes.filter(n => n.category === c).length; });
    $('#vault-filters').innerHTML = ['all'].concat(Object.keys(CATS)).map(c =>
      `<button type="button" data-action="vault-filter" data-cat="${c}" aria-pressed="${S.vaultCat === c}">${c === 'all' ? 'All' : CATS[c].label}<span>${counts[c]}</span></button>`).join('');
    const list = S.vaultCat === 'all' ? notes : notes.filter(n => n.category === S.vaultCat);
    if (!list.length) {
      $('#notes').innerHTML = emptyHTML('key', notes.length ? 'Nothing in this category' : 'The vault is empty',
        'Keep emergency contacts, doctors, insurance and household details where the whole family can find them.',
        '<button class="btn btn-ghost btn-sm" type="button" data-action="new-note">Add the first note</button>');
      return;
    }
    $('#notes').innerHTML = list.map(n => {
      const c = CATS[n.category] ? n.category : 'other';
      const open = S.revealed.has(n.id);
      return `<article class="card note">
        <div class="note-top">
          <span class="cat cat-${c}">${icon(CATS[c].icon)}${CATS[c].label}</span>
          <div class="note-tools">
            <button class="icon-btn" type="button" data-action="copy-note" data-id="${esc(n.id)}" aria-label="Copy ${esc(n.title)}">${icon('copy')}</button>
            <button class="icon-btn" type="button" data-action="edit-note" data-id="${esc(n.id)}" aria-label="Edit ${esc(n.title)}">${icon('pencil')}</button>
            <button class="icon-btn del" type="button" data-action="delete-note" data-id="${esc(n.id)}" aria-label="Delete ${esc(n.title)}">${icon('trash')}</button>
          </div>
        </div>
        <h2 class="note-title">${esc(n.title)}</h2>
        ${n.body ? `<div class="note-body${open ? '' : ' concealed'}"><pre${open ? '' : ' aria-hidden="true"'}>${esc(n.body)}</pre><button class="reveal-btn" type="button" data-action="reveal-note" data-id="${esc(n.id)}"><span>${icon('eye')}Tap to reveal</span></button></div>` : ''}
        <div class="note-foot"><span>Updated ${esc(timeAgo(n.updatedAt))}${n.updatedBy ? ` by ${esc(firstName(n.updatedBy))}` : ''}</span>${open && n.body ? `<button class="link-btn" type="button" data-action="hide-note" data-id="${esc(n.id)}">${icon('eye-off')}Hide</button>` : ''}</div>
      </article>`;
    }).join('');
  }
  function openNoteDialog(id) {
    const n = id ? (S.vault || []).find(x => x.id === id) : null;
    S.editingNote = n ? n.id : null;
    $('#note-form').reset();
    $('#note-dialog-title').textContent = n ? 'Edit note' : 'New vault note';
    $('#note-title').value = n ? n.title || '' : '';
    $('#note-cat').value = n && CATS[n.category] ? n.category : (S.vaultCat !== 'all' ? S.vaultCat : 'emergency');
    $('#note-body').value = n ? n.body || '' : '';
    $('#note-dialog').showModal();
    if (canHover) setTimeout(() => $('#note-title').focus(), 40);
  }
  $('#note-form').addEventListener('submit', async e => {
    e.preventDefault();
    const title = $('#note-title').value.trim();
    if (!title) { toast('Please give the note a title.', true); $('#note-title').focus(); return; }
    const data = { title, body: $('#note-body').value.trim(), category: $('#note-cat').value, updatedAt: nowIso(), updatedBy: myName() };
    const btn = $('#note-save');
    busy(btn, true, 'Saving…');
    try {
      if (S.editingNote) await col('vault').doc(S.editingNote).update(data);
      else await col('vault').add(Object.assign({ uid: S.user.uid, author: myName(), createdAt: data.updatedAt }, data));
      $('#note-dialog').close();
      toast(S.editingNote ? 'Note updated' : 'Saved to the vault');
      await loadVault(true);
      renderVault();
    } catch (err) {
      toast(denied(err) ? 'The vault needs the latest security rules — see README.' : 'Couldn’t save the note. Please try again.', true);
    } finally {
      busy(btn, false);
    }
  });
  async function deleteNote(id) {
    const n = (S.vault || []).find(x => x.id === id);
    if (!(await confirmBox('Delete this note?', n ? `“${n.title}” will be removed for everyone.` : ''))) return;
    try {
      await col('vault').doc(id).delete();
      S.revealed.delete(id);
      toast('Note deleted');
      await loadVault(true);
      renderVault();
    } catch (e) {
      toast('Couldn’t delete the note.', true);
    }
  }
  async function copyNote(id) {
    const n = (S.vault || []).find(x => x.id === id);
    if (!n) return;
    try { await navigator.clipboard.writeText(n.body ? `${n.title}\n${n.body}` : n.title); toast('Copied to clipboard'); }
    catch (e) { toast('Couldn’t copy on this device.', true); }
  }

  /* ===================== In Memory ===================== */
  function openMemorial() {
    if (!S.memorial) {
      $('#memorial-grid').innerHTML = '<div class="skel skel-tile"></div>'.repeat(4);
      loadMemorial().then(() => { if (S.view === 'memorial') renderMemorial(); }).catch(() => { $('#memorial-grid').innerHTML = errorHTML('photos'); });
    } else {
      renderMemorial();
    }
  }
  function renderMemorial() {
    const list = S.memorial || [];
    const cover = $('#memorial-cover');
    if (list[0]) {
      const img = document.createElement('img');
      img.alt = 'Hector Agraz';
      img.src = list[0].imageData;
      cover.replaceChildren(img);
    } else {
      cover.innerHTML = icon('candle');
    }
    const grid = $('#memorial-grid');
    if (!list.length) { grid.innerHTML = emptyHTML('heart', 'No photos yet', 'Add photos of Hector below — they’ll appear here for the whole family.'); return; }
    const frag = document.createDocumentFragment();
    list.forEach((m, i) => frag.appendChild(photoTile(m, i, 'memorial')));
    grid.replaceChildren(frag);
  }

  /* ===================== Profile ===================== */
  function renderProfile() {
    const m = S.me || {};
    $('#pf-name').value = m.name || '';
    $('#pf-phone').value = m.phone || '';
    $('#pf-birthday').value = DAY.test(m.birthday || '') ? m.birthday : '';
    $('#pf-address').value = m.address || '';
    $('#pf-bio').value = m.bio || '';
    S.avatarDraft = undefined;
    paintAvatar($('#profile-avatar'), m);
    $('#avatar-remove').hidden = !okImg(m.avatar);
    paintThemeSeg();
    let saved = '';
    try { saved = localStorage.getItem('jarvisUrl') || ''; } catch (e) {}
    $('#jarvis-url').value = saved;
    paintMe();
  }
  $('#avatar-input').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      S.avatarDraft = await compressImage(f, 320, 0.85, 140000, true);
      paintAvatar($('#profile-avatar'), Object.assign({}, S.me, { avatar: S.avatarDraft }));
      $('#avatar-remove').hidden = false;
      toast('Looking good! Save to keep your new photo.');
    } catch (err) {
      toast('That image couldn’t be used. Try a JPG or PNG.', true);
    }
    e.target.value = '';
  });
  $('#profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#pf-name').value.trim().replace(/\s+/g, ' ');
    if (!name) { toast('Please enter your name.', true); $('#pf-name').focus(); return; }
    const birthday = $('#pf-birthday').value;
    const data = {
      uid: S.user.uid,
      name,
      phone: $('#pf-phone').value.trim(),
      birthday: DAY.test(birthday) ? birthday : '',
      address: $('#pf-address').value.trim(),
      bio: $('#pf-bio').value.trim()
    };
    if (S.avatarDraft !== undefined) data.avatar = S.avatarDraft;
    const btn = $('#profile-save');
    busy(btn, true, 'Saving…');
    try {
      await col('users').doc(S.user.uid).update(data);
      if (name !== S.user.displayName) await S.user.updateProfile({ displayName: name }).catch(() => {});
      Object.assign(S.me, data);
      S.avatarDraft = undefined;
      paintMe();
      toast('Your profile is saved');
      await loadMembers().catch(() => {});
      if (S.view === 'profile') renderProfile();
    } catch (err) {
      toast(denied(err) ? 'Profile details need the latest security rules — see README.' : 'Couldn’t save your profile. Please try again.', true);
    } finally {
      busy(btn, false);
    }
  });
  $('#jarvis-form').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('#jarvis-url').value.trim();
    try {
      if (!v) { localStorage.removeItem('jarvisUrl'); toast('JARVIS address reset to the default'); return; }
      const u = new URL(v);
      if (!/^https?:$/.test(u.protocol)) throw new Error('protocol');
      localStorage.setItem('jarvisUrl', u.href);
      toast('JARVIS address saved on this device');
    } catch (err) {
      toast('Please enter a full web address, like https://…', true);
    }
  });

  const RENDER = {
    home: renderHome, photos: openPhotos, calendar: openCalendar, updates: openUpdates,
    directory: () => { renderDirectory(); if (!S.members.length) loadMembers().catch(() => { $('#people').innerHTML = errorHTML('the directory'); }); },
    vault: openVault, memorial: openMemorial, profile: renderProfile
  };

  /* ===================== Events (delegated) ===================== */
  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-action],[data-auth],[data-theme-set],[data-close]');
    if (!t) return;
    if (t.hasAttribute('data-close')) { t.closest('dialog').close(); return; }
    if (t.dataset.auth) {
      authMode(t.dataset.auth);
      if (t.dataset.auth === 'join') history.replaceState(null, '', '#join');
      else if (location.hash === '#join') history.replaceState(null, '', location.pathname);
      return;
    }
    if (t.dataset.themeSet) { setTheme(t.dataset.themeSet); return; }
    const id = t.dataset.id;
    switch (t.dataset.action) {
      case 'toggle-pass': {
        const input = t.parentElement.querySelector('input');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        t.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        t.querySelector('use').setAttribute('href', `/assets/icons.svg#${show ? 'eye-off' : 'eye'}`);
        break;
      }
      case 'signout': await signOut(); break;
      case 'toggle-theme': setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'); break;
      case 'jarvis': openJarvis(); break;
      case 'more': $('#more-sheet').showModal(); break;
      case 'retry': {
        if (!S.view) break;
        const stale = { home: ['events', 'updates', 'recent'], calendar: ['events'], updates: ['updates'], vault: ['vault'], memorial: ['memorial'] }[S.view] || [];
        stale.forEach(k => { S[k] = null; });
        if (S.view === 'photos') S.photos.loaded = false;
        if (!S.members.length) loadMembers().catch(() => {});
        RENDER[S.view]();
        break;
      }
      case 'new-event': openEventDialog(t.dataset.date); break;
      case 'delete-event': deleteEvent(id); break;
      case 'cal-prev': moveMonth(-1); break;
      case 'cal-next': moveMonth(1); break;
      case 'cal-today': S.cal = { y: new Date().getFullYear(), m: new Date().getMonth() }; renderCalendar(); break;
      case 'open-photo': openLightbox(t.dataset.kind, Number(t.dataset.i), t); break;
      case 'lb-close': closeLightbox(); break;
      case 'lb-prev': stepLightbox(-1); break;
      case 'lb-next': stepLightbox(1); break;
      case 'lb-delete': deleteFromLightbox(); break;
      case 'more-photos': morePhotos(t); break;
      case 'upload-photos': uploadStaged('photos'); break;
      case 'cancel-photos': clearStaging('photos'); break;
      case 'upload-memorial': uploadStaged('memorial'); break;
      case 'cancel-memorial': clearStaging('memorial'); break;
      case 'delete-update': deleteUpdate(id); break;
      case 'vault-filter': S.vaultCat = t.dataset.cat; renderVault(); break;
      case 'new-note': openNoteDialog(null); break;
      case 'edit-note': openNoteDialog(id); break;
      case 'delete-note': deleteNote(id); break;
      case 'copy-note': copyNote(id); break;
      case 'reveal-note': S.revealed.add(id); renderVault(); break;
      case 'hide-note': S.revealed.delete(id); renderVault(); break;
      case 'remove-avatar':
        S.avatarDraft = '';
        paintAvatar($('#profile-avatar'), Object.assign({}, S.me, { avatar: '' }));
        $('#avatar-remove').hidden = true;
        break;
      case 'reset-self':
        try { await auth.sendPasswordResetEmail(S.user.email); toast(`Reset link sent to ${S.user.email}`); }
        catch (err) { toast('Couldn’t send the email. Please try again later.', true); }
        break;
    }
  });

  // Close dialogs when the backdrop is clicked.
  $$('dialog').forEach(d => d.addEventListener('click', e => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
  }));
  $('#more-sheet').addEventListener('click', e => { if (e.target.closest('a')) $('#more-sheet').close(); });

  document.addEventListener('keydown', e => {
    if ($('#lightbox').hidden) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') stepLightbox(-1);
    else if (e.key === 'ArrowRight') stepLightbox(1);
  });

  // File pickers + drag and drop
  $('#photo-input').addEventListener('change', e => stageFiles('photos', e.target.files));
  $('#memorial-input').addEventListener('change', e => stageFiles('memorial', e.target.files));
  $$('[data-drop]').forEach(z => {
    ['dragenter', 'dragover'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove('drag'); }));
    z.addEventListener('drop', e => stageFiles(z.dataset.drop, e.dataTransfer && e.dataTransfer.files));
  });
  // Don't let a missed drop navigate away from the hub.
  ['dragover', 'drop'].forEach(ev => window.addEventListener(ev, e => { if (!e.target.closest || !e.target.closest('[data-drop]')) e.preventDefault(); }));

  // Links + misc
  $$('[data-link="tree"]').forEach(a => { a.href = ANCESTRY_URL; });
  paintThemeSeg();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
