/* Shared between browser (live preview, validation) and Node (Word generation, validation).
   Keeps the preview and the generated .docx identical. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DiaryShared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

  const OFFICIALS = [
    { key: 'vc', group: 'main', designation: 'উপাচার্য' },
    { key: 'pvc_admin', group: 'main', designation: 'প্রো-উপাচার্য (প্রশাসন)' },
    { key: 'pvc_acad', group: 'main', designation: 'প্রো-উপাচার্য (শিক্ষা)' },
    { key: 'treasurer', group: 'main', designation: 'কোষাধ্যক্ষ' },
    { key: 'registrar', group: 'main', designation: 'রেজিস্ট্রার' },
    { key: 'iqac_dir', group: 'iqac', designation: 'পরিচালক' },
    { key: 'iqac_add1', group: 'iqac', designation: 'অতিরিক্ত পরিচালক' },
    { key: 'iqac_add2', group: 'iqac', designation: 'অতিরিক্ত পরিচালক' },
    { key: 'iqac_add3', group: 'iqac', designation: 'অতিরিক্ত পরিচালক' },
    { key: 'iqac_add4', group: 'iqac', designation: 'অতিরিক্ত পরিচালক' },
  ];
  const MAX_IQAC_ADDITIONAL = 8;
  const IQAC_TITLE = 'ইনস্টিটিউশনাল কোয়ালিটি অ্যাসুরেন্স সেল (IQAC)';

  function emptyOfficial(o) {
    return { key: o.key, group: o.group, designation: o.designation, qualifier: '', name: '', office: '', mobiles: '', emails: '', vacant: false };
  }

  function emptyData() {
    return {
      nameBn: '', shortBn: '', nameEn: '',
      addresses: [{ label: '', text: '' }],
      phones: '', website: '', emails: '',
      officials: OFFICIALS.map(emptyOfficial),
      informant: { name: '', designation: '', date: '', phone: '', email: '' },
    };
  }

  /** Fill gaps so older / partial records always have every field. */
  function normalize(d) {
    const base = emptyData();
    d = d && typeof d === 'object' ? d : {};
    const out = Object.assign(base, d);
    if (!Array.isArray(out.addresses) || !out.addresses.length) out.addresses = [{ label: '', text: '' }];
    out.addresses = out.addresses.map(a => ({ label: str(a && a.label), text: str(a && a.text) }));
    if (!Array.isArray(out.officials) || !out.officials.length) out.officials = base.officials;
    out.officials = out.officials.map(o => Object.assign({ qualifier: '', name: '', office: '', mobiles: '', emails: '', vacant: false, group: 'main', designation: '' }, o));
    out.informant = Object.assign(base.informant, d.informant || {});
    ['nameBn', 'shortBn', 'nameEn', 'phones', 'website', 'emails'].forEach(k => { out[k] = str(out[k]); });
    return out;
  }

  function str(v) { return v == null ? '' : String(v).trim(); }
  function toBn(s) { return String(s).replace(/[0-9]/g, d => BN_DIGITS[+d]); }
  function toEn(s) { return String(s).replace(/[০-৯]/g, d => String(BN_DIGITS.indexOf(d))); }
  function splitMulti(s) { return str(s).split(/[,;\n]+/).map(x => x.trim()).filter(Boolean); }

  /** 01711432218 / +8801711432218 / ০১৭১১৪৩২২১৮  ->  01711-432218 (as in the diary). */
  function formatMobile(s) {
    const raw = toEn(str(s));
    let digits = raw.replace(/[^0-9]/g, '');
    if (digits.startsWith('880') && digits.length === 13) digits = digits.slice(2);
    if (/^01[3-9][0-9]{8}$/.test(digits)) return digits.slice(0, 5) + '-' + digits.slice(5);
    return raw;
  }
  function isMobile(s) { return /^01[3-9][0-9]{2}-[0-9]{6}$/.test(formatMobile(s)); }
  function isEmail(s) { return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(str(s)); }

  /** Turns form data into the exact structure printed in the diary. */
  function buildEntry(input, opts) {
    opts = Object.assign({ banglaDigits: true }, opts || {});
    const d = normalize(input);
    const num = s => (opts.banglaDigits ? toBn(s) : s);
    const title = d.shortBn ? `${d.nameBn} (${d.shortBn})` : d.nameBn;
    const addrs = d.addresses.filter(a => a.text);
    const addressLines = addrs.map(a => num(a.label ? `${a.label}: ${a.text}` : a.text));
    const phones = splitMulti(d.phones).map(num);
    const emails = splitMulti(d.emails);
    const websites = splitMulti(d.website);

    const rows = [];
    let iqacStarted = false;
    d.officials.forEach(o => {
      const has = o.vacant || o.name || o.mobiles || o.emails || o.office;
      if (!has) return;
      if (o.group === 'iqac' && !iqacStarted) { rows.push({ type: 'section', text: IQAC_TITLE }); iqacStarted = true; }
      rows.push({
        type: 'person',
        designation: o.qualifier ? `${o.designation} (${o.qualifier})` : o.designation,
        name: o.vacant ? 'পদ শূন্য' : o.name,
        office: splitMulti(o.office).map(num),
        mobiles: splitMulti(o.mobiles).map(formatMobile).map(num),
        emails: splitMulti(o.emails),
      });
    });
    return { title, addressLines, phones, emails, websites, rows };
  }

  function fileName(serial, data) {
    const d = normalize(data);
    const t = d.shortBn ? `${d.nameBn} (${d.shortBn})` : d.nameBn || 'university';
    const safe = t.replace(/[\\/:*?"<>|]+/g, ' ').trim();
    return (serial ? `${serial}-` : '') + safe + '.docx';
  }

  /** Returns [{field, msg}] — empty array means valid. */
  function validate(input) {
    const d = normalize(input);
    const e = [];
    const req = (v, field, msg) => { if (!str(v)) e.push({ field, msg }); };
    req(d.nameBn, 'nameBn', 'বিশ্ববিদ্যালয়ের নাম (বাংলায়) লিখুন');
    req(d.shortBn, 'shortBn', 'সংক্ষিপ্ত নাম লিখুন, যেমন: এসইউ');
    if (!d.addresses.some(a => a.text)) e.push({ field: 'addresses.0.text', msg: 'অন্তত একটি ঠিকানা লিখুন' });
    req(d.phones, 'phones', 'টেলিফোন নম্বর লিখুন');
    req(d.website, 'website', 'ওয়েবসাইট লিখুন');
    req(d.emails, 'emails', 'ই-মেইল লিখুন');
    splitMulti(d.emails).forEach(m => { if (!isEmail(m)) e.push({ field: 'emails', msg: `ই-মেইল ঠিক নেই: ${m}` }); });
    d.officials.forEach((o, i) => {
      const f = k => `officials.${i}.${k}`;
      if (o.key === 'vc' || o.key === 'registrar' || o.key === 'iqac_dir') {
        if (!o.vacant && !o.name) e.push({ field: f('name'), msg: `${label(o)}: নাম লিখুন অথবা “পদ শূন্য” চিহ্নিত করুন` });
      }
      splitMulti(o.mobiles).forEach(m => { if (!isMobile(m)) e.push({ field: f('mobiles'), msg: `${label(o)}: মোবাইল নম্বর ঠিক নেই (${m})` }); });
      splitMulti(o.emails).forEach(m => { if (!isEmail(m)) e.push({ field: f('emails'), msg: `${label(o)}: ই-মেইল ঠিক নেই (${m})` }); });
    });
    req(d.informant.name, 'informant.name', 'তথ্য প্রদানকারীর নাম লিখুন');
    req(d.informant.designation, 'informant.designation', 'তথ্য প্রদানকারীর পদবি লিখুন');
    req(d.informant.phone, 'informant.phone', 'যোগাযোগের নম্বর লিখুন');
    req(d.informant.email, 'informant.email', 'তথ্য প্রদানকারীর ই-মেইল লিখুন (অনুমোদনের পর ফাইল এখানে পাঠানো হবে)');
    if (d.informant.email && !isEmail(d.informant.email)) e.push({ field: 'informant.email', msg: 'তথ্য প্রদানকারীর ই-মেইল ঠিক নেই' });
    return e;
  }
  function label(o) { return o.group === 'iqac' ? `IQAC – ${o.designation}` : o.designation; }

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /** HTML that mirrors the Word layout; used in the live preview & admin view. */
  function renderEntryHTML(entry) {
    const L = s => `<span class="lat">${esc(s)}</span>`;
    let h = `<div class="dp-title">${esc(entry.title || 'বিশ্ববিদ্যালয়ের নাম')}</div>`;
    entry.addressLines.forEach(a => { h += `<div class="dp-addr">${esc(a)}</div>`; });
    if (entry.phones.length) h += `<div class="dp-line">টেলিফোন: ${esc(entry.phones.join(', '))}</div>`;
    const em = [];
    if (entry.emails.length) em.push('ই-মেইল: ' + entry.emails.map(L).join(', '));
    if (entry.websites.length) em.push('ওয়েবসাইট: ' + entry.websites.map(L).join(', '));
    if (em.length) h += `<div class="dp-line">${em.join('; ')}</div>`;
    h += '<table class="dp-table"><thead><tr><th>নাম ও পদবি</th><th>অফিস</th><th>মোবাইল ও ই-মেইল</th></tr></thead><tbody>';
    if (!entry.rows.length) h += '<tr><td colspan="3" class="dp-empty">কর্মকর্তাদের তথ্য লিখলে এখানে দেখা যাবে</td></tr>';
    entry.rows.forEach(r => {
      if (r.type === 'section') { h += `<tr><td colspan="3" class="dp-section">${esc(r.text)}</td></tr>`; return; }
      h += `<tr><td><div>${esc(r.designation)}</div><div>${esc(r.name || '')}</div></td>` +
        `<td>${r.office.length ? r.office.map(esc).join('<br>') : '-'}</td>` +
        `<td>${r.mobiles.map(esc).concat(r.emails.map(m => `<span class="lat sm">${esc(m)}</span>`)).join('<br>') || '-'}</td></tr>`;
    });
    h += '</tbody></table>';
    return h;
  }

  return { OFFICIALS, MAX_IQAC_ADDITIONAL, IQAC_TITLE, emptyData, normalize, toBn, toEn, splitMulti, formatMobile, isMobile, isEmail, buildEntry, fileName, validate, renderEntryHTML, esc };
});
