// Security-rule tests for firestore.rules, run against the Firestore emulator:
//   npm run test:rules
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, getDocs, deleteDoc, query, where } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-agraz',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 }
});
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
await t('nobody can read the invite code', getDoc(doc(alice, 'config/invite')), false);
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
await t('admin cannot change other fields while approving', updateDoc(doc(alice, 'users/fay'), { approved: true, name: 'X' }), false);
await t('admin approves', updateDoc(doc(alice, 'users/fay'), { approved: true }), true);
await t('approved member reads family data', getDocs(collection(fay, 'memories')), true);
await t('admin removes a member', deleteDoc(doc(alice, 'users/fay')), true);
await t('removed member loses access', getDocs(collection(fay, 'memories')), false);

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
