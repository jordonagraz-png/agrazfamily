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

  const FIRST_YEAR = 2024; // the hub's first photos
  const VAULT_IDLE_MS = 5 * 60e3; // vault relocks after this long without activity…
  const VAULT_AWAY_MS = 60e3; // …or after the tab has been in the background this long
  const NEED_RULES = 'This needs the latest security rules — see README.';

  const VIEWS = ['home', 'photos', 'calendar', 'updates', 'recipes', 'directory', 'vault', 'memorial', 'profile'];
  const ALIASES = { memories: 'photos', events: 'calendar' };
  const TITLES = { home: 'Home', photos: 'Photos', calendar: 'Calendar', updates: 'Updates', recipes: 'Recipes', directory: 'Directory', vault: 'Family Vault', memorial: 'In Memory', profile: 'My Profile' };
  const SECONDARY = ['recipes', 'directory', 'vault', 'memorial', 'profile'];
  const RECIPE_CATS = { mains: 'Mains', sides: 'Sides', desserts: 'Desserts', breakfast: 'Breakfast', drinks: 'Drinks', other: 'Other' };
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
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const joinNames = names => names.length < 2 ? (names[0] || '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const lines = v => String(v || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);

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
    staged: { photos: [], memorial: [] }, thumbUrls: { photos: [], memorial: [] },
    avatarDraft: undefined, pending: [],
    comments: {}, openThreads: new Set(), lbThread: false,
    recipes: null, recipeCat: 'all', openRecipe: null, editingRecipe: null, recipePhoto: undefined,
    tributes: null, candles: null, otd: null, addcal: null, prefillPost: '', installEvt: null,
    vaultOpen: false, lastActive: Date.now(), hiddenAt: 0
  };
  const myName = () => (S.me && S.me.name) || (S.user && (S.user.displayName || S.user.email)) || 'Family member';

  /* ===================== Auth screens ===================== */
  const setScreen = s => { document.body.dataset.state = s; };
  const AUTH_COPY = {
    login: ['Welcome home', 'Sign in to the private family hub.'],
    join: ['Join the family', 'Create your account with the invite code a family member gave you.'],
    reset: ['Reset your password', 'We’ll email you a secure link to choose a new one.'],
    finish: ['Almost there', 'Enter the family invite code to finish setting up your account.'],
    pending: ['You’re almost in', 'Your account is waiting for a family admin.']
  };
  function authMode(mode) {
    $('#auth-title').textContent = AUTH_COPY[mode][0];
    $('#auth-sub').textContent = AUTH_COPY[mode][1];
    ['login', 'join', 'reset', 'finish', 'pending'].forEach(m => { $('#form-' + m).hidden = m !== mode; });
    $('#auth-seg').hidden = !(mode === 'login' || mode === 'join');
    $('.auth-lock').hidden = mode === 'pending';
    $('#tab-login').setAttribute('aria-selected', String(mode === 'login'));
    $('#tab-join').setAttribute('aria-selected', String(mode === 'join'));
    if (mode === 'reset') $('#reset-email').value = $('#login-email').value;
    authMsg('');
    if (canHover && document.body.dataset.state === 'auth') {
      const first = $(`#form-${mode} input`);
      if (first) first.focus();
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
      const approved = await completeMembership(cred.user, name, code);
      S.joining = false;
      busy(btn, false);
      form.reset();
      if (approved) {
        await enterApp(cred.user);
        toast(`Welcome to the family, ${firstName(name)}!`);
      } else {
        showPending(name);
      }
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
  // before it will allow the users/{uid} doc that makes you a member. We never create
  // that doc unless the server accepted the code. Returns false if an admin must approve.
  async function completeMembership(user, name, code) {
    const at = nowIso();
    try {
      await col('joins').doc(user.uid).set({ code, createdAt: at });
    } catch (e) {
      // Joined before but setup was interrupted? Otherwise the code was wrong.
      const prior = await col('joins').doc(user.uid).get().catch(() => null);
      if (!prior || !prior.exists) throw e;
    }
    const base = { name, email: user.email, uid: user.uid, joinedDate: at };
    try {
      await col('users').doc(user.uid).set(Object.assign({ approved: true }, base));
      return true;
    } catch (e) {
      // The family requires an admin to approve new members.
      await col('users').doc(user.uid).set(Object.assign({ approved: false }, base));
      return false;
    }
  }

  $('#form-finish').addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('#finish-code').value.trim();
    if (!code) return authMsg('Please enter the family invite code.');
    const btn = submitBtn(e.currentTarget);
    busy(btn, true, 'Checking…');
    try {
      const u = auth.currentUser;
      const name = u.displayName || u.email.split('@')[0];
      if (await completeMembership(u, name, code)) {
        await enterApp(u);
        toast('Welcome to the family!');
      } else {
        showPending(name);
      }
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
      if (!wasAuth || !$('#form-finish').hidden || !$('#form-pending').hidden) authMode(location.hash === '#join' ? 'join' : 'login');
      return;
    }
    try {
      const snap = await col('users').doc(user.uid).get();
      if (snap.exists && snap.data().approved === false) {
        showPending(snap.data().name);
      } else if (snap.exists) {
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
    Object.assign(S, {
      me: null, members: [], byUid: {}, view: null, events: null, updates: null, vault: null, memorial: null, recent: null,
      vaultCat: 'all', avatarDraft: undefined, pending: [], comments: {}, lbThread: false, recipes: null, recipeCat: 'all',
      openRecipe: null, tributes: null, candles: null, otd: null, addcal: null, prefillPost: '', vaultOpen: false
    });
    S.openThreads.clear();
    S.photos = { items: [], last: null, done: false, loading: false, loaded: false, rendered: 0 };
    S.revealed.clear();
    clearStaging('photos');
    clearStaging('memorial');
    // Don't leave private content in the page after signing out.
    ['#home-upcoming', '#home-family', '#home-photos', '#home-updates', '#home-bday', '#home-otd-strip', '#photo-grid', '#cal-grid', '#cal-agenda', '#feed',
      '#people', '#pending-panel', '#notes', '#vault-filters', '#memorial-grid', '#tributes', '#candle-row', '#recipes', '#recipe-filters', '#lb-thread'].forEach(s => { const el = $(s); if (el) el.innerHTML = ''; });
    ['#home-bday', '#home-otd', '#pending-panel'].forEach(s => { $(s).hidden = true; });
    paintPendingBadge();
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
    const all = snap.docs.map(d => Object.assign({}, d.data(), { uid: d.id }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    S.members = all.filter(m => m.approved !== false);
    S.pending = all.filter(m => m.approved === false);
    S.byUid = {};
    all.forEach(m => { S.byUid[m.uid] = m; });
    if (S.user && S.byUid[S.user.uid]) { S.me = S.byUid[S.user.uid]; paintMe(); }
    paintPendingBadge();
    if (S.view === 'home') { renderHomeFamily(); if (S.events) renderHomeUpcoming(); if (S.updates) renderHomeUpdates(); }
    else if (S.view === 'directory') renderDirectory();
    else if (S.view === 'calendar' && S.events) { renderCalendar(); renderAgenda(); }
    else if (S.view === 'updates' && S.updates) renderFeed();
    else if (S.view === 'memorial') { if (S.tributes) renderGuestbook(); if (S.candles) renderCandles(); }
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
    const rc = bday ? null : rsvpCounts(it);
    const loc = it.location
      ? (compact ? `<span>${icon('pin')}${esc(it.location)}</span>` : `<a href="${esc(mapsUrl(it.location))}" target="_blank" rel="noopener noreferrer"><span>${icon('pin')}${esc(it.location)}</span></a>`)
      : '';
    return `<div class="ag-item${compact ? ' compact' : ''}">
      <div class="date-badge${bday ? ' is-bday' : ''}${today ? ' is-today' : ''}"><small>${MON[d.getMonth()]}</small><b>${d.getDate()}</b></div>
      <div class="ag-body">
        <div class="ag-title">${esc(it.title)}</div>
        <div class="ag-meta"><span>${icon(bday ? 'cake' : 'clock')}${when}</span>${loc}${compact && rc && rc.going.length ? `<span class="going">${icon('users')}${rc.going.length} going</span>` : ''}${compact && rc && rc.mine === 'yes' ? `<span class="going mine">${icon('check')}You’re going</span>` : ''}</div>
        ${!compact && it.description ? `<p class="ag-desc">${esc(it.description)}</p>` : ''}
        ${!compact && it.createdBy ? `<div class="ag-meta"><span>Added by ${esc(it.createdBy)}</span></div>` : ''}
        ${!compact && !bday ? rsvpHTML(it) : ''}
      </div>
      ${!compact && !bday ? `<div class="ag-actions"><button class="icon-btn" type="button" data-action="add-cal" data-id="${esc(it.id)}" aria-label="Add ${esc(it.title)} to your calendar">${icon('calendar-plus')}</button><button class="icon-btn del" type="button" data-action="delete-event" data-id="${esc(it.id)}" aria-label="Delete ${esc(it.title)}">${icon('trash')}</button></div>` : ''}
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
    renderInstall();
    if (S.members.length) renderBirthdayBanner();
    if (S.otd) renderHomeOtd();
    else loadOnThisDay().then(renderHomeOtd).catch(() => {});
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
    renderBirthdayBanner();
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
    S.staged[kind] = files;
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
    S.staged[kind] = [];
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
    const files = S.staged[kind];
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
  function lbList(kind) { return kind === 'photos' ? S.photos.items : kind === 'memorial' ? (S.memorial || []) : kind === 'otd' ? (S.otd || []) : (S.recent || []); }
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
    paintLbSocial();
  }
  // Hearts + comments for album photos (the memorial gallery stays quiet).
  function paintLbSocial() {
    const { list, i, kind } = S.lb;
    const it = list[i];
    const social = it && kind !== 'memorial';
    const parent = social ? `memories/${it.id}` : '';
    $('#lb-actions').innerHTML = social
      ? heartBtn('memories', it, true) + `<button type="button" class="react light" data-action="lb-thread" aria-expanded="${S.lbThread}">${icon('chat')}<span>${esc(commentLabel(parent))}</span></button>`
      : '';
    if (social && !S.comments[parent]) loadComments([parent]).then(() => { if (!$('#lightbox').hidden && S.lb.list[S.lb.i] === it) paintLbSocial(); });
    const panel = $('#lb-thread');
    const show = social && S.lbThread;
    panel.hidden = !show;
    $('#lightbox').classList.toggle('with-thread', !!show);
    panel.innerHTML = show
      ? `<header class="lb-thread-head"><strong>Comments</strong><button class="icon-btn" type="button" data-action="lb-thread" aria-label="Close comments">${icon('x')}</button></header><div class="thread">${S.comments[parent] ? threadHTML(parent) : skelRows(2)}</div>`
      : '';
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
    S.lbThread = false;
    lb.classList.remove('with-thread');
    $('#lb-thread').hidden = true;
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
        S.otd = null;
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
    if (canHover) $('#ev-title').focus();
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
    const withComments = () => loadComments((S.updates || []).map(p => `updates/${p.id}`)).then(() => { if (S.view === 'updates') renderFeed(); });
    if (!S.updates) {
      $('#feed').innerHTML = skelRows(4);
      loadUpdates().then(() => { if (S.view === 'updates') { renderFeed(); withComments(); } }).catch(() => { $('#feed').innerHTML = errorHTML('updates'); });
    } else {
      renderFeed();
      withComments();
    }
    if (S.prefillPost) {
      postText.value = S.prefillPost;
      S.prefillPost = '';
      postText.dispatchEvent(new Event('input'));
      setTimeout(() => { postText.focus(); postText.setSelectionRange(postText.value.length, postText.value.length); }, 60);
    }
  }
  function renderFeed() {
    const list = S.updates || [];
    $('#feed').innerHTML = list.length
      ? list.map(p => {
        const person = S.byUid[p.uid] || { name: p.author, uid: p.uid };
        const mine = S.user && p.uid === S.user.uid;
        const parent = `updates/${p.id}`;
        const open = S.openThreads.has(parent);
        return `<article class="card post">
          ${avatarHTML(person, 44)}
          <div class="post-main">
            <div class="post-head"><strong>${esc(person.name || p.author || 'Family member')}</strong><time datetime="${esc(p.createdAt)}">${esc(timeAgo(p.createdAt))}</time>
              ${mine ? `<span class="post-actions"><button class="icon-btn" type="button" data-action="delete-update" data-id="${esc(p.id)}" aria-label="Delete your update">${icon('trash')}</button></span>` : ''}
            </div>
            <p class="post-text">${esc(p.text)}</p>
            <div class="post-foot">${heartBtn('updates', p)}<button type="button" class="react" data-action="toggle-thread" data-parent="${esc(parent)}" aria-expanded="${open}">${icon('chat')}<span>${esc(commentLabel(parent))}</span></button></div>
            <div class="thread" data-thread="${esc(parent)}"${open ? '' : ' hidden'}>${open ? threadHTML(parent) : ''}</div>
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
      await loadComments(S.updates.map(x => `updates/${x.id}`));
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
    renderPending();
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
    $('#vault-lock').hidden = S.vaultOpen;
    $('#vault-content').hidden = !S.vaultOpen;
    $('#vault-actions').hidden = !S.vaultOpen;
    if (!S.vaultOpen) {
      $('#vault-msg').textContent = '';
      $('#vault-user').value = (S.user && S.user.email) || '';
      if (canHover) $('#vault-pass').focus();
      return;
    }
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
    if (canHover) $('#note-title').focus();
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
    paintMe();
    if (S.candles) renderCandles();
    loadCandles().then(() => { if (S.view === 'memorial') renderCandles(); }).catch(() => { if (S.view === 'memorial') renderCandles(); });
    if (S.tributes) renderGuestbook();
    else {
      $('#tributes').innerHTML = skelRows(2);
      loadTributes().then(() => { if (S.view === 'memorial') renderGuestbook(); }).catch(err => {
        $('#tributes').innerHTML = denied(err)
          ? emptyHTML('heart', 'The guestbook isn’t set up yet', 'A family admin needs to publish the latest security rules (see README).')
          : errorHTML('memories');
      });
    }
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

  /* ===================== Approvals (admins) ===================== */
  const isAdmin = () => !!(S.me && S.me.role === 'admin');
  function showPending(name) {
    setScreen('auth');
    authMode('pending');
    $('#pending-who').textContent = `Thanks for joining, ${firstName(name)}! A family admin needs to approve your account — you’ll be let in as soon as they do.`;
  }
  async function checkApproval(btn) {
    busy(btn, true, 'Checking…');
    try {
      const u = auth.currentUser;
      const snap = await col('users').doc(u.uid).get();
      if (snap.exists && snap.data().approved !== false) {
        await enterApp(u, snap);
        toast('You’re in — welcome to the family!');
      } else {
        authMsg('Still waiting for approval. Check back a little later.');
      }
    } catch (e) {
      authMsg('Couldn’t check right now. Please try again.');
    } finally {
      busy(btn, false);
    }
  }
  function paintPendingBadge() {
    const n = isAdmin() ? S.pending.length : 0;
    $$('[data-pending-badge]').forEach(b => { b.hidden = !n; b.textContent = n || ''; });
  }
  function renderPending() {
    const el = $('#pending-panel');
    if (!isAdmin() || !S.pending.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `<div class="pending-head"><span class="sc-icon sc-gold">${icon('hourglass')}</span><div><strong>Waiting for your approval</strong><p class="muted">${plural(S.pending.length, 'person')} joined with the invite code. Approve the people you know.</p></div></div>`
      + S.pending.map(m => `<div class="pending-row">${avatarHTML(m, 44)}<div class="pending-who"><strong>${esc(m.name || 'New member')}</strong><small>${esc(m.email || '')}${m.joinedDate ? ` · joined ${esc(timeAgo(m.joinedDate))}` : ''}</small></div><div class="pending-actions"><button class="btn btn-ghost btn-sm" type="button" data-action="decline-member" data-uid="${esc(m.uid)}">Decline</button><button class="btn btn-accent btn-sm" type="button" data-action="approve-member" data-uid="${esc(m.uid)}">${icon('check')}Approve</button></div></div>`).join('');
  }
  async function decideMember(uid, approve, btn) {
    const m = S.pending.find(x => x.uid === uid);
    if (!m) return;
    if (!approve && !(await confirmBox(`Decline ${m.name || 'this person'}?`, 'Their request will be removed. To block them for good, also disable their account in the Firebase console.', 'Decline'))) return;
    busy(btn, true);
    try {
      if (approve) await col('users').doc(uid).update({ approved: true });
      else await col('users').doc(uid).delete();
      toast(approve ? `${firstName(m.name)} is in — welcome to the family!` : 'Request declined');
      await loadMembers();
    } catch (e) {
      busy(btn, false);
      toast(denied(e) ? NEED_RULES : 'Couldn’t update. Please try again.', true);
    }
  }

  /* ===================== RSVPs + add to calendar ===================== */
  const RSVP_LABEL = { yes: 'Going', maybe: 'Maybe', no: 'Can’t go' };
  function rsvpCounts(ev) {
    const r = ev.rsvp || {};
    return {
      going: Object.keys(r).filter(u => r[u] === 'yes' && S.byUid[u]),
      maybe: Object.keys(r).filter(u => r[u] === 'maybe' && S.byUid[u]),
      mine: S.user ? r[S.user.uid] : undefined
    };
  }
  function rsvpHTML(ev) {
    const { going, maybe, mine } = rsvpCounts(ev);
    const btn = v => `<button type="button" class="rsvp-btn${mine === v ? ' on' : ''}" data-action="rsvp" data-id="${esc(ev.id)}" data-v="${v}" aria-pressed="${mine === v}">${v === 'yes' ? icon('check') : ''}${RSVP_LABEL[v]}</button>`;
    const summary = [going.length && `${going.length} going`, maybe.length && `${maybe.length} maybe`].filter(Boolean).join(' · ');
    return `<div class="rsvp"><div class="rsvp-btns" role="group" aria-label="Are you going to ${esc(ev.title)}?">${btn('yes')}${btn('maybe')}${btn('no')}</div>${summary ? `<div class="rsvp-who"><span class="rsvp-faces">${going.slice(0, 6).map(u => avatarHTML(S.byUid[u], 28)).join('')}</span><span>${esc(summary)}</span></div>` : ''}</div>`;
  }
  async function setRsvp(id, v) {
    const ev = (S.events || []).find(e => e.id === id);
    if (!ev || !RSVP_LABEL[v] || !S.user) return;
    const prev = Object.assign({}, ev.rsvp);
    const repaint = () => {
      if (S.view === 'calendar') renderAgenda(); else if (S.view === 'home') renderHomeUpcoming();
      const b = $$('[data-action="rsvp"]').find(x => x.dataset.id === id && x.dataset.v === v);
      if (b) b.focus({ preventScroll: true });
    };
    ev.rsvp = Object.assign({}, prev, { [S.user.uid]: v });
    repaint();
    try {
      await col('events').doc(id).update({ ['rsvp.' + S.user.uid]: v });
      if (v === 'yes' && prev[S.user.uid] !== 'yes') toast('You’re going — see you there!');
    } catch (e) {
      ev.rsvp = prev;
      repaint();
      toast(denied(e) ? NEED_RULES : 'Couldn’t save your RSVP. Please try again.', true);
    }
  }
  function eventTimes(ev) {
    const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const day = parseDay(ev.date);
    if (/^\d{2}:\d{2}$/.test(ev.time || '')) {
      const [h, m] = ev.time.split(':').map(Number);
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
      const end = new Date(start.getTime() + 2 * 3600e3);
      const f = d => `${ymd(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
      return { allDay: false, start: f(start), end: f(end) };
    }
    return { allDay: true, start: ymd(day), end: ymd(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) };
  }
  const icsText = v => String(v || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
  function icsFold(line) {
    const enc = new TextEncoder();
    let out = '', cur = '', bytes = 0;
    for (const ch of line) {
      const n = enc.encode(ch).length;
      if (bytes + n > 74) { out += cur + '\r\n '; cur = ''; bytes = 1; }
      cur += ch;
      bytes += n;
    }
    return out + cur;
  }
  function buildICS(ev) {
    const t = eventTimes(ev);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Agraz Family//Family Hub//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      `UID:${ev.id}@agrazfamily.com`, `DTSTAMP:${stamp}`,
      t.allDay ? `DTSTART;VALUE=DATE:${t.start}` : `DTSTART:${t.start}`,
      t.allDay ? `DTEND;VALUE=DATE:${t.end}` : `DTEND:${t.end}`,
      `SUMMARY:${icsText(ev.title)}`];
    if (ev.location) out.push(`LOCATION:${icsText(ev.location)}`);
    out.push(`DESCRIPTION:${icsText([ev.description, 'From the Agraz Family Hub — https://www.agrazfamily.com/family/#calendar'].filter(Boolean).join('\n\n'))}`, 'END:VEVENT', 'END:VCALENDAR');
    return out.map(icsFold).join('\r\n') + '\r\n';
  }
  function googleCalUrl(ev) {
    const t = eventTimes(ev);
    const q = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${t.start}/${t.end}`, details: ev.description || '', location: ev.location || '' });
    return `https://calendar.google.com/calendar/render?${q}`;
  }
  function openAddCal(id) {
    const ev = (S.events || []).find(e => e.id === id);
    if (!ev) return;
    S.addcal = ev;
    $('#addcal-event').textContent = `${ev.title} · ${relDay(ev.date)}${ev.time ? ' · ' + fmtTime(ev.time) : ''}`;
    $('#addcal-google').href = googleCalUrl(ev);
    $('#addcal-dialog').showModal();
  }
  function downloadICS() {
    const ev = S.addcal;
    if (!ev) return;
    const url = URL.createObjectURL(new Blob([buildICS(ev)], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${String(ev.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event'}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    $('#addcal-dialog').close();
    toast('Invite downloaded — open it to add it to your calendar');
  }
  $('#addcal-google').addEventListener('click', () => setTimeout(() => $('#addcal-dialog').close(), 150));

  /* ===================== Hearts + comments ===================== */
  const heartCount = it => Object.keys(it.hearts || {}).filter(k => it.hearts[k] === true).length;
  const hearted = it => !!(S.user && it.hearts && it.hearts[S.user.uid] === true);
  function heartBtn(colName, it, light) {
    const on = hearted(it), n = heartCount(it);
    return `<button type="button" class="react heart${on ? ' on' : ''}${light ? ' light' : ''}" data-action="heart" data-col="${colName}" data-id="${esc(it.id)}" aria-pressed="${on}" aria-label="${on ? 'Remove your heart' : 'Send a heart'}${n ? ` (${n})` : ''}">${icon(on ? 'heart-fill' : 'heart')}<span>${n || ''}</span></button>`;
  }
  function itemsFor(colName, id) {
    const lists = colName === 'updates' ? [S.updates || []] : [S.photos.items, S.recent || [], S.otd || []];
    const out = [];
    lists.forEach(l => l.forEach(x => { if (x.id === id && !out.includes(x)) out.push(x); }));
    return out;
  }
  function repaintHearts(colName, id, it, pop) {
    $$('[data-action="heart"]').filter(b => b.dataset.col === colName && b.dataset.id === id).forEach(b => {
      const hadFocus = document.activeElement === b;
      const tmp = document.createElement('div');
      tmp.innerHTML = heartBtn(colName, it, b.classList.contains('light'));
      const nb = tmp.firstElementChild;
      if (pop && !REDUCED) nb.classList.add('pop');
      b.replaceWith(nb);
      if (hadFocus) nb.focus({ preventScroll: true });
    });
  }
  async function toggleHeart(colName, id) {
    const items = itemsFor(colName, id);
    if (!items.length || !S.user) return;
    const uid = S.user.uid, was = hearted(items[0]);
    const apply = (v, pop) => { items.forEach(x => { x.hearts = Object.assign({}, x.hearts, { [uid]: v }); }); repaintHearts(colName, id, items[0], pop); };
    apply(!was, !was);
    try { await col(colName).doc(id).update({ ['hearts.' + uid]: !was }); }
    catch (e) { apply(was, false); toast(denied(e) ? NEED_RULES : 'Couldn’t send your heart. Please try again.', true); }
  }
  async function loadComments(parents, force) {
    const need = parents.filter(p => force || !S.comments[p]);
    for (let i = 0; i < need.length; i += 30) {
      const chunk = need.slice(i, i + 30);
      try {
        const snap = await col('comments').where('parent', 'in', chunk).get();
        chunk.forEach(p => { S.comments[p] = []; });
        snap.docs.forEach(d => { const c = Object.assign({ id: d.id }, d.data()); if (S.comments[c.parent]) S.comments[c.parent].push(c); });
        chunk.forEach(p => S.comments[p].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))));
      } catch (e) {
        chunk.forEach(p => { S.comments[p] = S.comments[p] || []; });
      }
    }
  }
  const commentLabel = parent => { const n = (S.comments[parent] || []).length; return n ? plural(n, 'comment') : 'Comment'; };
  function commentHTML(c) {
    const p = S.byUid[c.uid] || { name: c.author, uid: c.uid };
    const mine = S.user && c.uid === S.user.uid;
    return `<div class="comment">${avatarHTML(p, 28)}<div class="comment-bubble"><div class="comment-head"><strong>${esc(p.name || c.author || 'Family member')}</strong><time>${esc(timeAgo(c.createdAt))}</time></div><p>${esc(c.text)}</p></div>${mine ? `<button class="icon-btn comment-del" type="button" data-action="delete-comment" data-id="${esc(c.id)}" data-parent="${esc(c.parent)}" aria-label="Delete your comment">${icon('trash')}</button>` : ''}</div>`;
  }
  function threadHTML(parent) {
    return (S.comments[parent] || []).map(commentHTML).join('')
      + `<form class="comment-form" data-parent="${esc(parent)}">${avatarHTML(S.me, 28)}<input class="comment-input" name="text" maxlength="2000" placeholder="Write a comment…" aria-label="Write a comment" autocomplete="off"><button class="icon-btn" type="submit" aria-label="Post comment">${icon('send')}</button></form>`;
  }
  function repaintThread(parent) {
    if (parent.startsWith('memories/')) { if (!$('#lightbox').hidden) paintLbSocial(); return; }
    const box = $$('[data-thread]').find(el => el.dataset.thread === parent);
    if (box && !box.hidden) box.innerHTML = threadHTML(parent);
    $$('[data-action="toggle-thread"]').filter(b => b.dataset.parent === parent).forEach(b => { b.querySelector('span').textContent = commentLabel(parent); });
  }
  async function postComment(form) {
    const parent = form.dataset.parent;
    const input = form.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    const btn = form.querySelector('button');
    btn.disabled = true;
    const c = { parent, text, uid: S.user.uid, author: myName(), createdAt: nowIso() };
    try {
      const ref = await col('comments').add(c);
      (S.comments[parent] = S.comments[parent] || []).push(Object.assign({ id: ref.id }, c));
      repaintThread(parent);
      const nf = $$('.comment-form').find(f => f.dataset.parent === parent);
      if (nf) nf.querySelector('input').focus();
    } catch (e) {
      btn.disabled = false;
      toast(denied(e) ? NEED_RULES : 'Couldn’t post your comment. Please try again.', true);
    }
  }
  async function deleteComment(id, parent) {
    if (!(await confirmBox('Delete your comment?', 'This can’t be undone.'))) return;
    try {
      await col('comments').doc(id).delete();
      S.comments[parent] = (S.comments[parent] || []).filter(c => c.id !== id);
      repaintThread(parent);
    } catch (e) {
      toast('Couldn’t delete the comment.', true);
    }
  }
  document.addEventListener('submit', e => {
    const f = e.target.closest && e.target.closest('.comment-form');
    if (!f) return;
    e.preventDefault();
    postComment(f);
  });

  /* ===================== Birthdays ===================== */
  function renderBirthdayBanner() {
    const el = $('#home-bday');
    const t = parseDay(todayStr());
    const people = birthdaysBetween(t, t).map(b => S.byUid[b.uid]).filter(Boolean);
    if (!people.length) { el.hidden = true; el.innerHTML = ''; return; }
    const me = people.find(m => S.user && m.uid === S.user.uid);
    const others = people.filter(m => m !== me);
    const title = !others.length ? `Happy birthday, ${firstName(me.name)}!` : `It’s ${joinNames(others.map(m => firstName(m.name)))}’s birthday!`;
    const sub = !others.length ? 'The whole family is celebrating you today.'
      : me ? `And happy birthday to you too, ${firstName(me.name)}!` : 'Send some love — it’ll make their day.';
    el.innerHTML = `<div class="bday-banner"><div class="bday-faces">${people.map(m => avatarHTML(m, 64)).join('')}</div><div class="bday-text"><p class="bday-eyebrow">${icon('gift')}Today</p><h2>${esc(title)}</h2><p>${esc(sub)}</p></div>${others.length ? `<button class="btn btn-light" type="button" data-action="bday-wish" data-uid="${esc(others[0].uid)}">${icon('heart')}Send wishes</button>` : ''}</div>`;
    el.hidden = false;
    const key = `agraz-confetti-${todayStr()}`;
    let seen = false;
    try { seen = localStorage.getItem(key) === '1'; localStorage.setItem(key, '1'); } catch (e) {}
    if (!seen && !REDUCED) setTimeout(confetti, 450);
  }
  function confetti() {
    const c = document.createElement('canvas');
    c.className = 'confetti';
    c.setAttribute('aria-hidden', 'true');
    document.body.appendChild(c);
    const ctx = c.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.width = innerWidth * dpr, H = c.height = innerHeight * dpr;
    const colors = ['#f2a27a', '#7fc6b2', '#d6ad72', '#a94f2b', '#2b6b66', '#f4ede2', '#e58c63'];
    const bits = Array.from({ length: 170 }, (_, i) => ({
      x: Math.random() * W, y: -Math.random() * H * 0.6 - 20 * dpr,
      w: (5 + Math.random() * 6) * dpr, h: (8 + Math.random() * 8) * dpr,
      vx: (Math.random() - 0.5) * 2.4 * dpr, vy: (2 + Math.random() * 3) * dpr,
      r: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.24, c: colors[i % colors.length]
    }));
    const t0 = performance.now();
    (function frame(now) {
      const el = now - t0;
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, el - 2800) / 900);
      bits.forEach(b => {
        b.x += b.vx + Math.sin((el / 300) + b.r) * 0.6 * dpr;
        b.y += b.vy;
        b.vy += 0.025 * dpr;
        b.r += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.r)));
        ctx.restore();
      });
      if (el < 3700) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  /* ===================== On this day ===================== */
  async function loadOnThisDay() {
    if (S.otd) return S.otd;
    const now = new Date();
    const out = [];
    for (let y = now.getFullYear() - 1; y >= FIRST_YEAR && out.length < 8; y--) {
      const from = new Date(y, now.getMonth(), now.getDate() - 3).toISOString();
      const to = new Date(y, now.getMonth(), now.getDate() + 4).toISOString();
      const snap = await col('memories').where('createdAt', '>=', from).where('createdAt', '<', to).orderBy('createdAt', 'desc').limit(8).get();
      snap.docs.forEach(d => { const m = Object.assign({ id: d.id }, d.data()); if (okImg(m.imageData)) out.push(m); });
    }
    return (S.otd = out.slice(0, 8));
  }
  function renderHomeOtd() {
    if (S.view !== 'home') return;
    const card = $('#home-otd');
    const list = S.otd || [];
    if (!list.length) { card.hidden = true; return; }
    const years = [...new Set(list.map(m => new Date(m.createdAt).getFullYear()))].sort();
    $('#home-otd-sub').textContent = `Shared by the family this week in ${joinNames(years.map(String))}`;
    $('#home-otd-strip').replaceChildren(...list.map((m, i) => {
      const tile = photoTile(m, i, 'otd');
      tile.className = 'otd-tile';
      const ago = new Date().getFullYear() - new Date(m.createdAt).getFullYear();
      const tag = document.createElement('span');
      tag.className = 'otd-tag';
      tag.textContent = ago === 1 ? '1 year ago' : `${ago} years ago`;
      tile.appendChild(tag);
      return tile;
    }));
    card.hidden = false;
  }

  /* ===================== Install the app ===================== */
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; if (S.view === 'home') renderInstall(); });
  function renderInstall() {
    const card = $('#home-install');
    let dismissed = false;
    try { dismissed = localStorage.getItem('agraz-install-dismissed') === '1'; } catch (e) {}
    if (dismissed || isStandalone() || !(isIOS() || S.installEvt)) { card.hidden = true; return; }
    $('#install-how').textContent = S.installEvt ? 'Open it like an app, one tap from your home screen.' : 'In Safari, tap the Share button, then “Add to Home Screen.”';
    $('#install-btn').hidden = !S.installEvt;
    card.hidden = false;
  }
  async function installApp() {
    if (!S.installEvt) return;
    S.installEvt.prompt();
    const choice = await S.installEvt.userChoice.catch(() => null);
    S.installEvt = null;
    $('#home-install').hidden = true;
    if (choice && choice.outcome === 'accepted') toast('Installed — look for the Family Hub on your home screen');
  }

  /* ===================== Recipes ===================== */
  async function loadRecipes(force) {
    if (S.recipes && !force) return S.recipes;
    const snap = await col('recipes').orderBy('title', 'asc').get();
    S.recipes = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    return S.recipes;
  }
  function openRecipes() {
    if (S.recipes) { renderRecipes(); return; }
    $('#recipes').innerHTML = '<div class="skel recipe-skel"></div>'.repeat(3);
    loadRecipes().then(() => { if (S.view === 'recipes') renderRecipes(); }).catch(err => {
      $('#recipes').innerHTML = denied(err)
        ? emptyHTML('book', 'The recipe book isn’t set up yet', 'A family admin needs to publish the latest security rules (see README).')
        : errorHTML('recipes');
    });
  }
  const recipePhotoHTML = r => okImg(r.photo)
    ? `<img src="${r.photo}" alt="" loading="lazy" decoding="async">`
    : `<span class="recipe-ph ph-${RECIPE_CATS[r.category] ? r.category : 'other'}">${icon('utensils')}</span>`;
  const recipeMeta = r => [r.by && `From ${r.by}`, r.time, r.servings && `Serves ${r.servings}`].filter(Boolean).join(' · ');
  function renderRecipes() {
    const all = S.recipes || [];
    const q = $('#recipe-search').value.trim().toLowerCase();
    const counts = { all: all.length };
    Object.keys(RECIPE_CATS).forEach(c => { counts[c] = all.filter(r => r.category === c).length; });
    $('#recipe-filters').innerHTML = all.length ? ['all'].concat(Object.keys(RECIPE_CATS)).filter(c => c === 'all' || counts[c]).map(c =>
      `<button type="button" data-action="recipe-filter" data-cat="${c}" aria-pressed="${S.recipeCat === c}">${c === 'all' ? 'All' : RECIPE_CATS[c]}<span>${counts[c]}</span></button>`).join('') : '';
    const list = all.filter(r => (S.recipeCat === 'all' || r.category === S.recipeCat)
      && (!q || [r.title, r.by, r.ingredients].some(v => String(v || '').toLowerCase().includes(q))));
    if (!list.length) {
      $('#recipes').innerHTML = all.length
        ? emptyHTML('search', 'No recipes match', 'Try another search or category.')
        : emptyHTML('book', 'Start the family recipe book', 'Save Grandma’s flan, the holiday tamales, and every dish we can’t live without.', '<button class="btn btn-ghost btn-sm" type="button" data-action="new-recipe">Add the first recipe</button>');
      return;
    }
    $('#recipes').innerHTML = list.map(r => `<button type="button" class="recipe-card" data-action="open-recipe" data-id="${esc(r.id)}">
      <span class="recipe-photo">${recipePhotoHTML(r)}</span>
      <span class="recipe-info"><span class="recipe-cat">${esc(RECIPE_CATS[r.category] || 'Other')}</span><strong>${esc(r.title)}</strong>${recipeMeta(r) ? `<small>${esc(recipeMeta(r))}</small>` : ''}</span>
    </button>`).join('');
  }
  $('#recipe-search').addEventListener('input', () => renderRecipes());
  function openRecipe(id) {
    const r = (S.recipes || []).find(x => x.id === id);
    if (!r) return;
    S.openRecipe = r.id;
    $('#rv-hero').innerHTML = recipePhotoHTML(r);
    $('#rv-hero').classList.toggle('no-photo', !okImg(r.photo));
    $('#rv-cat').textContent = RECIPE_CATS[r.category] || 'Other';
    $('#rv-title').textContent = r.title;
    $('#rv-meta').textContent = recipeMeta(r);
    const ing = lines(r.ingredients), steps = lines(r.steps);
    $('#rv-ingredients').innerHTML = ing.length
      ? ing.map(x => `<li><label class="check"><input type="checkbox"><span>${esc(x)}</span></label></li>`).join('')
      : '<li class="muted">No ingredients listed yet.</li>';
    $('#rv-steps').innerHTML = steps.length ? steps.map(x => `<li>${esc(x)}</li>`).join('') : '<li class="muted">No steps written down yet.</li>';
    $('#rv-credit').textContent = `Added by ${r.author || 'a family member'}${r.updatedBy && r.updatedBy !== r.author ? ` · last edited by ${r.updatedBy}` : ''}`;
    const d = $('#recipe-dialog');
    if (!d.open) d.showModal();
    d.scrollTop = 0;
  }
  function paintRecipePhoto(src) {
    const box = $('#rf-photo-preview');
    if (okImg(src)) { const img = document.createElement('img'); img.src = src; img.alt = ''; box.replaceChildren(img); }
    else box.innerHTML = icon('utensils');
    $('#rf-photo-remove').hidden = !okImg(src);
  }
  function openRecipeForm(id) {
    const r = id ? (S.recipes || []).find(x => x.id === id) : null;
    S.editingRecipe = r ? r.id : null;
    S.recipePhoto = undefined;
    $('#recipe-form').reset();
    $('#rf-title').textContent = r ? 'Edit recipe' : 'Add a recipe';
    $('#rf-name').value = r ? r.title || '' : '';
    $('#rf-by').value = r ? r.by || '' : '';
    $('#rf-cat').value = r && RECIPE_CATS[r.category] ? r.category : (S.recipeCat !== 'all' ? S.recipeCat : 'mains');
    $('#rf-time').value = r ? r.time || '' : '';
    $('#rf-serves').value = r ? r.servings || '' : '';
    $('#rf-ingredients').value = r ? r.ingredients || '' : '';
    $('#rf-steps').value = r ? r.steps || '' : '';
    paintRecipePhoto(r && okImg(r.photo) ? r.photo : '');
    if ($('#recipe-dialog').open) $('#recipe-dialog').close();
    $('#recipe-form-dialog').showModal();
    if (canHover) $('#rf-name').focus();
  }
  $('#rf-photo-input').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try { S.recipePhoto = await compressImage(f, 1200, 0.8, 380000); paintRecipePhoto(S.recipePhoto); }
    catch (err) { toast('That image couldn’t be used. Try a JPG or PNG.', true); }
    e.target.value = '';
  });
  $('#recipe-form').addEventListener('submit', async e => {
    e.preventDefault();
    const title = $('#rf-name').value.trim();
    if (!title) { toast('Please give the recipe a name.', true); $('#rf-name').focus(); return; }
    const data = {
      title, by: $('#rf-by').value.trim(), category: $('#rf-cat').value, time: $('#rf-time').value.trim(), servings: $('#rf-serves').value.trim(),
      ingredients: $('#rf-ingredients').value.trim(), steps: $('#rf-steps').value.trim(), updatedAt: nowIso(), updatedBy: myName()
    };
    if (S.recipePhoto !== undefined) data.photo = S.recipePhoto;
    const btn = $('#rf-save');
    const editing = S.editingRecipe;
    busy(btn, true, 'Saving…');
    try {
      let id = editing;
      if (id) await col('recipes').doc(id).update(data);
      else id = (await col('recipes').add(Object.assign({ uid: S.user.uid, author: myName(), createdAt: data.updatedAt }, data))).id;
      $('#recipe-form-dialog').close();
      toast(editing ? 'Recipe updated' : 'Added to the family recipe book');
      await loadRecipes(true);
      renderRecipes();
      openRecipe(id);
    } catch (err) {
      toast(denied(err) ? NEED_RULES : 'Couldn’t save the recipe. Please try again.', true);
    } finally {
      busy(btn, false);
    }
  });
  async function deleteRecipe() {
    const r = (S.recipes || []).find(x => x.id === S.openRecipe);
    if (!r) return;
    if (!(await confirmBox('Delete this recipe?', `“${r.title}” will be removed from the family recipe book.`))) return;
    try {
      await col('recipes').doc(r.id).delete();
      $('#recipe-dialog').close();
      toast('Recipe deleted');
      await loadRecipes(true);
      renderRecipes();
    } catch (e) {
      toast('Couldn’t delete the recipe.', true);
    }
  }
  function printRecipe() {
    document.body.classList.add('printing-recipe');
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-recipe'), { once: true });
    window.print();
  }

  /* ===================== Memorial: candles + guestbook ===================== */
  async function loadCandles(force) {
    if (S.candles && !force) return S.candles;
    const snap = await col('candles').get();
    S.candles = snap.docs.map(d => Object.assign({ uid: d.id }, d.data())).sort((a, b) => String(a.litAt).localeCompare(String(b.litAt)));
    return S.candles;
  }
  function renderCandles() {
    const list = S.candles || [];
    const mine = !!(S.user && list.some(c => c.uid === S.user.uid));
    $('#candle-row').innerHTML = list.length
      ? list.slice(0, 36).map(() => '<span class="mini-candle"><span class="flame"></span></span>').join('')
      : '<span class="mini-candle unlit"></span>';
    const names = list.map(c => (S.user && c.uid === S.user.uid) ? 'you' : firstName((S.byUid[c.uid] && S.byUid[c.uid].name) || c.name));
    const shown = names.slice(0, 3);
    $('#candles-who').textContent = !list.length ? 'Be the first to light a candle in his memory.'
      : `${plural(list.length, 'candle')} lit by ${list.length > 3 ? `${shown.join(', ')} and ${plural(list.length - 3, 'other')}` : joinNames(shown)}.`;
    const btn = $('#candle-btn');
    btn.disabled = mine;
    btn.innerHTML = `<span class="flame" aria-hidden="true"></span>${mine ? 'Your candle is lit' : 'Light a candle'}`;
  }
  async function lightCandle(btn) {
    busy(btn, true, 'Lighting…');
    try {
      await col('candles').doc(S.user.uid).set({ name: myName(), litAt: nowIso() });
      await loadCandles(true);
      toast('Your candle is lit');
    } catch (e) {
      toast(denied(e) ? NEED_RULES : 'Couldn’t light the candle. Please try again.', true);
    } finally {
      busy(btn, false);
      renderCandles();
    }
  }
  async function loadTributes(force) {
    if (S.tributes && !force) return S.tributes;
    const snap = await col('tributes').orderBy('createdAt', 'desc').get();
    S.tributes = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    return S.tributes;
  }
  function renderGuestbook() {
    const list = S.tributes || [];
    $('#tributes').innerHTML = list.length ? list.map(t => {
      const p = S.byUid[t.uid] || { name: t.author, uid: t.uid };
      const mine = S.user && t.uid === S.user.uid;
      return `<figure class="card tribute"><blockquote>${esc(t.text)}</blockquote><figcaption>${avatarHTML(p, 36)}<span class="tribute-who"><strong>${esc(p.name || t.author || 'Family member')}</strong><small>${esc(fmtDate(t.createdAt))}</small></span>${mine ? `<button class="icon-btn" type="button" data-action="delete-tribute" data-id="${esc(t.id)}" aria-label="Delete your memory">${icon('trash')}</button>` : ''}</figcaption></figure>`;
    }).join('') : emptyHTML('heart', 'No memories shared yet', 'Be the first to share a story about Hector.');
  }
  $('#tribute-form').addEventListener('submit', async e => {
    e.preventDefault();
    const box = $('#tribute-text');
    const text = box.value.trim();
    if (!text) { box.focus(); return; }
    const btn = $('#tribute-btn');
    busy(btn, true, 'Sharing…');
    try {
      await col('tributes').add({ text, uid: S.user.uid, author: myName(), createdAt: nowIso() });
      box.value = '';
      toast('Thank you for sharing');
      await loadTributes(true);
      renderGuestbook();
    } catch (err) {
      toast(denied(err) ? NEED_RULES : 'Couldn’t share your memory. Please try again.', true);
    } finally {
      busy(btn, false);
    }
  });
  async function deleteTribute(id) {
    if (!(await confirmBox('Delete your memory?', 'It will be removed from the guestbook.'))) return;
    try {
      await col('tributes').doc(id).delete();
      await loadTributes(true);
      renderGuestbook();
    } catch (e) {
      toast('Couldn’t delete it. Please try again.', true);
    }
  }

  /* ===================== Vault lock ===================== */
  $('#vault-lock').addEventListener('submit', async e => {
    e.preventDefault();
    const pass = $('#vault-pass').value;
    if (!pass) { $('#vault-msg').textContent = 'Enter your password to unlock the vault.'; return; }
    const btn = $('#vault-unlock');
    busy(btn, true, 'Unlocking…');
    try {
      await S.user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(S.user.email, pass));
      $('#vault-pass').value = '';
      S.vaultOpen = true;
      S.lastActive = Date.now();
      openVault();
    } catch (err) {
      const c = err && err.code;
      $('#vault-msg').textContent = c === 'auth/too-many-requests' ? 'Too many attempts. Please wait a few minutes and try again.'
        : c === 'auth/network-request-failed' ? 'Can’t reach the server. Check your connection.' : 'That password isn’t right.';
    } finally {
      busy(btn, false);
    }
  });
  function lockVault(message) {
    if (!S.vaultOpen) return;
    S.vaultOpen = false;
    S.vault = null;
    S.revealed.clear();
    $('#notes').innerHTML = '';
    $('#vault-filters').innerHTML = '';
    if ($('#note-dialog').open) $('#note-dialog').close();
    if (S.view === 'vault') openVault();
    if (message) toast(message);
  }
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev => window.addEventListener(ev, () => { S.lastActive = Date.now(); }, { passive: true, capture: true }));
  setInterval(() => { if (S.vaultOpen && Date.now() - S.lastActive > VAULT_IDLE_MS) lockVault('The vault locked itself after 5 minutes of inactivity'); }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) S.hiddenAt = Date.now();
    else if (S.vaultOpen && S.hiddenAt && Date.now() - S.hiddenAt > VAULT_AWAY_MS) lockVault('The vault locked while you were away');
  });

  const RENDER = {
    home: renderHome, photos: openPhotos, calendar: openCalendar, updates: openUpdates,
    directory: () => { renderDirectory(); if (!S.members.length) loadMembers().catch(() => { $('#people').innerHTML = errorHTML('the directory'); }); },
    recipes: openRecipes, vault: openVault, memorial: openMemorial, profile: renderProfile
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
        const stale = { home: ['events', 'updates', 'recent'], calendar: ['events'], updates: ['updates'], vault: ['vault'], memorial: ['memorial', 'tributes', 'candles'], recipes: ['recipes'] }[S.view] || [];
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
      case 'check-approval': checkApproval(t); break;
      case 'approve-member': decideMember(t.dataset.uid, true, t); break;
      case 'decline-member': decideMember(t.dataset.uid, false, t); break;
      case 'rsvp': setRsvp(id, t.dataset.v); break;
      case 'add-cal': openAddCal(id); break;
      case 'addcal-ics': downloadICS(); break;
      case 'heart': toggleHeart(t.dataset.col, id); break;
      case 'toggle-thread': {
        const parent = t.dataset.parent;
        const open = !S.openThreads.has(parent);
        if (open) S.openThreads.add(parent); else S.openThreads.delete(parent);
        t.setAttribute('aria-expanded', String(open));
        const box = $$('[data-thread]').find(el => el.dataset.thread === parent);
        if (box) {
          box.hidden = !open;
          box.innerHTML = open ? threadHTML(parent) : '';
          if (open) box.querySelector('input').focus();
        }
        break;
      }
      case 'lb-thread':
        S.lbThread = !S.lbThread;
        paintLbSocial();
        if (S.lbThread) { const inp = $('#lb-thread input'); if (inp) inp.focus(); }
        break;
      case 'delete-comment': deleteComment(id, t.dataset.parent); break;
      case 'bday-wish': {
        const m = S.byUid[t.dataset.uid];
        S.prefillPost = `Happy birthday, ${firstName(m && m.name)}! 🎉 `;
        if (S.view === 'updates') openUpdates(); else location.hash = 'updates';
        break;
      }
      case 'install-app': installApp(); break;
      case 'dismiss-install':
        try { localStorage.setItem('agraz-install-dismissed', '1'); } catch (err) {}
        $('#home-install').hidden = true;
        break;
      case 'new-recipe': openRecipeForm(null); break;
      case 'open-recipe': openRecipe(id); break;
      case 'edit-recipe': openRecipeForm(S.openRecipe); break;
      case 'delete-recipe': deleteRecipe(); break;
      case 'print-recipe': printRecipe(); break;
      case 'recipe-filter': S.recipeCat = t.dataset.cat; renderRecipes(); break;
      case 'remove-recipe-photo': S.recipePhoto = ''; paintRecipePhoto(''); break;
      case 'light-candle': lightCandle(t); break;
      case 'delete-tribute': deleteTribute(id); break;
      case 'lock-vault': lockVault('Vault locked'); break;
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
    if ($('#lightbox').hidden || $('dialog[open]')) return;
    const typing = e.target.matches && e.target.matches('input, textarea');
    if (e.key === 'Escape') { if (typing) e.target.blur(); else closeLightbox(); }
    else if (!typing && e.key === 'ArrowLeft') stepLightbox(-1);
    else if (!typing && e.key === 'ArrowRight') stepLightbox(1);
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
