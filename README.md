# BAC Diary 2027 — Data Collection Website

Collects university contact data for the Bangladesh Accreditation Council Diary 2027,
lets admins review/approve it, and generates the Word file in the diary format
(e.g. `122-সোনারগাঁও ইউনিভার্সিটি (এসইউ).docx`).

## Run

```bash
npm install
cp .env.example .env      # set SESSION_SECRET, ADMIN_USER, ADMIN_PASS
npm start                 # http://localhost:3000
```

- University form: `/submit` (share this link)
- Admin panel: `/admin` (first run: `admin` / `admin123` unless ADMIN_PASS is set — you're asked to change it)

Requires Node 18+. Data (SQLite DB + generated Word files) is stored in `./data` — back this folder up.

## Workflow

1. Share `/submit`, or create a personal invite link per university from the dashboard.
2. University fills the form, sees a live preview of its diary entry, and gets a private link to edit until approved.
3. Admin reviews: **Approve** (assigns diary serial no. → Word file is generated), **Return for changes** (with a note the university sees), or **Reject**.
4. Admin can edit any field (including designations), regenerate, download, or **email the Word file** as an attachment.
5. **Diary compilation**: one combined Word file of all approved universities ordered by serial number; CSV export for Excel.

## Email

Settings → Email (SMTP). For Gmail: `smtp.gmail.com`, port 465, SSL on, use an App Password.
Optional automatic notices: new submission → admin; returned/approved → university.

## Word output

Unicode Bangla, default font **SutonnyOMJ** (looks like SutonnyMJ), Times New Roman for emails/websites,
Bangla digits for phone numbers. Changeable in Settings → Word file. The font must be installed on the
computer that opens/prints the file.

## Deploying

Any Node host / VPS: run `npm start` behind Nginx with HTTPS and set `COOKIE_SECURE=1`, and set
"Website address" in Settings so emailed links point to the public URL. Use pm2 or systemd to keep it running.
