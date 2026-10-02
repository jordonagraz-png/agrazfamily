/* Test double for the Firebase compat SDK subset used by assets/js/portal.js.
   Loaded by tests/ui.test.mjs in place of https://www.gstatic.com/firebasejs/…/firebase-app-compat.js.
   Options (set window.__MOCK before load): signedIn, newUser, empty, bdayToday, admin, requireApproval.
   Optional window.__IMG = { photos: [...dataUrls], memorial: [...], av1 } to use real photos. */
(function () {
  const M = window.__MOCK || {};
  const delay = (v, ms = 60) => new Promise(r => setTimeout(() => r(v), ms));
  const fail = (code, ms = 60) => new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(code), { code })), ms));
  const clone = v => JSON.parse(JSON.stringify(v));
  const day = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.toISOString().slice(0, 10); };
  const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
  const md = () => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  function fakePhoto(i) {
    const c = document.createElement('canvas');
    c.width = 480; c.height = 360;
    const x = c.getContext('2d');
    const hue = (i * 47) % 360;
    const g = x.createLinearGradient(0, 0, 0, 360);
    g.addColorStop(0, `hsl(${hue},55%,62%)`); g.addColorStop(0.6, `hsl(${(hue + 30) % 360},60%,72%)`); g.addColorStop(1, `hsl(${(hue + 180) % 360},40%,35%)`);
    x.fillStyle = g; x.fillRect(0, 0, 480, 360);
    x.fillStyle = 'rgba(255,240,210,.9)'; x.beginPath(); x.arc(140 + i * 23 % 200, 150, 38, 0, 7); x.fill();
    x.fillStyle = `hsl(${(hue + 190) % 360},45%,30%)`; x.fillRect(0, 230, 480, 130);
    return c.toDataURL('image/jpeg', 0.7);
  }
  const IMG = window.__IMG || {
    photos: Array.from({ length: 10 }, (_, i) => fakePhoto(i)),
    memorial: Array.from({ length: 5 }, (_, i) => fakePhoto(i + 20)),
    av1: fakePhoto(40)
  };

  const ME = { uid: 'u1', email: 'jordon@example.com', displayName: 'Jordon Agraz' };
  const store = {
    config: { invite: { code: 'seashell', requireApproval: !!M.requireApproval } },
    joins: {},
    users: {
      u1: { uid: 'u1', name: 'Jordon Agraz', email: 'jordon@example.com', joinedDate: '2024-05-02T10:00:00Z', phone: '(305) 555-0142', birthday: '1990-10-14', address: '12 Seagrape Lane, Miami, FL 33139', bio: 'Keeper of the family website', role: M.admin === false ? undefined : 'admin' },
      u2: { uid: 'u2', name: 'Maria Agraz', email: 'maria@example.com', joinedDate: '2024-05-03T10:00:00Z', phone: '(305) 555-0199', birthday: M.bdayToday ? `1962-${md()}` : '1962-10-09', address: '48 Harbor View Dr, Key Biscayne, FL', bio: 'Grandma, head chef, family historian', avatar: IMG.av1 },
      u3: { uid: 'u3', name: 'Daniel Agraz', email: 'daniel@example.com', joinedDate: '2024-06-11T10:00:00Z', phone: '(786) 555-0110', birthday: '1988-12-02' },
      u4: { uid: 'u4', name: 'Sofia Agraz', email: 'sofia@example.com', joinedDate: '2025-01-20T10:00:00Z', birthday: '2012-10-25', bio: 'Midfielder · artist' },
      u5: { uid: 'u5', name: 'Elena Ruiz', email: 'elena@example.com', joinedDate: '2025-03-02T10:00:00Z' },
      u6: { uid: 'u6', name: 'Marco Agraz', email: 'marco@example.com', joinedDate: '2025-07-15T10:00:00Z', phone: '(954) 555-0177', bio: 'Grill master' },
      u7: { uid: 'u7', name: 'Lucia Torres', email: 'lucia@example.com', joinedDate: ago(20), approved: false }
    },
    events: {
      e1: { title: 'Sunday dinner at Grandma’s', date: day(2), time: '17:30', location: '48 Harbor View Dr, Key Biscayne', description: 'Bring a side dish! Maria is making arroz con pollo.', createdBy: 'Maria Agraz', uid: 'u2', createdAt: ago(40), rsvp: { u2: 'yes', u3: 'yes', u4: 'yes', u6: 'maybe' } },
      e2: { title: 'Sofia’s soccer final', date: day(8), time: '10:00', location: 'Tropical Park', description: '', createdBy: 'Daniel Agraz', uid: 'u3', createdAt: ago(30), rsvp: { u3: 'yes' } },
      e3: { title: 'Thanksgiving', date: day(55), description: 'At our place this year.', createdBy: 'Jordon Agraz', uid: 'u1', createdAt: ago(20) },
      e4: { title: 'Beach day', date: day(-12), description: '', createdBy: 'Marco Agraz', uid: 'u6', createdAt: ago(500) },
      e5: { title: 'Family photo shoot', date: day(16), time: '16:00', location: 'South Pointe Park', description: 'Wear white & blue.', createdBy: 'Elena Ruiz', uid: 'u5', createdAt: ago(10) }
    },
    updates: {
      p1: { text: 'Made it home safe from the trip — thank you all for an amazing weekend. Photos coming soon!', author: 'Daniel Agraz', uid: 'u3', createdAt: ago(3), hearts: { u2: true, u4: true, u6: true } },
      p2: { text: 'Grandma’s flan recipe is finally written down. It’s in the recipe book so nobody loses it again 🍮', author: 'Maria Agraz', uid: 'u2', createdAt: ago(28), hearts: { u1: true, u3: true } },
      p3: { text: 'Who’s coming to Sofia’s final? Let’s get a big group in the stands.', author: 'Jordon Agraz', uid: 'u1', createdAt: ago(60) },
      p4: { text: 'New grill is set up. Saturday? 🔥', author: 'Marco Agraz', uid: 'u6', createdAt: ago(200) }
    },
    comments: {
      c1: { parent: 'updates/p1', text: 'So glad you made it back!', uid: 'u2', author: 'Maria Agraz', createdAt: ago(2) },
      c2: { parent: 'updates/p1', text: 'Best weekend ever.', uid: 'u4', author: 'Sofia Agraz', createdAt: ago(1) },
      c3: { parent: 'updates/p2', text: 'Finally!! 🙌', uid: 'u3', author: 'Daniel Agraz', createdAt: ago(20) },
      c4: { parent: 'memories/m0', text: 'What a sunset.', uid: 'u3', author: 'Daniel Agraz', createdAt: ago(4) }
    },
    memories: {},
    memorial: {},
    vault: {
      n1: { title: 'Family doctor', category: 'medical', body: 'Dr. Alvarez — (305) 555-0101\nMiami Family Clinic, 200 Main St', uid: 'u2', author: 'Maria Agraz', createdAt: ago(100), updatedAt: ago(50), updatedBy: 'Maria Agraz' },
      n2: { title: 'Emergency contacts', category: 'emergency', body: 'Grandma: (305) 555-0199\nDaniel: (786) 555-0110\nPoison control: 1-800-222-1222', uid: 'u1', author: 'Jordon Agraz', createdAt: ago(300), updatedAt: ago(5), updatedBy: 'Jordon Agraz' },
      n3: { title: 'Beach house Wi-Fi', category: 'household', body: 'Network: AgrazBeach\nPassword: saltair-2026', uid: 'u6', author: 'Marco Agraz', createdAt: ago(800), updatedAt: ago(700), updatedBy: 'Marco Agraz' }
    },
    recipes: {
      r1: { title: 'Grandma’s Flan', by: 'Grandma Maria', category: 'desserts', time: '1 hr + chilling', servings: '8', ingredients: '1 cup sugar\n5 eggs\n1 can condensed milk\n1 can evaporated milk\n1 tsp vanilla', steps: 'Melt the sugar into a golden caramel and pour it into the mold.\nBlend the eggs, both milks and vanilla.\nPour over the caramel and bake in a water bath at 350°F for 50 minutes.\nChill overnight, then flip onto a plate.', photo: IMG.photos[2], uid: 'u2', author: 'Maria Agraz', createdAt: ago(28), updatedAt: ago(28), updatedBy: 'Maria Agraz' },
      r2: { title: 'Arroz con Pollo', by: 'Grandma Maria', category: 'mains', time: '1 hr 15 min', servings: '6', ingredients: '1 whole chicken, cut up\n2 cups rice\n1 bell pepper\n1 onion\nSofrito\nSaffron', steps: 'Season and brown the chicken.\nAdd sofrito, onion and pepper.\nStir in rice, saffron and broth; simmer covered 25 minutes.', uid: 'u2', author: 'Maria Agraz', createdAt: ago(100), updatedAt: ago(100), updatedBy: 'Maria Agraz' },
      r3: { title: 'Marco’s Grill Rub', by: 'Marco', category: 'other', time: '5 min', ingredients: '2 tbsp paprika\n1 tbsp brown sugar\n1 tbsp garlic powder\n1 tsp cumin', steps: 'Mix everything. Rub generously.', photo: IMG.photos[1], uid: 'u6', author: 'Marco Agraz', createdAt: ago(300), updatedAt: ago(300), updatedBy: 'Marco Agraz' }
    },
    tributes: {
      t1: { text: 'He taught every one of us to fish off the pier — and to be patient when nothing was biting.', uid: 'u3', author: 'Daniel Agraz', createdAt: ago(400) },
      t2: { text: 'Sunday mornings will always smell like his café con leche.', uid: 'u2', author: 'Maria Agraz', createdAt: ago(200) }
    },
    candles: {
      u2: { name: 'Maria Agraz', litAt: ago(300) },
      u3: { name: 'Daniel Agraz', litAt: ago(250) },
      u4: { name: 'Sofia Agraz', litAt: ago(100) },
      u5: { name: 'Elena Ruiz', litAt: ago(90) }
    }
  };
  const caps = ['Sunset at the pier', 'Sunday table', 'Sofia’s birthday', '', 'Morning walk', 'The whole crew', 'Beach day', ''];
  IMG.photos.forEach((src, i) => { store.memories['m' + i] = { imageData: src, caption: caps[i % caps.length], uploadedBy: ['Maria Agraz', 'Daniel Agraz', 'Jordon Agraz'][i % 3], uid: 'u' + (1 + i % 3), createdAt: ago(5 + i * 20), hearts: i === 0 ? { u2: true, u3: true } : undefined }; });
  // "On this day": photos from this week last year
  const lastYear = d => { const x = new Date(); x.setFullYear(x.getFullYear() - 1); x.setDate(x.getDate() + d); return x.toISOString(); };
  store.memories.ly1 = { imageData: IMG.photos[5], caption: 'Last year at the beach', uploadedBy: 'Maria Agraz', uid: 'u2', createdAt: lastYear(0) };
  store.memories.ly2 = { imageData: IMG.photos[7], caption: '', uploadedBy: 'Daniel Agraz', uid: 'u3', createdAt: lastYear(-1) };
  IMG.memorial.forEach((src, i) => { store.memorial['h' + i] = { imageData: src, uploadedBy: 'Maria Agraz', uid: 'u2', order: 1000 + i, createdAt: ago(1000 + i) }; });
  Object.values(store.memories).forEach(m => { if (!m.hearts) delete m.hearts; });
  if (!store.users.u1.role) delete store.users.u1.role;
  if (M.empty) ['events', 'updates', 'memories', 'vault', 'memorial', 'recipes', 'tributes', 'candles', 'comments'].forEach(k => { store[k] = {}; });
  if (M.newUser) delete store.users.u1;

  let current = M.signedIn ? Object.assign({}, ME) : null;
  const listeners = [];
  const emit = () => listeners.forEach(cb => cb(current));
  function mkUser(u) {
    return Object.assign(u, {
      updateProfile: p => { Object.assign(u, p); return delay(); },
      delete: () => { current = null; setTimeout(emit, 10); return delay(); },
      reauthenticateWithCredential: cred => (cred && cred.password === 'password123' ? delay() : fail('auth/invalid-credential'))
    });
  }
  if (current) mkUser(current);
  const auth = {
    get currentUser() { return current; },
    onAuthStateChanged(cb) { listeners.push(cb); setTimeout(() => cb(current), 120); return () => {}; },
    setPersistence: () => delay(null, 5),
    signInWithEmailAndPassword(email, pass) {
      if (pass !== 'password123') return fail('auth/invalid-credential');
      current = mkUser(Object.assign({}, ME, { email }));
      setTimeout(emit, 10);
      return delay({ user: current });
    },
    createUserWithEmailAndPassword(email) {
      current = mkUser({ uid: 'new1', email, displayName: null });
      setTimeout(emit, 10);
      return delay({ user: current });
    },
    signOut() { current = null; setTimeout(emit, 10); return delay(); },
    sendPasswordResetEmail: () => delay()
  };

  let auto = 1;
  const snapDoc = (c, id) => ({ id, exists: !!store[c][id], data: () => store[c][id] && clone(store[c][id]) });
  const getPath = (o, f) => f.split('.').reduce((v, k) => (v == null ? v : v[k]), o);
  const matches = (doc, w) => {
    const v = getPath(doc, w.f);
    if (w.op === '==') return v === w.v;
    if (w.op === 'in') return w.v.includes(v);
    if (w.op === '>=') return v >= w.v;
    if (w.op === '<') return v < w.v;
    throw new Error('mock: unsupported op ' + w.op);
  };
  const member = () => current && store.users[current.uid] && store.users[current.uid].approved !== false;
  function Query(c, o = { wheres: [] }) {
    const next = patch => Query(c, Object.assign({}, o, patch));
    return {
      where: (f, op, v) => { if (op === 'in' && v.length > 30) throw new Error('mock: in > 30'); return next({ wheres: o.wheres.concat([{ f, op, v }]) }); },
      orderBy: (f, dir = 'asc') => next({ f, dir }),
      limit: n => next({ n }),
      startAfter: s => next({ after: s.id }),
      get() {
        if (!member()) return fail('permission-denied');
        let ids = Object.keys(store[c]).filter(id => o.wheres.every(w => matches(store[c][id], w)));
        if (o.f) ids.sort((a, b) => { const x = store[c][a][o.f], y = store[c][b][o.f]; return (x > y ? 1 : x < y ? -1 : 0) * (o.dir === 'desc' ? -1 : 1); });
        if (o.after) ids = ids.slice(ids.indexOf(o.after) + 1);
        if (o.n) ids = ids.slice(0, o.n);
        const docs = ids.map(id => snapDoc(c, id));
        return delay({ docs, size: docs.length, empty: !docs.length, forEach: fn => docs.forEach(fn) }, 90);
      },
      add(data) { if (!member()) return fail('permission-denied'); const id = 'auto' + (auto++); store[c][id] = clone(data); return delay({ id }); },
      doc(id) {
        return {
          id,
          get: () => {
            if (!current) return fail('permission-denied');
            if (c === 'joins' && id !== current.uid) return fail('permission-denied');
            if (c === 'users' && id !== current.uid && !member()) return fail('permission-denied');
            if (c !== 'users' && c !== 'joins' && !member()) return fail('permission-denied');
            return delay(snapDoc(c, id));
          },
          set(data) {
            if (c === 'joins' && (store.joins[id] || data.code !== store.config.invite.code)) return fail('permission-denied');
            if (c === 'users' && !store.users[id]) {
              if (!store.joins[id]) return fail('permission-denied');
              if (data.approved !== false && store.config.invite.requireApproval) return fail('permission-denied');
            }
            store[c][id] = clone(data);
            return delay();
          },
          update(data) {
            if (!store[c][id]) return fail('not-found');
            Object.keys(data).forEach(k => {
              const parts = k.split('.');
              let o2 = store[c][id];
              parts.slice(0, -1).forEach(pk => { o2[pk] = o2[pk] || {}; o2 = o2[pk]; });
              o2[parts[parts.length - 1]] = clone(data[k]);
            });
            return delay();
          },
          delete() { delete store[c][id]; return delay(); }
        };
      }
    };
  }
  const db = { collection: c => { store[c] = store[c] || {}; return Query(c); } };
  const authFn = () => auth;
  authFn.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session' } };
  authFn.EmailAuthProvider = { credential: (email, password) => ({ email, password }) };
  window.firebase = { initializeApp() {}, auth: authFn, firestore: () => db };
  window.__store = store;
})();
