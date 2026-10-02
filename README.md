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

## ⚠️ One-time setup (do this when you deploy this version)

The hub's privacy is enforced by **Firestore security rules on Google's
servers**, not by the website code (which is public). This version moves the
invite code check onto the server, so two quick steps are needed in the
[Firebase console](https://console.firebase.google.com/project/agrazfamily):

1. **Publish the rules.** Firestore Database → **Rules** → paste the contents
   of [`firestore.rules`](firestore.rules) → **Publish**.
   *(or `firebase deploy --only firestore:rules`)*
2. **Set the invite code.** Firestore Database → **Data** → **Start collection**
   - Collection ID: `config`
   - Document ID: `invite`
   - Field: `code` (string) = your new family invite code

   Pick a **new** code. The old code was visible in the old site's source, so
   treat it as public.

Until both are done, existing members can still sign in, but **new people
can't join** (they'll see "That invite code isn't right") and the new
**Family Vault / profile details** won't save.

Also worth a two-minute look:

- **Authentication → Users** and the **`users`** collection — because the old
  invite code was public, check that every account belongs to someone you know.
- **Authentication → Settings → Authorized domains** should include
  `www.agrazfamily.com`.

## Managing the family

- **Invite someone:** send them to `agrazfamily.com/family/#join` with the
  invite code.
- **Change the invite code:** edit `config/invite → code`. Existing members
  are unaffected.
- **Remove someone:** delete their document in the `users` collection (they
  lose access immediately) and optionally disable them under Authentication.

## What's in the Family Hub

- **Home** — greeting, what's coming up, birthdays, recent photos and updates
- **Photos** — shared album with drag-and-drop upload and a full-screen viewer
- **Calendar** — month view + agenda; birthdays from the directory appear automatically
- **Updates** — a family feed
- **Directory** — everyone's phone, email, birthday and address (each person edits their own)
- **Family Vault** — shared notes for emergency contacts, doctors, insurance,
  Wi-Fi… hidden until tapped. *Don't store bank passwords or full SSNs.*
- **In Memory** — the memorial for Hector, with the family's photos
- **My Profile** — photo, contact details, light/dark theme, password reset,
  and the per-device JARVIS address
- Links to the **Ancestry family tree** and **JARVIS**

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
```

No build step — it's static HTML/CSS/JS served by GitHub Pages. Both pages ship
a strict Content-Security-Policy, and the hub clears private content from the
page on sign-out.

**Preview locally:**

```bash
npx serve .          # or: python3 -m http.server 8080
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Everyone gets "That invite code isn't right" | Rules not published, or `config/invite` missing — see setup above |
| "The vault isn't set up yet" / profile won't save | Publish the latest `firestore.rules` |
| JARVIS opens the wrong address | My Profile → Preferences → JARVIS address (saved per device) |
| Forgot password | "Forgot password?" on the sign-in screen emails a reset link |
