# Pontis Energy dealer app

Dealers fill a checked form for each client and send it to Pontis Energy as one PDF on WhatsApp.
The Pontis office (admin) adds dealers and sends them their login on WhatsApp, and turns the received PDFs into an Excel list.

- **One login screen.** The admin number and password come from the settings below; dealers are kept in a Cloudflare D1 database.
- **Client details never reach the server.** They stay on the dealer's phone (IndexedDB) until the PDF is sent, then **Done** removes them. Unfinished forms are removed 30 days after they were last opened; the home screen warns in the last week.
- **Section 1 (work start)**: Cash or Loan. Loan with age 60+ asks for a co-applicant. **Section 2 (after installation)**: panels (one serial box per panel, duplicates caught), inverter, energy meter.
- **Checks**: required fields, 10-digit mobile, Aadhaar 12 digits with its check digit, PAN format, email, consumer number (warns when not 13 digits).
- **GPS photos** (rooftop; panels with customer) must be taken with the camera just now; the location and time are printed on the photo.
- **PDF** is made on the phone: a details table, then one page per photo. The typed details are also stored inside the PDF (`/PontisData`), which the admin's **Excel** tab reads to make a CSV per section.
- Fields are listed in `public/js/fields.js`; change them there.
- Logins: 10 wrong passwords lock that number for 5 minutes on that connection only, so nobody can lock the office out by typing wrong passwords for its number. 50 wrong passwords for one number within 15 minutes, from anywhere, lock it for 15 minutes. A login lasts 30 days and is renewed while the app is used. Blocking, deleting or resetting a dealer logs them out.

## Files

```
public/            the app (static files, installable, works offline)
  js/fields.js     the two forms and their checks
  js/app.js        screens: login, dealer, admin
  js/pdf.js        PDF writer
  js/media.js      photo resize and GPS stamp
  js/store.js      drafts and photos on the phone
  js/office.js     Excel (CSV) from PDFs
functions/api/     Cloudflare Pages Functions entry (/api/*)
lib/server.js      logins, sessions, dealers (D1)
```

## Run locally

```
npm install
copy .dev.vars.example .dev.vars   (then fill in the values)
npm run dev                        (http://localhost:8788)
```

## Deploy on Cloudflare Pages (free plan)

1. Push this folder to a new GitHub repository.
2. Cloudflare dashboard → **Storage & Databases → D1** → **Create database**, name `pontis-dealer`.
3. **Workers & Pages → Create → Pages → Connect to Git**, pick the repository.
   Build command: *(none)*. Build output directory: `public`.
4. In the new project → **Settings → Bindings → Add → D1 database**: variable name `DB`, database `pontis-dealer`.
5. **Settings → Variables and Secrets**, add as **Secret** (Production):
   - `ADMIN_PHONE`: the Pontis office mobile number (10 digits)
   - `ADMIN_PASSWORD`: the admin password
   - `SESSION_SECRET`: a long random string (40+ characters)
   - `PASSWORD_SECRET`: another long random string. **Never change it** once dealers exist, or their passwords stop working.
6. **Deployments → Retry deployment** (settings apply from the next deployment). The tables are created on the first login.
7. Optional: **Custom domains** to use your own address.

Every push to `main` deploys again. **Always raise `VERSION` in `public/sw.js` with each release.** The app opens from the files saved on the phone (fast on a weak signal, and offline), so phones only fetch new files when `VERSION` changes. They fetch them in the background; the open app switches to them when no form is open, otherwise the next time it opens.
