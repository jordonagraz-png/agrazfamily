// Security-rule tests for firestore.rules, run against the Firestore emulator:
//   npm run test:rules
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, getDocs, deleteDoc, query, where, writeBatch, Bytes } from 'firebase/firestore';

// The real owner key is never in the repo; tests swap in the fingerprint of a throwaway key.
const TEST_OWNER_KEY = 'test-owner-key-for-ci-only';
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  .replace(/function ownerKeyHash\(\) \{ return '[0-9a-f]{64}'; \}/, `function ownerKeyHash() { return '${createHash('sha256').update(TEST_OWNER_KEY).digest('hex')}'; }`);
if (!rules.includes(createHash('sha256').update(TEST_OWNER_KEY).digest('hex'))) throw new Error('could not swap the owner key hash');
const env = await initializeTestEnvironment({ projectId: 'demo-agraz', firestore: { rules, host: '127.0.0.1', port: 8085 } });
const IMG = 'data:image/jpeg;base64,' + Buffer.from('fakejpegbytes'.repeat(50)).toString('base64');

async function seed(extra) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, 'config/invite'), { code: 'seashell', ...extra });
    // alice and bob are legacy members (no join doc, no approved field)
    await setDoc(doc(db, 'users/alice'), { name: 'Alice Agraz', email: 'alice@x.com', uid: 'alice', joinedDate: '2024-01-01T00:00:00Z', role: 'admin' });
    await setDoc(doc(db, 'users/bob'), { name: 'Bob Agraz', email: 'bob@x.com', uid: 'bob', joinedDate: '2024-01-01T00:00:00Z' });
    await setDoc(doc(db, 'memories/m1'), { imageData: IMG, caption: '', uid: 'alice', uploadedBy: 'Alice', createdAt: 'x' });
    await setDoc(doc(db, 'events/e1'), { title: 'Dinner', date: '2026-10-04', description: '', uid: 'alice', createdBy: 'Alice', createdAt: 'x' });
    await setDoc(doc(db, 'updates/p1'), { text: 'hello', author: 'Alice', uid: 'alice', createdAt: 'x' });
    await setDoc(doc(db, 'vault/n1'), { title: 'Doctor', body: '555', category: 'medical', uid: 'alice', author: 'Alice', createdAt: 'x', updatedAt: 'x', updatedBy: 'Alice' });
    await setDoc(doc(db, 'recipes/r1'), { title: 'Flan', by: 'Grandma', category: 'desserts', ingredients: 'eggs', steps: 'bake', uid: 'alice', author: 'Alice', createdAt: 'x', updatedAt: 'x', updatedBy: 'Alice' });
    await setDoc(doc(db, 'comments/c1'), { parent: 'updates/p1', text: 'nice', uid: 'alice', author: 'Alice', createdAt: 'x' });
    await setDoc(doc(db, 'tributes/t1'), { text: 'We miss you', uid: 'alice', author: 'Alice', createdAt: 'x' });
  });
}

let pass = 0, fail = 0;
async function t(name, p, ok) {
  try { await (ok ? assertSucceeds(p) : assertFails(p)); pass++; console.log('  ok  ', name); }
  catch (e) { fail++; console.log('  FAIL', name, '-', String(e.message).slice(0, 200)); }
}
const as = (uid, email) => (uid ? env.authenticatedContext(uid, { email }) : env.unauthenticatedContext()).firestore();
const newMember = (approved = true) => ({ name: 'Eve', email: 'eve@x.com', uid: 'eve', joinedDate: 'x', approved });

await seed();
const anon = as(null), eve = as('eve', 'eve@x.com'), alice = as('alice', 'alice@x.com'), bob = as('bob', 'bob@x.com');

console.log('— outsiders');
await t('anon cannot read members', getDocs(collection(anon, 'users')), false);
await t('anon cannot read photos', getDocs(collection(anon, 'memories')), false);
await t('signed-in stranger cannot read photos', getDocs(collection(eve, 'memories')), false);
await t('stranger cannot list members', getDocs(collection(eve, 'users')), false);
await t('stranger cannot read vault', getDoc(doc(eve, 'vault/n1')), false);
await t('stranger cannot read recipes', getDocs(collection(eve, 'recipes')), false);
await t('stranger may check own (missing) member doc', getDoc(doc(eve, 'users/eve')), true);
await t('members cannot read the invite code', getDoc(doc(bob, 'config/invite')), false);
await t('outsiders cannot read the invite code', getDoc(doc(eve, 'config/invite')), false);
await t('cannot self-create member doc without join', setDoc(doc(eve, 'users/eve'), newMember()), false);
await t('wrong invite code rejected', setDoc(doc(eve, 'joins/eve'), { code: 'agraz2025', createdAt: 'x' }), false);
await t('cannot write a join for someone else', setDoc(doc(eve, 'joins/mallory'), { code: 'seashell', createdAt: 'x' }), false);
await t('right invite code accepted', setDoc(doc(eve, 'joins/eve'), { code: 'seashell', createdAt: 'x' }), true);
await t('join is write-once', setDoc(doc(eve, 'joins/eve'), { code: 'seashell', createdAt: 'y' }), false);
await t('can read own join (to finish an interrupted sign-up)', getDoc(doc(eve, 'joins/eve')), true);
await t('cannot read someone else\'s join', getDoc(doc(alice, 'joins/eve')), false);
await t('cannot list joins', getDocs(collection(eve, 'joins')), false);
await t('member doc must use own email', setDoc(doc(eve, 'users/eve'), { ...newMember(), email: 'alice@x.com' }), false);
await t('member doc rejects extra fields', setDoc(doc(eve, 'users/eve'), { ...newMember(), admin: true }), false);
await t('cannot make yourself an admin', setDoc(doc(eve, 'users/eve'), { ...newMember(), role: 'admin' }), false);
await t('member doc requires approved flag', setDoc(doc(eve, 'users/eve'), { name: 'Eve', email: 'eve@x.com', uid: 'eve', joinedDate: 'x' }), false);
await t('approval off: join as approved member', setDoc(doc(eve, 'users/eve'), newMember(true)), true);
await t('new member can now read photos', getDocs(collection(eve, 'memories')), true);

console.log('— members');
await t('member lists family', getDocs(collection(alice, 'users')), true);
await t('legacy member updates profile', updateDoc(doc(bob, 'users/bob'), { uid: 'bob', name: 'Bob A.', phone: '555', birthday: '1990-01-02', address: '1 Main', bio: 'hi', avatar: IMG }), true);
await t('profile can clear avatar', updateDoc(doc(bob, 'users/bob'), { avatar: '' }), true);
await t('profile rejects unknown field', updateDoc(doc(bob, 'users/bob'), { nickname: 'x' }), false);
await t('profile rejects email change', updateDoc(doc(bob, 'users/bob'), { email: 'evil@x.com' }), false);
await t('member cannot make self admin', updateDoc(doc(bob, 'users/bob'), { role: 'admin' }), false);
await t('profile rejects script in avatar', updateDoc(doc(bob, 'users/bob'), { avatar: 'data:image/png;base64,"><script>' }), false);
await t('cannot edit someone else\'s profile', updateDoc(doc(bob, 'users/alice'), { phone: '1' }), false);
await t('non-admin cannot approve anyone', updateDoc(doc(bob, 'users/eve'), { approved: false }), false);
await t('non-admin cannot remove anyone', deleteDoc(doc(bob, 'users/eve')), false);
await t('photo upload ok', addDoc(collection(alice, 'memories'), { imageData: IMG, caption: 'hi', uid: 'alice', uploadedBy: 'Alice', createdAt: 'x' }), true);
await t('photo with injected markup rejected', addDoc(collection(alice, 'memories'), { imageData: 'data:image/png;base64,AAAA"onerror="x', caption: '', uid: 'alice' }), false);
await t('photo as someone else rejected', addDoc(collection(alice, 'memories'), { imageData: IMG, caption: '', uid: 'bob' }), false);
await t('event with time/location ok', addDoc(collection(alice, 'events'), { title: 'Dinner', date: '2026-10-04', time: '17:30', location: 'Home', description: '', uid: 'alice', createdBy: 'Alice', createdAt: 'x' }), true);
await t('event bad date rejected', addDoc(collection(alice, 'events'), { title: 'Dinner', date: 'soon', description: '', uid: 'alice' }), false);
await t('update post ok', addDoc(collection(alice, 'updates'), { text: 'hello', author: 'Alice', uid: 'alice', createdAt: 'x' }), true);
await t('empty post rejected', addDoc(collection(alice, 'updates'), { text: '', author: 'Alice', uid: 'alice', createdAt: 'x' }), false);
await t('vault note ok', addDoc(collection(alice, 'vault'), { title: 'Wi-Fi', body: 'pw', category: 'household', uid: 'alice', author: 'Alice', createdAt: 'x', updatedAt: 'x', updatedBy: 'Alice' }), true);
await t('vault bad category rejected', addDoc(collection(alice, 'vault'), { title: 'X', body: '', category: 'secret', uid: 'alice', author: 'A', createdAt: 'x', updatedAt: 'x', updatedBy: 'A' }), false);
await t('another member edits vault note', updateDoc(doc(bob, 'vault/n1'), { title: 'Doctor (new)', body: '556', updatedAt: 'y', updatedBy: 'Bob' }), true);
await t('vault edit cannot change owner', updateDoc(doc(bob, 'vault/n1'), { uid: 'bob' }), false);
await t('memorial photo ok', addDoc(collection(alice, 'memorial'), { imageData: IMG, uid: 'alice', uploadedBy: 'Alice', order: 1, createdAt: 'x' }), true);
await t('memorial needs order', addDoc(collection(alice, 'memorial'), { imageData: IMG, uid: 'alice' }), false);
await t('unknown collections closed', setDoc(doc(alice, 'secrets/x'), { a: 1 }), false);

console.log('— hearts, RSVPs, comments');
await t('heart a photo', updateDoc(doc(bob, 'memories/m1'), { 'hearts.bob': true }), true);
await t('un-heart a photo', updateDoc(doc(bob, 'memories/m1'), { 'hearts.bob': false }), true);
await t('cannot heart on someone\'s behalf', updateDoc(doc(bob, 'memories/m1'), { 'hearts.alice': true }), false);
await t('cannot change caption while hearting', updateDoc(doc(bob, 'memories/m1'), { 'hearts.bob': true, caption: 'hacked' }), false);
await t('heart value must be true/false', updateDoc(doc(bob, 'updates/p1'), { 'hearts.bob': 'love' }), false);
await t('heart an update', updateDoc(doc(bob, 'updates/p1'), { 'hearts.bob': true }), true);
await t('cannot edit someone else\'s post text', updateDoc(doc(bob, 'updates/p1'), { text: 'edited' }), false);
await t('RSVP yes', updateDoc(doc(bob, 'events/e1'), { 'rsvp.bob': 'yes' }), true);
await t('RSVP change to maybe', updateDoc(doc(bob, 'events/e1'), { 'rsvp.bob': 'maybe' }), true);
await t('RSVP invalid value rejected', updateDoc(doc(bob, 'events/e1'), { 'rsvp.bob': 'definitely' }), false);
await t('cannot RSVP for someone else', updateDoc(doc(bob, 'events/e1'), { 'rsvp.alice': 'no' }), false);
await t('cannot move an event while RSVPing', updateDoc(doc(bob, 'events/e1'), { 'rsvp.bob': 'yes', date: '2027-01-01' }), false);
await t('new events cannot come with RSVPs', addDoc(collection(bob, 'events'), { title: 'X', date: '2026-10-04', description: '', uid: 'bob', rsvp: { alice: 'yes' } }), false);
await t('comment on an update', addDoc(collection(bob, 'comments'), { parent: 'updates/p1', text: 'Love it', uid: 'bob', author: 'Bob', createdAt: 'x' }), true);
await t('comment on a photo', addDoc(collection(bob, 'comments'), { parent: 'memories/m1', text: 'Great shot', uid: 'bob', author: 'Bob', createdAt: 'x' }), true);
await t('comment parent must be an update or photo', addDoc(collection(bob, 'comments'), { parent: 'vault/n1', text: 'x', uid: 'bob', author: 'Bob', createdAt: 'x' }), false);
await t('empty comment rejected', addDoc(collection(bob, 'comments'), { parent: 'updates/p1', text: '', uid: 'bob', author: 'Bob', createdAt: 'x' }), false);
await t('members read comments by parent', getDocs(query(collection(bob, 'comments'), where('parent', 'in', ['updates/p1']))), true);
await t('cannot delete someone else\'s comment', deleteDoc(doc(bob, 'comments/c1')), false);
await t('delete own comment', deleteDoc(doc(alice, 'comments/c1')), true);

console.log('— recipes, guestbook, candles');
await t('add a recipe', addDoc(collection(bob, 'recipes'), { title: 'Arroz con pollo', by: 'Grandma Maria', category: 'mains', time: '1 hr', servings: '6', ingredients: 'rice\nchicken', steps: 'cook', photo: IMG, uid: 'bob', author: 'Bob', createdAt: 'x', updatedAt: 'x', updatedBy: 'Bob' }), true);
await t('recipe bad category rejected', addDoc(collection(bob, 'recipes'), { title: 'X', category: 'snacks', ingredients: '', steps: '', uid: 'bob' }), false);
await t('another member fixes a recipe', updateDoc(doc(bob, 'recipes/r1'), { steps: 'bake at 350', updatedAt: 'y', updatedBy: 'Bob' }), true);
await t('recipe edit cannot change owner', updateDoc(doc(bob, 'recipes/r1'), { uid: 'bob' }), false);
await t('share a memory of Hector', addDoc(collection(bob, 'tributes'), { text: 'He taught me to fish.', uid: 'bob', author: 'Bob', createdAt: 'x' }), true);
await t('cannot post a memory as someone else', addDoc(collection(bob, 'tributes'), { text: 'x', uid: 'alice', author: 'Alice', createdAt: 'x' }), false);
await t('cannot delete someone else\'s memory', deleteDoc(doc(bob, 'tributes/t1')), false);
await t('light a candle', setDoc(doc(bob, 'candles/bob'), { name: 'Bob', litAt: 'x' }), true);
await t('cannot light a candle for someone else', setDoc(doc(bob, 'candles/alice'), { name: 'Alice', litAt: 'x' }), false);
await t('members see candles', getDocs(collection(bob, 'candles')), true);

console.log('— invite settings (admins)');
await t('admin reads the invite code', getDoc(doc(alice, 'config/invite')), true);
await t('admin changes the invite code', setDoc(doc(alice, 'config/invite'), { code: 'coral-tide-4821', requireApproval: false }), true);
await t('old code stops working', setDoc(doc(as('gus', 'gus@x.com'), 'joins/gus'), { code: 'seashell', createdAt: 'x' }), false);
await t('new code works', setDoc(doc(as('hal', 'hal@x.com'), 'joins/hal'), { code: 'coral-tide-4821', createdAt: 'x' }), true);
await t('admin turns on approval', updateDoc(doc(alice, 'config/invite'), { requireApproval: true }), true);
await t('code must be 6+ characters', setDoc(doc(alice, 'config/invite'), { code: 'abc', requireApproval: true }), false);
await t('code must be letters, numbers, dashes', setDoc(doc(alice, 'config/invite'), { code: 'bad code!', requireApproval: true }), false);
await t('invite settings reject extra fields', setDoc(doc(alice, 'config/invite'), { code: 'coral-tide-4821', requireApproval: true, owner: 'x' }), false);
await t('non-admin cannot change the code', setDoc(doc(bob, 'config/invite'), { code: 'bobs-own-code', requireApproval: false }), false);
await t('admin cannot touch other config docs', setDoc(doc(alice, 'config/other'), { code: 'whatever1' }), false);
await t('nobody can delete invite settings', deleteDoc(doc(alice, 'config/invite')), false);
await env.withSecurityRulesDisabled(async c => { await deleteDoc(doc(c.firestore(), 'config/invite')); });
await t('admin can create the invite code from the hub', setDoc(doc(alice, 'config/invite'), { code: 'first-code-2026', requireApproval: false }), true);

console.log('— approval required');
await seed({ requireApproval: true });
const fay = as('fay', 'fay@x.com');
await assertSucceeds(setDoc(doc(fay, 'joins/fay'), { code: 'seashell', createdAt: 'x' }));
const fayDoc = approved => ({ name: 'Fay', email: 'fay@x.com', uid: 'fay', joinedDate: 'x', approved });
await t('cannot skip approval', setDoc(doc(fay, 'users/fay'), fayDoc(true)), false);
await t('join as pending', setDoc(doc(fay, 'users/fay'), fayDoc(false)), true);
await t('pending member can read own doc', getDoc(doc(fay, 'users/fay')), true);
await t('pending member cannot read family data', getDocs(collection(fay, 'memories')), false);
await t('pending member cannot list members', getDocs(collection(fay, 'users')), false);
await t('pending member cannot approve self', updateDoc(doc(fay, 'users/fay'), { approved: true }), false);
await t('non-admin cannot approve', updateDoc(doc(bob, 'users/fay'), { approved: true }), false);
await t('admin cannot change a member\'s email while approving', updateDoc(doc(alice, 'users/fay'), { approved: true, email: 'x@x.com' }), false);
await t('admin approves', updateDoc(doc(alice, 'users/fay'), { approved: true }), true);
await t('approved member reads family data', getDocs(collection(fay, 'memories')), true);
await t('admin removes a member', deleteDoc(doc(alice, 'users/fay')), true);
await t('removed member loses access', getDocs(collection(fay, 'memories')), false);

console.log('— owner + admin powers');
await seed();
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  for (const [uid, name] of [['owen', 'Owen'], ['mia', 'Mia']]) await setDoc(doc(db, `users/${uid}`), { name, email: `${uid}@x.com`, uid, joinedDate: 'x' });
  await setDoc(doc(db, 'comments/c2'), { parent: 'updates/p1', text: 'spam', uid: 'bob', author: 'Bob', createdAt: 'x' });
  await setDoc(doc(db, 'tributes/t2'), { text: 'by bob', uid: 'bob', author: 'Bob', createdAt: 'x' });
});
const owen = as('owen', 'owen@x.com'), mia = as('mia', 'mia@x.com');
const claim = (db, uid, key) => { const b = writeBatch(db); b.set(doc(db, 'config/owner'), { uid, key, claimedAt: 'x' }); b.update(doc(db, `users/${uid}`), { role: 'owner' }); return b.commit(); };
await t('cannot just set your own role to owner', updateDoc(doc(owen, 'users/owen'), { role: 'owner' }), false);
await t('owner claim needs the right key', claim(owen, 'owen', 'guess-the-key'), false);
await t('cannot claim on someone else\'s behalf', (() => { const b = writeBatch(owen); b.set(doc(owen, 'config/owner'), { uid: 'mia', key: TEST_OWNER_KEY, claimedAt: 'x' }); b.update(doc(owen, 'users/mia'), { role: 'owner' }); return b.commit(); })(), false);
await t('claim ownership with the owner key', claim(owen, 'owen', TEST_OWNER_KEY), true);
await t('the owner key works only once', claim(mia, 'mia', TEST_OWNER_KEY), false);
await t('nobody can read the stored owner claim', getDoc(doc(owen, 'config/owner')), false);
await t('owner reads the invite code', getDoc(doc(owen, 'config/invite')), true);
await t('owner changes the invite code', setDoc(doc(owen, 'config/invite'), { code: 'owner-made-code', requireApproval: true }), true);
await t('owner makes Bob an admin', updateDoc(doc(owen, 'users/bob'), { role: 'admin' }), true);
await t('owner cannot create a second owner', updateDoc(doc(owen, 'users/mia'), { role: 'owner' }), false);
await t('admins cannot make admins', updateDoc(doc(bob, 'users/mia'), { role: 'admin' }), false);
await t('admin edits a member\'s details', updateDoc(doc(bob, 'users/mia'), { phone: '555-0100', bio: 'Updated by an admin' }), true);
await t('admin cannot change a member\'s email', updateDoc(doc(bob, 'users/mia'), { email: 'mia2@x.com' }), false);
await t('admin cannot edit the owner', updateDoc(doc(alice, 'users/owen'), { phone: '1' }), false);
await t('admin cannot demote the owner', updateDoc(doc(alice, 'users/owen'), { role: '' }), false);
await t('admin cannot remove the owner', deleteDoc(doc(alice, 'users/owen')), false);
await t('admin cannot remove another admin', deleteDoc(doc(alice, 'users/bob')), false);
await t('owner cannot demote themselves by accident', updateDoc(doc(owen, 'users/owen'), { role: 'admin' }), false);
await t('owner takes admin away', updateDoc(doc(owen, 'users/bob'), { role: '' }), true);
await t('admin deletes anyone\'s comment', deleteDoc(doc(alice, 'comments/c2')), true);
await t('admin removes anyone\'s guestbook memory', deleteDoc(doc(alice, 'tributes/t2')), true);
await t('members still cannot delete others\' memories', deleteDoc(doc(mia, 'tributes/t1')), false);
await t('admin removes a member', deleteDoc(doc(alice, 'users/mia')), true);
await t('owner removes an admin', deleteDoc(doc(owen, 'users/alice')), true);

console.log('— family globe');
await seed();
const spot = { lat: 25.8, lng: -80.2, label: 'Miami, FL', tz: 'America/New_York' };
await t('put yourself on the globe', updateDoc(doc(bob, 'users/bob'), { place: spot }), true);
await t('take yourself off the globe', updateDoc(doc(bob, 'users/bob'), { place: null }), true);
await t('globe spot needs real coordinates', updateDoc(doc(bob, 'users/bob'), { place: { ...spot, lat: 123 } }), false);
await t('globe spot needs a place name', updateDoc(doc(bob, 'users/bob'), { place: { lat: 1, lng: 2 } }), false);
await t('globe spot rejects extra fields', updateDoc(doc(bob, 'users/bob'), { place: { ...spot, street: '12 Seagrape Ln' } }), false);
await t('cannot move someone else\'s pin', updateDoc(doc(bob, 'users/alice'), { place: spot }), false);

console.log('— time capsules');
await seed();
const HOUR = 3600e3, YEAR = 365 * 24 * HOUR;
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'capsules/old'), { title: 'Opened already', uid: 'alice', author: 'Alice', createdAt: 'x', openAt: Date.now() - HOUR, hasPhoto: false });
  await setDoc(doc(db, 'capsuleLetters/old'), { text: 'Hello from the past', uid: 'alice' });
  await setDoc(doc(db, 'capsules/later'), { title: 'Not yet', uid: 'alice', author: 'Alice', createdAt: 'x', openAt: Date.now() + YEAR, hasPhoto: false });
  await setDoc(doc(db, 'capsuleLetters/later'), { text: 'Secret until next year', uid: 'alice' });
  await setDoc(doc(db, 'users/dan'), { name: 'Dan', email: 'dan@x.com', uid: 'dan', joinedDate: 'x' });
});
const dan = as('dan', 'dan@x.com');
const capsule = (over = {}) => ({ title: 'For Sofia at 18', to: 'Sofia', uid: 'bob', author: 'Bob Agraz', createdAt: 'x', openAt: Date.now() + YEAR, hasPhoto: false, ...over });
const seal = (db, id, cap, letter) => { const b = writeBatch(db); b.set(doc(db, `capsules/${id}`), cap); if (letter) b.set(doc(db, `capsuleLetters/${id}`), letter); return b.commit(); };
await t('members see sealed capsules (but not what\'s inside)', getDocs(collection(bob, 'capsules')), true);
await t('a sealed letter can\'t be read early — not even by its writer', getDoc(doc(alice, 'capsuleLetters/later')), false);
await t('nobody else can read it early either', getDoc(doc(bob, 'capsuleLetters/later')), false);
await t('letters can\'t be listed', getDocs(collection(bob, 'capsuleLetters')), false);
await t('once the day comes, the family can read it', getDoc(doc(bob, 'capsuleLetters/old')), true);
await t('outsiders can\'t read opened letters', getDoc(doc(eve, 'capsuleLetters/old')), false);
await t('seal a capsule with its letter', seal(bob, 'k1', capsule(), { text: 'Dear Sofia…', uid: 'bob' }), true);
await t('seal one with a photo', seal(bob, 'k2', capsule({ hasPhoto: true }), { text: 'Look at us!', photo: IMG, uid: 'bob' }), true);
await t('a capsule needs its letter', seal(bob, 'k3', capsule(), null), false);
await t('the opening day must be in the future', seal(bob, 'k4', capsule({ openAt: Date.now() - HOUR }), { text: 'x', uid: 'bob' }), false);
await t('…and less than 100 years away', seal(bob, 'k5', capsule({ openAt: Date.now() + 101 * YEAR }), { text: 'x', uid: 'bob' }), false);
await t('cannot seal one in someone else\'s name', seal(bob, 'k6', capsule({ uid: 'alice' }), { text: 'x', uid: 'bob' }), false);
await t('cannot swap the letter in a sealed capsule', setDoc(doc(alice, 'capsuleLetters/later'), { text: 'Replaced!', uid: 'alice' }), false);
await t('cannot slip a letter into someone else\'s capsule', (async () => { await deleteDoc(doc(alice, 'capsuleLetters/later')); await setDoc(doc(bob, 'capsuleLetters/later'), { text: 'Mine now', uid: 'bob' }); })(), false);
await t('cannot change a capsule\'s opening day', updateDoc(doc(bob, 'capsules/k1'), { openAt: Date.now() + 2 * HOUR }), false);
await t('cannot mark a sealed capsule as opened', updateDoc(doc(bob, 'capsules/k1'), { 'openedBy.bob': true }), false);
await t('mark an opened capsule as read', updateDoc(doc(bob, 'capsules/old'), { 'openedBy.bob': true }), true);
await t('cannot mark it read for someone else', updateDoc(doc(bob, 'capsules/old'), { 'openedBy.alice': true }), false);
await t('the writer can delete their capsule', deleteDoc(doc(bob, 'capsules/k2')), true);
await t('other members cannot delete it', deleteDoc(doc(dan, 'capsules/k1')), false);
await t('admins can remove any capsule', deleteDoc(doc(alice, 'capsules/k1')), true);

console.log('— voice stories');
await seed();
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'users/dan'), { name: 'Dan', email: 'dan@x.com', uid: 'dan', joinedDate: 'x' }));
const audio = n => Bytes.fromUint8Array(new Uint8Array(n).fill(7));
const story = (over = {}) => ({ title: 'How we met', prompt: 'How did you two meet?', uid: 'bob', author: 'Bob Agraz', createdAt: 'x', duration: 42.5, mime: 'audio/webm;codecs=opus', parts: 1, peaks: 'AAECAwQ=', ...over });
const record = (db, id, st, parts) => { const b = writeBatch(db); b.set(doc(db, `stories/${id}`), st); parts.forEach((p, n) => b.set(doc(db, `storyAudio/${id}_${n}`), { story: id, n, data: p, uid: st.uid })); return b.commit(); };
await t('save a voice story', record(bob, 's1', story(), [audio(2000)]), true);
await t('save a long one in three parts', record(bob, 's2', story({ parts: 3, mime: 'audio/mp4' }), [audio(900000), audio(900000), audio(1000)]), true);
await t('members can listen', getDocs(query(collection(alice, 'storyAudio'), where('story', '==', 's1'))), true);
await t('outsiders cannot listen', getDocs(query(collection(eve, 'storyAudio'), where('story', '==', 's1'))), false);
await t('a story needs its audio', record(bob, 's3', story(), []), false);
await t('audio parts are at most 900 KB', record(bob, 's4', story(), [audio(900001)]), false);
await t('audio must be audio bytes', (() => { const b = writeBatch(bob); b.set(doc(bob, 'stories/s5'), story()); b.set(doc(bob, 'storyAudio/s5_0'), { story: 's5', n: 0, data: 'not bytes', uid: 'bob' }); return b.commit(); })(), false);
await t('only audio types are allowed', record(bob, 's6', story({ mime: 'text/html' }), [audio(10)]), false);
await t('cannot add audio to someone else\'s story', setDoc(doc(alice, 'storyAudio/s1_1'), { story: 's1', n: 1, data: audio(10), uid: 'alice' }), false);
await t('cannot replace a story\'s audio later', setDoc(doc(bob, 'storyAudio/s1_2'), { story: 's1', n: 2, data: audio(10), uid: 'bob' }), false);
await t('cannot record in someone else\'s name', record(bob, 's7', story({ uid: 'alice' }), [audio(10)]), false);
await t('heart a story', updateDoc(doc(alice, 'stories/s1'), { 'hearts.alice': true }), true);
await t('cannot retitle someone else\'s story', updateDoc(doc(alice, 'stories/s1'), { title: 'Mine' }), false);
await t('other members cannot delete a story', deleteDoc(doc(dan, 'stories/s1')), false);
await t('the storyteller can delete it', deleteDoc(doc(bob, 'stories/s2')), true);
await t('admins can remove any story', deleteDoc(doc(alice, 'stories/s1')), true);

console.log('— family tree');
await seed();
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'users/dan'), { name: 'Dan', email: 'dan@x.com', uid: 'dan', joinedDate: 'x' }));
const meta = { v: 1, name: 'Agraz Family Tree', treeId: '191301314', source: 'Ancestry', people: 2, families: 1, portraits: 0, earliest: 1900, generations: 2, parts: 1, importedAt: 'x', importedBy: 'Alice Agraz' };
const part = { people: [{ id: 'I1', n: 'Ana Agraz', fc: [], fs: ['F1'] }, { id: 'I2', n: 'Leo Agraz', L: 1, fc: ['F1'], fs: [] }], families: [{ id: 'F1', w: 'I1', c: ['I2'] }] };
await t('members can’t import the tree', setDoc(doc(bob, 'tree/meta'), meta), false);
await t('admins import the tree', (() => { const b = writeBatch(alice); b.set(doc(alice, 'tree/meta'), meta); b.set(doc(alice, 'tree/part0'), part); return b.commit(); })(), true);
await t('members read the tree', getDoc(doc(bob, 'tree/part0')), true);
await t('outsiders can’t read the tree', getDoc(doc(eve, 'tree/part0')), false);
await t('tree pieces are named part0…part19', setDoc(doc(alice, 'tree/secret'), part), false);
await t('tree pieces hold only people and families', setDoc(doc(alice, 'tree/part1'), { ...part, notes: 'x' }), false);
await t('members can’t change the tree', setDoc(doc(bob, 'tree/part0'), part), false);
await t('link yourself to your place in the tree', updateDoc(doc(bob, 'users/bob'), { treeId: 'I182483266401' }), true);
await t('tree link must be a tree id', updateDoc(doc(bob, 'users/bob'), { treeId: 'not a/valid id' }), false);
await t('members add a photo to someone in the tree', setDoc(doc(bob, 'treePhotos/I1'), { img: IMG, uid: 'bob', by: 'Bob Agraz', createdAt: 'x' }), true);
await t('tree photos must be images', setDoc(doc(bob, 'treePhotos/I2'), { img: 'javascript:alert(1)', uid: 'bob', by: 'Bob Agraz', createdAt: 'x' }), false);
await t('tree photos stay small', setDoc(doc(bob, 'treePhotos/I2'), { img: 'data:image/jpeg;base64,' + 'A'.repeat(90000), uid: 'bob', by: 'Bob Agraz', createdAt: 'x' }), false);
await t('other members can’t replace your photo', setDoc(doc(dan, 'treePhotos/I1'), { img: IMG, uid: 'dan', by: 'Dan', createdAt: 'y' }), false);
await t('admins can replace any tree photo', setDoc(doc(alice, 'treePhotos/I1'), { img: IMG, uid: 'alice', by: 'Alice Agraz', createdAt: 'y' }), true);
await t('other members can’t delete a tree photo', deleteDoc(doc(dan, 'treePhotos/I1')), false);
await t('outsiders can’t see tree photos', getDoc(doc(eve, 'treePhotos/I1')), false);
const research = { people: { I1: { doc: [{ k: 'grave', t: 'Find a Grave memorial', u: 'https://www.findagrave.com/memorial/1' }] } }, count: 1, createdAt: 'x', by: 'Alice Agraz' };
await t('admins add research notes', setDoc(doc(alice, 'tree/research'), research), true);
await t('members read research notes', getDoc(doc(bob, 'tree/research')), true);
await t('members can’t change research notes', setDoc(doc(bob, 'tree/research'), research), false);
await t('research notes hold only what’s expected', setDoc(doc(alice, 'tree/research'), { ...research, secret: 'x' }), false);
await t('admins can remove the tree', deleteDoc(doc(alice, 'tree/part0')), true);

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
