# agrazfamily.com

The home of the Agraz family online — a public site anyone can visit, and a
private, password-protected **Family Hub** for the things we only share with
each other.

| | URL | Who can see it |
|---|---|---|
| **Public site** | `https://www.agrazfamily.com/` | Everyone |
| **Family Hub** | `https://www.agrazfamily.com/family/` | Signed-in family members only |

Old links like `agrazfamily.com/#memories` still work — they forward to the hub.

---

## ⚠️ Setup — re-publish the rules whenever `firestore.rules` changes

The hub's privacy is enforced by **Firestore security rules on Google's
servers**, not by the website code (which is public). This version moves the
invite code check onto the server, so two quick steps are needed in the
[Firebase console](https://console.firebase.google.com/project/agrazfamily):

1. **Publish the rules.** Firestore Database → **Rules** → paste the contents
   of [`firestore.rules`](firestore.rules) → **Publish**.
   *(or `firebase deploy --only firestore:rules`)*
2. **Make yourself the owner (once).** Sign in to the hub as yourself and go to
   **Invite family**. Until the family has an owner, that page shows a setup
   card: it checks that step 1 is done, then you paste your one-time **owner
   key** (or the whole owner link, `agrazfamily.com/family/#claim?key=…`) and
   tap **Become the owner**. Your invite code is created on the spot. (Opening
   the owner link while signed in does the same.) The key works exactly once.
   *(Lost it? In the console, add the field `role` (string) = `owner` to your
   document in `users`.)*
3. From then on, invite links, the QR code, the code itself and approvals are
   all managed on the **Invite family** page.

The old code (`agraz2025`) was visible in the old site's source, so use the new
one the Invite page creates.

Until steps 1–3 are done, existing members can still sign in, but **new people
can't join** (they'll see "That invite code isn't right") and the newer
features (Vault, profiles, recipes, RSVPs, hearts, comments, guestbook,
candles, Family Globe, Voice Stories, Time Capsules) show "needs the latest
security rules".

**Publishing the rules is what actually protects the family's data.** The
site itself won't let anyone join without a server-checked code, but until the
rules are published, the database still trusts any signed-in account.

Also worth a two-minute look:

- **Authentication → Users** and the **`users`** collection — because the old
  invite code was public, check that every account belongs to someone you know.
- **Authentication → Settings → Authorized domains** should include
  `www.agrazfamily.com`.

## Managing the family — the **Invite family** page

Everything lives in the hub under **Invite family** (sidebar, the phone's
**More** menu, and the Directory):

- **Invite someone:** tap **Share…** (phones), **Text message**, **Email**, or
  **Copy link**. The link has the code built in
  (`agrazfamily.com/family/#join?code=…`), so they only add their name, email
  and a password. Together in person? Let them scan the **QR code**.
- **Change the invite code:** **Make a new code** or **Choose my own**. Old
  links and codes stop working; everyone who already joined stays in.
- **Approve new members (recommended):** turn on **Approve new members before
  they get in**. New people wait on a "You're almost in" screen; you approve
  them right on the Invite page or in the Directory (a badge shows how many
  are waiting).
- **Remove someone:** admins can decline/remove from the site, or delete their
  document in the `users` collection. To block them for good, also disable
  their account under Authentication → Users.

### Owner and admins

| | Owner | Admin | Member |
|---|:-:|:-:|:-:|
| Use the whole hub, edit their own profile | ✓ | ✓ | ✓ |
| Invite code, invite links, approvals | ✓ | ✓ | |
| Edit anyone's directory details | ✓ | ✓ | |
| Delete any update, comment or guestbook entry | ✓ | ✓ | |
| Remove members | ✓ | ✓ | |
| Make or un-make admins, remove admins | ✓ | | |
| Be demoted or removed by someone else | never | by the owner | by admins |

- **Manage someone:** Directory → the settings icon on their card. Edit their details,
  turn **Family admin** on or off (owner only), or **Remove from family**.
- There's only ever **one owner**, claimed once with the owner link. Nobody —
  not even an admin — can change or remove the owner from the site.
- Only admins and the owner can see or change the invite code.

## What's in the Family Hub

- **Home** — greeting, what's coming up, birthdays, recent photos and updates,
  a 🎉 birthday banner (with confetti) on someone's big day, and **On this
  day** — photos the family shared this week in past years
- **Photos** — shared album with drag-and-drop upload, a full-screen viewer,
  hearts and comments
- **Calendar** — month view + agenda; birthdays from the directory appear
  automatically. Everyone can **RSVP** (Going / Maybe / Can't go) and **add
  any event to their own calendar** (Apple, Outlook or Google)
- **Updates** — a family feed with hearts and comments
- **Family Globe** — a live, spinning Earth showing where everyone lives,
  with the real day/night line (computed from the sun's position), everyone's
  local time, distances, and **Family clocks**: slide through the next 24
  hours to see who's awake, and it suggests the best time for a family call.
  Each person adds their own spot (tap the globe or "Use my location", rounded
  to about 7 miles — never a street address)
- **Voice Stories** — record family members telling their stories, right in
  the browser, with a live waveform and story starters ("How did you two
  meet?"). Everyone can listen, heart and replay them
- **Time Capsules** — write a letter (and tuck in a photo) that stays
  **sealed until a date you choose** — a grandchild's 18th birthday, next New
  Year's, ten years from now. The seal is enforced by the security rules on
  Google's servers, so nobody can open it early in the hub, not even the person
  who wrote it. When the day comes, the hub announces it and opens it with a
  little ceremony
- **Recipes** — the family recipe book: photos, tick-off ingredients,
  numbered steps, search, and a clean print layout
- **Directory** — everyone's phone, email, birthday and address (each person edits their own)
- **Family Vault** — shared notes for emergency contacts, doctors, insurance,
  Wi-Fi… Opening it asks for your password again — or, once you turn on
  **quick unlock**, Face ID / Touch ID / fingerprint / Windows Hello (a passkey
  kept on that device). Notes stay hidden until tapped, and it **locks itself**
  after 5 idle minutes or when you leave the tab. *Don't store bank passwords
  or full SSNs.*
- **In Memory** — the memorial for Hector: the family's photos, **light a
  candle**, and a guestbook of shared memories
- **Invite family** — share an invite link (code built in) by text, email or
  QR code, change the code, and approve new members
- **My Profile** — photo, contact details, light/dark theme, password reset,
  and the per-device JARVIS address
- Links to the **Ancestry family tree** and **JARVIS**
- **Follows the sun** — the homepage hero and the hub's photos change with
  the time of day (first light, midday, golden hour, and a starry night)
- **Install as an app** — phones get a one-time tip to add the hub to their
  home screen
- **Smooth page transitions** in browsers that support them (View Transitions)

Photos are stored in Firestore (resized in the browser to stay under the 1 MB
document limit), and so are voice recordings (compressed speech, split into
parts of under 1 MB; a 5-minute story is about 1.2 MB). Nothing private is
ever stored in this repository.

**About the seals and locks:** a time capsule can't be read early *through the
hub* — the rules refuse to hand it over. Like everything in the database, it's
still visible to whoever manages the Firebase project in the Firebase console,
so treat the console like the family safe. Quick unlock protects the vault on a
phone or computer that's already signed in; the vault's notes are still
protected by the rules either way.

## Editing the public site

Everything public is in [`index.html`](index.html) — plain HTML, edit the text
directly. Only put things there you're happy for anyone on the internet to see.

**Using your own photos:** the public photos are free-to-use images from
Unsplash. To use family photos instead, add them to `assets/img/` and change
each `<img src="…">` (and `srcset`) in `index.html`, e.g.
`src="/assets/img/thanksgiving.jpg"`. Update the `alt` text too.

The memorial tribute text lives in `family/index.html`. Like all site code it's
technically public (only the hub's *data* is protected), so keep anything truly
private in the hub itself.

## How it's built

```
index.html            Public homepage
family/index.html     Family Hub (sign-in + app)
404.html              "Lost at sea" page
assets/css/base.css   Design tokens (light + dark), type, buttons, forms
assets/css/public.css Public site styles
assets/css/portal.css Family Hub styles
assets/js/public.js   Public site interactions
assets/js/portal.js   Family Hub app (Firebase Auth + Firestore)
assets/js/globe.js    Family Globe renderer (canvas, no libraries; loaded on demand)
assets/data/land.bin  Land mask for the globe (5 KB, from Natural Earth — public domain)
assets/icons.svg      Icon set + logo mark
firestore.rules       Server-side security rules (publish in Firebase)
sw.js                 Service worker (offline shell; never caches private data)
tests/                Security-rule + UI tests (run on every push)
tools/                make-land-mask.mjs rebuilds assets/data/land.bin
```

No build step — it's static HTML/CSS/JS served by GitHub Pages. Both pages ship
a strict Content-Security-Policy, and the hub clears private content from the
page on sign-out.

**Preview locally:**

```bash
npm run serve        # http://127.0.0.1:8080/
```

## Tests

Every push runs two test suites on GitHub (see *Actions → Tests*):

- **Security rules** (`tests/rules.test.mjs`) — ~170 checks against the
  Firestore emulator: outsiders and wrong invite codes are locked out, the code
  can't be read, pending members see nothing, nobody can heart/RSVP/comment as
  someone else, removed members lose access, only the owner can make admins
  and nobody can demote the owner, a sealed time capsule can't be read (or
  swapped) before its day, and voice recordings can't be faked or replaced.
- **UI** (`tests/ui.test.mjs`) — ~240 end-to-end checks in a real browser with
  a fake Firebase, a fake microphone and a virtual fingerprint sensor: sign-in,
  joining and approval, RSVPs and calendar invites, hearts and comments,
  recipes and printing, candles and guestbook, vault locking and quick unlock,
  the globe and family clocks, recording and playing voice stories, sealing and
  opening time capsules, birthday banner, follows-the-sun, and that private
  content is cleared on sign-out.

Run them yourself with `npm install` then `npm test` (needs Node 20+ and Java
for the emulator). To publish rules from the command line: `npm run deploy:rules`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Everyone gets "That invite code isn't right" | Rules not published, or `config/invite` missing — see setup above |
| "Needs the latest security rules" / "isn't set up yet" | Publish the latest `firestore.rules` |
| A new member is stuck on "You're almost in" | Approve them on the **Invite family** page (or in the Directory) |
| The Invite page says "ask a family admin" | Use the setup card on that page: paste your owner key and tap **Become the owner** |
| The setup card says the rules are "Not yet" published | Publish `firestore.rules` (Firebase console → Firestore Database → Rules), then tap **Check again** |
| "That owner link didn't work" | Publish the latest rules, sign in first, and use the link only once — the family may already have an owner |
| JARVIS opens the wrong address | My Profile → Preferences → JARVIS address (saved per device) |
| "Record a story" can't use the microphone | Allow the microphone for agrazfamily.com in the browser's site settings |
| "Use my location" doesn't work | Allow location for the site — or just tap the globe where you live |
| A capsule says "Almost — it opens any moment now" | The phone's clock is a little ahead of Google's; try again in a minute |
| Forgot password | "Forgot password?" on the sign-in screen emails a reset link |
