# Pontis Energy dealer app

Dealers fill a checked form for each client and send it to Pontis Energy as one PDF on WhatsApp.
The Pontis office (admin) adds dealers and sends them their login on WhatsApp, and adds the received PDFs to the **Clients** tab to see each client and save their photos.

- **One login screen.** The admin number and password come from the settings below; dealers are kept in a Cloudflare D1 database.
- **Client details never reach the server.** They stay on the dealer's phone (IndexedDB) until the PDF is sent, then **Done** removes them. Unfinished forms are removed 30 days after they were last opened; the home screen warns in the last week. After **Done** on Section 1, the phone keeps the client's name, consumer number, mobile and Aadhaar number to fill Section 2; the Aadhaar number is removed when Section 2 is sent.
- **Section 1 (work start)**: Cash or Loan. Loan with age 60+ asks for a co-applicant. **Section 2 (after installation)**: panels (one serial box per panel, duplicates caught), inverter, energy meter.
- **Home screen**: two lists, **Section 1** and **Section 2**, each with the forms not sent yet first, then the ones sent.
  - **Continue…** on a Section 1 form asks: **Continue in Section 1**, or **Continue in Section 2**. Section 2 opens with the consumer number, name and Aadhaar number from Section 1, and the client is then in both lists. A Section 1 already sent has a **Section 2** button instead.
  - **Start Section 2** lists the Section 1 clients still waiting for Section 2 (or an empty form for a client not in the list).
  - A client's Section 2 is opened again, never made twice: it belongs to the Section 1 it was opened from, or has the same consumer number.
  - **Delete**: forms not sent yet (with their photos), and sent forms, can be deleted from either list at any time. Deleting a sent form removes only this phone's list entry (the PDF has already gone to Pontis Energy); the client stays in the other section's list.
- **Scan instead of typing**: the Aadhaar, PAN, consumer number, inverter and meter serial boxes, and each panel's serial box, have a scan button inside the box. It opens the camera, or reads a photo or screenshot (**Choose a photo**). **Scan all panels** keeps the camera open and fills the empty panel boxes in order (a panel scanned twice is not added again).
  - **Aadhaar**: old cards and letters have the full number in the QR code. New cards, e-Aadhaar and mAadhaar have the *secure QR code*, which holds only the last 4 digits (UIDAI leaves the full number out on purpose): the app says so, and then warns if the typed number does not end in those 4 digits. Both give the name and date of birth, which fill the name (and the age, on a loan) when those are still empty.
  - **PAN**: read when the QR code shows the PAN as text. The newer PAN cards' QR code is locked (only the Income Tax Department's app reads it); the app then says to type the PAN.
  - **KSEB bill**: the 13-digit consumer number is taken from the bill's QR code or barcode. **Serial numbers**: the code's text, or the "S/N" / "Serial No" in it. When a code holds several possible values, the dealer picks the right one.
  - **From the photos added**: the Aadhaar and PAN card photos, the KSEB bill photo and the serial number photos are searched for their QR code or barcode too. An empty box is filled; a box already filled is checked, with a warning under the photo when the code says something else. Panel serial photos fill the empty panel boxes (one photo can hold several codes). Set with `readInto` in `fields.js`.
  - Android Chrome reads codes with its built-in reader. iPhones and computers use ZXing (`public/vendor/zxing`), which needs `'wasm-unsafe-eval'` in the Content-Security-Policy (`public/_headers`); it is fetched once and kept for offline use.
- **Checks**: required fields, 10-digit mobile, Aadhaar 12 digits with its check digit, PAN format, email, consumer number (warns when not 13 digits).
- **GPS photos** (rooftop; panels with customer) can come from the camera, the gallery or a computer. The location and time printed on the photo come from the GPS saved in the photo itself (phone camera with location on, or a GPS camera app); without it, from the device's location when the photo is added (marked "location when added" if the photo is older than 10 minutes). If neither is available (often on a computer), the photo is still added but marked **No GPS** on the screen and in the PDF.
- **PDF** is made on the phone: a details table, then one page per photo. The typed details are also stored inside the PDF (`/PontisData`).
- **Clients tab (admin)**: add the PDFs dealers send (choose or drop many at once). Forms are grouped by consumer number, so Section 1 and Section 2 of a client show together.
  - Counts at the top (all, waiting for Section 2, installed) also work as filters; search by name, consumer number, mobile or Ref; filter by dealer and Cash / Loan; sort by date, name or dealer. Filters are kept in the address, so Back returns to the same list. Each dealer on the Dealers tab links to their clients.
  - Each client: open the Section 1 / 2 PDF, delete; or tick several and delete them together.
  - A client's page: all details (with copy buttons), call the customer, WhatsApp the dealer, open or save each PDF, and every photo taken out of the PDF unchanged: view large (Previous / Next), **Save** one, or **Save all** (one ZIP on a computer; the share sheet on a phone, to save them to the gallery).
  - The PDFs are kept on that device (IndexedDB) until deleted; the footer shows how much space they use.
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
  js/office.js     Clients tab: reads PDFs, takes photos out, ZIP
  js/scan.js       QR code / barcode reading: camera, photos, and the value for each field
  vendor/zxing/    ZXing code reader for iPhones and computers (zxing-wasm 3.1.7, MIT; from the npm
                   package: dist/es/share.js, dist/es/reader/index.js, dist/reader/zxing_reader.wasm)
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
