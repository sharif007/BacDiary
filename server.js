require('./src/env');
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const { settings, subs, history, emails, admins, DATA_DIR } = require('./src/db');
const shared = require('./public/js/shared');
const docgen = require('./src/docgen');
const mailer = require('./src/mailer');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const GEN_DIR = path.join(DATA_DIR, 'generated');
fs.mkdirSync(GEN_DIR, { recursive: true });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use('/fonts/hind', express.static(path.join(__dirname, 'node_modules/@fontsource/hind-siliguri/files'), { maxAge: '30d' }));
app.use('/fonts/serif', express.static(path.join(__dirname, 'node_modules/@fontsource/noto-serif-bengali/files'), { maxAge: '30d' }));
app.use(session({
  name: 'bac.sid',
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: 8 * 3600 * 1000 },
}));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  // Reject cross-site POSTs (basic CSRF guard)
  if (req.method === 'POST' && req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).send('Forbidden'); } catch { return res.status(403).send('Forbidden'); }
  }
  res.locals.flash = req.session.flash; delete req.session.flash;
  res.locals.admin = req.session.adminId ? admins.byId(req.session.adminId) : null;
  res.locals.path = req.path;
  res.locals.S = settings.all();
  res.locals.shared = shared;
  next();
});

const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
const baseUrl = req => (settings.get('public_base_url') || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const STATUS = {
  invited: { bn: 'আমন্ত্রিত', hint: 'লিংক পাঠানো হয়েছে, এখনো জমা হয়নি' },
  pending: { bn: 'পর্যালোচনাধীন', hint: 'অ্যাডমিনের যাচাই বাকি' },
  changes: { bn: 'সংশোধন প্রয়োজন', hint: 'বিশ্ববিদ্যালয়কে ফেরত পাঠানো হয়েছে' },
  approved: { bn: 'অনুমোদিত', hint: 'Word ফাইল তৈরি করা যাবে' },
  rejected: { bn: 'বাতিল', hint: '' },
};
app.locals.STATUS = STATUS;
app.locals.fmtDate = s => {
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return shared.toBn(d.toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
};
const EDITABLE_BY_UNIVERSITY = ['invited', 'pending', 'changes'];

// ---------- simple in-memory rate limiter for public writes ----------
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const k = req.ip + req.path; const now = Date.now();
    const arr = (hits.get(k) || []).filter(t => now - t < windowMs); arr.push(now); hits.set(k, arr);
    if (arr.length > max) return res.status(429).json({ error: 'অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।' });
    next();
  };
}

function cleanData(body) {
  const d = shared.normalize(body && body.data);
  // keep only allowed official keys / structure
  d.officials = d.officials.slice(0, 5 + 1 + shared.MAX_IQAC_ADDITIONAL).map(o => ({
    key: String(o.key || '').slice(0, 40), group: o.group === 'iqac' ? 'iqac' : 'main',
    designation: String(o.designation || '').slice(0, 120), qualifier: String(o.qualifier || '').slice(0, 80),
    name: String(o.name || '').slice(0, 200), office: String(o.office || '').slice(0, 200),
    mobiles: String(o.mobiles || '').slice(0, 300), emails: String(o.emails || '').slice(0, 300), vacant: !!o.vacant,
  }));
  d.addresses = d.addresses.slice(0, 6);
  return d;
}

async function notifyAdmin(req, sub, what) {
  const to = settings.get('admin_notify_email');
  if (!to || !mailer.configured()) return;
  await mailer.send({ to, subject: `[BAC ডায়েরি] ${what}: ${sub.univ_name}`, text: `${sub.univ_name}\n${what}\n\nদেখুন: ${baseUrl(req)}/admin/s/${sub.id}`, submissionId: sub.id, actor: 'system' });
}
async function notifyUniversity(req, sub, subject, body) {
  if (settings.get('notify_university') !== '1' || !mailer.configured() || !sub.contact_email) return;
  await mailer.send({ to: sub.contact_email, subject, text: `${body}\n\nআপনার জমার লিংক: ${baseUrl(req)}/s/${sub.token}\n\nবাংলাদেশ অ্যাক্রেডিটেশন কাউন্সিল`, submissionId: sub.id, actor: 'system' });
}

// =================== PUBLIC (university) ===================
app.get('/', (req, res) => res.redirect('/submit'));

app.get('/submit', (req, res) => {
  if (settings.get('form_open') !== '1') return res.render('public/closed');
  res.render('public/form', { sub: null, data: shared.emptyData(), mode: 'new', editable: true });
});

app.post('/submit', rateLimit(10, 10 * 60 * 1000), async (req, res) => {
  if (settings.get('form_open') !== '1') return res.status(403).json({ error: 'তথ্য সংগ্রহ এখন বন্ধ আছে' });
  const data = cleanData(req.body);
  const errors = shared.validate(data);
  if (errors.length) return res.status(422).json({ errors });
  const sub = subs.create({ data, status: 'pending' });
  history.add(sub.id, 'submitted', 'বিশ্ববিদ্যালয়', `${data.informant.name}, ${data.informant.designation}`);
  notifyAdmin(req, sub, 'নতুন তথ্য জমা হয়েছে');
  notifyUniversity(req, sub, 'BAC ডায়েরি ২০২৭: আপনার তথ্য জমা হয়েছে', `${sub.univ_name}-এর তথ্য জমা হয়েছে। অনুমোদনের আগ পর্যন্ত নিচের লিংক থেকে তথ্য সংশোধন করতে পারবেন।`);
  res.json({ ok: true, redirect: `/s/${sub.token}?saved=1` });
});

app.get('/s/:token', (req, res) => {
  const sub = subs.byToken(req.params.token);
  if (!sub) return res.status(404).render('public/notfound');
  res.render('public/form', { sub, data: sub.data, mode: 'token', editable: EDITABLE_BY_UNIVERSITY.includes(sub.status), saved: req.query.saved, link: `${baseUrl(req)}/s/${sub.token}` });
});

app.post('/s/:token', rateLimit(30, 10 * 60 * 1000), async (req, res) => {
  const sub = subs.byToken(req.params.token);
  if (!sub) return res.status(404).json({ error: 'লিংকটি সঠিক নয়' });
  if (!EDITABLE_BY_UNIVERSITY.includes(sub.status)) return res.status(403).json({ error: 'এই তথ্য অনুমোদিত/বন্ধ হয়ে গেছে, আর সংশোধন করা যাবে না। প্রয়োজনে কাউন্সিলের সাথে যোগাযোগ করুন।' });
  const data = cleanData(req.body);
  const errors = shared.validate(data);
  if (errors.length) return res.status(422).json({ errors });
  const wasStatus = sub.status;
  subs.updateData(sub.id, data);
  subs.set(sub.id, { status: 'pending', submitted_at: new Date().toISOString() });
  history.add(sub.id, wasStatus === 'invited' ? 'submitted' : 'resubmitted', 'বিশ্ববিদ্যালয়', `${data.informant.name}, ${data.informant.designation}`);
  notifyAdmin(req, subs.byId(sub.id), wasStatus === 'invited' ? 'নতুন তথ্য জমা হয়েছে' : 'তথ্য সংশোধন করে আবার জমা হয়েছে');
  res.json({ ok: true, redirect: `/s/${sub.token}?saved=1` });
});

// =================== ADMIN ===================
function requireAdmin(req, res, next) {
  if (!req.session.adminId || !admins.byId(req.session.adminId)) {
    if (req.accepts(['html', 'json']) === 'json' && req.method !== 'GET') return res.status(401).json({ error: 'আবার লগইন করুন' });
    return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}
const actor = req => { const a = admins.byId(req.session.adminId); return a ? (a.display_name || a.username) : 'admin'; };

app.get('/admin/login', (req, res) => res.render('admin/login', { error: null, next: req.query.next || '/admin' }));
app.post('/admin/login', rateLimit(10, 15 * 60 * 1000), (req, res) => {
  const a = admins.check(String(req.body.username || ''), String(req.body.password || ''));
  const next = /^\/admin(\/|$)/.test(req.body.next || '') ? req.body.next : '/admin';
  if (!a) return res.status(401).render('admin/login', { error: 'ইউজারনেম বা পাসওয়ার্ড ভুল', next });
  req.session.regenerate(() => {
    req.session.adminId = a.id;
    if (a.must_change) { req.session.flash = { type: 'warn', msg: 'নিরাপত্তার জন্য ডিফল্ট পাসওয়ার্ড এখনই বদলে নিন।' }; return res.redirect('/admin/settings#account'); }
    res.redirect(next);
  });
});
app.post('/admin/logout', (req, res) => req.session.destroy(() => res.redirect('/admin/login')));

app.use('/admin', requireAdmin);

app.get('/admin', (req, res) => {
  const status = STATUS[req.query.status] ? req.query.status : '';
  const q = String(req.query.q || '').trim();
  res.render('admin/dashboard', { list: subs.list({ status, q }), counts: subs.counts(), status, q, recent: history.recent(8), submitUrl: `${baseUrl(req)}/submit` });
});

app.post('/admin/invite', (req, res) => {
  const d = shared.emptyData();
  d.nameBn = String(req.body.nameBn || '').trim();
  d.shortBn = String(req.body.shortBn || '').trim();
  d.informant.email = String(req.body.email || '').trim();
  if (!d.nameBn) { flash(req, 'error', 'বিশ্ববিদ্যালয়ের নাম লিখুন'); return res.redirect('/admin'); }
  const sub = subs.create({ data: d, status: 'invited' });
  history.add(sub.id, 'invited', actor(req));
  flash(req, 'ok', 'আমন্ত্রণ লিংক তৈরি হয়েছে। লিংকটি কপি করে বিশ্ববিদ্যালয়কে পাঠান।');
  res.redirect(`/admin/s/${sub.id}`);
});

app.get('/admin/new', (req, res) => res.render('admin/edit', { sub: null, data: shared.emptyData() }));
app.post('/admin/new', (req, res) => {
  const data = cleanData(req.body);
  if (!data.nameBn) return res.status(422).json({ errors: [{ field: 'nameBn', msg: 'বিশ্ববিদ্যালয়ের নাম লিখুন' }] });
  const sub = subs.create({ data, status: 'pending' });
  history.add(sub.id, 'created', actor(req), 'অ্যাডমিন সরাসরি যোগ করেছেন');
  res.json({ ok: true, redirect: `/admin/s/${sub.id}` });
});

function loadSub(req, res, next) {
  const sub = subs.byId(Number(req.params.id));
  if (!sub) return res.status(404).render('public/notfound');
  req.sub = sub; next();
}

app.get('/admin/s/:id', loadSub, (req, res) => {
  const sub = req.sub;
  const S = settings.all();
  const entry = shared.buildEntry(sub.data, { banglaDigits: S.bangla_digits !== '0' });
  const subj = S.email_subject.replace(/\{university\}/g, sub.univ_name);
  const body = S.email_body.replace(/\{university\}/g, sub.univ_name);
  const recips = [...new Set([sub.data.informant.email, ...shared.splitMulti(sub.data.emails)].filter(Boolean))];
  res.render('admin/view', {
    sub, entry, warnings: shared.validate(sub.data), hist: history.of(sub.id), mails: emails.of(sub.id),
    link: `${baseUrl(req)}/s/${sub.token}`, fileName: shared.fileName(sub.serial_no, sub.data),
    mail: { to: recips.join(', '), subject: subj, body }, nextSerial: subs.nextSerial(), smtpOk: mailer.configured(S),
  });
});

app.get('/admin/s/:id/edit', loadSub, (req, res) => res.render('admin/edit', { sub: req.sub, data: req.sub.data }));
app.post('/admin/s/:id/edit', loadSub, (req, res) => {
  const data = cleanData(req.body);
  if (!data.nameBn) return res.status(422).json({ errors: [{ field: 'nameBn', msg: 'বিশ্ববিদ্যালয়ের নাম লিখুন' }] });
  subs.updateData(req.sub.id, data);
  history.add(req.sub.id, 'edited', actor(req));
  flash(req, 'ok', req.sub.doc_file ? 'পরিবর্তন সংরক্ষিত হয়েছে। Word ফাইলটি পুরনো হয়ে গেছে — আবার তৈরি করুন।' : 'পরিবর্তন সংরক্ষিত হয়েছে।');
  res.json({ ok: true, redirect: `/admin/s/${req.sub.id}` });
});

app.post('/admin/s/:id/status', loadSub, async (req, res) => {
  const sub = req.sub; const action = req.body.action; const note = String(req.body.note || '').trim();
  if (action === 'approve') {
    const serial = shared.toEn(String(req.body.serial_no || '').trim());
    if (!/^[0-9]{1,5}$/.test(serial)) { flash(req, 'error', 'অনুমোদনের আগে ডায়েরির ক্রমিক নম্বর দিন (শুধু সংখ্যা)'); return res.redirect(`/admin/s/${sub.id}`); }
    if (subs.serialTaken(serial, sub.id)) { flash(req, 'error', `ক্রমিক নম্বর ${serial} অন্য একটি বিশ্ববিদ্যালয়ে ব্যবহার হয়েছে`); return res.redirect(`/admin/s/${sub.id}`); }
    subs.set(sub.id, { status: 'approved', serial_no: serial, approved_at: new Date().toISOString(), admin_note: note || null });
    history.add(sub.id, 'approved', actor(req), `ক্রমিক ${serial}${note ? ' — ' + note : ''}`);
    // Generate the Word file right away
    await generate(subs.byId(sub.id), req);
    notifyUniversity(req, subs.byId(sub.id), 'BAC ডায়েরি ২০২৭: আপনার তথ্য অনুমোদিত হয়েছে', `${sub.univ_name}-এর তথ্য অনুমোদিত হয়েছে।`);
    flash(req, 'ok', 'অনুমোদিত হয়েছে এবং Word ফাইল তৈরি হয়েছে।');
  } else if (action === 'changes') {
    if (!note) { flash(req, 'error', 'কী সংশোধন করতে হবে তা লিখুন — বিশ্ববিদ্যালয় এটি দেখতে পাবে'); return res.redirect(`/admin/s/${sub.id}`); }
    subs.set(sub.id, { status: 'changes', admin_note: note });
    history.add(sub.id, 'changes', actor(req), note);
    notifyUniversity(req, sub, 'BAC ডায়েরি ২০২৭: তথ্য সংশোধন প্রয়োজন', `${sub.univ_name}-এর তথ্যে নিচের সংশোধন প্রয়োজন:\n\n${note}`);
    flash(req, 'ok', 'সংশোধনের জন্য ফেরত পাঠানো হয়েছে।');
  } else if (action === 'reject') {
    subs.set(sub.id, { status: 'rejected', admin_note: note || null });
    history.add(sub.id, 'rejected', actor(req), note);
    flash(req, 'ok', 'বাতিল করা হয়েছে।');
  } else if (action === 'reopen') {
    subs.set(sub.id, { status: 'pending' });
    history.add(sub.id, 'reopened', actor(req), note);
    flash(req, 'ok', 'আবার পর্যালোচনায় আনা হয়েছে।');
  }
  res.redirect(`/admin/s/${sub.id}`);
});

app.post('/admin/s/:id/serial', loadSub, (req, res) => {
  const serial = shared.toEn(String(req.body.serial_no || '').trim());
  if (serial && !/^[0-9]{1,5}$/.test(serial)) flash(req, 'error', 'ক্রমিক নম্বর শুধু সংখ্যা হতে হবে');
  else if (serial && subs.serialTaken(serial, req.sub.id)) flash(req, 'error', `ক্রমিক নম্বর ${serial} অন্য একটি বিশ্ববিদ্যালয়ে ব্যবহার হয়েছে`);
  else {
    subs.set(req.sub.id, { serial_no: serial || null, doc_outdated: req.sub.doc_file ? 1 : 0 });
    history.add(req.sub.id, 'serial', actor(req), serial || 'মুছে ফেলা হয়েছে');
    flash(req, 'ok', 'ক্রমিক নম্বর সংরক্ষিত হয়েছে।');
  }
  res.redirect(`/admin/s/${req.sub.id}`);
});

async function generate(sub, req) {
  const buf = await docgen.singleDocx(sub.data, settings.all());
  const file = `${sub.id}-${Date.now()}.docx`;
  fs.writeFileSync(path.join(GEN_DIR, file), buf);
  if (sub.doc_file && sub.doc_file !== file) fs.rm(path.join(GEN_DIR, sub.doc_file), { force: true }, () => {});
  subs.set(sub.id, { doc_file: file, doc_generated_at: new Date().toISOString(), doc_outdated: 0 });
  history.add(sub.id, 'generated', actor(req), shared.fileName(sub.serial_no, sub.data));
}

app.post('/admin/s/:id/generate', loadSub, async (req, res) => {
  if (req.sub.status !== 'approved') { flash(req, 'error', 'Word ফাইল তৈরির আগে তথ্য অনুমোদন করুন'); return res.redirect(`/admin/s/${req.sub.id}`); }
  await generate(req.sub, req);
  flash(req, 'ok', 'Word ফাইল তৈরি হয়েছে।');
  res.redirect(`/admin/s/${req.sub.id}`);
});

app.get('/admin/s/:id/download', loadSub, (req, res) => {
  const sub = req.sub;
  if (!sub.doc_file || !fs.existsSync(path.join(GEN_DIR, sub.doc_file))) { flash(req, 'error', 'Word ফাইল এখনো তৈরি হয়নি'); return res.redirect(`/admin/s/${sub.id}`); }
  res.download(path.join(GEN_DIR, sub.doc_file), shared.fileName(sub.serial_no, sub.data));
});

// Draft preview download (any status) — clearly named as draft
app.get('/admin/s/:id/draft.docx', loadSub, async (req, res) => {
  const buf = await docgen.singleDocx(req.sub.data, settings.all());
  res.attachment('খসড়া-' + shared.fileName(req.sub.serial_no, req.sub.data));
  res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').send(buf);
});

app.post('/admin/s/:id/email', loadSub, async (req, res) => {
  const sub = req.sub;
  if (!sub.doc_file || !fs.existsSync(path.join(GEN_DIR, sub.doc_file))) { flash(req, 'error', 'আগে Word ফাইল তৈরি করুন'); return res.redirect(`/admin/s/${sub.id}`); }
  const to = shared.splitMulti(req.body.to).filter(shared.isEmail);
  const cc = shared.splitMulti(req.body.cc).filter(shared.isEmail);
  if (!to.length) { flash(req, 'error', 'অন্তত একটি সঠিক ই-মেইল ঠিকানা দিন'); return res.redirect(`/admin/s/${sub.id}#email`); }
  const r = await mailer.send({
    to: to.join(', '), cc: cc.join(', '), subject: String(req.body.subject || '').slice(0, 300), text: String(req.body.body || ''),
    attachments: [{ filename: shared.fileName(sub.serial_no, sub.data), path: path.join(GEN_DIR, sub.doc_file) }],
    submissionId: sub.id, actor: actor(req),
  });
  if (r.ok) { history.add(sub.id, 'emailed', actor(req), to.join(', ')); flash(req, 'ok', `ই-মেইল পাঠানো হয়েছে: ${to.join(', ')}`); }
  else flash(req, 'error', 'ই-মেইল পাঠানো যায়নি: ' + r.error);
  res.redirect(`/admin/s/${sub.id}#email`);
});

app.post('/admin/s/:id/delete', loadSub, (req, res) => {
  if (req.sub.doc_file) fs.rm(path.join(GEN_DIR, req.sub.doc_file), { force: true }, () => {});
  subs.remove(req.sub.id);
  flash(req, 'ok', `${req.sub.univ_name || 'জমা'} মুছে ফেলা হয়েছে।`);
  res.redirect('/admin');
});

// ---- Compile whole diary / exports ----
app.get('/admin/compile', (req, res) => {
  const approved = subs.list({ status: 'approved' });
  res.render('admin/compile', { approved, missingSerial: approved.filter(s => !s.serial_no), counts: subs.counts() });
});
app.get('/admin/compile.docx', async (req, res) => {
  const items = subs.list({ status: 'approved' }).filter(s => s.serial_no);
  if (!items.length) { flash(req, 'error', 'কোনো অনুমোদিত বিশ্ববিদ্যালয় নেই'); return res.redirect('/admin/compile'); }
  const buf = await docgen.combinedDocx(items, settings.all(), { pageBreak: req.query.pageBreak === '1', withSerial: req.query.serial !== '0' });
  res.attachment('BAC-ডায়েরি-২০২৭-সংকলন.docx');
  res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').send(buf);
});
app.get('/admin/export.csv', (req, res) => {
  const rows = [['ক্রমিক', 'অবস্থা', 'বিশ্ববিদ্যালয়', 'সংক্ষিপ্ত', 'English name', 'ঠিকানা', 'টেলিফোন', 'ওয়েবসাইট', 'ই-মেইল', 'পদবি', 'নাম', 'অফিস', 'মোবাইল', 'কর্মকর্তার ই-মেইল', 'তথ্য প্রদানকারী', 'যোগাযোগ']];
  subs.list({ status: req.query.status || '' }).forEach(s => {
    const d = shared.normalize(s.data);
    const base = [s.serial_no || '', STATUS[s.status].bn, d.nameBn, d.shortBn, d.nameEn, d.addresses.map(a => (a.label ? a.label + ': ' : '') + a.text).join(' | '), d.phones, d.website, d.emails];
    const inf = `${d.informant.name}, ${d.informant.designation}`; const ic = `${d.informant.phone} ${d.informant.email}`;
    const offs = d.officials.filter(o => o.name || o.vacant);
    if (!offs.length) rows.push([...base, '', '', '', '', '', inf, ic]);
    offs.forEach(o => rows.push([...base, (o.group === 'iqac' ? 'IQAC – ' : '') + o.designation + (o.qualifier ? ` (${o.qualifier})` : ''), o.vacant ? 'পদ শূন্য' : o.name, o.office, o.mobiles, o.emails, inf, ic]));
  });
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  res.attachment('BAC-diary-2027-data.csv'); res.type('text/csv; charset=utf-8').send(csv);
});

app.get('/admin/emails', (req, res) => res.render('admin/emails', { list: emails.list() }));

// ---- Settings ----
app.get('/admin/settings', (req, res) => res.render('admin/settings', { admins: admins.list(), submitUrl: `${baseUrl(req)}/submit` }));
app.post('/admin/settings', (req, res) => {
  const b = req.body;
  const section = b.section;
  const keys = {
    form: ['form_notice', 'deadline', 'public_base_url'],
    doc: ['doc_font', 'latin_font'],
    mail: ['smtp_host', 'smtp_port', 'smtp_user', 'mail_from', 'admin_notify_email', 'email_subject', 'email_body'],
  }[section] || [];
  keys.forEach(k => settings.set(k, String(b[k] || '').trim()));
  if (section === 'form') settings.set('form_open', b.form_open ? '1' : '0');
  if (section === 'doc') settings.set('bangla_digits', b.bangla_digits ? '1' : '0');
  if (section === 'mail') {
    settings.set('smtp_secure', b.smtp_secure ? '1' : '0');
    settings.set('notify_university', b.notify_university ? '1' : '0');
    if (b.smtp_pass) settings.set('smtp_pass', b.smtp_pass);
  }
  if (section === 'doc') {
    // existing files are now out of date
    require('./src/db').db.prepare('UPDATE submissions SET doc_outdated=1 WHERE doc_file IS NOT NULL').run();
  }
  flash(req, 'ok', 'সেটিংস সংরক্ষিত হয়েছে।');
  res.redirect('/admin/settings#' + section);
});
app.post('/admin/settings/test-mail', async (req, res) => {
  const v = await mailer.verify();
  if (!v.ok) { flash(req, 'error', 'SMTP সংযোগ হয়নি: ' + v.error); return res.redirect('/admin/settings#mail'); }
  const to = String(req.body.to || '').trim();
  if (to && shared.isEmail(to)) {
    const r = await mailer.send({ to, subject: 'BAC ডায়েরি — পরীক্ষামূলক ই-মেইল', text: 'ইমেইল সেটিংস ঠিকভাবে কাজ করছে।', actor: actor(req) });
    flash(req, r.ok ? 'ok' : 'error', r.ok ? `পরীক্ষামূলক ই-মেইল পাঠানো হয়েছে: ${to}` : 'পাঠানো যায়নি: ' + r.error);
  } else flash(req, 'ok', 'SMTP সংযোগ ঠিক আছে।');
  res.redirect('/admin/settings#mail');
});
app.post('/admin/account/password', (req, res) => {
  const a = admins.byId(req.session.adminId);
  if (!admins.check(a.username, String(req.body.current || ''))) flash(req, 'error', 'বর্তমান পাসওয়ার্ড ভুল');
  else if (String(req.body.password || '').length < 8) flash(req, 'error', 'নতুন পাসওয়ার্ড অন্তত ৮ অক্ষরের হতে হবে');
  else if (req.body.password !== req.body.confirm) flash(req, 'error', 'দুটি পাসওয়ার্ড মিলছে না');
  else { admins.setPassword(a.id, req.body.password); flash(req, 'ok', 'পাসওয়ার্ড বদলানো হয়েছে।'); }
  res.redirect('/admin/settings#account');
});
app.post('/admin/admins', (req, res) => {
  const u = String(req.body.username || '').trim(); const p = String(req.body.password || '');
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(u)) flash(req, 'error', 'ইউজারনেম ৩–৩০ অক্ষরের ইংরেজি হতে হবে');
  else if (p.length < 8) flash(req, 'error', 'পাসওয়ার্ড অন্তত ৮ অক্ষরের হতে হবে');
  else if (admins.byName(u)) flash(req, 'error', 'এই ইউজারনেম আগে থেকেই আছে');
  else { admins.create(u, p, String(req.body.display_name || '').trim() || u); flash(req, 'ok', `অ্যাডমিন “${u}” যোগ হয়েছে।`); }
  res.redirect('/admin/settings#account');
});
app.post('/admin/admins/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.adminId) flash(req, 'error', 'নিজের অ্যাকাউন্ট মুছতে পারবেন না');
  else { admins.remove(id); flash(req, 'ok', 'অ্যাডমিন মুছে ফেলা হয়েছে।'); }
  res.redirect('/admin/settings#account');
});

app.use((req, res) => res.status(404).render('public/notfound'));
app.use((err, req, res, next) => { console.error(err); res.status(500).send('সার্ভারে সমস্যা হয়েছে। আবার চেষ্টা করুন।'); });

if (require.main === module) app.listen(PORT, () => console.log(`BAC Diary 2027 running on http://localhost:${PORT}  (admin: /admin)`));
module.exports = app;
