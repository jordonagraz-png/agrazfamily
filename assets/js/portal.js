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
  // The tree's home person (Hector) in the family's Ancestry export — used only to recognise him
  // in the imported tree. The hub never links out to Ancestry.
  const HOME_PID = '182483266401';
  // JARVIS runs on the family network. Its address is saved per device (My Profile →
  // Preferences) so a private hostname is never published in this public file.
  const JARVIS_DEFAULT = 'http://localhost:8765/index.html';
  const PAGE = 24;

  const FIRST_YEAR = 2024; // the hub's first photos
  const VAULT_IDLE_MS = 5 * 60e3; // vault relocks after this long without activity…
  const VAULT_AWAY_MS = 60e3; // …or after the tab has been in the background this long
  const NEED_RULES = 'This needs the latest security rules — see README.';

  const VIEWS = ['home', 'photos', 'calendar', 'updates', 'tree', 'globe', 'games', 'stories', 'capsules', 'recipes', 'directory', 'invite', 'vault', 'memorial', 'profile'];
  const ALIASES = { memories: 'photos', events: 'calendar' };
  const TITLES = { home: 'Home', photos: 'Photos', calendar: 'Calendar', updates: 'Updates', tree: 'Family Tree', globe: 'Family Globe', games: 'Games', stories: 'Voice Stories', capsules: 'Time Capsules', recipes: 'Recipes', directory: 'Directory', invite: 'Invite family', vault: 'Family Vault', memorial: 'In Memory', profile: 'My Profile' };
  const SECONDARY = ['tree', 'globe', 'games', 'stories', 'capsules', 'recipes', 'directory', 'invite', 'vault', 'memorial', 'profile'];
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
  // The ?v= stamp this script was loaded with — reused for everything it loads later.
  const ASSET_V = (() => { try { return new URL(document.currentScript.src).search; } catch (e) { return ''; } })();
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ESC[c]);
  const icon = (n, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="/assets/icons.svg${ASSET_V}#${n}"/></svg>`;
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
    // Letters only — Ancestry names can carry notes like "(6GG)" or "Dn.".
    const parts = String(name || '').replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(w => /^\p{L}/u.test(w));
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
  function confirmBox(title, body, okLabel, tone) {
    const d = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body || '';
    $('#confirm-ok').textContent = okLabel || 'Delete';
    $('#confirm-ok').className = `btn ${tone === 'go' ? 'btn-accent' : 'btn-danger'}`;
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
  // Motion: things rise into view, light follows the pointer, the welcome photo drifts.
  // Everything holds still for reduced motion; automated test browsers skip the waiting.
  const MOTION = !REDUCED && 'IntersectionObserver' in window;
  if (MOTION) root.classList.add('motion');
  if (MOTION && navigator.webdriver) root.classList.add('motion-instant');
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
    tributes: null, candles: null, otd: null, scores: null, game: null, addcal: null, prefillPost: '', installEvt: null,
    vaultOpen: false, lastActive: Date.now(), hiddenAt: 0, invite: undefined,
    globe: { api: null, offset: 0, draft: null, picking: false, active: new Set() },
    capsules: null, capPhoto: '', justSealed: null, stories: null, storyUrls: {}, rulesOk: undefined, tree: null, treeDraft: null
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
    const invited = inviteCodeFromLink();
    if (invited && (mode === 'join' || mode === 'finish')) {
      $('#join-code').value = invited;
      $('#finish-code').value = invited;
      if (mode === 'join') $('#auth-sub').textContent = 'You’ve been invited! Your code is already filled in — just add your details.';
    }
    authMsg('');
    if (canHover && document.body.dataset.state === 'auth') {
      const first = $(`#form-${mode} input`);
      if (first) first.focus();
    }
  }
  // Invite links look like /family/#join?code=coral-tide-4821 (the hash never reaches a server).
  function inviteCodeFromLink() {
    const m = location.hash.match(/^#join\?(.*)$/);
    return m ? (new URLSearchParams(m[1]).get('code') || '').trim() : '';
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
      if (!wasAuth || !$('#form-finish').hidden || !$('#form-pending').hidden) authMode(location.hash.startsWith('#join') ? 'join' : 'login');
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
    loadCapsules().catch(() => {}); // for the "ready to open" badge and home banner
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
      openRecipe: null, tributes: null, candles: null, otd: null, scores: null, game: null, addcal: null, prefillPost: '', vaultOpen: false, invite: undefined,
      capsules: null, capPhoto: '', justSealed: null, stories: null, rulesOk: undefined, tree: null, treeDraft: null
    });
    matcher.rows = [];
    stopPlayer();
    if ($('#story-dialog').open) $('#story-dialog').close();
    resetRecorder();
    Object.values(S.storyUrls).forEach(u => URL.revokeObjectURL(u));
    S.storyUrls = {};
    clearTimeout(capsuleTimer);
    $$('[data-capsule-badge]').forEach(b => { b.hidden = true; });
    S.openThreads.clear();
    if (S.globe.api) S.globe.api.destroy();
    S.globe = { api: null, offset: 0, draft: null, picking: false, active: new Set() };
    $('#globe-time').value = '0';
    $('#globe-time-label').textContent = 'Now';
    $('#globe-now').hidden = true;
    $('#globe-live').classList.remove('travel');
    $('#globe-live-text').textContent = 'Live daylight';
    $('#globe-pick').hidden = true;
    $('#globe-stage').classList.remove('is-picking');
    $('#globe-spin').setAttribute('aria-pressed', 'true');
    $('#globe-spin').setAttribute('aria-label', 'Pause spinning');
    $('#globe-spin').innerHTML = icon('pause');
    S.photos = { items: [], last: null, done: false, loading: false, loaded: false, rendered: 0 };
    S.revealed.clear();
    clearStaging('photos');
    clearStaging('memorial');
    // Don't leave private content in the page after signing out.
    ['#home-upcoming', '#home-family', '#home-photos', '#home-updates', '#home-bday', '#home-otd-strip', '#photo-grid', '#cal-grid', '#cal-agenda', '#feed',
      '#people', '#pending-panel', '#notes', '#vault-filters', '#memorial-grid', '#tributes', '#candle-row', '#recipes', '#recipe-filters', '#lb-thread', '#invite-body',
      '#globe-clocks', '#globe-strip', '#globe-best', '#globe-pins', '#capsules', '#home-capsule', '#co-text', '#stories', '#tree-body', '#tree-results', '#match-list', '#games-lobby', '#game-board'].forEach(s => { const el = $(s); if (el) el.innerHTML = ''; });
    stopGame();
    ['#home-bday', '#home-otd', '#pending-panel', '#home-capsule'].forEach(s => { $(s).hidden = true; });
    $('#co-photo').removeAttribute('src');
    paintPendingBadge();
    $('#memorial-cover').innerHTML = icon('candle');
    $$('.view').forEach(v => { v.hidden = true; });
    closeLightbox();
    $$('dialog[open]').forEach(d => d.close());
  }

  function route() {
    if (!S.me) return;
    const ownerKey = (location.hash.match(/^#claim\?(?:.*&)?key=([^&]+)/) || [])[1];
    if (ownerKey) claimOwner(decodeURIComponent(ownerKey)); // swaps the hash for #home right away
    const treeKey = (location.hash.match(/^#tree\?(?:.*&)?key=([^&]+)/) || [])[1];
    if (treeKey) { S.treeKey = decodeURIComponent(treeKey); history.replaceState(null, '', '#tree'); } // the key never stays in the address bar
    let v = location.hash.slice(1);
    v = ALIASES[v] || v;
    if (!VIEWS.includes(v)) v = 'home';
    if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
    show(v);
  }
  window.addEventListener('hashchange', () => {
    if (S.me) route();
    else if (document.body.dataset.state === 'auth' && location.hash.startsWith('#join')) authMode('join');
  });

  // Pages cross-fade with the View Transitions API where the browser has it.
  const VT = !!document.startViewTransition && !REDUCED && !navigator.webdriver;
  if (VT) root.classList.add('vt');
  function show(v) {
    if (VT && S.view && S.view !== v && !document.hidden) { document.startViewTransition(() => showNow(v)); return; }
    showNow(v);
  }
  function showNow(v) {
    const changed = S.view !== v;
    revealUntil = performance.now() + 1800;
    requestAnimationFrame(tagReveals);
    if (changed && S.view === 'globe') { stopPicking(); if (S.globe.api) S.globe.api.stop(); }
    if (changed && S.view === 'stories' && player.audio) player.audio.pause();
    if (changed && S.view === 'games') stopGame();
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

  /* ===================== Motion ===================== */
  // Cards and list items rise into place the first time they scroll into view after a page
  // opens (not on every refresh of the data, so nothing flickers while you use it).
  const REVEAL = '.view .card, .shortcut, #home-upcoming > *, #photo-grid > *, #feed > *, #recipes > *, #stories > *, #capsules > *, #people > *, #memorial-grid > *, #tributes > *, #cal-agenda > *';
  let revealUntil = 0;
  const revealed = new WeakSet();
  const rio = MOTION ? new IntersectionObserver(entries => {
    let i = 0;
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target, d = Math.min(i++, 7) * 70;
      rio.unobserve(el);
      el.style.setProperty('--rv-d', d + 'ms');
      el.classList.add('rv-in');
      setTimeout(() => { el.classList.remove('rv', 'rv-in'); el.style.removeProperty('--rv-d'); }, 1000 + d);
    });
  }, { rootMargin: '0px 0px -4% 0px' }) : null;
  function tagReveals() {
    if (!rio || performance.now() > revealUntil) return;
    $$(REVEAL).forEach(el => {
      if (revealed.has(el) || el.closest('[hidden]')) return;
      revealed.add(el);
      el.classList.add('rv');
      rio.observe(el);
    });
  }
  if (rio) new MutationObserver(() => { if (performance.now() < revealUntil) requestAnimationFrame(tagReveals); }).observe($('.main'), { childList: true, subtree: true });

  if (MOTION && window.matchMedia('(hover: hover)').matches) {
    // A soft light follows the pointer across cards.
    let spotEl = null, last = null, raf = 0;
    const plain = new WeakMap();
    document.addEventListener('pointermove', e => {
      last = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        let el = last.target instanceof Element ? last.target.closest('.card, .shortcut') : null;
        if (el && !plain.has(el)) plain.set(el, getComputedStyle(el).backgroundImage === 'none');
        if (el && !plain.get(el)) el = null;
        if (spotEl && spotEl !== el) spotEl.classList.remove('spot-on');
        spotEl = el;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--sx', Math.round(last.clientX - r.left) + 'px');
        el.style.setProperty('--sy', Math.round(last.clientY - r.top) + 'px');
        el.classList.add('spot-on');
      });
    }, { passive: true });
    // The welcome photo and its gulls drift against each other as the pointer moves.
    const hero = $('.welcome');
    hero.addEventListener('pointermove', e => {
      const r = hero.getBoundingClientRect();
      hero.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 2 - 1).toFixed(3));
      hero.style.setProperty('--my', ((e.clientY - r.top) / r.height * 2 - 1).toFixed(3));
    });
    hero.addEventListener('pointerleave', () => { hero.style.setProperty('--mx', '0'); hero.style.setProperty('--my', '0'); });
  }

  // A little burst of confetti from a button, for the good moments.
  function celebrate(from) {
    if (!MOTION || navigator.webdriver) return;
    const c = document.createElement('canvas'), W = window.innerWidth, H = window.innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    c.className = 'burst';
    c.width = W * dpr; c.height = H * dpr;
    c.style.width = W + 'px'; c.style.height = H + 'px';
    document.body.appendChild(c);
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const r = from && from.getBoundingClientRect ? from.getBoundingClientRect() : { left: W / 2, top: H / 2, width: 0, height: 0 };
    const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
    const COLORS = ['#e58c63', '#f2c3a1', '#c9933f', '#2b6b66', '#7fc7be', '#f4ede2'];
    const bits = Array.from({ length: 80 }, () => {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, v = 5 + Math.random() * 8;
      return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: 3 + Math.random() * 4, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: COLORS[(Math.random() * COLORS.length) | 0], sq: Math.random() < 0.6 };
    });
    const t0 = performance.now();
    (function frame(now) {
      const t = now - t0;
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = Math.max(0, 1 - t / 1700);
      bits.forEach(b => {
        b.vy += 0.3; b.vx *= 0.985; b.x += b.vx; b.y += b.vy; b.rot += b.vr;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot); ctx.fillStyle = b.c;
        if (b.sq) ctx.fillRect(-b.s, -b.s / 2.5, b.s * 2, b.s / 1.25); else { ctx.beginPath(); ctx.arc(0, 0, b.s / 1.6, 0, 7); ctx.fill(); }
        ctx.restore();
      });
      if (t < 1700) requestAnimationFrame(frame); else c.remove();
    })(t0);
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
    else if (S.view === 'invite') renderInvite();
    else if (S.view === 'tree' && S.tree && S.tree.status === 'ready') renderTree();
    else if (S.view === 'globe' && S.globe.api) { S.globe.api.setPeople(globePeople(), S.user.uid); paintPlaceBtn(); renderGlobeSide(); }
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
    // each word rises into place (see .welcome-title .w)
    const word = html => `<span class="w"><span>${html}</span></span>`;
    $('#home-title').innerHTML = [word('Good'), word(`${part},`), word(`<em>${esc(firstName(myName()))}</em>`)].join(' ');
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
      <a class="fam-invite" href="#invite">${icon('user-plus')}Invite family</a>
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
              ${mine || isAdmin() ? `<span class="post-actions"><button class="icon-btn" type="button" data-action="delete-update" data-id="${esc(p.id)}" aria-label="${mine ? 'Delete your update' : `Delete ${esc(firstName(person.name || p.author))}’s update`}">${icon('trash')}</button></span>` : ''}
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
    const own = (S.updates || []).some(x => x.id === id && S.user && x.uid === S.user.uid);
    if (!(await confirmBox(own ? 'Delete your update?' : 'Delete this update?', own ? 'This can’t be undone.' : 'You’re removing it as an admin. This can’t be undone.'))) return;
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
          <h2 class="person-name">${esc(m.name || 'Family member')}${isMe ? '<span class="you">You</span>' : ''}${roleBadge(m)}</h2>
          ${m.bio ? `<p class="person-bio">${esc(m.bio)}</p>` : `<p class="person-bio">Joined ${esc(fmtDate(m.joinedDate) || 'the hub')}</p>`}
        </div>${canManage(m) ? `<button class="icon-btn person-manage" type="button" data-action="manage-member" data-uid="${esc(m.uid)}" aria-label="Manage ${esc(m.name || 'member')}">${icon('settings')}</button>` : ''}</div>
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
    paintBio();
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
    const pill = $('#profile-role');
    pill.hidden = !isAdmin();
    pill.className = `role-pill${isOwner() ? ' owner' : ''}`;
    pill.textContent = isOwner() ? 'Owner · full access' : 'Admin';
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
  const isAdmin = () => !!(S.me && (S.me.role === 'admin' || S.me.role === 'owner'));
  const isOwner = () => !!(S.me && S.me.role === 'owner');
  const roleBadge = m => m.role === 'owner' ? '<span class="role-pill owner">Owner</span>' : m.role === 'admin' ? '<span class="role-pill">Admin</span>' : '';
  // Admins look after other members (never the owner); only the owner can remove admins.
  const canManage = m => isAdmin() && S.user && m.uid !== S.user.uid && m.role !== 'owner';
  const canRemove = m => canManage(m) && (isOwner() || !m.role);
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
    el.innerHTML = `<div class="pending-head"><span class="sc-icon sc-gold">${icon('hourglass')}</span><div><strong>Waiting for your approval</strong><p class="muted">${plural(S.pending.length, 'person')} joined with the invite code. Approve the people you know.</p></div></div>` + pendingRowsHTML();
  }
  function pendingRowsHTML() {
    return S.pending.map(m => `<div class="pending-row">${avatarHTML(m, 44)}<div class="pending-who"><strong>${esc(m.name || 'New member')}</strong><small>${esc(m.email || '')}${m.joinedDate ? ` · joined ${esc(timeAgo(m.joinedDate))}` : ''}</small></div><div class="pending-actions"><button class="btn btn-ghost btn-sm" type="button" data-action="decline-member" data-uid="${esc(m.uid)}">Decline</button><button class="btn btn-accent btn-sm" type="button" data-action="approve-member" data-uid="${esc(m.uid)}">${icon('check')}Approve</button></div></div>`).join('');
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
      if (v === 'yes' && prev[S.user.uid] !== 'yes') { toast('You’re going — see you there!'); celebrate($$('[data-action="rsvp"]').find(x => x.dataset.id === id && x.dataset.v === v)); }
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
    const lists = colName === 'updates' ? [S.updates || []] : colName === 'stories' ? [S.stories || []] : [S.photos.items, S.recent || [], S.otd || []];
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
    return `<div class="comment">${avatarHTML(p, 28)}<div class="comment-bubble"><div class="comment-head"><strong>${esc(p.name || c.author || 'Family member')}</strong><time>${esc(timeAgo(c.createdAt))}</time></div><p>${esc(c.text)}</p></div>${mine || isAdmin() ? `<button class="icon-btn comment-del" type="button" data-action="delete-comment" data-id="${esc(c.id)}" data-parent="${esc(c.parent)}" aria-label="${mine ? 'Delete your comment' : 'Delete this comment'}">${icon('trash')}</button>` : ''}</div>`;
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
    if (!(await confirmBox('Delete this comment?', 'This can’t be undone.'))) return;
    try {
      await col('comments').doc(id).delete();
      S.comments[parent] = (S.comments[parent] || []).filter(c => c.id !== id);
      repaintThread(parent);
    } catch (e) {
      toast('Couldn’t delete the comment.', true);
    }
  }
  document.addEventListener('submit', e => {
    if (e.target.id === 'custom-code-form') { e.preventDefault(); saveCustomCode(); return; }
    if (e.target.id === 'owner-form') { e.preventDefault(); claimFromInvite(); return; }
    const f = e.target.closest && e.target.closest('.comment-form');
    if (!f) return;
    e.preventDefault();
    postComment(f);
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'tree-file') { previewImport(e.target.files && e.target.files[0]); e.target.value = ''; return; }
    if (e.target.id === 'research-file') { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) importResearch(f); return; }
    if (e.target.id === 'invite-approval') {
      saveInvite({ requireApproval: e.target.checked }, e.target.checked ? 'New members will wait for your approval' : 'New members get in right away');
    }
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
      return `<figure class="card tribute"><blockquote>${esc(t.text)}</blockquote><figcaption>${avatarHTML(p, 36)}<span class="tribute-who"><strong>${esc(p.name || t.author || 'Family member')}</strong><small>${esc(fmtDate(t.createdAt))}</small></span>${mine || isAdmin() ? `<button class="icon-btn" type="button" data-action="delete-tribute" data-id="${esc(t.id)}" aria-label="${mine ? 'Delete your memory' : 'Remove this memory'}">${icon('trash')}</button>` : ''}</figcaption></figure>`;
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
    if (!(await confirmBox('Remove this memory?', 'It will be removed from the guestbook.'))) return;
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

  /* ===================== Vault: Face ID / fingerprint unlock ===================== */
  // A passkey kept on this device (WebAuthn, platform authenticator, user verification
  // required). It's a quick lock for this phone or computer — if someone picks it up while
  // you're signed in, they still can't open the vault. The notes themselves stay protected
  // by firestore.rules either way, and your password always works too.
  const bioKey = () => (S.user ? `agraz-vault-key:${S.user.uid}` : '');
  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = str => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
  function bioName() {
    const ua = navigator.userAgent;
    return /iPhone|iPad/.test(ua) ? 'Face ID' : /Macintosh/.test(ua) ? 'Touch ID' : /Android/.test(ua) ? 'your fingerprint' : /Windows/.test(ua) ? 'Windows Hello' : 'your device lock';
  }
  let bioOk = null;
  async function bioAvailable() {
    if (bioOk === null) {
      try { bioOk = !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
      catch (e) { bioOk = false; }
    }
    return bioOk;
  }
  function bioCred() { try { return localStorage.getItem(bioKey()) || ''; } catch (e) { return ''; } }
  async function paintBio() {
    const ok = await bioAvailable(), has = ok && !!bioCred();
    $('#vault-bio').hidden = !has;
    $('#vault-or').hidden = !has;
    $('#vault-bio-label').textContent = `Unlock with ${bioName()}`;
    const offer = $('#vault-bio-offer');
    offer.hidden = !ok || !S.vaultOpen;
    offer.innerHTML = !ok ? '' : has
      ? `${icon('fingerprint')}<p><strong>Quick unlock is on.</strong> This device opens the vault with ${esc(bioName())}.</p><button class="link-btn" type="button" data-action="vault-bio-off">Turn off</button>`
      : `${icon('fingerprint')}<p><strong>Unlock faster next time.</strong> Use ${esc(bioName())} on this device instead of typing your password.</p><button class="btn btn-sm btn-ghost" type="button" data-action="vault-bio-on">Turn on</button>`;
  }
  async function enableBio(btn) {
    busy(btn, true, 'Setting up…');
    try {
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'Agraz Family Hub' },
          user: { id: new TextEncoder().encode(S.user.uid).slice(0, 64), name: S.user.email || myName(), displayName: myName() },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
          timeout: 60000,
          attestation: 'none'
        }
      });
      localStorage.setItem(bioKey(), b64u(cred.rawId));
      toast(`All set — next time, open the vault with ${bioName()}`);
    } catch (e) {
      if (!e || e.name !== 'NotAllowedError') toast('Couldn’t set that up on this device.', true);
    } finally {
      busy(btn, false);
      paintBio();
    }
  }
  async function unlockWithBio() {
    const id = bioCred(), btn = $('#vault-bio');
    if (!id) return;
    $('#vault-msg').textContent = '';
    busy(btn, true, 'Waiting…');
    try {
      const a = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ type: 'public-key', id: unb64u(id), transports: ['internal'] }],
          userVerification: 'required',
          timeout: 60000
        }
      });
      // byte 32 of authenticatorData holds the flags; 0x04 = the person was verified (face, finger, PIN)
      if (!(new Uint8Array(a.response.authenticatorData)[32] & 0x04)) throw new Error('unverified');
      S.vaultOpen = true;
      S.lastActive = Date.now();
      openVault();
    } catch (e) {
      $('#vault-msg').textContent = e && e.name === 'NotAllowedError' ? '' : `${bioName()} didn’t work this time — use your password instead.`;
    } finally {
      busy(btn, false);
    }
  }
  function disableBio() {
    try { localStorage.removeItem(bioKey()); } catch (e) {}
    paintBio();
    toast('Quick unlock is off for this device');
  }

  /* ===================== Invite family ===================== */
  const CODE_WORDS = ['coral', 'tide', 'shell', 'dune', 'harbor', 'breeze', 'pier', 'sunset', 'lagoon', 'reef', 'anchor', 'sail',
    'palm', 'wave', 'salt', 'pelican', 'marina', 'island', 'sandy', 'seaside', 'starfish', 'surf', 'cove', 'beacon',
    'driftwood', 'current', 'horizon', 'mango', 'citrus', 'hibiscus', 'gull', 'dolphin', 'tropic', 'sunrise', 'shore', 'bay',
    'kelp', 'pearl', 'compass', 'canoe', 'oyster', 'sea', 'glow', 'calm', 'golden', 'amber', 'azure', 'jade'];
  function newInviteCode() {
    const r = new Uint32Array(3);
    crypto.getRandomValues(r);
    return `${CODE_WORDS[r[0] % CODE_WORDS.length]}-${CODE_WORDS[r[1] % CODE_WORDS.length]}-${1000 + (r[2] % 9000)}`;
  }
  const inviteLink = () => `${location.origin}/family/#join?code=${encodeURIComponent((S.invite && S.invite.code) || '')}`;
  const inviteMessage = () => `You’re invited to the Agraz Family Hub — our private family website for photos, plans and staying close.\n\nTap to join (your invite code is filled in for you):\n${inviteLink()}\n\nInvite code: ${S.invite.code}`;
  async function copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch (e) { toast('Couldn’t copy on this device — press and hold the text to copy it instead.', true); }
  }
  async function shareInvite() {
    try { await navigator.share({ title: 'Join the Agraz Family Hub', text: 'You’re invited to the Agraz Family Hub — our private family website. Tap the link to join; your invite code is filled in for you.', url: inviteLink() }); }
    catch (e) { /* the share sheet was closed */ }
  }
  async function loadInvite(force) {
    if (S.invite !== undefined && !force) return S.invite;
    try {
      const snap = await col('config').doc('invite').get();
      S.invite = snap.exists ? Object.assign({ requireApproval: false }, snap.data()) : null;
    } catch (e) {
      S.invite = denied(e) ? 'denied' : 'error';
    }
    return S.invite;
  }
  async function saveInvite(patch, okMsg) {
    const cur = S.invite && typeof S.invite === 'object' ? S.invite : {};
    const next = { code: cur.code || '', requireApproval: !!cur.requireApproval };
    Object.assign(next, patch);
    try {
      await col('config').doc('invite').set(next);
      S.invite = next;
      if (okMsg) toast(okMsg);
    } catch (e) {
      toast(denied(e) ? NEED_RULES : 'Couldn’t save. Please try again.', true);
    }
    if (S.view === 'invite') renderInvite();
  }
  function saveCustomCode() {
    const code = $('#custom-code').value.trim();
    if (!/^[A-Za-z0-9-]{6,64}$/.test(code)) { toast('Use at least 6 letters, numbers or dashes (no spaces).', true); $('#custom-code').focus(); return; }
    saveInvite({ code }, 'Invite code updated — share the new link');
  }
  function openInvite() {
    if (!isAdmin()) { renderInvite(); return; }
    if (S.invite === undefined) {
      $('#invite-body').innerHTML = skelRows(3);
      loadInvite().then(() => { if (S.view === 'invite') renderInvite(); });
    } else {
      renderInvite();
    }
  }
  function renderInvite() {
    const el = $('#invite-body');
    if (!isAdmin()) {
      const admins = S.members.filter(m => m.role === 'admin' || m.role === 'owner');
      const setup = !admins.length;
      if (setup && S.rulesOk === undefined) { S.rulesOk = 'checking'; checkRules(); }
      const typed = $('#owner-key') ? $('#owner-key').value : '';
      el.innerHTML = (setup ? ownerSetupHTML() : '') + `<article class="card invite-member">
        <span class="sc-icon sc-accent">${icon('user-plus')}</span>
        <h2 class="card-title">Know someone who should be here?</h2>
        <p class="muted">Send them the sign-up page. They’ll also need the family invite code — ${admins.length ? `ask ${esc(joinNames(admins.map(m => firstName(m.name))))}` : 'ask a family admin'}, who can send them a link with the code built in.</p>
        <div class="copy-field"><input class="input" readonly value="${esc(`${location.origin}/family/#join`)}" aria-label="Sign-up page"><button class="btn" type="button" data-action="copy-join-link">${icon('copy')}Copy link</button></div>
      </article>`;
      if (typed && $('#owner-key')) $('#owner-key').value = typed;
      return;
    }
    if (S.invite === 'denied' || S.invite === 'error') {
      el.innerHTML = S.invite === 'denied'
        ? emptyHTML('lock', 'Invites need the latest security rules', 'Publish firestore.rules in the Firebase console (see README), then come back to this page.')
        : errorHTML('invite settings');
      return;
    }
    if (!S.invite || !S.invite.code) {
      el.innerHTML = `<article class="card invite-setup">
        <span class="sc-icon sc-accent">${icon('user-plus')}</span>
        <h2>Create your family invite code</h2>
        <p class="muted">New members need a code to join. We’ll make a friendly one — you can change it any time. New members will wait for your approval (you can turn that off).</p>
        <button class="btn btn-accent btn-lg" type="button" data-action="create-invite">${icon('sparkle')}Create invite code</button>
      </article>`;
      return;
    }
    const link = inviteLink();
    const req = !!S.invite.requireApproval;
    const msg = inviteMessage();
    const pendingBlock = S.pending.length
      ? `<div class="invite-pending"><p class="invite-pending-title">${icon('hourglass')}${plural(S.pending.length, 'person')} waiting for you</p>${pendingRowsHTML()}</div>`
      : (req ? '<p class="muted invite-none">No one is waiting right now.</p>' : '');
    el.innerHTML = `<div class="invite-grid">
      <article class="card invite-hero">
        <div class="invite-hero-head">
          <span class="sc-icon sc-accent">${icon('user-plus')}</span>
          <div><h2 class="card-title">Your family invite link</h2><p class="muted">One tap takes them to sign up with the code already filled in. Share it only with family.</p></div>
        </div>
        <div class="copy-field"><input class="input" id="invite-link" readonly value="${esc(link)}" aria-label="Invite link"><button class="btn" type="button" data-action="copy-invite-link">${icon('copy')}Copy link</button></div>
        <div class="share-row">
          ${navigator.share ? `<button class="share-btn primary" type="button" data-action="share-invite">${icon('share')}Share…</button>` : ''}
          <a class="share-btn" href="${esc(`sms:?&body=${encodeURIComponent(msg)}`)}">${icon('chat')}Text message</a>
          <a class="share-btn" href="${esc(`mailto:?subject=${encodeURIComponent('You’re invited to the Agraz Family Hub')}&body=${encodeURIComponent(msg)}`)}">${icon('mail')}Email</a>
          <button class="share-btn" type="button" data-action="copy-invite-message">${icon('copy')}Copy invite message</button>
        </div>
      </article>
      <article class="card invite-qr">
        <div class="qr-box" id="invite-qr" role="img" aria-label="QR code for the invite link"></div>
        <p><strong>Together in person?</strong><span class="muted">Have them point their phone’s camera here.</span></p>
      </article>
      <article class="card invite-code-card">
        <header class="card-head"><h2 class="card-title">Invite code</h2></header>
        <div class="code-row"><span class="invite-code" id="invite-code">${esc(S.invite.code)}</span><button class="icon-btn" type="button" data-action="copy-invite-code" aria-label="Copy invite code">${icon('copy')}</button></div>
        <p class="muted small">For anyone typing the address themselves. Changing it stops old links and codes from working — everyone who already joined stays in.</p>
        <div class="code-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-action="new-invite-code">${icon('sparkle')}Make a new code</button>
          <button class="btn btn-ghost btn-sm" type="button" data-action="custom-invite-code">${icon('pencil')}Choose my own</button>
        </div>
        <form class="inline-form custom-code" id="custom-code-form" hidden>
          <label class="sr-only" for="custom-code">New invite code</label>
          <input class="input" id="custom-code" maxlength="64" placeholder="e.g. agraz-sunday-dinner" autocomplete="off" autocapitalize="off" spellcheck="false">
          <button class="btn btn-sm" type="submit">Save</button>
        </form>
      </article>
      <article class="card invite-approval">
        <header class="card-head"><h2 class="card-title">Approval</h2></header>
        <label class="switch-row" for="invite-approval">
          <span><strong>Approve new members before they get in</strong><small class="muted">Recommended. If the link ever gets passed around, nobody gets in without you.</small></span>
          <span class="switch"><input type="checkbox" id="invite-approval" role="switch"${req ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span></span>
        </label>
        ${pendingBlock}
      </article>
      <article class="card invite-how">
        <h2 class="card-title">How it works</h2>
        <ol class="steps">
          <li><strong>Send the link</strong><span>By text or email — or let them scan the QR code.</span></li>
          <li><strong>They create an account</strong><span>Name, email and a password. The code is already filled in.</span></li>
          <li><strong>${req ? 'You approve them' : 'They’re in'}</strong><span>${req ? 'Tap Approve here or in the Directory. They’ll get in right away.' : 'They see the family hub straight away.'}</span></li>
        </ol>
      </article>
    </div>`;
    renderQr(link);
  }
  let qrLib;
  function loadQrLib() {
    if (window.qrcode) return Promise.resolve();
    if (!qrLib) {
      qrLib = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = '/assets/js/vendor/qrcode.js' + ASSET_V;
        sc.onload = resolve;
        sc.onerror = () => { qrLib = null; reject(new Error('qr')); };
        document.head.appendChild(sc);
      });
    }
    return qrLib;
  }
  async function renderQr(text) {
    try { await loadQrLib(); } catch (e) { const card = $('.invite-qr'); if (card) card.hidden = true; return; }
    const box = $('#invite-qr');
    if (!box || S.view !== 'invite') return;
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    box.innerHTML = `<svg viewBox="-4 -4 ${n + 8} ${n + 8}" shape-rendering="crispEdges" aria-hidden="true"><rect x="-4" y="-4" width="${n + 8}" height="${n + 8}" fill="#fff"/><path d="${d}" fill="#10252b"/></svg>`;
  }

  /* ===================== Owner + member management ===================== */
  // First-time setup on the Invite page: no admin yet, so whoever holds the owner key
  // claims ownership right there — and gets the family's invite code straight away.
  // The family tree is the newest part of the rules, so reading it is a quick "are the rules published?" check.
  async function checkRules() {
    try { await Promise.all([col('tree').doc('meta').get(), col('scores').limit(1).get()]); S.rulesOk = true; }
    catch (e) { S.rulesOk = denied(e) ? false : null; }
    if (S.view === 'invite' && !isAdmin()) renderInvite();
    return S.rulesOk;
  }
  // The rules file is published with the site, so the owner can copy it straight into the console.
  let rulesText = '';
  async function loadRulesText() {
    if (rulesText) return rulesText;
    try {
      const r = await fetch('/firestore.rules', { cache: 'no-store' });
      const t = r.ok ? await r.text() : '';
      if (/^rules_version/m.test(t)) rulesText = t;
    } catch (e) {}
    return rulesText;
  }
  async function copyRules() {
    if (!(await loadRulesText())) { toast('Couldn’t load the rules — copy them from firestore.rules on GitHub instead.', true); return; }
    copyText(rulesText, 'Rules copied — now paste them in the Firebase console and click Publish');
  }
  function ownerSetupHTML() {
    const r = S.rulesOk;
    const again = '<button class="link-btn" type="button" data-action="check-rules">Check again</button>';
    if (r === false) loadRulesText(); // ready before the tap, so copying works on iPhones too
    const status = r === true ? `<p id="rules-status"><span class="setup-ok">${icon('check')}Published</span></p>`
      : r === false ? `<p id="rules-status"><span class="setup-warn">Not yet</span> — your Firebase project still has the old rules.</p>
        <ol class="mini-steps">
          <li><button class="btn btn-sm" type="button" data-action="copy-rules">${icon('copy')}Copy the rules</button></li>
          <li>Open the <a href="https://console.firebase.google.com/project/agrazfamily/firestore/databases/-default-/rules" target="_blank" rel="noopener noreferrer">rules editor</a> in the Firebase console (sign in with the Google account that owns the project).</li>
          <li>Select everything in the editor (Ctrl+A, or ⌘A on a Mac), paste, and click <b>Publish</b>.</li>
          <li>Wait a minute, then ${again}.</li>
        </ol>`
        : `<p id="rules-status">${r === null ? `Couldn’t check just now. ${again}` : 'Checking…'}</p>`;
    return `<article class="card owner-setup">
      <span class="sc-icon sc-accent">${icon('key')}</span>
      <h2>Make your family invite code</h2>
      <p class="muted">Invite codes are made by the family’s owner. If that’s you, it’s two quick steps — just this once.</p>
      <ol class="setup-steps">
        <li class="${r === true ? 'done' : ''}"><strong>Publish the latest security rules</strong>${status}</li>
        <li><strong>Become the owner</strong><p>Paste your owner key — or the whole owner link.</p>
          <form class="copy-field" id="owner-form" novalidate>
            <label class="sr-only" for="owner-key">Owner key or link</label>
            <input class="input" id="owner-key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Owner key or link">
            <button class="btn btn-accent" type="submit" id="owner-go">${icon('sparkle')}Become the owner</button>
          </form>
          <p class="form-msg" id="owner-msg" role="alert"></p>
        </li>
      </ol>
      <p class="setup-then">${icon('user-plus')}Then your invite code appears right here, ready to share by text, email or QR code.</p>
    </article>`;
  }
  async function claimFromInvite() {
    const raw = $('#owner-key').value.trim();
    let key = (raw.match(/key=([^&\s]+)/) || [])[1] || raw;
    try { key = decodeURIComponent(key); } catch (e) {}
    if (!key) { $('#owner-msg').textContent = 'Paste your owner key or link first.'; $('#owner-key').focus(); return; }
    $('#owner-msg').textContent = '';
    const btn = $('#owner-go');
    busy(btn, true, 'One moment…');
    const ok = await claimOwner(key, true);
    if (!ok && $('#owner-go')) busy($('#owner-go'), false);
  }

  async function claimOwner(key, fromPage) {
    if (/^#claim/.test(location.hash)) history.replaceState(null, '', '#home'); // never leave the key in the address bar
    if (isOwner()) { toast('You’re already the owner'); return true; }
    try {
      const batch = db.batch();
      batch.set(col('config').doc('owner'), { uid: S.user.uid, key, claimedAt: nowIso() });
      batch.update(col('users').doc(S.user.uid), { role: 'owner' });
      await batch.commit();
    } catch (e) {
      let why = 'Couldn’t finish. Check your connection and try again.';
      if (denied(e)) {
        why = (await checkRules()) === false
          ? 'The latest security rules aren’t published yet — do step 1 first, then try again.'
          : 'That owner key didn’t work. Check it — it only works once, so the family may already have an owner.';
      }
      if (fromPage && $('#owner-msg')) $('#owner-msg').textContent = why; else toast(why, true);
      return false;
    }
    S.me.role = 'owner';
    S.invite = undefined;
    paintMe();
    await loadMembers().catch(() => {});
    let made = false;
    if (fromPage) {
      await loadInvite(true);
      if (S.invite === null || (S.invite && typeof S.invite === 'object' && !S.invite.code)) {
        await saveInvite({ code: newInviteCode(), requireApproval: true });
        made = !!(S.invite && S.invite.code);
      }
    }
    if (S.view && RENDER[S.view]) RENDER[S.view]();
    toast(made ? 'You’re the owner — and your invite code is ready to share' : 'You’re now the owner — full admin access to everything');
    return true;
  }
  function openMemberDialog(uid) {
    const m = S.byUid[uid];
    if (!m || !canManage(m)) return;
    S.managing = uid;
    $('#member-form').reset();
    paintAvatar($('#md-avatar'), m);
    $('#md-title').textContent = m.name || 'Family member';
    $('#md-email').textContent = m.email || '';
    $('#md-name').value = m.name || '';
    $('#md-phone').value = m.phone || '';
    $('#md-birthday').value = DAY.test(m.birthday || '') ? m.birthday : '';
    $('#md-address').value = m.address || '';
    $('#md-bio').value = m.bio || '';
    $('#md-admin-row').hidden = !isOwner();
    $('#md-admin').checked = m.role === 'admin';
    $('#md-remove').hidden = !canRemove(m);
    $('#member-dialog').showModal();
    if (canHover) $('#md-name').focus();
  }
  $('#member-form').addEventListener('submit', async e => {
    e.preventDefault();
    const m = S.byUid[S.managing];
    if (!m) return;
    const name = $('#md-name').value.trim().replace(/\s+/g, ' ');
    if (!name) { toast('Please enter a name.', true); $('#md-name').focus(); return; }
    const birthday = $('#md-birthday').value;
    const data = { name, phone: $('#md-phone').value.trim(), birthday: DAY.test(birthday) ? birthday : '', address: $('#md-address').value.trim(), bio: $('#md-bio').value.trim() };
    if (isOwner()) {
      const wantAdmin = $('#md-admin').checked;
      if (wantAdmin !== (m.role === 'admin')) data.role = wantAdmin ? 'admin' : '';
    }
    const btn = $('#md-save');
    busy(btn, true, 'Saving…');
    try {
      await col('users').doc(m.uid).update(data);
      $('#member-dialog').close();
      toast(data.role === 'admin' ? `${firstName(name)} is now a family admin` : data.role === '' ? `${firstName(name)} is no longer an admin` : `${firstName(name)}’s details are saved`);
      await loadMembers();
    } catch (err) {
      toast(denied(err) ? NEED_RULES : 'Couldn’t save. Please try again.', true);
    } finally {
      busy(btn, false);
    }
  });
  async function removeMember() {
    const m = S.byUid[S.managing];
    if (!m || !canRemove(m)) return;
    if (!(await confirmBox(`Remove ${m.name || 'this member'}?`, 'They’ll lose access to the family hub right away. To block them for good, also disable their account in the Firebase console (Authentication → Users).', 'Remove'))) return;
    try {
      await col('users').doc(m.uid).delete();
      $('#member-dialog').close();
      toast(`${firstName(m.name)} has been removed`);
      await loadMembers();
    } catch (e) {
      toast(denied(e) ? NEED_RULES : 'Couldn’t remove them. Please try again.', true);
    }
  }

  /* ===================== Family Globe ===================== */
  // The globe itself is drawn by /assets/js/globe.js, loaded the first time it's opened.
  let globeLib = null;
  function loadGlobeLib() {
    if (window.AgrazGlobe) return Promise.resolve();
    if (!globeLib) {
      globeLib = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = '/assets/js/globe.js' + ASSET_V;
        sc.onload = resolve;
        sc.onerror = () => { globeLib = null; reject(new Error('globe')); };
        document.head.appendChild(sc);
      });
    }
    return globeLib;
  }
  const hasPlace = m => !!(m && m.place && typeof m.place.lat === 'number' && typeof m.place.lng === 'number');
  const roundLL = ll => ({ lat: Math.round(ll.lat * 10) / 10, lng: Math.round(ll.lng * 10) / 10 });
  const fmtLatLng = d => `${Math.abs(d.lat).toFixed(1)}°${d.lat >= 0 ? 'N' : 'S'}, ${Math.abs(d.lng).toFixed(1)}°${d.lng >= 0 ? 'E' : 'W'}`;
  const myTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } };
  function okTz(tz) { if (!tz) return false; try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; } }
  // Their saved time zone; failing that, a rough one from their longitude.
  function tzOf(m) {
    if (okTz(m.place.tz)) return m.place.tz;
    const off = Math.round(m.place.lng / 15);
    return off === 0 ? 'UTC' : `Etc/GMT${off < 0 ? '+' : '-'}${Math.abs(off)}`;
  }
  const clockAt = (m, date) => date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tzOf(m) });
  function hourAt(m, date) {
    const h = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tzOf(m) }).formatToParts(date).find(p => p.type === 'hour');
    return h ? Number(h.value) % 24 : date.getHours();
  }
  function skyAt(m, date) {
    const alt = window.AgrazGlobe.sunAltitude(m.place.lat, m.place.lng, date);
    const h = hourAt(m, date);
    if (alt > 6) return { key: 'day', icon: 'sun', label: h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening' };
    if (alt > -6) return { key: 'dusk', icon: 'sunrise', label: h < 12 ? 'Sunrise' : 'Sunset' };
    return { key: 'night', icon: 'moon', label: h >= 22 || h < 5 ? 'Night' : h >= 12 ? 'Evening' : 'Early morning' };
  }
  function milesFromMe(m) {
    if (!S.me || !hasPlace(S.me) || m.uid === S.user.uid) return '';
    const mi = window.AgrazGlobe.distanceKm(S.me.place, m.place) * 0.621371;
    if (mi < 15) return 'Nearby';
    return `${(mi >= 1000 ? Math.round(mi / 10) * 10 : Math.round(mi)).toLocaleString('en-US')} mi away`;
  }
  const globeTime = () => (S.globe.offset ? new Date(Date.now() + S.globe.offset * 60e3) : new Date());
  const globePeople = () => S.members.filter(hasPlace).map(m => ({ id: m.uid, lat: m.place.lat, lng: m.place.lng, m }));

  function globePinHTML(list, date) {
    const first = list[0].m;
    const faces = list.slice(0, 3).map(p => avatarHTML(p.m, 28)).join('');
    const title = list.length === 1 ? firstName(first.name) : (String(first.place.label).split(',')[0] || firstName(first.name));
    const sub = list.length === 1 ? clockAt(first, date) : `${list.length} of us · ${clockAt(first, date)}`;
    const names = joinNames(list.map(p => p.m.name || 'Family member'));
    return `<span class="gpin-faces">${faces}</span><span class="gpin-label n${Math.min(list.length, 3)}"><b>${esc(title)}</b><small>${esc(sub)}</small></span><span class="sr-only">${esc(names)}</span>`;
  }

  async function openGlobe() {
    paintPlaceBtn();
    if (!S.members.length) loadMembers().catch(() => {});
    if (S.globe.api) { S.globe.api.setPeople(globePeople(), S.user.uid); S.globe.api.start(); renderGlobeSide(); return; }
    const status = $('#globe-status');
    status.hidden = false;
    status.textContent = 'Loading the globe…';
    try {
      await loadGlobeLib();
      const land = await window.AgrazGlobe.loadLand();
      if (S.view !== 'globe' || !S.me || S.globe.api) return;
      const placed = globePeople();
      const mine = hasPlace(S.me) ? S.me.place : placed[0];
      S.globe.api = window.AgrazGlobe.create($('#globe-stage'), {
        land,
        pinLayer: $('#globe-pins'),
        pinHTML: globePinHTML,
        lat: mine ? Math.max(-45, Math.min(45, mine.lat)) : 24,
        lng: mine ? mine.lng - 25 : -40,
        onPick: ll => { S.globe.draft = roundLL(ll); S.globe.api.setDraft(S.globe.draft); paintPick(); }
      });
      status.hidden = true;
      S.globe.api.setPeople(placed, S.user.uid);
      S.globe.api.start();
      renderGlobeSide();
    } catch (e) {
      status.textContent = 'The globe couldn’t load. Check your connection and try again.';
    }
  }

  function paintPlaceBtn() {
    const on = hasPlace(S.me);
    $('#globe-place-btn span').textContent = on ? 'Move my pin' : 'Put me on the globe';
  }

  function renderGlobeSide() {
    if (!window.AgrazGlobe || !S.user) return;
    const date = globeTime();
    const placed = S.members.filter(hasPlace).sort((a, b) => a.place.lng - b.place.lng);
    $('#globe-clocks').innerHTML = placed.map(m => {
      const sky = skyAt(m, date), far = milesFromMe(m), me = m.uid === S.user.uid;
      return `<li><button type="button" class="clock${S.globe.active.has(m.uid) ? ' is-active' : ''}" data-action="globe-focus" data-uid="${esc(m.uid)}">
        ${avatarHTML(m, 40)}
        <span class="clock-who"><strong>${esc(m.name || 'Family member')}${me ? '<span class="you-tag">You</span>' : ''}</strong><small>${esc(m.place.label)}${far ? ` · ${esc(far)}` : ''}</small></span>
        <span class="clock-time"><b>${esc(clockAt(m, date))}</b><small class="sky-${sky.key}">${icon(sky.icon)}${sky.label}</small></span>
      </button></li>`;
    }).join('') || `<li class="empty empty-sm">${icon('earth')}<span>Nobody’s on the globe yet — be the first!</span></li>`;
    const missing = S.members.filter(m => !hasPlace(m)).map(m => (m.uid === S.user.uid ? 'you' : firstName(m.name)));
    const miss = $('#globe-missing');
    miss.hidden = !missing.length || !placed.length;
    miss.textContent = missing.length ? `Not on the globe yet: ${joinNames(missing)}.` : '';
    renderPlanner();
  }

  // Family call planner: for each of the next 24 hours, how many of us are between 9am and 9pm?
  function renderPlanner() {
    const placed = S.members.filter(hasPlace);
    const clocks = placed.map(m => d => hourAt(m, d));
    if (!placed.some(m => m.uid === S.user.uid)) clocks.push(d => d.getHours()); // you, on this device's clock
    const n = clocks.length;
    const start = new Date(); start.setMinutes(0, 0, 0);
    const slots = Array.from({ length: 24 }, (_, i) => {
      const d = new Date(start.getTime() + i * 3600e3);
      return { d, ok: clocks.filter(h => { const x = h(d); return x >= 9 && x < 21; }).length };
    });
    const at = Math.floor(S.globe.offset / 60);
    $('#globe-strip').innerHTML = slots.map((s, i) =>
      `<i class="gt-cell l${n ? Math.round((s.ok / n) * 4) : 0}${i === at ? ' is-now' : ''}" data-action="globe-hour" data-i="${i}" title="${esc(s.d.toLocaleTimeString(undefined, { hour: 'numeric' }))}: ${s.ok} of ${n}"></i>`).join('') +
      `<span class="gt-ticks">${[0, 6, 12, 18].map(i => `<span>${i ? esc(slots[i].d.toLocaleTimeString(undefined, { hour: 'numeric' })) : 'Now'}</span>`).join('')}</span>`;
    const best = $('#globe-best');
    if (placed.length < 2) { best.textContent = 'Put a few of us on the globe and this finds the best time for a family call.'; return; }
    const max = Math.max(...slots.map(s => s.ok));
    let run = null;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].ok !== max) continue;
      let j = i; while (j + 1 < slots.length && slots[j + 1].ok === max) j++;
      if (!run || j - i > run[1] - run[0]) run = [i, j];
      i = j;
    }
    const hr = d => d.toLocaleTimeString(undefined, { hour: 'numeric' });
    const end = new Date(slots[run[1]].d.getTime() + 3600e3);
    const when = `${dayWord(slots[run[0]].d)} ${hr(slots[run[0]].d)} – ${hr(end)}`;
    best.innerHTML = max === 0 ? 'Nobody overlaps between 9 am and 9 pm in the next day.' :
      `${icon('sparkle')}<span><strong>Best time for a family call:</strong> ${esc(when)} your time — ${max === n ? `all ${n} of you are` : `${max} of ${n} are`} between 9 am and 9 pm.</span>`;
  }
  function dayWord(d) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - t) / 864e5);
    return diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : d.toLocaleDateString(undefined, { weekday: 'long' });
  }

  function setGlobeOffset(steps) {
    S.globe.offset = Math.max(0, Math.min(96, steps)) * 15;
    $('#globe-time').value = String(S.globe.offset / 15);
    const live = !S.globe.offset;
    const d = globeTime();
    const label = live ? 'Now' : `${dayWord(d).replace(/^./, c => c.toUpperCase())} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    $('#globe-time-label').textContent = label;
    $('#globe-now').hidden = live;
    $('#globe-live').classList.toggle('travel', !live);
    $('#globe-live-text').textContent = live ? 'Live daylight' : `Daylight at ${label.replace(/^(Today|Tomorrow) /, (m, w) => (w === 'Today' ? '' : 'tomorrow '))}`;
    if (S.globe.api) S.globe.api.setTime(live ? null : d);
    renderGlobeSide();
  }

  function startPicking() {
    if (!S.globe.api) return;
    const mine = hasPlace(S.me) ? S.me.place : null;
    S.globe.picking = true;
    S.globe.draft = mine ? { lat: mine.lat, lng: mine.lng } : null;
    S.globe.api.setPicking(true);
    if (mine) { S.globe.api.setDraft(S.globe.draft); S.globe.api.focus(mine.lat, mine.lng); }
    $('#globe-label').value = mine ? mine.label : '';
    $('#globe-remove').hidden = !mine;
    $('#globe-pick').hidden = false;
    $('#globe-stage').classList.add('is-picking');
    paintPick();
  }
  function stopPicking() {
    S.globe.picking = false;
    S.globe.draft = null;
    if (S.globe.api) S.globe.api.setPicking(false);
    $('#globe-pick').hidden = true;
    $('#globe-stage').classList.remove('is-picking');
  }
  function paintPick() {
    const d = S.globe.draft;
    $('#globe-pick-title').textContent = d ? `Your spot: ${fmtLatLng(d)}` : 'Tap the globe where you live';
    $('#globe-save').disabled = !d;
  }
  function locateMe() {
    const btn = $('#globe-locate');
    if (!navigator.geolocation) { toast('This browser can’t share your location — tap the globe instead.', true); return; }
    busy(btn, true, 'Finding you…');
    navigator.geolocation.getCurrentPosition(pos => {
      busy(btn, false);
      if (!S.globe.picking || !S.globe.api) return;
      S.globe.draft = roundLL({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      S.globe.api.setDraft(S.globe.draft);
      S.globe.api.focus(S.globe.draft.lat, S.globe.draft.lng);
      paintPick();
    }, err => {
      busy(btn, false);
      toast(err && err.code === 1 ? 'Location is off for this site — tap the globe where you live instead.' : 'Couldn’t find you — tap the globe where you live instead.', true);
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
  }
  async function savePlace(remove) {
    const label = $('#globe-label').value.trim().replace(/\s+/g, ' ');
    if (!remove && !S.globe.draft) { toast('Tap the globe where you live first.', true); return; }
    if (!remove && !label) { toast('Give your spot a name, like “Miami, FL”.', true); $('#globe-label').focus(); return; }
    const place = remove ? null : Object.assign(roundLL(S.globe.draft), { label: label.slice(0, 60), tz: myTz().slice(0, 64) });
    const btn = remove ? $('#globe-remove') : $('#globe-save');
    busy(btn, true, remove ? 'Removing…' : 'Saving…');
    try {
      await col('users').doc(S.user.uid).update({ place });
      S.me.place = place;
      if (S.byUid[S.user.uid]) S.byUid[S.user.uid].place = place;
      stopPicking();
      if (S.globe.api) { S.globe.api.setPeople(globePeople(), S.user.uid); if (place) S.globe.api.focus(place.lat, place.lng); }
      paintPlaceBtn();
      renderGlobeSide();
      toast(place ? 'You’re on the family globe' : 'You’re off the globe');
    } catch (err) {
      toast(denied(err) ? NEED_RULES : 'Couldn’t save your spot. Please try again.', true);
    } finally {
      busy(btn, false);
      if (S.globe.picking) paintPick();
    }
  }
  function focusPeople(ids) {
    const list = ids.map(id => S.byUid[id]).filter(hasPlace);
    if (!list.length || !S.globe.api) return;
    S.globe.active = new Set(ids);
    S.globe.api.setActive(ids);
    S.globe.api.focus(list[0].place.lat, list[0].place.lng);
    renderGlobeSide();
    const el = $(`.clock[data-uid="${CSS.escape(ids[0])}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' });
  }
  $('#globe-time').addEventListener('input', e => setGlobeOffset(Number(e.target.value)));
  $('#globe-pick').addEventListener('submit', e => { e.preventDefault(); savePlace(false); });
  $('#globe-pick').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); stopPicking(); } });

  /* ===================== Voice Stories ===================== */
  // Recorded in the browser (MediaRecorder), stored in Firestore as up to three ≤ 880 KB
  // parts (storyAudio/{id}_{n}) next to the story itself. Played back from a blob: URL.
  const STORY_PROMPTS = ['How did you two meet?', 'What was the house you grew up in like?', 'Tell us about your first job.',
    'What’s the story behind a family recipe?', 'What was the best day of your life?', 'What do you want the grandkids to know?',
    'Tell us about someone we miss.', 'What was the funniest family dinner ever?'];
  const MAX_REC_S = 600, MAX_AUDIO = 2.6e6, PART = 880000, PEAKS = 96;
  const fmtDur = s => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
  const rec = { state: 'idle', stream: null, mr: null, chunks: [], bytes: 0, t0: 0, timer: 0, raf: 0, ctx: null, analyser: null, levels: [], blob: null, url: '', mime: '', duration: 0, peaks: '', prompt: '', audio: null, discard: false };
  const player = { audio: null, id: null, loading: null, raf: 0 };

  async function loadStories(force) {
    if (S.stories && !force) return S.stories;
    const snap = await col('stories').orderBy('createdAt', 'desc').limit(60).get();
    S.stories = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    return S.stories;
  }
  async function openStories() {
    if (!S.stories) $('#stories').innerHTML = skelRows(3);
    try { await loadStories(true); }
    catch (e) {
      $('#stories').innerHTML = denied(e) ? emptyHTML('lock', 'Voice stories need the latest security rules', 'Publish firestore.rules — see README.') : errorHTML('voice stories');
      return;
    }
    if (S.view === 'stories') renderStories();
  }
  function peaksOf(st) {
    try { return Array.from(atob(st.peaks || ''), ch => ch.charCodeAt(0)); } catch (e) { return []; }
  }
  function waveSVG(peaks, n) {
    const vals = peaks.length ? peaks : Array.from({ length: n }, (_, i) => 60 + 50 * Math.sin(i / 3));
    const W = vals.length * 4, H = 40;
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${vals.map((v, i) => {
      const h = Math.max(3, (v / 255) * H);
      return `<rect x="${i * 4 + 0.6}" y="${((H - h) / 2).toFixed(1)}" width="2.8" height="${h.toFixed(1)}" rx="1.4"/>`;
    }).join('')}</svg>`;
  }
  function renderStories() {
    const list = S.stories || [];
    if (!list.length) {
      $('#stories').innerHTML = emptyHTML('mic', 'No voice stories yet', 'Be the first — or hand your phone to Grandma and ask her how she met Grandpa.',
        `<button class="btn btn-accent btn-sm" type="button" data-action="new-story">${icon('mic')}Record a story</button>`);
      return;
    }
    $('#stories').innerHTML = list.map(st => {
      const m = S.byUid[st.uid] || { name: st.author, uid: st.uid };
      const mine = S.user && st.uid === S.user.uid;
      const wave = waveSVG(peaksOf(st), PEAKS);
      const playing = player.id === st.id && player.audio && !player.audio.paused;
      return `<article class="story${player.id === st.id ? ' is-current' : ''}" data-story="${esc(st.id)}">
        <button class="story-play${playing ? ' is-playing' : ''}" type="button" data-action="story-play" data-id="${esc(st.id)}" aria-label="${playing ? 'Pause' : 'Play'} “${esc(st.title)}”">${icon(playing ? 'pause' : 'play')}</button>
        <div class="story-main">
          <div class="story-top"><h3>${esc(st.title)}</h3><span class="story-time" data-story-time="${esc(st.id)}">${fmtDur(st.duration)}</span></div>
          <p class="story-meta">${avatarHTML(m, 28)}<span>${esc(st.author || 'Family member')} · ${esc(timeAgo(st.createdAt))}${st.prompt ? ` · <em>“${esc(st.prompt)}”</em>` : ''}</span></p>
          <div class="story-wave" data-action="story-seek" data-id="${esc(st.id)}" role="presentation">
            <div class="wave-base">${wave}</div><div class="wave-played" data-wave="${esc(st.id)}">${wave}</div>
          </div>
          <div class="story-foot">${heartBtn('stories', st)}${mine || isAdmin() ? `<button class="icon-btn story-del" type="button" data-action="delete-story" data-id="${esc(st.id)}" aria-label="Delete “${esc(st.title)}”">${icon('trash')}</button>` : ''}</div>
        </div>
      </article>`;
    }).join('');
    paintPlayer();
  }

  // ---- playback ----
  // iPhones only let a page start audio during a tap. Loading a story takes a moment, so
  // the tap first plays a split second of silence; that unlocks the player for the story.
  let silentUrl = '';
  function unlockAudio(a) {
    if (!silentUrl) {
      const n = 800, v = new DataView(new ArrayBuffer(44 + n));
      const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
      for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
      silentUrl = URL.createObjectURL(new Blob([v.buffer], { type: 'audio/wav' }));
    }
    a.src = silentUrl;
    a.play().catch(() => {});
  }
  async function storyUrl(st) {
    if (S.storyUrls[st.id]) return S.storyUrls[st.id];
    const snap = await col('storyAudio').where('story', '==', st.id).get();
    const parts = snap.docs.map(d => d.data()).sort((a, b) => a.n - b.n).map(p => p.data.toUint8Array());
    if (!parts.length) throw new Error('missing');
    S.storyUrls[st.id] = URL.createObjectURL(new Blob(parts, { type: st.mime || 'audio/webm' }));
    return S.storyUrls[st.id];
  }
  async function playStory(id) {
    const st = (S.stories || []).find(x => x.id === id);
    if (!st) return;
    if (!player.audio) {
      player.audio = new Audio();
      player.audio.preload = 'auto';
      player.audio.addEventListener('play', paintPlayer);
      player.audio.addEventListener('pause', paintPlayer);
      player.audio.addEventListener('ended', () => { player.audio.currentTime = 0; paintPlayer(); });
      player.audio.addEventListener('error', () => { if (player.id && player.audio.src === S.storyUrls[player.id]) toast('Couldn’t play that recording on this device.', true); });
    }
    const a = player.audio;
    if (player.id === id && a.src) { if (a.paused) a.play().catch(() => {}); else a.pause(); return; }
    player.id = id;
    player.loading = id;
    if (S.storyUrls[id]) a.src = S.storyUrls[id]; else unlockAudio(a);
    paintPlayer();
    try {
      const url = await storyUrl(st);
      if (player.id !== id) return;
      if (a.src !== url) a.src = url;
      await a.play();
    } catch (e) {
      if (player.id === id) { player.id = null; toast(denied(e) ? NEED_RULES : 'Couldn’t load that story. Please try again.', true); }
    } finally {
      if (player.loading === id) player.loading = null;
      paintPlayer();
    }
  }
  function paintPlayer() {
    const a = player.audio;
    $$('.story').forEach(card => {
      const id = card.dataset.story, cur = id === player.id;
      const st = (S.stories || []).find(x => x.id === id);
      const playing = cur && a && !a.paused;
      card.classList.toggle('is-current', cur);
      const btn = card.querySelector('.story-play');
      btn.classList.toggle('is-playing', playing);
      btn.classList.toggle('is-loading', player.loading === id);
      btn.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} “${st ? st.title : ''}”`);
      btn.innerHTML = icon(playing ? 'pause' : 'play');
      if (!cur) {
        card.querySelector('.wave-played').style.clipPath = 'inset(0 100% 0 0)';
        card.querySelector('.story-time').textContent = fmtDur(st && st.duration);
      }
    });
    cancelAnimationFrame(player.raf);
    if (a && !a.paused) player.raf = requestAnimationFrame(tickPlayer);
    tickPlayer(true);
  }
  function tickPlayer(once) {
    const a = player.audio;
    if (!a || !player.id) return;
    const st = (S.stories || []).find(x => x.id === player.id);
    const total = isFinite(a.duration) && a.duration > 0 ? a.duration : (st && st.duration) || 1;
    const pct = Math.min(100, (a.currentTime / total) * 100);
    const layer = $(`.wave-played[data-wave="${CSS.escape(player.id)}"]`);
    if (layer) layer.style.clipPath = `inset(0 ${(100 - pct).toFixed(2)}% 0 0)`;
    const tm = $(`[data-story-time="${CSS.escape(player.id)}"]`);
    if (tm) tm.textContent = `${fmtDur(a.currentTime)} / ${fmtDur(total)}`;
    if (once !== true && !a.paused) player.raf = requestAnimationFrame(tickPlayer);
  }
  function seekStory(id, e, el) {
    const a = player.audio;
    if (player.id !== id || !a || !a.src) { playStory(id); return; }
    const r = el.getBoundingClientRect();
    const total = isFinite(a.duration) && a.duration > 0 ? a.duration : 0;
    if (!total) return;
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total;
    if (a.paused) a.play().catch(() => {});
    tickPlayer(true);
  }
  function stopPlayer() {
    if (player.audio) { player.audio.pause(); player.audio.removeAttribute('src'); player.audio.load(); }
    cancelAnimationFrame(player.raf);
    player.id = null;
    player.loading = null;
  }
  async function deleteStory(id) {
    const st = (S.stories || []).find(x => x.id === id);
    if (!st) return;
    if (!(await confirmBox(`Delete “${st.title}”?`, 'The recording will be gone for everyone.', 'Delete'))) return;
    try {
      const b = db.batch();
      for (let n = 0; n < (st.parts || 1); n++) b.delete(col('storyAudio').doc(`${id}_${n}`));
      b.delete(col('stories').doc(id));
      await b.commit();
      if (player.id === id) stopPlayer();
      if (S.storyUrls[id]) { URL.revokeObjectURL(S.storyUrls[id]); delete S.storyUrls[id]; }
      S.stories = S.stories.filter(x => x.id !== id);
      renderStories();
      toast('Story deleted');
    } catch (e) {
      toast(denied(e) ? NEED_RULES : 'Couldn’t delete it. Please try again.', true);
    }
  }

  // ---- recording ----
  function openRecorder() {
    stopPlayer();
    paintPlayer();
    resetRecorder();
    $('#story-title').value = '';
    rec.prompt = '';
    $('#rec-prompts').innerHTML = STORY_PROMPTS.map(p => `<button type="button" data-action="rec-prompt" aria-pressed="false">${esc(p)}</button>`).join('');
    $('#story-dialog').showModal();
    $('#rec-btn').focus();
  }
  function setRecState(state) {
    rec.state = state;
    $('#rec-stage').dataset.state = state;
    const btn = $('#rec-btn');
    btn.hidden = state === 'review';
    btn.innerHTML = icon(state === 'recording' ? 'stop' : 'mic');
    btn.setAttribute('aria-label', state === 'recording' ? 'Stop recording' : 'Start recording');
    $('#rec-review').hidden = state !== 'review';
    $('#rec-hint').textContent = state === 'recording' ? 'Recording… tap to stop when you’re done.'
      : state === 'review' ? 'Listen back, give it a title, and save it for the family.'
        : 'Up to 10 minutes. Find a quiet spot and hold the phone close.';
    $('#story-save').disabled = state !== 'review';
  }
  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  }
  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      toast('This browser can’t record audio — try Safari or Chrome.', true);
      return;
    }
    const btn = $('#rec-btn');
    btn.disabled = true;
    try {
      rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      btn.disabled = false;
      toast(e && e.name === 'NotAllowedError' ? 'Microphone access is off — allow it for this site to record.' : 'Couldn’t find a microphone.', true);
      return;
    }
    btn.disabled = false;
    if (!$('#story-dialog').open) { releaseMic(); return; }
    const mime = pickMime();
    try { rec.mr = new MediaRecorder(rec.stream, Object.assign({ audioBitsPerSecond: 32000 }, mime ? { mimeType: mime } : {})); }
    catch (e) { rec.mr = new MediaRecorder(rec.stream); }
    rec.chunks = []; rec.bytes = 0; rec.levels = []; rec.discard = false;
    rec.mime = mime;
    rec.mr.ondataavailable = ev => {
      if (!ev.data || !ev.data.size) return;
      rec.chunks.push(ev.data);
      rec.bytes += ev.data.size;
      if (rec.bytes > MAX_AUDIO && rec.mr.state === 'recording') { stopRecording(); toast('That’s as long as one story can be — we kept what you recorded.'); }
    };
    rec.mr.onstop = finishRecording;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      try {
        rec.ctx = new AC();
        rec.analyser = rec.ctx.createAnalyser();
        rec.analyser.fftSize = 1024;
        rec.ctx.createMediaStreamSource(rec.stream).connect(rec.analyser);
        if (rec.ctx.state === 'suspended') rec.ctx.resume().catch(() => {});
      } catch (e) { rec.analyser = null; }
    }
    rec.mr.start(1000);
    rec.t0 = performance.now();
    setRecState('recording');
    rec.timer = setInterval(() => {
      const s = (performance.now() - rec.t0) / 1000;
      $('#rec-time').textContent = fmtDur(s);
      if (s >= MAX_REC_S) stopRecording();
    }, 250);
    drawLive();
  }
  function stopRecording() {
    if (rec.mr && rec.mr.state !== 'inactive') {
      rec.duration = (performance.now() - rec.t0) / 1000;
      rec.mr.stop();
    }
    clearInterval(rec.timer);
    cancelAnimationFrame(rec.raf);
  }
  function releaseMic() {
    if (rec.stream) rec.stream.getTracks().forEach(t => t.stop());
    rec.stream = null;
    if (rec.ctx) rec.ctx.close().catch(() => {});
    rec.ctx = null;
    rec.analyser = null;
  }
  function finishRecording() {
    releaseMic();
    if (rec.discard) { rec.discard = false; return; }
    const type = (rec.mr && rec.mr.mimeType) || rec.mime || 'audio/webm';
    rec.blob = new Blob(rec.chunks, { type });
    rec.chunks = [];
    rec.mime = /^audio\/[a-z0-9.+-]+(;\s?codecs=[A-Za-z0-9.,"+-]+)?$/.test(type) ? type : type.split(';')[0];
    if (!/^audio\//.test(rec.mime)) rec.mime = 'audio/webm';
    if (rec.blob.size > 3 * PART) { toast('That recording is too long to save — try a shorter one.', true); resetRecorder(); return; }
    if (rec.duration < 1 || !rec.blob.size) { toast('That was too short — try again.', true); resetRecorder(); return; }
    // squeeze the loudness readings into a small waveform to store with the story
    const lv = rec.levels.length ? rec.levels : [0];
    const out = [];
    for (let i = 0; i < PEAKS; i++) {
      const a = Math.floor((i * lv.length) / PEAKS), b = Math.max(a + 1, Math.floor(((i + 1) * lv.length) / PEAKS));
      out.push(Math.max(...lv.slice(a, b)));
    }
    const max = Math.max(...out, 0.0001);
    rec.peaks = btoa(String.fromCharCode(...out.map(v => Math.round(Math.min(1, v / max) * 255))));
    rec.url = URL.createObjectURL(rec.blob);
    setRecState('review');
    drawPeaks();
    if (!$('#story-title').value && rec.prompt) $('#story-title').value = rec.prompt.replace(/\?$/, '');
    $('#story-title').focus();
  }
  function resetRecorder() {
    if (rec.mr && rec.mr.state !== 'inactive') { rec.discard = true; stopRecording(); }
    clearInterval(rec.timer);
    cancelAnimationFrame(rec.raf);
    releaseMic();
    if (rec.audio) { rec.audio.pause(); rec.audio = null; }
    if (rec.url) URL.revokeObjectURL(rec.url);
    Object.assign(rec, { mr: null, chunks: [], bytes: 0, levels: [], blob: null, url: '', duration: 0, peaks: '' });
    $('#rec-time').textContent = '0:00';
    $('#rec-play').innerHTML = `${icon('play')}Listen back`;
    setRecState('idle');
    clearWave();
  }
  function waveCtx() {
    const c = $('#rec-wave'), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth || 400, h = c.clientHeight || 90;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  function clearWave() { waveCtx(); }
  function bars(ctx, w, h, vals, color) {
    const step = 5, n = Math.floor(w / step);
    ctx.fillStyle = color;
    vals.slice(-n).forEach((v, i, arr) => {
      const bh = Math.max(3, Math.min(1, v) * (h - 8));
      const x = w - (arr.length - i) * step;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, (h - bh) / 2, 3, bh, 1.5); else ctx.rect(x, (h - bh) / 2, 3, bh);
      ctx.fill();
    });
  }
  function drawLive() {
    if (rec.state !== 'recording') return;
    let level = 0.04 + 0.03 * Math.random();
    if (rec.analyser) {
      const buf = new Float32Array(rec.analyser.fftSize);
      rec.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      level = Math.min(1, Math.sqrt(sum / buf.length) * 4.5);
    }
    rec.levels.push(level);
    const { ctx, w, h } = waveCtx();
    bars(ctx, w, h, rec.levels.slice(-600).filter((_, i) => i % 3 === 0), getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#a94f2b');
    rec.raf = requestAnimationFrame(drawLive);
  }
  function drawPeaks(progress) {
    const { ctx, w, h } = waveCtx();
    const vals = Array.from(atob(rec.peaks), ch => ch.charCodeAt(0) / 255);
    const n = vals.length, gap = w / n;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#a94f2b';
    const muted = getComputedStyle(document.documentElement).getPropertyValue('--line-2').trim() || '#ccc';
    vals.forEach((v, i) => {
      const bh = Math.max(3, v * (h - 8));
      ctx.fillStyle = progress != null && i / n <= progress ? accent : (progress == null ? accent : muted);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(i * gap + gap * 0.2, (h - bh) / 2, gap * 0.6, bh, 1.5); else ctx.rect(i * gap + gap * 0.2, (h - bh) / 2, gap * 0.6, bh);
      ctx.fill();
    });
  }
  function toggleListen() {
    if (!rec.url) return;
    if (!rec.audio) {
      rec.audio = new Audio(rec.url);
      rec.audio.addEventListener('ended', () => { $('#rec-play').innerHTML = `${icon('play')}Listen back`; drawPeaks(); });
      rec.audio.addEventListener('timeupdate', () => { if (rec.audio) drawPeaks(rec.audio.currentTime / (rec.duration || 1)); });
    }
    if (rec.audio.paused) { rec.audio.play().catch(() => {}); $('#rec-play').innerHTML = `${icon('pause')}Pause`; }
    else { rec.audio.pause(); $('#rec-play').innerHTML = `${icon('play')}Listen back`; }
  }
  $('#story-dialog').addEventListener('close', () => { if (rec.state !== 'saving') resetRecorder(); });
  $('#story-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!rec.blob) { toast('Record your story first.', true); return; }
    const title = $('#story-title').value.trim().replace(/\s+/g, ' ');
    if (!title) { toast('Give your story a title.', true); $('#story-title').focus(); return; }
    const btn = $('#story-save');
    busy(btn, true, 'Saving…');
    rec.state = 'saving';
    try {
      const bytes = new Uint8Array(await rec.blob.arrayBuffer());
      const parts = [];
      for (let i = 0; i < bytes.length; i += PART) parts.push(bytes.slice(i, i + PART));
      const ref = col('stories').doc();
      const story = { title: title.slice(0, 120), uid: S.user.uid, author: myName().slice(0, 80), createdAt: nowIso(),
        duration: Math.min(900, Math.max(0.1, Math.round(rec.duration * 10) / 10)), mime: rec.mime.slice(0, 60), parts: parts.length, peaks: rec.peaks };
      if (rec.prompt) story.prompt = rec.prompt.slice(0, 200);
      const batch = db.batch();
      batch.set(ref, story);
      parts.forEach((p, n) => batch.set(col('storyAudio').doc(`${ref.id}_${n}`), { story: ref.id, n, data: firebase.firestore.Blob.fromUint8Array(p), uid: S.user.uid }));
      await batch.commit();
      S.storyUrls[ref.id] = rec.url;
      rec.url = '';
      S.stories = [Object.assign({ id: ref.id }, story)].concat(S.stories || []);
      rec.state = 'review';
      $('#story-dialog').close();
      if (S.view === 'stories') renderStories(); else location.hash = 'stories';
      toast('Your story is saved for the family');
    } catch (err) {
      rec.state = 'review';
      toast(denied(err) ? NEED_RULES : 'Couldn’t save your story. Please try again.', true);
    } finally {
      busy(btn, false);
    }
  });

  /* ===================== Time Capsules ===================== */
  // Letters sealed until a chosen day. firestore.rules won't hand a letter to anyone —
  // its writer included — before its openAt time, so the seal is real, not just hidden.
  const fmtLong = ms => new Date(ms).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  function spanText(ms) {
    const days = Math.max(1, Math.round(ms / 864e5));
    if (days < 45) return plural(days, 'day');
    const months = Math.round(days / 30.44);
    if (months < 12) return plural(months, 'month');
    const y = Math.floor(months / 12), m = months % 12;
    return plural(y, 'year') + (m ? `, ${plural(m, 'month')}` : '');
  }
  function untilText(ms) {
    const d = ms - Date.now();
    if (d <= 0) return 'now';
    if (d < 864e5) return `in ${plural(Math.ceil(d / 3600e3), 'hour')}`;
    return `in ${spanText(d)}`;
  }
  const capReady = c => c.openAt <= Date.now();
  const capReadByMe = c => !!(c.openedBy && S.user && c.openedBy[S.user.uid]);
  const capSeal = c => esc(initials(c.author || '?').slice(0, 1));
  const peopleText = n => (n === 1 ? '1 person' : `${n} people`);

  async function loadCapsules(force) {
    if (S.capsules && !force) return S.capsules;
    const snap = await col('capsules').orderBy('openAt').get();
    S.capsules = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(c => typeof c.openAt === 'number');
    paintCapsuleBadge();
    scheduleCapsuleTick();
    return S.capsules;
  }
  function paintCapsuleBadge() {
    const n = (S.capsules || []).filter(c => capReady(c) && !capReadByMe(c)).length;
    $$('[data-capsule-badge]').forEach(b => { b.hidden = !n; b.textContent = n || ''; });
    renderHomeCapsule();
  }
  // If a capsule opens while the hub is open (say, at midnight), show it right away.
  let capsuleTimer = 0;
  function scheduleCapsuleTick() {
    clearTimeout(capsuleTimer);
    const next = (S.capsules || []).map(c => c.openAt).filter(t => t > Date.now()).sort((a, b) => a - b)[0];
    if (!next || next - Date.now() > 864e5) return;
    capsuleTimer = setTimeout(() => {
      paintCapsuleBadge();
      if (S.view === 'capsules') renderCapsules();
      scheduleCapsuleTick();
    }, next - Date.now() + 1500);
  }
  function renderHomeCapsule() {
    const box = $('#home-capsule');
    const ready = (S.capsules || []).filter(c => capReady(c) && !capReadByMe(c));
    box.hidden = !ready.length;
    if (!ready.length) { box.innerHTML = ''; return; }
    const c = ready[0], created = Date.parse(c.createdAt);
    const ago = isNaN(created) ? '' : ` ${spanText(c.openAt - created)} ago`;
    box.innerHTML = `<div class="capsule-banner">
      <span class="seal" aria-hidden="true">${capSeal(c)}</span>
      <div><strong>${ready.length > 1 ? `${ready.length} time capsules are ready to open` : 'A time capsule is ready to open'}</strong>
      <p>“${esc(c.title)}” — sealed by ${esc(firstName(c.author))}${esc(ago)}</p></div>
      <button class="btn btn-accent" type="button" data-action="open-capsule" data-id="${esc(c.id)}">${icon('letter')}Open it</button>
    </div>`;
  }

  async function openCapsules() {
    if (!S.capsules) $('#capsules').innerHTML = skelRows(3);
    try { await loadCapsules(true); }
    catch (e) {
      $('#capsules').innerHTML = denied(e) ? emptyHTML('lock', 'Time capsules need the latest security rules', 'Publish firestore.rules — see README.') : errorHTML('time capsules');
      return;
    }
    if (S.view === 'capsules') renderCapsules();
  }
  function renderCapsules() {
    const all = S.capsules || [];
    if (!all.length) {
      $('#capsules').innerHTML = emptyHTML('letter', 'No time capsules yet', 'Seal the first one — a letter to a grandchild, to next Thanksgiving’s table, or to your future self.',
        `<button class="btn btn-accent btn-sm" type="button" data-action="new-capsule">${icon('letter')}Seal a time capsule</button>`);
      return;
    }
    const ready = all.filter(c => capReady(c) && !capReadByMe(c));
    const sealed = all.filter(c => !capReady(c));
    const opened = all.filter(c => capReady(c) && capReadByMe(c)).reverse();
    const section = (title, list) => (list.length ? `<section class="cap-section"><h2 class="cap-h">${title}<span>${list.length}</span></h2><div class="capsules">${list.map(capCard).join('')}</div></section>` : '');
    $('#capsules').innerHTML = section('Ready to open', ready) + section('Sealed', sealed) + section('Opened', opened);
  }
  function capCard(c) {
    const state = !capReady(c) ? 'sealed' : capReadByMe(c) ? 'opened' : 'ready';
    const created = Date.parse(c.createdAt), total = c.openAt - created;
    const pct = isNaN(created) || total <= 0 ? 0 : Math.max(0, Math.min(1000, Math.round(((Date.now() - created) / total) * 1000)));
    const readers = Object.keys(c.openedBy || {}).filter(k => c.openedBy[k]).length;
    const canDelete = (S.user && c.uid === S.user.uid) || isAdmin();
    const when = state === 'sealed' ? `${icon('lock')}Opens ${esc(fmtLong(c.openAt))} · ${esc(untilText(c.openAt))}`
      : state === 'ready' ? `${icon('sparkle')}Opened ${esc(fmtLong(c.openAt))} — waiting for you`
        : `${icon('check')}Opened ${esc(fmtLong(c.openAt))}${readers ? ` · read by ${peopleText(readers)}` : ''}`;
    return `<article class="capsule is-${state}${S.justSealed === c.id ? ' just-sealed' : ''}" data-capsule="${esc(c.id)}">
      <div class="cap-art" aria-hidden="true"><span class="seal">${capSeal(c)}</span></div>
      <div class="cap-body">
        <h3>${esc(c.title)}</h3>
        <p class="cap-who">From ${esc(c.author || 'Family member')}${c.to ? ` · for ${esc(c.to)}` : ''}${c.hasPhoto ? ` · <span class="nw">${icon('image')}photo inside</span>` : ''}</p>
        <p class="cap-when">${when}</p>
        ${state === 'sealed' ? `<progress class="cap-progress" max="1000" value="${pct}" aria-label="How much of the wait has passed"></progress>` : ''}
        ${state !== 'sealed' ? `<div class="cap-actions"><button class="btn ${state === 'ready' ? 'btn-accent' : 'btn-ghost'} btn-sm" type="button" data-action="open-capsule" data-id="${esc(c.id)}">${state === 'ready' ? `${icon('letter')}Open it` : 'Read it again'}</button></div>` : ''}
      </div>
      ${canDelete ? `<button class="icon-btn cap-del" type="button" data-action="delete-capsule" data-id="${esc(c.id)}" aria-label="Delete “${esc(c.title)}”">${icon('trash')}</button>` : ''}
    </article>`;
  }

  // ---- writing one ----
  function openCapsuleForm() {
    $('#capsule-form').reset();
    S.capPhoto = '';
    paintCapPhoto('');
    const min = new Date(); min.setDate(min.getDate() + 1);
    const max = new Date(); max.setFullYear(max.getFullYear() + 99);
    $('#cap-date').min = isoDay(min);
    $('#cap-date').max = isoDay(max);
    $('#cap-presets').innerHTML = capPresets().map(([label, d]) =>
      `<button type="button" data-action="cap-preset" data-day="${isoDay(d)}" aria-pressed="false">${esc(label)}</button>`).join('');
    $('#cap-count').textContent = '';
    paintCapHint();
    $('#capsule-dialog').showModal();
    $('#cap-title').focus();
  }
  function capPresets() {
    const now = new Date(), y = now.getFullYear();
    const inYears = n => { const d = new Date(now.getFullYear() + n, now.getMonth(), now.getDate()); return d; };
    const list = [['In 1 year', inYears(1)], ['In 5 years', inYears(5)], ['In 10 years', inYears(10)], [`New Year’s ${y + 1}`, new Date(y + 1, 0, 1)]];
    // Kids in the directory: "Sofia turns 18"
    S.members.forEach(m => {
      if (!DAY.test(m.birthday || '')) return;
      const b = parseDay(m.birthday), d = new Date(b.getFullYear() + 18, b.getMonth(), b.getDate());
      if (d > now && b < now) list.push([`${firstName(m.name)} turns 18`, d]);
    });
    return list.slice(0, 7);
  }
  function paintCapHint() {
    const v = $('#cap-date').value;
    $('#cap-hint').textContent = DAY.test(v)
      ? `Opens ${fmtLong(parseDay(v).getTime())} — ${untilText(parseDay(v).getTime())}. Until then, nobody can read it.`
      : 'Pick any day from tomorrow up to 100 years from now.';
    $$('#cap-presets [data-day]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.day === v)));
  }
  function paintCapPhoto(src) {
    $('#cap-photo-preview').innerHTML = okImg(src) ? `<img src="${src}" alt="">` : icon('image');
    $('#cap-photo-remove').hidden = !okImg(src);
  }
  $('#cap-date').addEventListener('input', paintCapHint);
  $('#cap-date').addEventListener('change', paintCapHint);
  $('#cap-text').addEventListener('input', e => { const n = e.target.value.length; $('#cap-count').textContent = n > 15000 ? `${n.toLocaleString()} / 20,000` : ''; });
  $('#cap-photo-input').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { S.capPhoto = await compressImage(f, 1600, 0.82, 780000); paintCapPhoto(S.capPhoto); }
    catch (err) { toast('That photo couldn’t be used — try another one.', true); }
  });
  $('#capsule-form').addEventListener('submit', async e => {
    e.preventDefault();
    const title = $('#cap-title').value.trim().replace(/\s+/g, ' ');
    const to = $('#cap-to').value.trim().replace(/\s+/g, ' ');
    const text = $('#cap-text').value.trim();
    const day = $('#cap-date').value;
    if (!title) { toast('Give your time capsule a name.', true); $('#cap-title').focus(); return; }
    if (!text) { toast('Write your letter first.', true); $('#cap-text').focus(); return; }
    if (!DAY.test(day) || parseDay(day).getTime() < Date.now() + 2 * 3600e3) { toast('Pick a day in the future for it to open.', true); $('#cap-date').focus(); return; }
    const openAt = parseDay(day).getTime();
    if (!(await confirmBox(`Seal it until ${fmtLong(openAt)}?`, 'Once it’s sealed, nobody can read or change it until that day — not even you.', 'Seal it', 'go'))) return;
    const btn = $('#cap-save');
    busy(btn, true, 'Sealing…');
    try {
      const ref = col('capsules').doc();
      const cap = { title: title.slice(0, 120), uid: S.user.uid, author: myName().slice(0, 80), createdAt: nowIso(), openAt, hasPhoto: okImg(S.capPhoto) };
      if (to) cap.to = to.slice(0, 120);
      const letter = { text: text.slice(0, 20000), uid: S.user.uid };
      if (okImg(S.capPhoto)) letter.photo = S.capPhoto;
      const batch = db.batch();
      batch.set(ref, cap);
      batch.set(col('capsuleLetters').doc(ref.id), letter);
      await batch.commit();
      $('#capsule-dialog').close();
      S.capPhoto = '';
      S.justSealed = ref.id;
      S.capsules = (S.capsules || []).concat([Object.assign({ id: ref.id }, cap)]).sort((a, b) => a.openAt - b.openAt);
      paintCapsuleBadge();
      if (S.view === 'capsules') renderCapsules(); else location.hash = 'capsules';
      toast(`Sealed until ${fmtLong(openAt)}`);
      setTimeout(() => { S.justSealed = null; }, 2500);
    } catch (err) {
      toast(denied(err) ? NEED_RULES : 'Couldn’t seal it. Please try again.', true);
    } finally {
      busy(btn, false);
    }
  });

  // ---- opening one ----
  async function openCapsule(id) {
    const c = (S.capsules || []).find(x => x.id === id);
    if (!c) return;
    const d = $('#capsule-open');
    const ceremony = !capReadByMe(c) && !REDUCED;
    d.classList.remove('cracked', 'flap-open', 'risen', 'reading');
    $('#co-letter').hidden = true;
    $('#co-wait').hidden = true;
    $('#co-envelope').hidden = !ceremony;
    $('#co-seal').textContent = initials(c.author || '?').slice(0, 1);
    d.showModal();
    let snap;
    try {
      [snap] = await Promise.all([col('capsuleLetters').doc(id).get(), ceremony ? playCeremony(d) : null]);
    } catch (e) {
      $('#co-envelope').hidden = true;
      $('#co-wait').hidden = false;
      $('#co-wait').textContent = denied(e) && !capReady(c) ? 'Still sealed — come back when the day arrives.'
        : denied(e) ? 'Almost — it opens any moment now. Try again in a minute.' : 'Couldn’t open it. Check your connection and try again.';
      return;
    }
    if (!d.open) return;
    const letter = snap.exists ? snap.data() : null;
    if (!letter) { $('#co-envelope').hidden = true; $('#co-wait').hidden = false; $('#co-wait').textContent = 'This letter has gone missing.'; return; }
    const created = Date.parse(c.createdAt);
    $('#co-meta').textContent = `Sealed ${isNaN(created) ? '' : fmtLong(created) + ' · '}opened ${fmtLong(c.openAt)}`;
    $('#co-title').textContent = c.title;
    $('#co-to').textContent = c.to ? `For ${c.to}` : '';
    $('#co-to').hidden = !c.to;
    const photo = $('#co-photo');
    photo.hidden = !okImg(letter.photo);
    if (okImg(letter.photo)) photo.src = letter.photo; else photo.removeAttribute('src');
    $('#co-text').innerHTML = String(letter.text || '').split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    $('#co-sign').textContent = initials(c.author || '?').slice(0, 1);
    $('#co-sealed').textContent = `With love, ${c.author || 'family'}${isNaN(created) ? '' : ` — kept sealed for ${spanText(c.openAt - created)}`}`;
    $('#co-envelope').hidden = true;
    $('#co-letter').hidden = false;
    d.classList.add('reading');
    $('#co-letter').scrollTop = 0;
    if (!capReadByMe(c)) {
      if (ceremony) confetti();
      c.openedBy = Object.assign({}, c.openedBy, { [S.user.uid]: true });
      paintCapsuleBadge();
      if (S.view === 'capsules') renderCapsules();
      col('capsules').doc(id).update({ ['openedBy.' + S.user.uid]: true }).catch(() => {});
    }
  }
  // The seal cracks, the flap lifts, the letter slides out.
  function playCeremony(d) {
    const steps = [[450, 'cracked'], [650, 'flap-open'], [750, 'risen'], [700, null]];
    return new Promise(res => {
      let i = 0;
      (function next() {
        if (i >= steps.length || !d.open) { res(); return; }
        const [ms, cls] = steps[i++];
        setTimeout(() => { if (cls) d.classList.add(cls); next(); }, ms);
      })();
    });
  }
  async function deleteCapsule(id) {
    const c = (S.capsules || []).find(x => x.id === id);
    if (!c) return;
    const body = capReady(c) ? 'The letter will be gone for everyone.' : 'The sealed letter will be gone for good — nobody will ever read it.';
    if (!(await confirmBox(`Delete “${c.title}”?`, body, 'Delete'))) return;
    try {
      const b = db.batch();
      b.delete(col('capsuleLetters').doc(id));
      b.delete(col('capsules').doc(id));
      await b.commit();
      S.capsules = S.capsules.filter(x => x.id !== id);
      paintCapsuleBadge();
      if (S.view === 'capsules') renderCapsules();
      toast('Time capsule deleted');
    } catch (e) {
      toast(denied(e) ? NEED_RULES : 'Couldn’t delete it. Please try again.', true);
    }
  }

  /* ===================== Family Tree ===================== */
  // The tree is imported once from an Ancestry export (by an admin) and lives in the private
  // database: tree/meta + tree/part0…, read by /assets/js/tree.js (loaded on demand).
  // The tree's home person — Hector, whom the In Memory page honours — gets the memorial photo.
  const HOME_PERSON = 'I' + HOME_PID;
  let treeLib = null;
  function loadTreeLib() {
    if (window.AgrazTree) return Promise.resolve();
    if (!treeLib) {
      treeLib = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = '/assets/js/tree.js' + ASSET_V;
        sc.onload = resolve;
        sc.onerror = () => { treeLib = null; reject(new Error('tree')); };
        document.head.appendChild(sc);
      });
    }
    return treeLib;
  }
  const T = () => window.AgrazTree;
  const capFirst = x => x.charAt(0).toUpperCase() + x.slice(1);
  const vtName = pid => 'tp-' + String(pid).replace(/[^A-Za-z0-9_-]/g, '');

  async function loadTree() {
    await loadTreeLib();
    const metaSnap = await col('tree').doc('meta').get();
    if (!metaSnap.exists) { S.tree = { status: 'empty', photos: {} }; return; }
    const meta = metaSnap.data();
    const snaps = await Promise.all(Array.from({ length: Math.max(1, Math.min(20, meta.parts || 1)) }, (_, i) => col('tree').doc('part' + i).get()));
    const model = Object.assign({}, meta, { people: [], families: [] });
    snaps.forEach(s => { if (s.exists) { const d = s.data(); model.people.push(...(d.people || [])); model.families.push(...(d.families || [])); } });
    setTreeModel(meta, model);
    try { const r = await col('tree').doc('research').get(); if (r.exists) S.tree.research = r.data().people || {}; } catch (e) {}
  }
  function setTreeModel(meta, model) {
    const prev = S.tree || {};
    S.tree = { status: 'ready', meta, model, ix: T().index(model), photos: prev.photos || {}, research: prev.research || {}, view: prev.view || 'family', history: [], relCache: new Map(), memorialThumb: prev.memorialThumb || '', ghosts: new Map(),
      counts: model.people.reduce((c, p) => { c.records += (p.src || []).length; c.media += (p.md || []).length; return c; }, { records: 0, media: 0 }) };
    S.tree.focus = treeStart();
    loadTreePhotos();
  }
  const treeMe = () => (S.tree && S.tree.ix && S.me && S.me.treeId && S.tree.ix.get(S.me.treeId) ? S.me.treeId : null);
  function treeStart() {
    const ix = S.tree.ix;
    if (treeMe()) return treeMe();
    if (ix.get(HOME_PERSON)) return HOME_PERSON;
    let best = null, n = -1;
    S.tree.model.people.forEach(p => { const k = ix.parents(p.id).length + ix.children(p.id).length + ix.spouses(p.id).length; if (k > n) { n = k; best = p.id; } });
    return best;
  }
  async function loadTreePhotos() {
    try {
      const snap = await col('treePhotos').get();
      snap.docs.forEach(d => { const v = d.data(); if (okImg(v.img)) S.tree.photos[d.id] = { img: v.img, uid: v.uid }; });
    } catch (e) { /* photos are a bonus */ }
    // The memorial's first photo stands in for the home person, if they have no photo yet.
    if (!S.tree.memorialThumb && S.tree.ix && S.tree.ix.get(HOME_PERSON)) {
      try {
        const snap = await col('memorial').orderBy('order').limit(1).get();
        const src = snap.docs.length && snap.docs[0].data().imageData;
        if (okImg(src)) S.tree.memorialThumb = await thumbOf(src, 320);
      } catch (e) {}
    }
    if (S.view === 'tree' && S.tree.status === 'ready') {
      paintTree(false);
      const n = S.tree.model.people.reduce((k, p) => k + (photoFor(p.id) ? 1 : 0), 0), el = $('#ts-photos');
      if (el) { el.dataset.count = n; el.textContent = n.toLocaleString(); }
    }
  }
  function thumbOf(src, size) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas');
        c.width = c.height = Math.min(size, s);
        c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 3, s, s, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => resolve('');
      img.src = src;
    });
  }
  // Photos, best first: one added to the tree → the member's own profile photo → the memorial.
  function photoFor(pid) {
    const t = S.tree;
    if (t.photos[pid]) return t.photos[pid].img;
    const m = S.members.find(x => x.treeId === pid && okImg(x.avatar));
    if (m) return m.avatar;
    if (pid === HOME_PERSON && t.memorialThumb) return t.memorialThumb;
    return '';
  }
  function relOf(pid) {
    const me = treeMe();
    if (!me) return '';
    if (pid === me) return 'you';
    return T().relationship(S.tree.ix, me, pid, S.tree.relCache) || '';
  }
  const relLong = r => (!r ? '' : r === 'you' ? 'This is you' : /^your /.test(r) || / of your /.test(r) ? capFirst(r) : `Your ${r}`);
  const relShort = r => (!r ? '' : r === 'you' ? 'You' : capFirst(r.replace(/^your /, '')));

  async function openTree() {
    const body = $('#tree-body');
    if (!S.tree || !S.tree.status || S.tree.status === 'error' || S.tree.status === 'denied') {
      body.innerHTML = '<div class="tree-skel"><div class="skel"></div><div class="skel"></div></div>';
      $('#tree-head').hidden = true;
      try { await loadTree(); }
      catch (e) { S.tree = { status: denied(e) ? 'denied' : 'error', photos: {} }; }
    }
    if (S.treeKey) { const key = S.treeKey; S.treeKey = null; await unlockTree(key); }
    if (S.view === 'tree') renderTree();
  }
  function renderTree() {
    const t = S.tree || {}, body = $('#tree-body');
    $('#tree-head').hidden = t.status !== 'ready';
    $('#tree-photos-btn').hidden = !isAdmin();
    if (t.status === 'denied') { body.innerHTML = rulesNeededHTML('The family tree'); return; }
    if (t.status === 'error') { body.innerHTML = errorHTML('the family tree'); return; }
    if (t.status === 'empty') { body.innerHTML = treeImportHTML(); return; }
    body.innerHTML = `${t.updating ? treeImportHTML(true) : ''}${treeStatsHTML()}${treeMeBannerHTML()}
      <div class="tree-layout">
        <div class="tree-stage">
          <div class="tree-toolbar">
            <div class="seg seg-sm tree-seg" role="tablist" aria-label="Tree view">
              <button type="button" role="tab" data-action="tree-view" data-v="family" aria-selected="${t.view === 'family'}">${icon('pedigree')}<span>Family</span></button>
              <button type="button" role="tab" data-action="tree-view" data-v="fan" aria-selected="${t.view === 'fan'}">${icon('sunrise')}<span>Ancestors</span></button>
            </div>
            <span class="tree-tools">
              <button class="icon-btn" type="button" data-action="tree-back" id="tree-back" aria-label="Back to the previous person" hidden>${icon('arrow-l')}</button>
              <button class="btn btn-sm btn-ghost-light" type="button" data-action="tree-home" aria-label="${treeMe() ? 'Back to me' : 'Back to the start'}">${icon('home')}<span class="tt-label">${treeMe() ? 'Back to me' : 'Start'}</span></button>
            </span>
          </div>
          <div class="tree-canvas" id="tree-canvas"></div>
          <div class="tree-story" id="tree-story"></div>
        </div>
        <aside class="tree-panel card" id="tree-panel" aria-live="polite"></aside>
      </div>`;
    paintTree(false);
    countUp();
  }
  // Redraw the chart and the profile (with a smooth glide between people where supported).
  function paintTree(animate) {
    const t = S.tree;
    if (!t || t.status !== 'ready' || !$('#tree-canvas')) return;
    const draw = () => {
      if (t.view === 'fan') renderFan(); else renderFamily();
      renderStory();
      renderPanel();
      const back = $('#tree-back');
      if (back) back.hidden = !t.history.length;
    };
    if (animate && VT && !document.hidden) document.startViewTransition(draw); else draw();
  }
  function treeFocus(pid) {
    const t = S.tree;
    if (!t || !t.ix.get(pid)) return;
    t.ghost = null;
    if (pid !== t.focus) { t.history.push(t.focus); if (t.history.length > 50) t.history.shift(); t.focus = pid; }
    $('#tree-results').hidden = true;
    $('#tree-search').setAttribute('aria-expanded', 'false');
    paintTree(true);
    if (window.matchMedia('(max-width: 1100px)').matches && t.view === 'family') {
      const panel = $('#tree-panel');
      if (panel && document.activeElement && document.activeElement.closest('.tree-panel')) panel.scrollIntoView({ block: 'start', behavior: REDUCED ? 'auto' : 'smooth' });
    }
  }

  function treeStatsHTML() {
    const t = S.tree, m = t.model;
    const photos = m.people.reduce((n, p) => n + (photoFor(p.id) ? 1 : 0), 0);
    const stat = (n, label, id) => `<div class="ts"><b data-count="${n}"${id ? ` id="${id}"` : ''}>${Number(n).toLocaleString()}</b><span>${label}</span></div>`;
    return `<div class="tree-stats">
      ${stat(m.people.length, 'relatives')}${stat(m.generations || 0, 'generations')}
      ${m.earliest ? `<div class="ts"><b>${m.earliest}</b><span>earliest birth</span></div>` : ''}
      ${stat(photos, 'with photos', 'ts-photos')}
      ${t.counts.records ? stat(t.counts.records, 'records') : ''}${t.counts.media ? stat(t.counts.media, 'photos &amp; documents') : ''}
      <p class="ts-source">${icon('tree')}${esc(m.name || 'Family tree')} · from ${esc(t.meta.source || 'Ancestry')}${t.meta.importedAt ? ` · updated ${esc(fmtDate(t.meta.importedAt))}` : ''}${isAdmin() ? ' · <button class="link-btn" type="button" data-action="tree-update">Update</button> · <label class="link-btn" for="research-file">Add research</label><input type="file" id="research-file" accept=".json,application/json" class="sr-only">' : ''}</p>
    </div>`;
  }
  function countUp() {
    if (REDUCED) return;
    $$('.tree-stats b[data-count]').forEach(el => {
      const end = Number(el.dataset.count), t0 = performance.now();
      if (!end) return;
      (function step(now) {
        const k = Math.min(1, (now - t0) / 1100), v = Math.round(end * (1 - Math.pow(1 - k, 3)));
        el.textContent = v.toLocaleString();
        if (k < 1 && el.isConnected) requestAnimationFrame(step);
      })(t0);
    });
  }
  function treeMeBannerHTML() {
    if (treeMe()) return '';
    let off = false;
    try { off = localStorage.getItem('agraz-tree-me-off') === '1'; } catch (e) {}
    if (off) return '';
    const fullName = T().fold(myName()), first = fullName.split(' ')[0], last = fullName.split(' ').slice(-1)[0];
    const cands = S.tree.model.people.filter(p => {
      const n = T().fold(p.n);
      return n === fullName || (n.split(' ')[0] === first && n.split(' ').slice(-1)[0] === last);
    }).slice(0, 3);
    if (!cands.length) {
      return `<div class="tree-me">${icon('user')}<p><strong>Find yourself in the tree.</strong> Search your name, open your card and tap “This is me” — then the tree shows how everyone is related to you.</p><button class="link-btn" type="button" data-action="tree-me-off">Not now</button></div>`;
    }
    return `<div class="tree-me">${icon('sparkle')}<p><strong>Is this you?</strong> Link yourself and every card shows how you’re related — “your 2nd great-grandmother”, “your first cousin once removed”…</p>
      <span class="tree-me-btns">${cands.map(p => `<button class="btn btn-sm btn-accent" type="button" data-action="tree-me" data-pid="${esc(p.id)}">${esc(p.n)}${T().lifespan(p) ? ` · ${esc(T().lifespan(p))}` : ''}</button>`).join('')}
      <button class="link-btn" type="button" data-action="tree-me-off">Not me</button></span></div>`;
  }

  // ---- the family chart: grandparents, parents, the person and their partners, children ----
  function personCard(pid, size, slot, used) {
    const t = S.tree, p = pid && t.ix.get(pid), g = pid && !p && t.ghosts.get(pid);
    if (g) return `<button type="button" class="tcard ${size} ghost" data-action="tree-ghost" data-gid="${esc(pid)}" data-slot="${slot}" aria-label="Possible ${esc(g.r)}: ${esc(g.n)}">
      <span class="tc-photo"><span class="tc-mono">${esc(initials(g.n))}</span></span><span class="tc-name">${esc(g.n)}</span><span class="tc-years">${esc(lifeOf(g)) || '&nbsp;'}</span><span class="tc-rel">Possible ${esc(g.r)}</span></button>`;
    if (!p) return `<div class="tcard ${size} unknown" data-slot="${slot}" aria-hidden="true"><span class="tc-photo">${icon('user')}</span><span class="tc-name">Not in the tree</span></div>`;
    const photo = photoFor(pid), rel = relShort(relOf(pid));
    const vt = used && !used.has(pid) ? (used.add(pid), vtName(pid)) : '';
    return `<button type="button" class="tcard ${size}${pid === t.focus ? ' is-focus' : ''} sx-${(p.x || 'u').toLowerCase()}${p.L ? ' is-living' : ''}" data-action="tree-focus" data-pid="${esc(pid)}" data-slot="${slot}"${vt ? ` data-vt="${vt}"` : ''} aria-label="${esc(p.n)}${T().lifespan(p) ? `, ${esc(T().lifespan(p))}` : ''}${rel ? `, ${esc(rel)}` : ''}">
      <span class="tc-photo">${photo ? `<img src="${photo}" alt="">` : `<span class="tc-mono">${esc(initials(p.n))}</span>`}</span>
      ${t.research && t.research[pid] ? `<span class="tc-badge" title="Records found">${icon('book')}</span>` : ''}
      <span class="tc-name">${esc(p.n)}</span>
      <span class="tc-years">${esc(T().lifespan(p)) || '&nbsp;'}</span>
      ${rel ? `<span class="tc-rel">${esc(rel)}</span>` : ''}
    </button>`;
  }
  function parentPair(pid) {
    if (!pid) return [null, null];
    const ix = S.tree.ix, ps = ix.parents(pid);
    let fa = ps.find(x => ix.get(x).x === 'M') || null, mo = ps.find(x => ix.get(x).x === 'F') || null;
    ps.forEach(x => { if (x !== fa && x !== mo) { if (!fa) fa = x; else if (!mo) mo = x; } });
    return [fa, mo];
  }

  // ---- possible ancestors: parents the research found that aren't in the tree yet ----
  // Research lists them per person ({ r: 'father', n, b, d, of }); `of` says whose parent they'd
  // be, which lets a chain of them climb several generations above the last person in the tree.
  const NAME_SKIP = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'van', 'von', 'der', 'the', 'and', 'possibly', 'his', 'her', 'iii', 'jr', 'sr']);
  const nameTokens = s => T().fold(String(s || '').replace(/\([^)]*\)/g, ' ')).split(' ').filter(w => w.length > 2 && !NAME_SKIP.has(w));
  // Same person if the first names agree and enough of the rest does too.
  function sameName(a, b) {
    const A = nameTokens(a), B = nameTokens(b);
    if (!A.length || !B.length || !B.includes(A[0]) || !A.includes(B[0])) return false;
    const k = A.filter(w => B.includes(w)).length;
    return k >= Math.min(2, A.length, B.length);
  }
  function ghostParents(id) {
    const t = S.tree, real = t.ix.get(id), g = t.ghosts.get(id);
    const owner = real ? id : g && g.owner, r = owner && t.research[owner];
    if (!r || !r.rel || (real && real.L)) return [null, null];
    const who = real ? real.n : g.n;
    const pick = role => {
      const i = r.rel.findIndex((x, j) => x.r === role && (!g || j !== g.i) && (real ? !x.of || sameName(x.of, who) : x.of && sameName(x.of, who)));
      if (i < 0) return null;
      const gid = `g:${owner}:${i}`;
      if (!t.ghosts.has(gid)) t.ghosts.set(gid, Object.assign({ id: gid, owner, i, child: id }, r.rel[i]));
      return gid;
    };
    return [pick('father'), pick('mother')];
  }
  function parentPairX(id) {
    if (!id) return [null, null];
    if (!S.tree.ix.get(id)) return ghostParents(id);
    const pp = parentPair(id);
    if (pp[0] && pp[1]) return pp;
    const gp = ghostParents(id);
    return [pp[0] || gp[0], pp[1] || gp[1]];
  }
  const personOf = id => S.tree.ix.get(id) || S.tree.ghosts.get(id);
  const lifeOf = p => (!p ? '' : p.owner ? [p.b, p.d].filter(Boolean).join('–') : T().lifespan(p));
  function treeChip(id, note) {
    const q = S.tree.ix.get(id), ph = photoFor(id), r = relShort(relOf(id));
    return `<button class="tchip" type="button" data-action="tree-focus" data-pid="${esc(id)}">${ph ? `<img src="${ph}" alt="">` : `<span class="tc-mono">${esc(initials(q.n))}</span>`}<span><b>${esc(q.n)}</b><small>${esc([note, T().lifespan(q), r].filter(Boolean).join(' · '))}</small></span></button>`;
  }

  // ---- the story under the chart: life & times, and the line between this person and you ----
  function lifeTimes(p) {
    const ix = S.tree.ix, first = firstName(p.n);
    const by = p.b && p.b.y, dy = p.d && p.d.y, now = new Date().getFullYear();
    if (!by) return '';
    const to = dy || (p.L ? now : Math.min(now, by + 90));
    const items = [];
    const add = (y, what, kind) => { if (y && what) items.push({ y, what, kind }); };
    add(by, `Born${!p.L && p.b.p ? ` in ${p.b.p}` : ''}`, 'me');
    if (!p.L) {
      ix.unions(p.id).forEach(u => { const m = u.fam.m, sp = u.spouse && ix.get(u.spouse); if (m && m.y) add(m.y, `Married${sp ? ` ${sp.n}` : ''}${m.p ? ` in ${m.p}` : ''}`, 'me'); });
      ix.children(p.id).forEach(c => { const q = ix.get(c); if (q && q.b && q.b.y) add(q.b.y, `${q.x === 'F' ? 'Daughter' : q.x === 'M' ? 'Son' : 'Child'} ${firstName(q.n)} born`, 'kid'); });
      const seenRes = new Set();
      (p.ev || []).forEach(e => {
        if (!e.y) return;
        if (e.k === 'Residence') { if (seenRes.has(e.p) || seenRes.size >= 4) return; seenRes.add(e.p); add(e.y, `Living in ${e.p}`, 'me'); return; }
        add(e.y, `${e.k}${e.v ? `: ${e.v}` : ''}${e.p ? ` · ${e.p}` : ''}`, 'me');
      });
      if (dy) add(dy, `Died${p.d.p ? ` in ${p.d.p}` : ''}`, 'me');
    }
    T().world(T().regionsOf(p), by + 1, to, p.L ? 6 : 7).forEach(w => add(w.y, w.what, 'world'));
    items.sort((a, b) => a.y - b.y || (a.kind === 'world') - (b.kind === 'world'));
    if (items.length < 2) return '';
    const rows = items.slice(0, 18).map(it => {
      const age = it.y - by;
      return `<li class="lt-${it.kind}"><b>${it.y}</b><div><p>${esc(it.what)}</p>${it.kind === 'world' && age >= 0 ? `<small>${esc(first)} was ${age}</small>` : it.kind !== 'world' && age > 0 ? `<small>age ${age}</small>` : ''}</div></li>`;
    }).join('');
    return `<section class="story-card"><h3>${icon('sunrise')}Life &amp; times<span>${esc(lifeOf(p) || '')}</span></h3><ol class="lt">${rows}</ol></section>`;
  }
  // The shortest line of parents and children between two people (through a shared ancestor if need be).
  function lineBetween(a, b) {
    const ix = S.tree.ix;
    const ups = from => { const prev = new Map([[from, null]]), q = [from]; while (q.length) { const x = q.shift(); ix.parents(x).forEach(pp => { if (!prev.has(pp)) { prev.set(pp, x); q.push(pp); } }); } return prev; };
    const A = ups(a), B = ups(b);
    let best = null, bestLen = Infinity;
    A.forEach((_, x) => { if (!B.has(x)) return; let n = 0; for (let y = x; y; y = A.get(y)) n++; for (let y = x; y; y = B.get(y)) n++; if (n < bestLen) { bestLen = n; best = x; } });
    if (!best) return null;
    const toA = []; for (let y = best; y; y = A.get(y)) toA.push(y);
    const toB = []; for (let y = best; y; y = B.get(y)) toB.push(y);
    return { top: best, path: [...toA.reverse(), ...toB.slice(1)] };
  }
  function lineHTML(p) {
    const me = treeMe(), other = me || HOME_PERSON;
    if (!S.tree.ix.get(other) || other === p.id) return '';
    const line = lineBetween(p.id, other);
    if (!line || line.path.length < 2) return '';
    const who = me ? 'you' : firstName(S.tree.ix.get(other).n), n = line.path.length;
    let ids = line.path;
    const cut = ids.length > 12 ? ids.length - 9 : 0;
    if (cut) ids = [...ids.slice(0, 5), null, ...ids.slice(-4)];
    const steps = ids.map(id => (id ? `<li${id === line.top && line.top !== p.id && line.top !== other ? ' class="ln-top"' : ''}>${treeChip(id, id === line.top && line.top !== p.id && line.top !== other ? 'shared ancestor' : '')}</li>` : `<li class="ln-more"><span>${cut} more generation${cut === 1 ? '' : 's'}</span></li>`)).join('');
    const title = line.top === p.id ? `From ${esc(firstName(p.n))} down to ${esc(who)}` : line.top === other ? `From ${esc(who)} down to ${esc(firstName(p.n))}` : `How ${esc(firstName(p.n))} and ${esc(who)} connect`;
    return `<section class="story-card"><h3>${icon('pedigree')}${title}<span>${n} people</span></h3><ol class="line">${steps}</ol></section>`;
  }
  function findParentsHTML(p) {
    if (p.L || S.tree.ix.parents(p.id).length) return '';
    const q = encodeURIComponent, by = p.b && p.b.y, dy = p.d && p.d.y, place = p.b && p.b.p ? p.b.p.split(',').slice(-2).join(',').trim() : '';
    const fs = `https://www.familysearch.org/search/record/results?q.givenName=${q(p.g || '')}&q.surname=${q(p.s || '')}${by ? `&q.birthLikeDate.from=${by - 2}&q.birthLikeDate.to=${by + 2}` : ''}${place ? `&q.birthLikePlace=${q(place)}` : ''}`;
    const fg = `https://www.findagrave.com/memorial/search?firstname=${q((p.g || '').split(' ')[0])}&lastname=${q(p.s || '')}${by ? `&birthyear=${by}` : ''}${dy ? `&deathyear=${dy}` : ''}`;
    const [gf, gm] = ghostParents(p.id);
    return `<section class="story-card roots-card"><h3>${icon('search')}Where this branch begins</h3>
      <p>The tree doesn’t have ${esc(firstName(p.n))}’s parents yet${by ? ` — ${p.x === 'F' ? 'she' : p.x === 'M' ? 'he' : 'they'} ${p.x ? 'is' : 'are'} the earliest person known on this branch, born ${by}` : ''}.${gf || gm ? ' The research found possible parents — they’re shown dashed in Ancestors.' : ''}</p>
      <div class="roots-links">
        <a class="btn btn-sm btn-ghost-light" href="${esc(fs)}" target="_blank" rel="noopener noreferrer">${icon('external')}Search FamilySearch</a>
        <a class="btn btn-sm btn-ghost-light" href="${esc(fg)}" target="_blank" rel="noopener noreferrer">${icon('external')}Search Find a Grave</a>
      </div></section>`;
  }
  function renderStory() {
    const box = $('#tree-story'), t = S.tree;
    if (!box) return;
    const p = t.ix.get(t.focus);
    box.innerHTML = p ? [findParentsHTML(p), lifeTimes(p), lineHTML(p)].join('') : '';
    box.hidden = !box.innerHTML.trim();
  }
  // No ancestors at all (not even possible ones): the fan gives way to a portrait of where the line starts.
  function renderRoots() {
    const t = S.tree, p = t.ix.get(t.focus), photo = photoFor(t.focus);
    $('#tree-canvas').innerHTML = `<div class="roots">
      <div class="roots-medal">${photo ? `<img src="${photo}" alt="">` : `<span>${esc(initials(p.n))}</span>`}</div>
      <h3>${esc(p.n)}</h3><p class="roots-years">${esc(T().lifespan(p) || (p.L ? 'Living' : ''))}</p>
      <p class="roots-lede">${p.L ? 'No parents are in the tree for this living relative yet.' : `The earliest known ${esc(p.s || 'person')} on this branch. Their parents are still a mystery — the search links below are a good place to start.`}</p>
      <div class="roots-rings" aria-hidden="true"><i></i><i></i><i></i></div>
    </div>`;
  }
  function renderFamily() {
    const t = S.tree, ix = t.ix, f = t.focus, used = new Set();
    const P = parentPairX(f), G = [...parentPairX(P[0]), ...parentPairX(P[1])];
    const unions = ix.unions(f);
    const groups = unions.map((u, k) => ({ k, spouse: u.spouse && ix.get(u.spouse) ? u.spouse : null, kids: u.fam.c.filter(c => ix.get(c)) })).filter(g => g.spouse || g.kids.length);
    const gp = (id, i) => (P[i < 2 ? 0 : 1] ? personCard(id, 'sm', 'g' + i, used) : `<div class="tcard sm void" data-slot="g${i}"></div>`);
    $('#tree-canvas').innerHTML = `<div class="fam-chart" id="fam-chart">
      <svg class="fam-lines" id="fam-lines" aria-hidden="true"></svg>
      <div class="fam-row fam-g2">${G.map(gp).join('')}</div>
      <div class="fam-row fam-g1">${P.map((id, i) => personCard(id, 'md', 'p' + i, used)).join('')}</div>
      <div class="fam-row fam-g0">${personCard(f, 'lg', 'focus', used)}${groups.filter(g => g.spouse).map(g => personCard(g.spouse, 'md', 's' + g.k, used)).join('')}</div>
      ${groups.some(g => g.kids.length) ? `<div class="fam-row fam-kids">${groups.filter(g => g.kids.length).map(g => `
        <div class="kid-group" data-union="${g.k}">${groups.filter(x => x.kids.length).length > 1 ? `<span class="kid-label">with ${g.spouse ? esc(firstName(ix.get(g.spouse).n)) : 'an unknown partner'}</span>` : ''}
          <div class="kid-cards">${g.kids.map((c, j) => personCard(c, 'sm', `k${g.k}-${j}`, used)).join('')}</div>
        </div>`).join('')}</div>` : `<p class="fam-none">No children recorded</p>`}
    </div>`;
    $$('#tree-canvas [data-vt]').forEach(el => { el.style.viewTransitionName = el.dataset.vt; });
    drawFamilyLines();
    if (!treeRO && window.ResizeObserver) { treeRO = new ResizeObserver(() => { if (S.view === 'tree' && S.tree && S.tree.view === 'family') drawFamilyLines(); }); }
    if (treeRO) { treeRO.disconnect(); treeRO.observe($('#fam-chart')); }
  }
  let treeRO = null;
  // Flowing connectors: each pair of parents meets at a point, which branches to their children.
  function drawFamilyLines() {
    const chart = $('#fam-chart'), svg = $('#fam-lines');
    if (!chart || !svg) return;
    const box = chart.getBoundingClientRect();
    if (!box.width) return;
    svg.setAttribute('viewBox', `0 0 ${box.width.toFixed(0)} ${box.height.toFixed(0)}`);
    svg.setAttribute('width', box.width.toFixed(0));
    svg.setAttribute('height', box.height.toFixed(0));
    const el = slot => chart.querySelector(`[data-slot="${slot}"]:not(.void):not(.unknown)`);
    const bottom = e => { const r = e.getBoundingClientRect(); return [r.left - box.left + r.width / 2, r.bottom - box.top + 2]; };
    const top = e => { const r = e.getBoundingClientRect(); return [r.left - box.left + r.width / 2, r.top - box.top - 2]; };
    const paths = [];
    const link = (parents, kids, kind) => {
      const ps = parents.map(el).filter(Boolean), ks = kids.map(el).filter(Boolean);
      if (!ps.length || !ks.length) return;
      const pb = ps.map(bottom), kt = ks.map(top);
      const jx = pb.reduce((s, p) => s + p[0], 0) / pb.length;
      const low = Math.max(...pb.map(p => p[1])), high = Math.min(...kt.map(k => k[1]));
      const jy = low + Math.max(8, (high - low) * 0.42);
      pb.forEach(p => { p[1] = low; });
      pb.forEach(([x, y]) => paths.push([`M${x.toFixed(1)} ${y.toFixed(1)} C${x.toFixed(1)} ${jy.toFixed(1)} ${x.toFixed(1)} ${jy.toFixed(1)} ${jx.toFixed(1)} ${jy.toFixed(1)}`, kind]));
      kt.forEach(([x, y]) => { const my = (jy + y) / 2; paths.push([`M${jx.toFixed(1)} ${jy.toFixed(1)} C${jx.toFixed(1)} ${my.toFixed(1)} ${x.toFixed(1)} ${my.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`, kind]); });
      paths.push([`M${jx.toFixed(1)} ${jy.toFixed(1)} m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0`, kind + ' knot']);
    };
    link(['g0', 'g1'], ['p0'], 'up');
    link(['g2', 'g3'], ['p1'], 'up');
    link(['p0', 'p1'], ['focus'], 'up');
    $$('.kid-group', chart).forEach(g => {
      const k = g.dataset.union;
      link(['focus', 's' + k], $$('[data-slot]', g).map(x => x.dataset.slot), 'down');
    });
    svg.innerHTML = `<defs><linearGradient id="famGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2c478" stop-opacity=".85"/><stop offset="1" stop-color="#e58c63" stop-opacity=".55"/></linearGradient></defs>` +
      paths.map(([d, kind], i) => `<path class="fl ${kind} d${Math.min(i, 9)}" d="${d}" pathLength="1"/>`).join('');
  }

  // ---- the ancestor fan: up to six generations around the chosen person ----
  function renderFan() {
    const t = S.tree, ix = t.ix, cx = 380, cy = 380;
    const RAD = Math.PI / 180, F = n => n.toFixed(1);
    const at = (r, a) => [cx + r * Math.sin(a * RAD), cy - r * Math.cos(a * RAD)];
    const A = { 1: t.focus };
    for (let k = 1; k < 2 ** 6; k++) { if (!A[k]) continue; const [fa, mo] = parentPairX(A[k]); if (fa) A[2 * k] = fa; if (mo) A[2 * k + 1] = mo; }
    const deepest = Math.max(...Object.keys(A).map(k => Math.floor(Math.log2(k))));
    if (!deepest) { renderRoots(); return; }
    // Only as many rings as there are ancestors (plus one to grow into), widened to fill the fan.
    const GENS = Math.min(6, deepest + 1), W = [62, 54, 50, 44, 38, 32].slice(0, GENS), k0 = 280 / W.reduce((a, b) => a + b, 0);
    const R = W.reduce((r, w) => (r.push(r[r.length - 1] + w * k0), r), [72]).map(Math.round);
    const ghosts = Object.values(A).filter(id => !ix.get(id)).length;
    const HUES = { 4: 18, 5: 38, 6: 168, 7: 210 }, G1 = { 2: 22, 3: 180 };
    let segs = '', defs = '', labels = '';
    for (let g = 1; g <= GENS; g++) {
      const n = 2 ** g, span = 240 / n, r1 = R[g - 1], r2 = R[g];
      for (let j = 0; j < n; j++) {
        const k = n + j, pid = A[k], a1 = -120 + j * span, a2 = a1 + span;
        const [x1, y1] = at(r2, a1), [x2, y2] = at(r2, a2), [x3, y3] = at(r1, a2), [x4, y4] = at(r1, a1);
        const d = `M${F(x1)} ${F(y1)}A${r2} ${r2} 0 0 1 ${F(x2)} ${F(y2)}L${F(x3)} ${F(y3)}A${r1} ${r1} 0 0 0 ${F(x4)} ${F(y4)}Z`;
        if (!pid) { segs += `<path class="fan-seg vacant fan-g${g}" d="${d}"/>`; continue; }
        const ghost = !ix.get(pid), p = personOf(pid);
        const hue = g === 1 ? G1[k] : HUES[k >> (g - 2)];
        const tip = `${ghost ? 'Possible ancestor: ' : ''}${p.n}${lifeOf(p) ? ` (${lifeOf(p)})` : ''}`;
        segs += ghost ? `<path class="fan-seg ghost fan-g${g}" data-action="tree-ghost" data-gid="${esc(pid)}" d="${d}"><title>${esc(tip)}</title></path>`
          : `<path class="fan-seg fan-g${g} hue-${hue}" data-action="tree-focus" data-pid="${esc(pid)}" d="${d}"><title>${esc(tip)}</title></path>`;
        const mid = (a1 + a2) / 2, rm = (r1 + r2) / 2;
        if (g <= 4) {
          // names follow the arc; on the lower half the arc is drawn the other way so text stays upright
          const flip = Math.abs(mid) > 90;
          const id = `fa${k}`, rr = rm + (g <= 2 ? 6 : 3);
          const [sx, sy] = at(rr, flip ? a2 : a1), [ex, ey] = at(rr, flip ? a1 : a2);
          defs += `<path id="${id}" d="M${F(sx)} ${F(sy)}A${F(rr)} ${F(rr)} 0 0 ${flip ? 0 : 1} ${F(ex)} ${F(ey)}"/>`;
          const arcLen = (span * RAD) * rr, fs = g === 1 ? 15 : g === 2 ? 13 : g === 3 ? 11.5 : 10;
          const max = Math.max(3, Math.floor(arcLen / (fs * 0.56)) - 1);
          const name = g >= 3 ? (g === 4 ? firstName(p.n) : `${firstName(p.n)} ${p.s || ''}`.trim()) : p.n;
          labels += `<text class="fan-name g${g}${ghost ? ' ghost' : ''}"><textPath href="#${id}" startOffset="50%">${esc(name.length > max ? name.slice(0, max - 1) + '…' : name)}</textPath></text>`;
          if (g <= 3) {
            const id2 = `fy${k}`, ry = rm - (g <= 2 ? 12 : 10);
            const [sx2, sy2] = at(ry, flip ? a2 : a1), [ex2, ey2] = at(ry, flip ? a1 : a2);
            defs += `<path id="${id2}" d="M${F(sx2)} ${F(sy2)}A${F(ry)} ${F(ry)} 0 0 ${flip ? 0 : 1} ${F(ex2)} ${F(ey2)}"/>`;
            labels += `<text class="fan-years g${g}"><textPath href="#${id2}" startOffset="50%">${esc(ghost ? 'possible' + (lifeOf(p) ? ' · ' + lifeOf(p) : '') : lifeOf(p))}</textPath></text>`;
          }
        } else if (g === 5) {
          const [tx, ty] = at(rm, mid), rot = mid > 0 ? mid - 90 : mid + 90;
          const nm = firstName(p.n);
          labels += `<text class="fan-name g5${ghost ? ' ghost' : ''}" transform="translate(${F(tx)} ${F(ty)}) rotate(${F(rot)})">${esc(nm.length > 8 ? nm.slice(0, 7) + '…' : nm)}</text>`;
        }
      }
    }
    const fp = ix.get(t.focus), photo = photoFor(t.focus);
    const count = Object.keys(A).length - 1 - ghosts;
    $('#tree-canvas').innerHTML = `<div class="fan-wrap">
      <svg class="fan" viewBox="0 0 760 572" role="img" aria-label="Ancestors of ${esc(fp.n)}: ${count} in the tree${ghosts ? ` and ${ghosts} possible from research` : ''}">
        <defs>${defs}<clipPath id="fanClip"><circle cx="${cx}" cy="${cy}" r="${R[0] - 6}"/></clipPath>
          <radialGradient id="fanGlow"><stop offset="0" stop-color="#f2c478" stop-opacity=".35"/><stop offset="1" stop-color="#f2c478" stop-opacity="0"/></radialGradient></defs>
        <circle cx="${cx}" cy="${cy}" r="${R[0] + 30}" fill="url(#fanGlow)"/>
        ${segs}${labels}
        <circle class="fan-core" cx="${cx}" cy="${cy}" r="${R[0] - 2}"/>
        ${photo ? `<image href="${photo}" x="${cx - R[0] + 6}" y="${cy - R[0] + 6}" width="${(R[0] - 6) * 2}" height="${(R[0] - 6) * 2}" clip-path="url(#fanClip)" preserveAspectRatio="xMidYMid slice"/>`
        : `<text class="fan-mono" x="${cx}" y="${cy + 12}">${esc(initials(fp.n))}</text>`}
        <text class="fan-focus" x="${cx}" y="${cy + R[0] + 34}">${esc(fp.n)}</text>
        <text class="fan-focus-years" x="${cx}" y="${cy + R[0] + 56}">${esc(T().lifespan(fp))}</text>
      </svg>
      <p class="fan-legend"><span class="lgi"><span class="lg p"></span>Father’s side</span><span class="lgi"><span class="lg m"></span>Mother’s side</span>${ghosts ? '<span class="lgi"><span class="lg g"></span>Possible, from research</span>' : ''}<span class="lgi">Tap anyone to step back in time</span></p>
    </div>`;
  }

  // ---- the profile ----
  function renderPanel() {
    const t = S.tree, ix = t.ix, pid = t.focus, p = ix.get(pid);
    if (t.ghost && t.ghosts.get(t.ghost)) { renderGhostPanel(t.ghosts.get(t.ghost)); return; }
    if (!p) { $('#tree-panel').innerHTML = ''; return; }
    const photo = photoFor(pid), rel = relLong(relOf(pid)), me = treeMe();
    const ev = e => (e ? [e.d, e.p].filter(Boolean).join(' · ') : '');
    const fact = (ico, label, value) => (value ? `<div class="tp-fact">${icon(ico)}<div><dt>${label}</dt><dd>${esc(value)}</dd></div></div>` : '');
    const chip = id => treeChip(id);
    const group = (title, ids, extra) => (ids.length ? `<section class="tp-group"><h3>${title}<span>${ids.length}</span></h3><div class="tp-chips">${ids.map((id, i) => chip(id) + (extra ? extra(id, i) : '')).join('')}</div></section>` : '');
    const unions = ix.unions(pid).filter(u => u.spouse && ix.get(u.spouse));
    const marriage = (id, i) => { const u = unions[i], m = u && u.fam.m; return m || (u && u.fam.dv) ? `<p class="tp-marr">${m ? `Married ${esc(ev(m))}` : ''}${u.fam.dv ? `${m ? ' · ' : ''}Divorced` : ''}</p>` : ''; };
    const age = !p.L && p.b && p.b.y && p.d && p.d.y ? p.d.y - p.b.y : null;
    const own = t.photos[pid];
    const canPhoto = !!S.user;
    $('#tree-panel').innerHTML = `
      <div class="tp-hero${photo ? ' has-photo' : ''}">
        ${photo ? `<img class="tp-img" src="${photo}" alt="${esc(p.n)}">` : `<span class="tp-mono">${esc(initials(p.n))}</span>`}
        ${canPhoto ? `<button class="tp-photo-btn" type="button" data-action="tree-photo" data-pid="${esc(pid)}">${icon('image')}${own ? 'Change photo' : photo ? 'Use a different photo' : 'Add a photo'}</button>` : ''}
      </div>
      <div class="tp-body">
        <h2 class="tp-name">${esc(p.n)}</h2>
        ${p.aka ? `<p class="tp-aka">Also recorded as ${esc(p.aka.join(' · '))}</p>` : ''}
        <p class="tp-years">${esc(T().lifespan(p) || (p.L ? 'Living' : ''))}${age != null ? ` · ${age} years` : ''}</p>
        ${rel ? `<p class="tp-rel">${icon(rel === 'This is you' ? 'user' : 'heart')}${esc(rel)}</p>` : ''}
        <dl class="tp-facts">${fact('cake', p.L ? 'Born' : 'Born', p.L ? (p.b ? p.b.d : '') : ev(p.b))}${fact('candle', 'Died', ev(p.d) + (p.d && p.d.c ? ` — ${p.d.c}` : ''))}${fact('pin', 'Resting place', p.bu)}${p.r ? fact('home', 'Lived in', p.r.map(r => r.p + (r.y ? ` (${r.y})` : '')).join(' · ')) : ''}</dl>
        ${group('Parents', ix.parents(pid))}
        ${group(unions.length > 1 ? 'Partners' : 'Partner', unions.map(u => u.spouse), marriage)}
        ${group('Children', ix.children(pid))}
        ${group('Brothers &amp; sisters', ix.siblings(pid))}
        ${p.nt ? `<section class="tp-group tp-notes"><h3>${icon('note')}Notes</h3><p class="tp-nt">${esc(p.nt)}</p></section>` : ''}
        ${mediaHTML(p)}
        ${recordsHTML(p)}
        ${researchHTML(pid)}
        <div class="tp-actions">
          ${!me ? `<button class="btn btn-sm btn-ghost" type="button" data-action="tree-me" data-pid="${esc(pid)}">${icon('user')}This is me</button>`
          : me === pid ? `<button class="link-btn" type="button" data-action="tree-unme">That’s not me</button>` : ''}
          ${own && (own.uid === S.user.uid || isAdmin()) ? `<button class="link-btn danger-link" type="button" data-action="tree-photo-remove" data-pid="${esc(pid)}">Remove photo</button>` : ''}
        </div>
        ${p.L ? `<p class="tp-note">${icon('shield')}Living relative — only the birth year is kept here.</p>` : ''}
      </div>`;
  }

  // ---- everything else from the Ancestry export: photos & documents, and records ----
  const MEDIA_KIND = { portrait: ['image', 'Photo'], photo: ['image', 'Photo'], document: ['note', 'Document'], headstone: ['candle', 'Headstone'],
    story: ['book', 'Story'], immigration: ['globe', 'Immigration'], place: ['pin', 'Place'], other: ['image', 'Item'], file: ['note', 'File'] };
  const more = (items, n, label) => (items.length > n ? `<button class="link-btn tp-more" type="button" data-action="tp-more">${icon('chev-d')}Show all ${items.length} ${label}</button>` : '');
  function mediaHTML(p) {
    if (!p.md) return '';
    const rows = p.md.map((m, i) => {
      const k = MEDIA_KIND[m.k] || MEDIA_KIND.other, link = safeUrl(m.u);
      return `<li class="tmedia${i >= 4 ? ' tp-extra' : ''}"><span class="tm-ico">${icon(k[0])}</span><div><p>${link ? extLink(link, m.t) : esc(m.t)}${m.m ? ' <span class="conf h">Main photo</span>' : ''}</p><small>${esc(k[1])}${link ? ' · saved from the web' : ' · in the family’s Ancestry tree'}</small>${m.d ? `<p class="tm-about">${esc(m.d)}</p>` : ''}</div></li>`;
    }).join('');
    const pics = p.md.filter(m => /portrait|photo|headstone|place|other/.test(m.k)).length;
    return `<section class="tp-group tp-docs"><h3>${icon('image')}Photos &amp; documents<span>${p.md.length}</span></h3>
      <ul class="rlist">${rows}</ul>${more(p.md, 4, 'photos & documents')}
      ${pics && !S.tree.photos[p.id] ? `<p class="tp-note">${icon('sparkle')}<span>The pictures themselves are kept in the family’s Ancestry tree. Download them there, then tap <b>Add a photo</b> above — or drop a whole folder into <b>Add photos</b> and each is matched to the right person.</span></p>` : ''}
    </section>`;
  }
  const RECORD_ICON = [[/census/i, 'users'], [/death|burial|grave|cemetery|funeral/i, 'candle'], [/birth|baptism|christening/i, 'cake'], [/marriage/i, 'heart'],
    [/border|passenger|immigra|naturali|arrival|crossing|passport/i, 'globe'], [/military|draft|army|navy|veteran|war/i, 'shield'],
    [/newspaper|obituar/i, 'note'], [/directory|address|phone/i, 'book']];
  function recordsHTML(p) {
    if (!p.src) return '';
    const rows = p.src.map((r, i) => {
      const ico = (RECORD_ICON.find(([re]) => re.test(r.t)) || [0, 'book'])[1];
      const links = safeUrl(r.u) ? extLink(r.u, /newspapers\.com/.test(r.u) ? 'See the newspaper' : 'Open the page') : '';
      return `<li class="trec${i >= 5 ? ' tp-extra' : ''}"><span class="tm-ico">${icon(ico)}</span><div><p>${esc(r.t)}</p>${r.p ? `<small>${esc(r.p)}</small>` : ''}${r.e || links ? `<small>${r.e ? `Shows: ${esc(r.e)}` : ''}${r.e && links ? ' · ' : ''}${links}</small>` : ''}</div></li>`;
    }).join('');
    return `<section class="tp-group tp-records"><h3>${icon('book')}Records<span>${p.src.length}</span></h3><ul class="rlist">${rows}</ul>${more(p.src, 5, 'records')}</section>`;
  }
  function renderGhostPanel(g) {
    const t = S.tree, child = personOf(g.child), conf = { h: 'Confirmed', m: 'Likely', l: 'Possible' }[g.c] || 'Possible';
    $('#tree-panel').innerHTML = `
      <div class="tp-hero tp-ghost"><span class="tp-mono">${esc(initials(g.n))}</span></div>
      <div class="tp-body">
        <h2 class="tp-name">${esc(g.n)}</h2>
        <p class="tp-years">${esc(lifeOf(g) || 'Dates unknown')}</p>
        <p class="tp-rel">${icon('sparkle')}Possible ${esc(g.r)} of ${esc(child ? child.n : g.of || '')}</p>
        <dl class="tp-facts">
          <div class="tp-fact">${icon('check')}<div><dt>How sure</dt><dd><span class="conf ${esc(g.c || 'l')}">${conf}</span></dd></div></div>
          ${g.w ? `<div class="tp-fact">${icon('note')}<div><dt>Why we think so</dt><dd>${esc(g.w)}</dd></div></div>` : ''}
          ${g.s || g.u ? `<div class="tp-fact">${icon('book')}<div><dt>Source</dt><dd>${extLink(g.u, g.s || 'Source')}</dd></div></div>` : ''}
        </dl>
        <p class="tp-note">${icon('sparkle')}Found by research in public records — not in the family’s Ancestry tree yet. If it checks out, add them on Ancestry and update the tree here.</p>
        <div class="tp-actions"><button class="btn btn-sm btn-ghost" type="button" data-action="tree-focus" data-pid="${esc(t.focus)}">${icon('arrow-l')}Back to ${esc(firstName(t.ix.get(t.focus).n))}</button></div>
      </div>`;
  }

  // ---- "From the archives": research gathered from public records ----
  const KIND = { grave: ['candle', 'Grave'], obituary: ['note', 'Obituary'], newspaper: ['note', 'Newspaper'], census: ['users', 'Census'], baptism: ['sparkle', 'Baptism'],
    marriage: ['heart', 'Marriage'], military: ['shield', 'Military'], immigration: ['globe', 'Immigration'], naturalization: ['globe', 'Naturalization'], church: ['book', 'Church record'],
    book: ['book', 'Book'], photo: ['image', 'Photo'], portrait: ['image', 'Portrait'], other: ['external', 'Record'] };
  const FACT = { birth: 'Born', death: 'Died', burial: 'Buried', marriage: 'Married', residence: 'Lived', occupation: 'Work', immigration: 'Arrived', military: 'Served', biography: 'Story', other: 'Note' };
  const CONF = { h: ['h', 'Confirmed'], m: ['m', 'Likely'], l: ['l', 'Possible'] };
  // https only — and never Ancestry (the family asked for no links out to it).
  const safeUrl = u => (/^https:\/\/[^\s"'<>]+$/.test(String(u || '')) && !/^https:\/\/([^/]+\.)?ancestry\.[a-z.]+(\/|$)/i.test(String(u)) ? String(u) : '');
  const extLink = (u, text) => (safeUrl(u) ? `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener noreferrer">${esc(text || 'Source')}</a>` : esc(text || ''));
  function researchHTML(pid) {
    const r = S.tree.research && S.tree.research[pid];
    if (!r) return '';
    const conf = c => { const k = CONF[c] || CONF.l; return `<span class="conf ${k[0]}">${k[1]}</span>`; };
    const docs = (r.doc || []).map(d => { const k = KIND[d.k] || KIND.other; return `<li class="rdoc">${icon(k[0])}<div>${extLink(d.u, d.t || k[1])}<small>${esc(k[1])}${d.l ? ` · ${esc(d.l)}` : ''}${d.n ? ` · ${esc(d.n)}` : ''}</small></div></li>`; }).join('');
    const facts = (r.f || []).map(f => `<li class="rfact"><span class="rlabel">${esc(FACT[f.t] || 'Note')}</span><div><p>${esc(f.v)} ${conf(f.c)}${f.d ? ' <span class="conf x">Differs from the tree</span>' : ''}</p><small>${extLink(f.u, f.s)}</small></div></li>`).join('');
    const rels = (r.rel || []).map(x => `<li class="rrel"><span class="rlabel">Possible ${esc(x.r)}</span><div><p><b>${esc(x.n)}</b>${x.b || x.d ? ` · ${esc([x.b, x.d].filter(Boolean).join('–'))}` : ''} ${conf(x.c)}</p>${x.of ? `<small class="rof">${esc(capFirst(x.r))} of ${esc(x.of)}</small>` : ''}<small>${x.w ? `${esc(x.w)} · ` : ''}${extLink(x.u, x.s)}</small></div></li>`).join('');
    const count = (r.doc || []).length + (r.f || []).length + (r.rel || []).length;
    return `<section class="tp-group tp-research"><h3>${icon('book')}From the archives<span>${count}</span></h3>
      ${docs ? `<ul class="rlist">${docs}</ul>` : ''}
      ${facts ? `<ul class="rlist">${facts}</ul>` : ''}
      ${rels ? `<ul class="rlist">${rels}</ul><p class="tp-note">${icon('sparkle')}Not in the tree yet — if it checks out, add it on Ancestry and update the tree here.</p>` : ''}
      ${r.sv && r.sv.length ? `<p class="rsv"><b>Named in the obituary:</b> ${esc(r.sv.join(' · '))}</p>` : ''}
      ${r.note ? `<p class="rsv">${esc(r.note)}</p>` : ''}
    </section>`;
  }
  // A research file (from a research pass over public records): { kind: 'agraz-research', people: { id: { f, doc, rel, sv, note } } }
  async function saveResearch(data) {
    if (!data || data.kind !== 'agraz-research' || typeof data.people !== 'object') throw new Error('shape');
    const cut = (v, n) => String(v == null ? '' : v).slice(0, n);
    const people = {};
    Object.entries(data.people).forEach(([pid, r]) => {
      if (!S.tree.ix.get(pid) || S.tree.ix.get(pid).L || !r) return; // only people in the tree who have passed
      const out = {};
      const f = (r.f || []).filter(x => x && x.v).slice(0, 30).map(x => ({ t: cut(x.t, 20), v: cut(x.v, 400), s: cut(x.s, 160), u: safeUrl(x.u), c: ['h', 'm', 'l'].includes(x.c) ? x.c : 'l', d: x.d ? 1 : 0 }));
      const doc = (r.doc || []).filter(x => x && safeUrl(x.u)).slice(0, 30).map(x => ({ k: cut(x.k, 20), t: cut(x.t, 200), u: safeUrl(x.u), l: cut(x.l, 80), n: cut(x.n, 200) }));
      const rel = (r.rel || []).filter(x => x && x.n).slice(0, 12).map(x => Object.assign({ r: cut(x.r, 20), n: cut(x.n, 120), b: cut(x.b, 40), d: cut(x.d, 40), s: cut(x.s, 160), u: safeUrl(x.u), c: ['h', 'm', 'l'].includes(x.c) ? x.c : 'l', w: cut(x.w, 300) }, x.of ? { of: cut(x.of, 120) } : {}));
      const sv = (r.sv || []).slice(0, 30).map(x => cut(x, 120)).filter(Boolean);
      if (f.length) out.f = f; if (doc.length) out.doc = doc; if (rel.length) out.rel = rel; if (sv.length) out.sv = sv;
      if (r.note) out.note = cut(r.note, 600);
      if (Object.keys(out).length) people[pid] = out;
    });
    const count = Object.keys(people).length;
    if (count) {
      await col('tree').doc('research').set({ people, count, createdAt: nowIso(), by: myName().slice(0, 80) });
      S.tree.research = people;
    }
    return count;
  }
  async function importResearch(file) {
    try {
      const count = await saveResearch(JSON.parse(await file.text()));
      if (!count) { toast('Nothing in that file matches people in this tree.', true); return; }
      renderTree();
      toast(`Research added for ${count} ${count === 1 ? 'person' : 'people'} — look for “From the archives”`);
    } catch (e) {
      toast(denied(e) ? NEED_RULES : 'That file isn’t a research file for this tree.', true);
    }
  }

  // ---- search ----
  function treeSearch() {
    const q = $('#tree-search').value, list = $('#tree-results');
    const found = S.tree && S.tree.ix ? T().search(S.tree.ix, q, 10) : [];
    list.hidden = !found.length && !q.trim();
    $('#tree-search').setAttribute('aria-expanded', String(!list.hidden));
    list.innerHTML = found.length ? found.map((p, i) => {
      const ph = photoFor(p.id), r = relShort(relOf(p.id));
      return `<li role="option" id="tr-${i}"><button type="button" data-action="tree-focus" data-pid="${esc(p.id)}">${ph ? `<img src="${ph}" alt="">` : `<span class="tc-mono">${esc(initials(p.n))}</span>`}<span><b>${esc(p.n)}</b><small>${esc([T().lifespan(p), r].filter(Boolean).join(' · '))}</small></span></button></li>`;
    }).join('') : q.trim() ? '<li class="tr-none">Nobody by that name in the tree</li>' : '';
  }
  $('#tree-search').addEventListener('input', treeSearch);
  $('#tree-search').addEventListener('keydown', e => {
    if (e.key === 'Escape') { $('#tree-results').hidden = true; e.target.value = ''; }
    if (e.key === 'Enter') { const b = $('#tree-results button'); if (b) { e.preventDefault(); treeFocus(b.dataset.pid); e.target.value = ''; } }
    if (e.key === 'ArrowDown') { const b = $('#tree-results button'); if (b) { e.preventDefault(); b.focus(); } }
  });
  $('#tree-results').addEventListener('keydown', e => {
    const bs = $$('#tree-results button'), i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < bs.length - 1) { e.preventDefault(); bs[i + 1].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (i > 0) bs[i - 1].focus(); else $('#tree-search').focus(); }
  });
  document.addEventListener('click', e => { if (!e.target.closest('.tree-find')) { const l = $('#tree-results'); if (l && !l.hidden) l.hidden = true; } });

  // ---- "this is me" ----
  async function linkMe(pid) {
    try {
      await col('users').doc(S.user.uid).update({ treeId: pid });
      S.me.treeId = pid;
      if (S.byUid[S.user.uid]) S.byUid[S.user.uid].treeId = pid;
      S.tree.relCache = new Map();
      if (pid) { S.tree.focus = pid; toast('Linked — every card now shows how you’re related'); } else toast('Unlinked');
      renderTree();
    } catch (e) {
      toast(denied(e) ? NEED_RULES : 'Couldn’t save that. Please try again.', true);
    }
  }

  // ---- importing (admins) ----
  function treeImportHTML(updating) {
    if (!isAdmin()) return emptyHTML('pedigree', 'The family tree is on its way', 'Once a family admin adds it from Ancestry, everyone will be here — with photos, stories and how you’re all related.');
    return `<div class="tree-import card">
      <div class="ti-art" aria-hidden="true">${icon('pedigree')}</div>
      <div class="ti-text">
        <h2>${updating ? 'Update the family tree' : 'Bring in the family tree'}</h2>
        <p class="muted">Choose the file you exported from Ancestry — the <b>.zip</b> it gives you is fine (or the <b>.ged</b> inside). It’s read right here in your browser, then saved privately for the family.</p>
        <ol class="mini-steps"><li>On Ancestry, open your tree → <b>Tree settings</b> → <b>Export tree</b>, then download the file.</li><li>Choose that file below.</li></ol>
        <label class="match-drop ti-drop" for="tree-file">${icon('upload')}<strong>Choose the family tree file</strong><span>.zip or .ged from Ancestry</span></label>
        <input type="file" id="tree-file" accept=".zip,.ged" class="sr-only">
        <div id="tree-preview"></div>
        <p class="tp-note">${icon('shield')}Living relatives are saved with their birth year only — no birthdays or places.</p>
        ${updating ? '<button class="link-btn" type="button" data-action="tree-update-cancel">Cancel</button>' : ''}
      </div>
    </div>`;
  }
  async function previewImport(file) {
    const box = $('#tree-preview');
    if (!file || !box) return;
    box.innerHTML = `<p class="muted">Reading ${esc(file.name)}…</p>`;
    try {
      await loadTreeLib();
      const model = T().parse(await T().readFile(file));
      if (!model.people.length) throw new Error('empty');
      S.treeDraft = model;
      box.innerHTML = `<div class="ti-preview">
        <p><strong>${model.people.length.toLocaleString()} people</strong> in “${esc(model.name || file.name)}” — ${model.families.length.toLocaleString()} families, ${model.generations} generations${model.earliest ? `, back to ${model.earliest}` : ''}. ${model.portraits ? `${model.portraits} have photos on Ancestry you can add next.` : ''}</p>
        <button class="btn btn-accent" type="button" data-action="tree-import-go" id="tree-import-go">${icon('check')}${S.tree && S.tree.status === 'ready' ? 'Replace the tree' : 'Add the tree'}</button>
      </div>`;
    } catch (e) {
      S.treeDraft = null;
      box.innerHTML = `<p class="form-msg">That doesn’t look like a family tree export. Choose the .zip or .ged file from Ancestry.</p>`;
    }
  }
  async function saveTree(model) {
    const parts = T().chunk(model);
    const before = S.tree && S.tree.meta ? S.tree.meta.parts || 0 : 0;
    const meta = { v: model.v || 1, name: (model.name || 'Family tree').slice(0, 80), treeId: model.treeId || '', source: (model.source || 'GEDCOM').slice(0, 40),
      people: model.people.length, families: model.families.length, portraits: model.portraits || 0, earliest: model.earliest || null,
      generations: model.generations || 0, parts: parts.length, importedAt: nowIso(), importedBy: myName().slice(0, 80) };
    const b = db.batch();
    b.set(col('tree').doc('meta'), meta);
    parts.forEach((p, i) => b.set(col('tree').doc('part' + i), p));
    for (let i = parts.length; i < before; i++) b.delete(col('tree').doc('part' + i));
    await b.commit();
    setTreeModel(meta, Object.assign({}, meta, { people: model.people, families: model.families }));
  }
  async function importTree(btn) {
    const model = S.treeDraft;
    if (!model) return;
    busy(btn, true, 'Saving the tree…');
    try {
      await saveTree(model);
      S.treeDraft = null;
      renderTree();
      toast(`The family tree is in — ${model.people.length.toLocaleString()} relatives`);
      celebrate($('.tree-stats'));
    } catch (e) {
      busy(btn, false);
      toast(denied(e) ? NEED_RULES : 'Couldn’t save the tree. Please try again.', true);
    }
  }

  // ---- one-tap import from a private link (admins) ----
  // The tree (and its research) can ship on the site as /assets/data/tree-import.bin, locked with
  // AES-256-GCM. The key only travels in a private link, /family/#tree?key=… — the part of an
  // address after # is never sent to any server, and it's wiped from the address bar on arrival.
  const LOCKED_TREE = '/assets/data/tree-import.bin';
  async function openLocked(key) {
    let raw;
    try { raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); } catch (e) { raw = []; }
    if (raw.length !== 32) throw new Error('key');
    const res = await fetch(LOCKED_TREE + ASSET_V, { cache: 'no-store' });
    if (!res.ok) throw new Error('gone');
    const buf = new Uint8Array(await res.arrayBuffer());
    let plain;
    try {
      const k = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, k, buf.slice(12));
    } catch (e) { throw new Error('key'); }
    const data = JSON.parse(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
    if (!data || data.kind !== 'agraz-tree' || !data.tree || !Array.isArray(data.tree.people) || !data.tree.people.length) throw new Error('shape');
    return data;
  }
  async function unlockTree(key) {
    const t = S.tree || {};
    if (t.status === 'denied' || t.status === 'error') return; // the page already says what's wrong
    if (!isAdmin()) { toast('Only a family admin can add the family tree.', true); return; }
    if (S.view === 'tree') {
      $('#tree-head').hidden = true;
      $('#tree-body').innerHTML = `<div class="tree-import card tree-unlock" aria-live="polite">
        <div class="ti-art" aria-hidden="true">${icon('pedigree')}</div>
        <div class="ti-text"><h2>Bringing in the family tree…</h2><p class="muted" id="unlock-msg">Unlocking it right here in your browser.</p></div>
      </div>`;
    }
    const say = m => { const el = $('#unlock-msg'); if (el) el.textContent = m; };
    try {
      await loadTreeLib();
      const data = await openLocked(key);
      // A newer reading of the export (more of it harvested) replaces the saved tree; photos,
      // research and everyone's “This is me” stay as they are.
      const newer = t.status !== 'ready' || (t.meta.v || 1) < (data.tree.v || 1);
      const hadResearch = t.research && Object.keys(t.research).length;
      if (!newer && (hadResearch || !data.research)) { toast('The family tree is already up to date'); return; }
      if (newer) { say(`Saving ${data.tree.people.length.toLocaleString()} relatives privately for the family…`); await saveTree(data.tree); }
      let found = 0;
      if (data.research) { say('Adding what was found in the archives…'); found = await saveResearch(data.research); }
      const n = S.tree.model.people.length.toLocaleString();
      toast(newer ? `The family tree is in — ${n} relatives${found ? `, with research for ${found}` : ''}` : `Research added for ${found} ${found === 1 ? 'person' : 'people'} — look for “From the archives”`);
    } catch (e) {
      const why = denied(e) ? NEED_RULES
        : e.message === 'key' ? 'That link didn’t unlock the tree — check you opened the whole link.'
        : e.message === 'gone' ? 'That link has expired. The tree can still be added from the Ancestry file below.'
        : 'Couldn’t bring in the tree. Check your connection and open the link again.';
      toast(why, true);
    }
  }

  // ---- photos for one person ----
  async function saveTreePhoto(pid, file) {
    try {
      const img = await compressImage(file, 320, 0.84, 85000, true);
      await col('treePhotos').doc(pid).set({ img, uid: S.user.uid, by: myName().slice(0, 80), createdAt: nowIso() });
      S.tree.photos[pid] = { img, uid: S.user.uid };
      paintTree(false);
      toast('Photo added to the tree');
    } catch (e) {
      toast(denied(e) ? 'Only the person who added this photo (or an admin) can change it.' : 'That photo couldn’t be used — try another one.', true);
    }
  }
  async function removeTreePhoto(pid) {
    if (!(await confirmBox('Remove this photo?', 'It will be removed from the family tree for everyone.', 'Remove'))) return;
    try {
      await col('treePhotos').doc(pid).delete();
      delete S.tree.photos[pid];
      paintTree(false);
      toast('Photo removed');
    } catch (e) { toast('Couldn’t remove it. Please try again.', true); }
  }
  $('#tree-photo-input').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f && S.tree && S.tree.photoTarget) saveTreePhoto(S.tree.photoTarget, f);
  });

  // ---- matching a whole folder of photos to people (admins) ----
  const matcher = { rows: [], fn: null };
  const HOW = {
    exact: 'Exact match — the same photo as on Ancestry',
    title: 'Matched by its Ancestry title',
    name: 'Matched by the name in the file name',
    dims: 'Matched by its size',
    picked: 'You chose this person',
    dup: 'Another photo matched this person too — choose who this is',
    none: 'No match yet — who is this?',
    bad: 'This photo can’t be read here (try a JPEG or PNG)'
  };
  function openMatcher() {
    if (!S.tree || !S.tree.model) return;
    matcher.rows = [];
    matcher.fn = T().photoMatcher(S.tree.model);
    renderMatcher();
    $('#match-dialog').showModal();
  }
  async function addMatchFiles(files) {
    const rank = { exact: 4, title: 3, name: 2, dims: 1 };
    for (const f of Array.from(files || [])) {
      if (!/^image\//.test(f.type) && !/\.(jpe?g|png|gif|webp|bmp)$/i.test(f.name)) continue;
      const row = { file: f, name: f.name, size: f.size, w: 0, h: 0, thumb: '', pid: null, how: 'none' };
      try {
        const img = await decodeImage(f);
        row.w = img.naturalWidth; row.h = img.naturalHeight;
        const c = document.createElement('canvas'), s = Math.min(row.w, row.h);
        c.width = c.height = 96;
        c.getContext('2d').drawImage(img, (row.w - s) / 2, (row.h - s) / 3, s, s, 0, 0, 96, 96);
        row.thumb = c.toDataURL('image/jpeg', 0.7);
      } catch (e) { row.how = 'bad'; matcher.rows.push(row); continue; }
      const m = matcher.fn({ name: f.name, size: f.size, w: row.w, h: row.h });
      if (m) {
        const clash = matcher.rows.find(r => r.pid === m.pid);
        if (clash && rank[clash.how] >= rank[m.how]) row.how = 'dup';
        else { if (clash) { clash.pid = null; clash.how = 'dup'; } row.pid = m.pid; row.how = m.how; }
      }
      matcher.rows.push(row);
    }
    renderMatcher();
  }
  function renderMatcher() {
    const ix = S.tree.ix, rows = matcher.rows;
    $('#match-list').innerHTML = rows.map((r, i) => {
      const p = r.pid && ix.get(r.pid);
      return `<div class="mrow ${p ? 'ok' : r.how === 'bad' ? 'bad' : 'todo'}">
        ${r.thumb ? `<img class="mthumb" src="${r.thumb}" alt="">` : `<span class="mthumb">${icon('image')}</span>`}
        <div class="minfo"><b>${esc(r.name)}</b><small>${HOW[p ? r.how : r.how === 'bad' ? 'bad' : r.how === 'dup' ? 'dup' : 'none']}</small></div>
        <div class="mwho">${p ? `<span class="mperson">${photoFor(r.pid) ? `<img src="${photoFor(r.pid)}" alt="">` : ''}${esc(p.n)}<small>${esc(T().lifespan(p))}</small></span><button class="link-btn" type="button" data-action="match-change" data-i="${i}">Change</button>`
          : r.how === 'bad' ? '' : `<div class="mpick"><input class="input match-q" data-i="${i}" placeholder="Who is this?" autocomplete="off" aria-label="Who is in ${esc(r.name)}?"><ul class="match-res" data-i="${i}"></ul></div>`}</div>
        <button class="icon-btn" type="button" data-action="match-remove" data-i="${i}" aria-label="Leave out ${esc(r.name)}">${icon('x')}</button>
      </div>`;
    }).join('');
    const ok = rows.filter(r => r.pid).length, todo = rows.filter(r => !r.pid && r.how !== 'bad').length;
    $('#match-summary').textContent = rows.length ? `${ok} matched${todo ? ` · ${todo} still need a name` : ''}` : '';
    $('#match-save').disabled = !ok;
    $('#match-save').innerHTML = `${icon('check')}${ok ? `Save ${ok} photo${ok === 1 ? '' : 's'}` : 'Save photos'}`;
  }
  async function saveMatches(btn) {
    const todo = matcher.rows.filter(r => r.pid);
    if (!todo.length) return;
    busy(btn, true, `Saving 0 of ${todo.length}…`);
    let done = 0;
    try {
      for (let i = 0; i < todo.length; i += 20) {
        const slice = todo.slice(i, i + 20), b = db.batch(), out = [];
        for (const r of slice) {
          const img = await compressImage(r.file, 320, 0.84, 85000, true);
          out.push([r.pid, img]);
          b.set(col('treePhotos').doc(r.pid), { img, uid: S.user.uid, by: myName().slice(0, 80), createdAt: nowIso() });
        }
        await b.commit();
        out.forEach(([pid, img]) => { S.tree.photos[pid] = { img, uid: S.user.uid }; });
        done += slice.length;
        btn.textContent = `Saving ${done} of ${todo.length}…`;
      }
      $('#match-dialog').close();
      toast(`${done} photo${done === 1 ? '' : 's'} added to the tree`);
    } catch (e) {
      toast(denied(e) ? NEED_RULES : `Saved ${done} — the rest didn’t go through. Please try again.`, true);
    } finally {
      busy(btn, false);
      renderMatcher();
      if (S.view === 'tree') renderTree();
    }
  }
  $('#match-input').addEventListener('change', e => { addMatchFiles(e.target.files); e.target.value = ''; });
  const dropMatch = $('[data-drop-match]');
  ['dragenter', 'dragover'].forEach(ev => dropMatch.addEventListener(ev, e => { e.preventDefault(); dropMatch.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dropMatch.addEventListener(ev, e => { e.preventDefault(); dropMatch.classList.remove('drag'); }));
  dropMatch.addEventListener('drop', e => addMatchFiles(e.dataTransfer && e.dataTransfer.files));
  document.addEventListener('input', e => {
    if (!e.target.classList || !e.target.classList.contains('match-q')) return;
    const i = e.target.dataset.i, list = $(`.match-res[data-i="${i}"]`);
    list.innerHTML = T().search(S.tree.ix, e.target.value, 6).map(p =>
      `<li><button type="button" data-action="match-pick" data-i="${i}" data-pid="${esc(p.id)}">${esc(p.n)} <small>${esc(T().lifespan(p))}</small></button></li>`).join('');
  });

  // When the security rules are missing, explain exactly how to publish them.
  /* ===================== Game Night ===================== */
  // Two games, each in its own file, loaded when someone plays: Gaviota (games/gull.js) and
  // La Nevería (games/neveria.js). Every member's best score per game goes on the family board.
  const GAMES = [
    { id: 'gull', title: 'Gaviota', kind: 'Tap to fly', blurb: 'Fly a seagull between the pier pilings as the sun sets over the water. One tap to flap — how far can you get?',
      help: 'Tap, click or press Space to flap. P pauses.' },
    { id: 'neveria', title: 'La Nevería', kind: 'Run the shop', money: true, blurb: 'Run the family’s beach-side nevería: take orders, scoop the nieve, blend, add toppings and serve before customers lose patience.',
      help: 'Keys 1–4 switch stations, hold Space to blend, Enter serves. P pauses.' }
  ];
  const gameLib = {};
  function loadGame(id) {
    if (window.AgrazGames && window.AgrazGames[id]) return Promise.resolve();
    if (!gameLib[id]) {
      gameLib[id] = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = `/assets/js/games/${id}.js${ASSET_V}`;
        sc.onload = resolve;
        sc.onerror = () => { gameLib[id] = null; reject(new Error('game')); };
        document.head.appendChild(sc);
      });
    }
    return gameLib[id];
  }
  const localBest = id => { try { return Number(localStorage.getItem('agraz-best-' + id)) || 0; } catch (e) { return 0; } };
  const soundOn = () => { try { return localStorage.getItem('agraz-game-sound') !== 'off'; } catch (e) { return true; } };
  const fmtScore = (g, n) => (g.money ? '$' : '') + Number(n || 0).toLocaleString();
  const myScore = id => (S.scores && S.user ? S.scores.list.find(x => x.game === id && x.uid === S.user.uid) : null);
  const myBest = id => Math.max((myScore(id) || {}).best || 0, localBest(id));
  const boardOf = id => (S.scores ? S.scores.list.filter(x => x.game === id).sort((a, b) => b.best - a.best || String(a.at).localeCompare(String(b.at))) : []);
  async function loadScores() {
    try {
      const snap = await col('scores').get();
      S.scores = { list: snap.docs.map(d => d.data()), denied: false };
    } catch (e) { S.scores = { list: [], denied: denied(e) }; }
  }
  async function openGames() {
    if (S.game) { renderGameBoard(); return; }
    $('#game-play').hidden = true;
    $('#games-lobby').hidden = false;
    $('#games-head').hidden = false;
    renderLobby();
    if (!S.scores) { await loadScores(); if (S.view === 'games' && !S.game) renderLobby(); }
  }
  function boardHTML(g, n) {
    if (!S.scores) return skelRows(3);
    const rows = boardOf(g.id).slice(0, n);
    if (!rows.length) return S.scores.denied ? '' : '<p class="gb-empty">No scores yet — be the first on the board.</p>';
    return `<ol class="gb-list">${rows.map((x, i) => {
      const m = S.byUid[x.uid] || { name: x.name, uid: x.uid }, me = S.user && x.uid === S.user.uid;
      return `<li class="${me ? 'me' : ''}${i === 0 ? ' top' : ''}"><span class="gb-rank">${i === 0 ? icon('trophy') : i + 1}</span>${avatarHTML(m, 28)}<span class="gb-name">${esc(firstName(m.name || x.name))}${me ? ' <small>you</small>' : ''}</span><b>${esc(fmtScore(g, x.best))}</b></li>`;
    }).join('')}</ol>`;
  }
  const GAME_ART = {
    gull: `<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="ga-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f6489"/><stop offset=".5" stop-color="#d99a93"/><stop offset=".78" stop-color="#ffcf9a"/><stop offset="1" stop-color="#fff0c2"/></linearGradient><linearGradient id="ga-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#86aaa0"/><stop offset="1" stop-color="#1e5550"/></linearGradient><radialGradient id="ga-sun"><stop offset="0" stop-color="#fffbe8"/><stop offset=".55" stop-color="#ffe7b0"/><stop offset="1" stop-color="#ffe7b0" stop-opacity="0"/></radialGradient></defs>
      <rect width="320" height="180" fill="url(#ga-sky)"/><circle cx="200" cy="118" r="48" fill="url(#ga-sun)"/><circle cx="200" cy="118" r="20" fill="#fffaf0"/>
      <path d="M0 122 C60 114 110 118 160 121 S260 114 320 120 V180 H0Z" fill="#b48a8a" opacity=".55"/><rect y="124" width="320" height="56" fill="url(#ga-sea)"/>
      <path class="ga-glint" d="M186 130h28M180 138h40M190 146h20M176 154h48" stroke="#fff6dc" stroke-width="2" stroke-linecap="round" opacity=".75"/>
      <path d="M0 160 Q40 152 80 160 T160 160 T240 160 T320 160" fill="none" stroke="#e9f4ef" stroke-opacity=".55" stroke-width="2"/>
      <g fill="#7b4f2e"><rect x="252" y="0" width="24" height="54" rx="3"/><rect x="252" y="104" width="24" height="76" rx="3"/></g><g fill="#5c3a21" opacity=".55"><rect x="252" y="40" width="24" height="5"/><rect x="252" y="114" width="24" height="5"/></g>
      <g class="ga-gull" transform="translate(112 82)"><path d="M-30 4 C-14 -10 6 -10 18 -2 L30 0 L18 4 C4 12 -18 12 -30 4Z" fill="#fbfaf6"/><path class="ga-wing" d="M-12 -2 C-6 -22 8 -26 16 -24 C8 -14 4 -6 2 0Z" fill="#9aa4ab"/><path d="M-30 4 L-38 0 L-36 8Z" fill="#2c3338"/><circle cx="14" cy="-2" r="1.6" fill="#1b2226"/><path d="M28 -1 L36 1 L28 3Z" fill="#f4b23a"/></g></svg>`,
    neveria: `<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="gn-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd9b8"/><stop offset="1" stop-color="#f6b48d"/></linearGradient></defs>
      <rect width="320" height="180" fill="url(#gn-bg)"/><rect y="132" width="320" height="48" fill="#2b6b66"/><rect y="128" width="320" height="8" fill="#f4ede2"/>
      <path d="M0 14 Q160 34 320 14" fill="none" stroke="#7b4f2e" stroke-width="1.5"/>
      <g class="gn-flags"><path d="M14 17 h26 l-13 22Z" fill="#e8557a"/><path d="M50 20 h26 l-13 22Z" fill="#f2a33a"/><path d="M86 23 h26 l-13 22Z" fill="#f2cf4a"/><path d="M122 24 h26 l-13 22Z" fill="#46b37b"/><path d="M158 24 h26 l-13 22Z" fill="#3e8ed0"/><path d="M194 24 h26 l-13 22Z" fill="#9b6ad6"/><path d="M230 23 h26 l-13 22Z" fill="#e8557a"/><path d="M266 20 h26 l-13 22Z" fill="#f2a33a"/><path d="M302 17 h26 l-13 22Z" fill="#46b37b"/></g>
      <g transform="translate(160 0)"><path d="M-34 96 h68 l-8 56 h-52Z" fill="#fffaf2"/><path d="M-33 104 h66 l-1.6 12 h-62.8Z" fill="#2b6b66"/><path d="M-31 122 h62" stroke="#e58c63" stroke-width="4"/>
        <circle cx="-14" cy="88" r="17" fill="#f6a5b8"/><circle cx="14" cy="88" r="17" fill="#ffc94d"/><circle cx="0" cy="72" r="17" fill="#7a4a2e"/>
        <path d="M-16 62 C-14 50 -4 46 0 38 C4 46 14 50 16 62 C8 66 -8 66 -16 62Z" fill="#fffdf8"/><circle cx="0" cy="34" r="6" fill="#d8273a"/><path d="M0 28 C2 22 6 19 10 18" stroke="#3d7a3a" stroke-width="2" fill="none"/>
        <rect x="18" y="40" width="7" height="44" rx="3" fill="#e7b46a" transform="rotate(18 21 62)"/></g>
      <g fill="#ffffff" opacity=".7"><circle cx="48" cy="80" r="2"/><circle cx="270" cy="70" r="2.5"/><circle cx="250" cy="100" r="1.6"/><circle cx="70" cy="110" r="1.8"/></g></svg>`
  };
  function renderLobby() {
    $('#games-lobby').innerHTML = GAMES.map(g => {
      const best = myBest(g.id), top = boardOf(g.id)[0];
      return `<article class="game-card card gc-${g.id}">
        <button class="gc-art" type="button" data-action="game-play" data-game="${g.id}" aria-label="Play ${esc(g.title)}">${GAME_ART[g.id]}<span class="gc-play">${icon('play')}</span></button>
        <div class="gc-body">
          <p class="gc-kind">${esc(g.kind)}</p>
          <h2 class="gc-title">${esc(g.title)}</h2>
          <p class="gc-blurb">${esc(g.blurb)}</p>
          <div class="gc-foot">
            <button class="btn btn-accent" type="button" data-action="game-play" data-game="${g.id}">${icon('play')}Play</button>
            <span class="gc-best">${best ? `Your best <b>${esc(fmtScore(g, best))}</b>` : 'Not played yet'}${top && S.user && top.uid !== S.user.uid ? ` · ${esc(firstName((S.byUid[top.uid] || top).name || top.name))} leads with ${esc(fmtScore(g, top.best))}` : ''}</span>
          </div>
          <section class="gc-board"><h3>${icon('trophy')}Family leaderboard</h3>${boardHTML(g, 5)}</section>
        </div>
      </article>`;
    }).join('') + (S.scores && S.scores.denied && isAdmin() ? rulesNeededHTML('The family leaderboard') : '');
  }
  function renderGameBoard(g) {
    g = g || (S.game && GAMES.find(x => x.id === S.game.id));
    const box = $('#game-board');
    if (!box || !g) return;
    const best = myBest(g.id);
    box.innerHTML = `<h3>${icon('trophy')}Family leaderboard</h3>${boardHTML(g, 8)}
      <p class="gb-you">${best ? `Your best: <b>${esc(fmtScore(g, best))}</b>` : 'Your first game — good luck!'}</p>
      <p class="gb-help">${icon('sparkle')}<span>${esc(g.help)}</span></p>
      ${S.scores && S.scores.denied ? `<p class="gb-help">${icon('shield')}<span>Scores stay on this device until the family leaderboard is switched on${isAdmin() ? ' — it needs the latest security rules (see Game Night).' : '.'}</span></p>` : ''}`;
  }
  function paintSoundBtn() {
    const on = soundOn(), b = $('#game-sound');
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    b.innerHTML = icon(on ? 'volume' : 'volume-x');
  }
  async function playGame(id) {
    const g = GAMES.find(x => x.id === id);
    if (!g) return;
    stopGame();
    $('#games-lobby').hidden = true;
    $('#games-head').hidden = true;
    $('#game-play').hidden = false;
    $('#game-name').textContent = g.title;
    paintSoundBtn();
    renderGameBoard(g);
    const host = $('#game-host');
    host.innerHTML = '<div class="skel game-skel"></div>';
    window.scrollTo(0, 0);
    try { await loadGame(id); } catch (e) { host.innerHTML = errorHTML('the game'); return; }
    if (S.view !== 'games' || $('#game-play').hidden || $('#game-name').textContent !== g.title) return;
    host.innerHTML = '';
    const api = window.AgrazGames[id].mount(host, { best: myBest(id), reduced: REDUCED, sound: soundOn(), onOver: score => saveScore(g, score) });
    S.game = { id, api };
    host.gameApi = api; // lets automated tests drive the game
  }
  function stopGame() {
    if (S.game) { try { S.game.api.destroy(); } catch (e) {} S.game = null; }
    const host = $('#game-host');
    if (host) { host.gameApi = null; host.innerHTML = ''; }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  async function saveScore(g, score) {
    score = Math.max(0, Math.floor(Number(score) || 0));
    const before = myBest(g.id), had = myScore(g.id), leader = boardOf(g.id)[0];
    if (score > localBest(g.id)) { try { localStorage.setItem('agraz-best-' + g.id, String(score)); } catch (e) {} }
    if (!had || score > had.best) {
      const rec = { uid: S.user.uid, game: g.id, best: score, name: myName().slice(0, 80), at: nowIso() };
      try {
        await col('scores').doc(`${S.user.uid}_${g.id}`).set(rec);
        if (!S.scores) S.scores = { list: [], denied: false };
        S.scores.list = S.scores.list.filter(x => !(x.uid === rec.uid && x.game === rec.game)).concat(rec);
      } catch (e) { if (denied(e)) S.scores = Object.assign(S.scores || { list: [] }, { denied: true }); }
    }
    if (score > before && before > 0) {
      const lead = leader && leader.uid !== S.user.uid && score > leader.best;
      toast(lead ? `Top of the family board — ${fmtScore(g, score)}!` : `New personal best: ${fmtScore(g, score)}!`);
      celebrate($('#game-board'));
    }
    if (S.game && S.game.id === g.id) renderGameBoard(g);
  }

  function rulesNeededHTML(what) {
    if (S.rulesOk === undefined && !rulesText) loadRulesText();
    return `<div class="card rules-needed">
      <span class="sc-icon sc-accent">${icon('shield')}</span>
      <h2>${esc(what)} needs the latest security rules</h2>
      <p class="muted">The rules that keep the family’s data private were updated for this. ${isAdmin() ? 'Publishing them takes a minute:' : 'Ask a family admin to publish them in the Firebase console.'}</p>
      ${isAdmin() ? `<ol class="mini-steps">
        <li><button class="btn btn-sm" type="button" data-action="copy-rules">${icon('copy')}Copy the rules</button></li>
        <li>Open the <a href="https://console.firebase.google.com/project/agrazfamily/firestore/databases/-default-/rules" target="_blank" rel="noopener noreferrer">rules editor</a> in the Firebase console.</li>
        <li>Select everything in the editor (Ctrl+A, or ⌘A on a Mac), paste, and click <b>Publish</b>.</li>
        <li>Wait a minute, then <button class="link-btn" type="button" data-action="tree-retry">try again</button>.</li>
      </ol>` : ''}
    </div>`;
  }

  const RENDER = {
    home: renderHome, photos: openPhotos, calendar: openCalendar, updates: openUpdates,
    directory: () => { renderDirectory(); if (!S.members.length) loadMembers().catch(() => { $('#people').innerHTML = errorHTML('the directory'); }); },
    recipes: openRecipes, invite: openInvite, vault: openVault, memorial: openMemorial, profile: renderProfile,
    globe: openGlobe, stories: openStories, capsules: openCapsules, tree: openTree, games: openGames
  };

  /* ===================== Events (delegated) ===================== */
  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-action],[data-auth],[data-theme-set],[data-close]');
    if (!t) return;
    if (t.hasAttribute('data-close')) { t.closest('dialog').close(); return; }
    if (t.dataset.auth) {
      authMode(t.dataset.auth);
      if (t.dataset.auth === 'join') { if (!location.hash.startsWith('#join')) history.replaceState(null, '', '#join'); }
      else if (location.hash.startsWith('#join')) history.replaceState(null, '', location.pathname);
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
        t.querySelector('use').setAttribute('href', `/assets/icons.svg${ASSET_V}#${show ? 'eye-off' : 'eye'}`);
        break;
      }
      case 'signout': await signOut(); break;
      case 'toggle-theme': setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'); break;
      case 'jarvis': openJarvis(); break;
      case 'more': $('#more-sheet').showModal(); break;
      case 'retry': {
        if (!S.view) break;
        const stale = { home: ['events', 'updates', 'recent'], calendar: ['events'], capsules: ['capsules'], stories: ['stories'], updates: ['updates'], vault: ['vault'], memorial: ['memorial', 'tributes', 'candles'], recipes: ['recipes'] }[S.view] || [];
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
      case 'vault-bio': unlockWithBio(); break;
      case 'vault-bio-on': enableBio(t); break;
      case 'vault-bio-off': disableBio(); break;
      case 'manage-member': openMemberDialog(t.dataset.uid); break;
      case 'check-rules': S.rulesOk = undefined; renderInvite(); break;
      case 'tree-retry': S.rulesOk = undefined; if (S.view === 'games') { S.scores = null; openGames(); } else { S.tree = null; openTree(); } break;
      case 'game-play': playGame(t.dataset.game); break;
      case 'game-exit': stopGame(); openGames(); break;
      case 'game-sound': {
        const on = !soundOn();
        try { localStorage.setItem('agraz-game-sound', on ? 'on' : 'off'); } catch (e) {}
        if (S.game) S.game.api.setSound(on);
        paintSoundBtn();
        break;
      }
      case 'game-full': {
        const el = $('#game-host');
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else if (el.requestFullscreen) el.requestFullscreen().then(() => el.focus()).catch(() => {});
        break;
      }
      case 'tree-focus': treeFocus(t.dataset.pid); $('#tree-search').value = ''; break;
      case 'tree-view': if (S.tree) { S.tree.view = t.dataset.v; $$('.tree-seg button').forEach(b => b.setAttribute('aria-selected', String(b === t))); paintTree(true); } break;
      case 'tree-back': if (S.tree && S.tree.history.length) { S.tree.focus = S.tree.history.pop(); paintTree(true); } break;
      case 'tree-home': if (S.tree) treeFocus(treeStart()); break;
      case 'tree-me': linkMe(t.dataset.pid); break;
      case 'tree-unme': linkMe(null); break;
      case 'tree-me-off': try { localStorage.setItem('agraz-tree-me-off', '1'); } catch (err) {} renderTree(); break;
      case 'tree-update': S.tree.updating = true; renderTree(); window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' }); break;
      case 'tree-update-cancel': S.tree.updating = false; S.treeDraft = null; renderTree(); break;
      case 'tree-import-go': importTree(t); break;
      case 'tree-ghost': if (S.tree && S.tree.ghosts.get(t.dataset.gid)) { S.tree.ghost = t.dataset.gid; renderPanel(); } break;
      case 'tp-more': { const sec = t.closest('.tp-group'); if (sec) sec.classList.add('show-all'); t.remove(); break; }
      case 'tree-photo': S.tree.photoTarget = t.dataset.pid; $('#tree-photo-input').click(); break;
      case 'tree-photo-remove': removeTreePhoto(t.dataset.pid); break;
      case 'tree-photos': openMatcher(); break;
      case 'match-save': saveMatches(t); break;
      case 'match-remove': matcher.rows.splice(Number(t.dataset.i), 1); renderMatcher(); break;
      case 'match-change': { const r = matcher.rows[Number(t.dataset.i)]; if (r) { r.pid = null; r.how = 'none'; renderMatcher(); const q = $(`.match-q[data-i="${t.dataset.i}"]`); if (q) q.focus(); } break; }
      case 'match-pick': { const r = matcher.rows[Number(t.dataset.i)]; if (r) { matcher.rows.forEach(o => { if (o !== r && o.pid === t.dataset.pid) { o.pid = null; o.how = 'dup'; } }); r.pid = t.dataset.pid; r.how = 'picked'; renderMatcher(); } break; }
      case 'copy-rules': copyRules(); break;
      case 'new-story': openRecorder(); break;
      case 'rec-toggle': if (rec.state === 'recording') stopRecording(); else if (rec.state === 'idle') startRecording(); break;
      case 'rec-play': toggleListen(); break;
      case 'rec-redo': resetRecorder(); break;
      case 'rec-prompt':
        rec.prompt = t.getAttribute('aria-pressed') === 'true' ? '' : t.textContent;
        $$('#rec-prompts button').forEach(b => b.setAttribute('aria-pressed', String(b === t && !!rec.prompt)));
        $('#rec-prompt').textContent = rec.prompt || 'Tap the button and start talking.';
        break;
      case 'story-play': playStory(id); break;
      case 'story-seek': seekStory(id, e, t); break;
      case 'delete-story': deleteStory(id); break;
      case 'new-capsule': openCapsuleForm(); break;
      case 'cap-preset': $('#cap-date').value = t.dataset.day; paintCapHint(); break;
      case 'cap-photo-remove': S.capPhoto = ''; paintCapPhoto(''); break;
      case 'open-capsule': openCapsule(id); break;
      case 'delete-capsule': deleteCapsule(id); break;
      case 'globe-place': if (S.globe.picking) stopPicking(); else startPicking(); break;
      case 'globe-cancel': stopPicking(); break;
      case 'globe-locate': locateMe(); break;
      case 'globe-remove': savePlace(true); break;
      case 'globe-focus': focusPeople([t.dataset.uid]); break;
      case 'globe-pin': focusPeople(t.dataset.ids.split(',')); break;
      case 'globe-hour': setGlobeOffset(Number(t.dataset.i) * 4); break;
      case 'globe-now': setGlobeOffset(0); break;
      case 'globe-spin': {
        if (!S.globe.api) break;
        const on = !S.globe.api.spinning;
        S.globe.api.setSpin(on);
        t.setAttribute('aria-pressed', String(on));
        t.setAttribute('aria-label', on ? 'Pause spinning' : 'Spin the globe');
        t.innerHTML = icon(on ? 'pause' : 'play');
        break;
      }
      case 'remove-member': removeMember(); break;
      case 'copy-invite-link': copyText(inviteLink(), 'Invite link copied — paste it in a text or email'); break;
      case 'copy-invite-code': copyText(S.invite.code, 'Invite code copied'); break;
      case 'copy-invite-message': copyText(inviteMessage(), 'Invite message copied — paste it anywhere'); break;
      case 'copy-join-link': copyText(`${location.origin}/family/#join`, 'Link copied'); break;
      case 'share-invite': shareInvite(); break;
      case 'create-invite': saveInvite({ code: newInviteCode(), requireApproval: true }, 'Your invite code is ready'); break;
      case 'new-invite-code':
        if (await confirmBox('Make a new invite code?', 'Links and codes you’ve already sent will stop working. Everyone who has joined stays in.', 'Make new code')) {
          saveInvite({ code: newInviteCode() }, 'New invite code ready — share the new link');
        }
        break;
      case 'custom-invite-code': {
        const f = $('#custom-code-form');
        f.hidden = !f.hidden;
        if (!f.hidden) $('#custom-code').focus();
        break;
      }
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
  paintThemeSeg();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
