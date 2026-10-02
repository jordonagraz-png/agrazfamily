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
2. **Make yourself an admin (once).** Firestore Database → **Data** → `users`
   → your document → **Add field** `role` (string) = `admin`.
3. **Open the hub → Invite family** and tap **Create invite code**. From then
   on, invites, codes and approvals are all managed on that page.

The old code (`agraz2025`) was visible in the old site's source, so use the new
one the Invite page creates.

Until steps 1–3 are done, existing members can still sign in, but **new people
can't join** (they'll see "That invite code isn't right") and the newer
features (Vault, profiles, recipes, RSVPs, hearts, comments, guestbook,
candles) show "needs the latest security rules".

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
- **More admins:** add `role` = `admin` to their `users` document in the
  console. Only admins can see or change the invite code.
- **Remove someone:** admins can decline/remove from the site, or delete their
  document in the `users` collection. To block them for good, also disable
  their account under Authentication → Users.

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
- **Recipes** — the family recipe book: photos, tick-off ingredients,
  numbered steps, search, and a clean print layout
- **Directory** — everyone's phone, email, birthday and address (each person edits their own)
- **Family Vault** — shared notes for emergency contacts, doctors, insurance,
  Wi-Fi… Opening it asks for your password again; notes stay hidden until
  tapped, and it **locks itself** after 5 idle minutes or when you leave the
  tab. *Don't store bank passwords or full SSNs.*
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

Photos are stored in Firestore (resized in the browser to stay under the 1 MB
document limit). Nothing private is ever stored in this repository.

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
assets/icons.svg      Icon set + logo mark
firestore.rules       Server-side security rules (publish in Firebase)
sw.js                 Service worker (offline shell; never caches private data)
tests/                Security-rule + UI tests (run on every push)
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

- **Security rules** (`tests/rules.test.mjs`) — ~90 checks against the
  Firestore emulator: outsiders and wrong invite codes are locked out, the code
  can't be read, pending members see nothing, nobody can heart/RSVP/comment as
  someone else, removed members lose access.
- **UI** (`tests/ui.test.mjs`) — ~100 end-to-end checks in a real browser with
  a fake Firebase: sign-in, joining and approval, RSVPs and calendar invites,
  hearts and comments, recipes and printing, candles and guestbook, vault
  locking, birthday banner, follows-the-sun, and that private content is
  cleared on sign-out.

Run them yourself with `npm install` then `npm test` (needs Node 20+ and Java
for the emulator). To publish rules from the command line: `npm run deploy:rules`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Everyone gets "That invite code isn't right" | Rules not published, or `config/invite` missing — see setup above |
| "Needs the latest security rules" / "isn't set up yet" | Publish the latest `firestore.rules` |
| A new member is stuck on "You're almost in" | Approve them on the **Invite family** page (or in the Directory) |
| The Invite page says "ask a family admin" | Add `role: "admin"` to your own `users` doc (one time) |
| JARVIS opens the wrong address | My Profile → Preferences → JARVIS address (saved per device) |
| Forgot password | "Forgot password?" on the sign-in screen emails a reset link |
