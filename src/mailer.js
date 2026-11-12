const nodemailer = require('nodemailer');
const { settings, emails } = require('./db');

function configured(s = settings.all()) { return !!(s.smtp_host && s.mail_from); }

function transport(s) {
  if (process.env.MAIL_TRANSPORT === 'json') return nodemailer.createTransport({ jsonTransport: true }); // for local testing
  return nodemailer.createTransport({
    host: s.smtp_host, port: Number(s.smtp_port) || 587, secure: s.smtp_secure === '1',
    auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
  });
}

/** Sends a mail and records it in the email log. Never throws; returns {ok, error}. */
async function send({ to, cc, subject, text, attachments, submissionId, actor }) {
  const s = settings.all();
  const recipients = [to, cc && `cc: ${cc}`].filter(Boolean).join(' | ');
  if (!configured(s) && process.env.MAIL_TRANSPORT !== 'json') {
    const error = 'SMTP সেট করা নেই — সেটিংস থেকে ইমেইল সার্ভার যোগ করুন';
    emails.add({ submission_id: submissionId, recipients, subject, status: 'failed', error, actor });
    return { ok: false, error };
  }
  try {
    await transport(s).sendMail({ from: s.mail_from || 'bac-diary@localhost', to, cc: cc || undefined, subject, text, attachments });
    emails.add({ submission_id: submissionId, recipients, subject, status: 'sent', actor });
    return { ok: true };
  } catch (e) {
    emails.add({ submission_id: submissionId, recipients, subject, status: 'failed', error: e.message, actor });
    return { ok: false, error: e.message };
  }
}

async function verify() {
  const s = settings.all();
  if (!configured(s)) return { ok: false, error: 'SMTP host ও প্রেরকের ঠিকানা দিন' };
  try { await transport(s).verify(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { send, verify, configured };
