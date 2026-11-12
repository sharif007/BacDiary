const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, VerticalAlign, PageBreak,
} = require('docx');
const shared = require('../public/js/shared');

// A4 with 1" margins, matching the sample file (11909 x 16834 twips).
const PAGE = { width: 11909, height: 16834, margin: 1440 };
const CONTENT_W = PAGE.width - 2 * PAGE.margin;
const COLS = [Math.round(CONTENT_W * 0.43), Math.round(CONTENT_W * 0.23)];
COLS.push(CONTENT_W - COLS[0] - COLS[1]);

function makeRuns(opts) {
  const bnFont = { ascii: opts.font, hAnsi: opts.font, cs: opts.font, eastAsia: opts.font };
  const latFont = { ascii: opts.latin, hAnsi: opts.latin, cs: opts.latin };
  return {
    bn: (text, o = {}) => new TextRun({ text, font: bnFont, size: o.size || 20, sizeComplexScript: o.size || 20, bold: !!o.bold, boldComplexScript: !!o.bold, break: o.break }),
    lat: (text, o = {}) => new TextRun({ text, font: latFont, size: o.size || 18, sizeComplexScript: o.size || 18, bold: !!o.bold, break: o.break }),
  };
}

const tight = { before: 0, after: 0, line: 240 };
const cellSp = { before: 30, after: 30, line: 240 };
const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };

function entryBlocks(entry, opts) {
  const { bn, lat } = makeRuns(opts);
  const out = [];
  out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: tight, children: [bn(entry.title, { size: 30, bold: true })] }));
  entry.addressLines.forEach(a => out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: tight, children: [bn(a, { bold: true })] })));
  if (entry.phones.length) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: tight, children: [bn('টেলিফোন: ' + entry.phones.join(', '))] }));
  const line = [];
  if (entry.emails.length) {
    line.push(bn('ই-মেইল: '));
    entry.emails.forEach((m, i) => { if (i) line.push(bn(', ')); line.push(lat(m, { size: 18 })); });
  }
  if (entry.websites.length) {
    line.push(bn(line.length ? '; ওয়েবসাইট: ' : 'ওয়েবসাইট: '));
    entry.websites.forEach((w, i) => { if (i) line.push(bn(', ')); line.push(lat(w, { size: 16 })); });
  }
  if (line.length) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 120, line: 240 }, children: line }));

  const cell = (paras, w, o = {}) => new TableCell({
    width: { size: w, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, columnSpan: o.span,
    margins: { left: 60, right: 60 }, children: paras,
  });
  const p = (children, align) => new Paragraph({ spacing: cellSp, alignment: align, children });

  const rows = [new TableRow({
    tableHeader: true,
    children: [
      cell([p([bn('নাম ও পদবি', { bold: true })], AlignmentType.CENTER)], COLS[0]),
      cell([p([bn('অফিস', { bold: true })], AlignmentType.CENTER)], COLS[1]),
      cell([p([bn('মোবাইল ও ই-মেইল', { bold: true })], AlignmentType.CENTER)], COLS[2]),
    ],
  })];
  entry.rows.forEach(r => {
    if (r.type === 'section') {
      rows.push(new TableRow({ cantSplit: true, children: [cell([p([bn(r.text, { bold: true })])], CONTENT_W, { span: 3 })] }));
      return;
    }
    const contact = [];
    r.mobiles.forEach((m, i) => contact.push(bn(m, { break: i ? 1 : 0 })));
    r.emails.forEach((m, i) => contact.push(lat(m, { size: 16, break: contact.length || i ? 1 : 0 })));
    rows.push(new TableRow({
      cantSplit: true,
      children: [
        cell([p([bn(r.designation), bn(r.name || '', { break: 1 })])], COLS[0]),
        cell([p(r.office.length ? r.office.map((o, i) => bn(o, { break: i ? 1 : 0 })) : [bn('-')], AlignmentType.CENTER)], COLS[1]),
        cell([p(contact.length ? contact : [bn('-')])], COLS[2]),
      ],
    }));
  });
  out.push(new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: COLS, borders, rows }));
  return out;
}

function docOptions(settings) {
  return {
    font: settings.doc_font || 'SutonnyOMJ',
    latin: settings.latin_font || 'Times New Roman',
    banglaDigits: settings.bangla_digits !== '0',
  };
}

function wrap(children, opts) {
  return new Document({
    creator: 'Bangladesh Accreditation Council',
    title: 'BAC Diary 2027',
    styles: { default: { document: { run: { font: { ascii: opts.font, hAnsi: opts.font, cs: opts.font }, size: 20 } } } },
    sections: [{ properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin } } }, children }],
  });
}

/** One university → Buffer (.docx) */
async function singleDocx(data, settings) {
  const opts = docOptions(settings);
  const entry = shared.buildEntry(data, opts);
  return Packer.toBuffer(wrap(entryBlocks(entry, opts), opts));
}

/** Many universities (approved, ordered by serial) → one combined diary .docx */
async function combinedDocx(items, settings, { pageBreak = false, withSerial = true } = {}) {
  const opts = docOptions(settings);
  const { bn } = makeRuns(opts);
  const children = [];
  items.forEach((it, idx) => {
    const entry = shared.buildEntry(it.data, opts);
    if (withSerial && it.serial_no) entry.title = `${opts.banglaDigits ? shared.toBn(it.serial_no) : it.serial_no}. ${entry.title}`;
    if (idx > 0) {
      children.push(pageBreak ? new Paragraph({ children: [new PageBreak()] }) : new Paragraph({ spacing: { before: 240, after: 240 }, children: [bn('')] }));
    }
    children.push(...entryBlocks(entry, opts));
  });
  return Packer.toBuffer(wrap(children, opts));
}

module.exports = { singleDocx, combinedDocx };
