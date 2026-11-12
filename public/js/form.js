/* Data-entry form used by the university page and the admin edit page. */
(function () {
  const S = window.DiaryShared;
  const cfg = window.FORM_CONFIG;
  const root = document.getElementById('formRoot');
  const preview = document.getElementById('preview');
  if (!root) return;
  let data = S.normalize(cfg.data);
  const DRAFT_KEY = 'bac-diary-2027-draft';
  let dirty = false;

  // restore local draft for brand-new submissions
  if (cfg.mode === 'new') {
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (saved && saved.nameBn !== undefined) { data = S.normalize(saved); showDraftNote(); }
    } catch (e) { /* storage unavailable */ }
  }

  const esc = S.esc;
  const get = p => p.split('.').reduce((o, k) => (o == null ? o : o[k]), data);
  const set = (p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], data)[last] = v; };
  const ro = !cfg.editable;

  function field(path, label, o = {}) {
    const v = get(path);
    const type = o.type || 'text';
    const attrs = `id="f-${path}" data-path="${path}" ${ro ? 'disabled' : ''} ${o.placeholder ? `placeholder="${esc(o.placeholder)}"` : ''} ${o.lat ? 'lang="en" class="lat-in"' : ''} ${o.auto ? `autocomplete="${o.auto}"` : ''}`;
    const input = o.textarea ? `<textarea rows="2" ${attrs}>${esc(v || '')}</textarea>` : `<input type="${type}" value="${esc(v || '')}" ${attrs}>`;
    return `<div class="field ${o.cls || ''}" data-field="${path}"><label for="f-${path}">${label}${o.req ? ' <span aria-hidden="true" style="color:var(--bad)">*</span>' : ''}</label>${input}${o.hint ? `<div class="hint">${o.hint}</div>` : ''}</div>`;
  }

  function officer(o, i) {
    const p = k => `officials.${i}.${k}`;
    const required = ['vc', 'registrar', 'iqac_dir'].includes(o.key);
    const removable = o.group === 'iqac' && o.key !== 'iqac_dir' && !ro;
    const desig = cfg.adminMode
      ? `<input type="text" data-path="${p('designation')}" value="${esc(o.designation)}" aria-label="পদবি" style="max-width:16rem;font-weight:600">`
      : `<span class="desig">${o.group === 'iqac' ? '<small>IQAC –</small> ' : ''}${esc(o.designation)}${required ? ' <span style="color:var(--bad)">*</span>' : ''}</span>`;
    return `<div class="officer ${o.vacant ? 'is-vacant' : ''}" data-idx="${i}">
      <div class="officer-h">
        ${desig}
        <div class="q"><input type="text" data-path="${p('qualifier')}" value="${esc(o.qualifier)}" ${ro ? 'disabled' : ''} placeholder="যেমন: ভারপ্রাপ্ত" aria-label="${esc(o.designation)} — বন্ধনীর লেখা (ঐচ্ছিক)" title="পদবির পরে বন্ধনীতে ছাপা হবে, যেমন: (ভারপ্রাপ্ত), (কিউএ)"></div>
        <div class="tools">
          <label class="check"><input type="checkbox" data-path="${p('vacant')}" ${o.vacant ? 'checked' : ''} ${ro ? 'disabled' : ''}> পদ শূন্য</label>
          ${removable ? `<button type="button" class="btn btn-ghost btn-sm btn-danger" data-remove-officer="${i}">সরান</button>` : ''}
        </div>
      </div>
      <div class="grid g2">
        ${field(p('name'), 'কর্মকর্তার নাম', { cls: o.vacant ? 'hidden-v' : '', placeholder: 'যেমন: প্রফেসর ড. মোহাম্মদ ...' })}
        ${field(p('office'), 'অফিসের ফোন নম্বর', { placeholder: '02-41020135', hint: 'না থাকলে খালি রাখুন' })}
        ${field(p('mobiles'), 'মোবাইল নম্বর', { type: 'tel', placeholder: '01711-432218', hint: 'একাধিক হলে কমা দিন' })}
        ${field(p('emails'), 'ই-মেইল ঠিকানা', { lat: true, placeholder: 'vc@university.edu.bd', hint: 'একাধিক হলে কমা দিন' })}
      </div>
    </div>`;
  }

  function render() {
    const iqacCount = data.officials.filter(o => o.group === 'iqac' && o.key !== 'iqac_dir').length;
    const mainHtml = data.officials.map((o, i) => (o.group === 'main' ? officer(o, i) : '')).join('');
    const iqacHtml = data.officials.map((o, i) => (o.group === 'iqac' ? officer(o, i) : '')).join('');
    root.innerHTML = `
    <section class="step" id="sec-inst">
      <div class="step-h"><span class="step-n">১</span><div><h2>প্রতিষ্ঠানের তথ্য</h2><p>ডায়েরিতে শিরোনাম ও ঠিকানা হিসেবে ছাপা হবে।</p></div></div>
      <div class="grid g2">
        ${field('nameBn', 'বিশ্ববিদ্যালয়ের নাম (বাংলায়)', { req: true, placeholder: 'সোনারগাঁও ইউনিভার্সিটি' })}
        ${field('shortBn', 'সংক্ষিপ্ত নাম (বাংলায়)', { req: true, placeholder: 'এসইউ', hint: 'শিরোনামে বন্ধনীতে বসবে' })}
      </div>
      ${field('nameEn', 'বিশ্ববিদ্যালয়ের নাম (ইংরেজিতে)', { lat: true, placeholder: 'Sonargaon University', hint: 'শুধু রেকর্ডের জন্য, ডায়েরিতে ছাপা হবে না' })}
      <label>ঠিকানা <span style="color:var(--bad)">*</span></label>
      <div class="hint" style="margin:-.1rem 0 .5rem">একাধিক ক্যাম্পাস থাকলে প্রতিটির জন্য আলাদা লাইন যোগ করুন।</div>
      <div id="addrList">
        ${data.addresses.map((a, i) => `<div class="grid g-addr">
          <div class="field addr-label" data-field="addresses.${i}.label"><input type="text" data-path="addresses.${i}.label" value="${esc(a.label)}" ${ro ? 'disabled' : ''} placeholder="ক্যাম্পাস-১" aria-label="ঠিকানার শিরোনাম (ঐচ্ছিক)"></div>
          <div class="field" data-field="addresses.${i}.text"><input type="text" data-path="addresses.${i}.text" id="f-addresses.${i}.text" value="${esc(a.text)}" ${ro ? 'disabled' : ''} placeholder="১৪৭/আই, গ্রীন রোড, তেজগাঁও, ঢাকা-১২১৫" aria-label="ঠিকানা"></div>
          <div>${!ro && data.addresses.length > 1 ? `<button type="button" class="btn btn-ghost btn-sm btn-danger" data-remove-addr="${i}">সরান</button>` : ''}</div>
        </div>`).join('')}
      </div>
      ${!ro && data.addresses.length < 6 ? '<button type="button" class="btn btn-ghost btn-sm" id="addAddr" style="margin:-.4rem 0 1rem">+ আরেকটি ক্যাম্পাসের ঠিকানা</button>' : ''}
      <div class="grid g3">
        ${field('phones', 'টেলিফোন', { req: true, type: 'tel', placeholder: '02-41010351', hint: 'একাধিক হলে কমা দিন' })}
        ${field('website', 'ওয়েবসাইট', { req: true, lat: true, placeholder: 'www.su.edu.bd' })}
        ${field('emails', 'ই-মেইল', { req: true, lat: true, placeholder: 'registrar@su.edu.bd' })}
      </div>
    </section>

    <section class="step" id="sec-off">
      <div class="step-h"><span class="step-n">২</span><div><h2>কর্মকর্তাদের তথ্য</h2><p>যে পদে কেউ নেই সেটি খালি রাখুন (ছাপা হবে না) অথবা “পদ শূন্য” চিহ্নিত করুন।</p></div></div>
      <div class="group-label">প্রশাসনিক দপ্তর</div>
      ${mainHtml}
      <div class="group-label">ইনস্টিটিউশনাল কোয়ালিটি অ্যাসুরেন্স সেল (IQAC)</div>
      ${iqacHtml}
      ${!ro && iqacCount < S.MAX_IQAC_ADDITIONAL ? '<button type="button" class="btn btn-sm" id="addIqac">+ আরও একজন অতিরিক্ত পরিচালক</button>' : ''}
    </section>

    <section class="step" id="sec-inf">
      <div class="step-h"><span class="step-n">৩</span><div><h2>তথ্য প্রদানকারী</h2><p>যাচাইয়ের প্রয়োজনে কাউন্সিল এই ব্যক্তির সাথে যোগাযোগ করবে। অনুমোদিত ফাইলও এই ই-মেইলে পাঠানো হবে।</p></div></div>
      <div class="grid g2">
        ${field('informant.name', 'নাম', { req: true, auto: 'name' })}
        ${field('informant.designation', 'পদবি', { req: true, placeholder: 'যেমন: অতিরিক্ত পরিচালক, IQAC' })}
        ${field('informant.phone', 'যোগাযোগের নম্বর', { req: true, type: 'tel', auto: 'tel' })}
        ${field('informant.email', 'ই-মেইল', { req: true, type: 'email', lat: true, auto: 'email' })}
        ${field('informant.date', 'তারিখ', { type: 'date' })}
      </div>
    </section>`;
    if (!data.informant.date && !ro) { data.informant.date = new Date().toISOString().slice(0, 10); const d = root.querySelector('[data-path="informant.date"]'); if (d) d.value = data.informant.date; }
    updatePreview();
  }

  function updatePreview() {
    if (!preview) return;
    preview.innerHTML = S.renderEntryHTML(S.buildEntry(data, { banglaDigits: cfg.banglaDigits !== false }));
  }

  function changed() {
    dirty = true;
    updatePreview();
    if (cfg.mode === 'new') { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ } }
  }

  root.addEventListener('input', e => {
    const p = e.target.dataset.path; if (!p) return;
    set(p, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
    const f = e.target.closest('.field'); if (f) { f.classList.remove('has-error'); const er = f.querySelector('.err'); if (er) er.remove(); }
    if (e.target.type === 'checkbox') e.target.closest('.officer').classList.toggle('is-vacant', e.target.checked);
    changed();
  });
  root.addEventListener('change', e => {
    const p = e.target.dataset.path; if (!p) return;
    if (/\.mobiles$/.test(p) && e.target.value) {
      e.target.value = S.splitMulti(e.target.value).map(S.formatMobile).join(', ');
      set(p, e.target.value); changed();
    }
    if (/emails$|website$|email$/.test(p)) { e.target.value = e.target.value.replace(/\s*[,;]\s*/g, ', ').trim(); set(p, e.target.value); changed(); }
  });
  root.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'addAddr') {
      if (data.addresses.length === 1 && !data.addresses[0].label) data.addresses[0].label = 'ক্যাম্পাস-১';
      data.addresses.push({ label: 'ক্যাম্পাস-' + S.toBn(data.addresses.length + 1), text: '' }); render(); changed();
      const ins = root.querySelectorAll('#addrList input[data-path$=".text"]'); ins[ins.length - 1].focus();
    } else if (t.dataset.removeAddr != null) {
      data.addresses.splice(+t.dataset.removeAddr, 1); render(); changed();
    } else if (t.id === 'addIqac') {
      data.officials.push({ key: 'iqac_add_' + Date.now(), group: 'iqac', designation: 'অতিরিক্ত পরিচালক', qualifier: '', name: '', office: '', mobiles: '', emails: '', vacant: false });
      render(); changed();
      const offs = root.querySelectorAll('.officer'); offs[offs.length - 1].querySelector('input[data-path$=".name"]').focus();
    } else if (t.dataset.removeOfficer != null) {
      data.officials.splice(+t.dataset.removeOfficer, 1); render(); changed();
    }
  });

  function showErrors(errors) {
    root.querySelectorAll('.has-error').forEach(f => f.classList.remove('has-error'));
    root.querySelectorAll('.err').forEach(x => x.remove());
    const box = document.getElementById('errSummary');
    if (!errors.length) { box.hidden = true; return; }
    errors.forEach(er => {
      const f = root.querySelector(`[data-field="${er.field}"]`);
      if (f) { f.classList.add('has-error'); if (!f.querySelector('.err')) f.insertAdjacentHTML('beforeend', `<div class="err">${esc(er.msg)}</div>`); }
    });
    box.innerHTML = `<strong>জমা দেওয়ার আগে ${S.toBn(errors.length)}টি বিষয় ঠিক করুন:</strong><ul>${errors.map(er => `<li><a href="#f-${esc(er.field)}" data-jump="${esc(er.field)}">${esc(er.msg)}</a></li>`).join('')}</ul>`;
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-jump]'); if (!a) return;
    e.preventDefault();
    const el = document.getElementById('f-' + a.dataset.jump) || root.querySelector(`[data-field="${a.dataset.jump}"] input`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }); }
  });

  const form = document.getElementById('mainForm');
  form && form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    if (!cfg.adminMode) {
      const errs = S.validate(data);
      if (errs.length) return showErrors(errs);
    }
    btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = 'সংরক্ষণ হচ্ছে…';
    try {
      const r = await fetch(cfg.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ data }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        dirty = false;
        if (cfg.mode === 'new') { try { localStorage.removeItem(DRAFT_KEY); } catch (e2) { /* ignore */ } }
        location.href = j.redirect; return;
      }
      if (j.errors) showErrors(j.errors);
      else showErrors([{ field: '_', msg: j.error || 'সংরক্ষণ করা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।' }]);
    } catch (err) {
      showErrors([{ field: '_', msg: 'সার্ভারে পৌঁছানো যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।' }]);
    }
    btn.disabled = false; btn.innerHTML = old;
  });
  window.addEventListener('beforeunload', e => { if (dirty && cfg.mode !== 'new') { e.preventDefault(); e.returnValue = ''; } });

  const tg = document.getElementById('previewToggle');
  tg && tg.addEventListener('click', () => { const c = tg.closest('.preview-col'); c.classList.toggle('open'); tg.setAttribute('aria-expanded', c.classList.contains('open')); });

  function showDraftNote() {
    const n = document.getElementById('draftNote'); if (!n) return;
    n.hidden = false;
    n.querySelector('button').addEventListener('click', () => {
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
      data = S.emptyData(); render(); n.hidden = true;
    });
  }

  render();
})();
