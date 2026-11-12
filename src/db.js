const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'bac-diary.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  display_name TEXT, must_change INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  serial_no TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- invited | pending | changes | approved | rejected
  data TEXT NOT NULL,
  univ_name TEXT,
  contact_email TEXT,
  admin_note TEXT,
  doc_file TEXT,
  doc_generated_at TEXT,
  doc_outdated INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  submitted_at TEXT,
  approved_at TEXT
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY, submission_id INTEGER REFERENCES submissions(id) ON DELETE CASCADE,
  action TEXT, actor TEXT, note TEXT, at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY, submission_id INTEGER REFERENCES submissions(id) ON DELETE SET NULL,
  recipients TEXT, subject TEXT, status TEXT, error TEXT, actor TEXT, at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

const DEFAULT_SETTINGS = {
  form_open: '1',
  deadline: '',
  form_notice: 'অনুগ্রহ করে বিশ্ববিদ্যালয়ের প্রশাসনিক দপ্তর ও IQAC-এর সঠিক তথ্য দিন। এই তথ্য বাংলাদেশ অ্যাক্রেডিটেশন কাউন্সিলের ডায়েরি ২০২৭-এ ছাপা হবে।',
  doc_font: 'SutonnyOMJ',
  latin_font: 'Times New Roman',
  bangla_digits: '1',
  smtp_host: '', smtp_port: '587', smtp_secure: '0', smtp_user: '', smtp_pass: '',
  mail_from: '', admin_notify_email: '',
  notify_university: '1',
  public_base_url: '',
  email_subject: 'বাংলাদেশ অ্যাক্রেডিটেশন কাউন্সিল ডায়েরি ২০২৭ — {university}',
  email_body: 'সম্মানিত মহোদয়,\n\nবাংলাদেশ অ্যাক্রেডিটেশন কাউন্সিলের ডায়েরি ২০২৭-এর জন্য আপনার প্রতিষ্ঠানের ({university}) তথ্য অনুমোদিত হয়েছে। চূড়ান্ত তথ্যের Word ফাইল সংযুক্ত করা হলো।\n\nধন্যবাদান্তে,\nবাংলাদেশ অ্যাক্রেডিটেশন কাউন্সিল',
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

// First-run admin account
if (!db.prepare('SELECT COUNT(*) c FROM admins').get().c) {
  const user = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASS || 'admin123';
  db.prepare('INSERT INTO admins(username,password_hash,display_name,must_change) VALUES (?,?,?,?)')
    .run(user, bcrypt.hashSync(pass, 10), 'অ্যাডমিন', process.env.ADMIN_PASS ? 0 : 1);
  console.log(`Created admin account "${user}"${process.env.ADMIN_PASS ? '' : ' with password "admin123" — change it after first login'}`);
}

const settings = {
  all() { return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value])); },
  get(k) { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? r.value : DEFAULT_SETTINGS[k]; },
  set(k, v) { db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v == null ? '' : String(v)); },
};

const newToken = () => crypto.randomBytes(18).toString('base64url');

function parse(row) {
  if (!row) return row;
  return Object.assign({}, row, { data: JSON.parse(row.data) });
}

const subs = {
  byId(id) { return parse(db.prepare('SELECT * FROM submissions WHERE id=?').get(id)); },
  byToken(t) { return parse(db.prepare('SELECT * FROM submissions WHERE token=?').get(t)); },
  list({ status, q } = {}) {
    let sql = 'SELECT * FROM submissions WHERE 1=1'; const p = [];
    if (status) { sql += ' AND status=?'; p.push(status); }
    if (q) { sql += ' AND (univ_name LIKE ? OR serial_no LIKE ? OR contact_email LIKE ? OR data LIKE ?)'; p.push(...Array(4).fill(`%${q}%`)); }
    sql += ' ORDER BY CASE WHEN serial_no GLOB \'[0-9]*\' THEN CAST(serial_no AS INTEGER) ELSE 999999 END, updated_at DESC';
    return db.prepare(sql).all(...p).map(parse);
  },
  counts() {
    const c = { all: 0, invited: 0, pending: 0, changes: 0, approved: 0, rejected: 0 };
    db.prepare('SELECT status, COUNT(*) n FROM submissions GROUP BY status').all().forEach(r => { c[r.status] = r.n; c.all += r.n; });
    return c;
  },
  create({ data, status = 'pending', serial_no = null }) {
    const token = newToken();
    const info = db.prepare(`INSERT INTO submissions(token,status,data,univ_name,contact_email,serial_no,submitted_at)
      VALUES (?,?,?,?,?,?,?)`).run(token, status, JSON.stringify(data), nameOf(data), data.informant && data.informant.email || '', serial_no,
      status === 'pending' ? new Date().toISOString() : null);
    return subs.byId(info.lastInsertRowid);
  },
  updateData(id, data) {
    db.prepare(`UPDATE submissions SET data=?, univ_name=?, contact_email=?, updated_at=datetime('now'),
      doc_outdated=CASE WHEN doc_file IS NOT NULL THEN 1 ELSE 0 END WHERE id=?`)
      .run(JSON.stringify(data), nameOf(data), data.informant && data.informant.email || '', id);
  },
  set(id, fields) {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE submissions SET ${keys.map(k => `${k}=@${k}`).join(',')}, updated_at=datetime('now') WHERE id=@id`).run(Object.assign({ id }, fields));
  },
  remove(id) { db.prepare('DELETE FROM submissions WHERE id=?').run(id); },
  serialTaken(serial, exceptId) { return !!db.prepare('SELECT 1 FROM submissions WHERE serial_no=? AND id<>?').get(serial, exceptId || 0); },
  nextSerial() {
    const r = db.prepare("SELECT MAX(CAST(serial_no AS INTEGER)) m FROM submissions WHERE serial_no GLOB '[0-9]*'").get();
    return String((r.m || 0) + 1);
  },
};
function nameOf(d) { return d.shortBn ? `${d.nameBn} (${d.shortBn})` : (d.nameBn || ''); }

const history = {
  add(submission_id, action, actor, note) { db.prepare('INSERT INTO history(submission_id,action,actor,note) VALUES (?,?,?,?)').run(submission_id, action, actor, note || null); },
  of(id) { return db.prepare('SELECT * FROM history WHERE submission_id=? ORDER BY id DESC').all(id); },
  recent(n = 12) { return db.prepare('SELECT h.*, s.univ_name FROM history h LEFT JOIN submissions s ON s.id=h.submission_id ORDER BY h.id DESC LIMIT ?').all(n); },
};
const emails = {
  add(e) { db.prepare('INSERT INTO email_log(submission_id,recipients,subject,status,error,actor) VALUES (@submission_id,@recipients,@subject,@status,@error,@actor)').run(Object.assign({ submission_id: null, error: null, actor: null }, e)); },
  list(limit = 200) { return db.prepare('SELECT e.*, s.univ_name FROM email_log e LEFT JOIN submissions s ON s.id=e.submission_id ORDER BY e.id DESC LIMIT ?').all(limit); },
  of(id) { return db.prepare('SELECT * FROM email_log WHERE submission_id=? ORDER BY id DESC').all(id); },
};
const admins = {
  byName(u) { return db.prepare('SELECT * FROM admins WHERE username=?').get(u); },
  byId(id) { return db.prepare('SELECT * FROM admins WHERE id=?').get(id); },
  list() { return db.prepare('SELECT id,username,display_name,created_at FROM admins ORDER BY id').all(); },
  create(u, p, name) { db.prepare('INSERT INTO admins(username,password_hash,display_name) VALUES (?,?,?)').run(u, bcrypt.hashSync(p, 10), name || u); },
  setPassword(id, p) { db.prepare('UPDATE admins SET password_hash=?, must_change=0 WHERE id=?').run(bcrypt.hashSync(p, 10), id); },
  remove(id) { db.prepare('DELETE FROM admins WHERE id=?').run(id); },
  check(u, p) { const a = admins.byName(u); return a && bcrypt.compareSync(p, a.password_hash) ? a : null; },
};

module.exports = { db, settings, subs, history, emails, admins, DATA_DIR };
