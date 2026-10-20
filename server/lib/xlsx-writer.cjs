/**
 * 极简 XLSX 写入器
 * ------------------------------------------------------------------
 * 不依赖任何外部库，直接生成符合 OOXML 规范的 .xlsx 文件。
 * 这里用最稳妥的做法：所有单元格写成 inline string / number，
 * 数字单元格带 type="n"，避免依赖 sharedStrings 与样式表。
 */
(function (global) {
  /* ---------- CRC32（ZIP 需要） ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const enc = new TextEncoder();
  const u16 = (n) => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

  /* ---------- 最小 ZIP 打包 ---------- */
  function zip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;

    files.forEach((f) => {
      const nameBytes = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const local = [];
      local.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(crc), ...u32(data.length), ...u32(data.length),
        ...u16(nameBytes.length), ...u16(0));
      const localHead = new Uint8Array(local);
      chunks.push(localHead, nameBytes, data);

      central.push({ nameBytes, crc, size: data.length, offset });
      offset += localHead.length + nameBytes.length + data.length;
    });

    const cdStart = offset;
    let cdSize = 0;
    central.forEach((c) => {
      const rec = [];
      rec.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(c.crc), ...u32(c.size), ...u32(c.size),
        ...u16(c.nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
        ...u32(c.offset));
      const head = new Uint8Array(rec);
      chunks.push(head, c.nameBytes);
      cdSize += head.length + c.nameBytes.length;
    });

    chunks.push(new Uint8Array([
      ...u32(0x06054b50), ...u16(0), ...u16(0),
      ...u16(central.length), ...u16(central.length),
      ...u32(cdSize), ...u32(cdStart), ...u16(0),
    ]));

    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    chunks.forEach((c) => { out.set(c, p); p += c.length; });
    return out;
  }

  /* ---------- 单元格 / 表 XML ---------- */
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // 去掉 XML 1.0 不允许的控制字符
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  const colName = (n) => {
    let s = '';
    n += 1;
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };

  function cellXml(ref, v, styleIdx) {
    const s = styleIdx ? ` s="${styleIdx}"` : '';
    if (v === null || v === undefined || v === '') return `<c r="${ref}"${s}/>`;
    if (typeof v === 'number' && Number.isFinite(v)) {
      return `<c r="${ref}"${s}><v>${v}</v></c>`;
    }
    if (typeof v === 'boolean') return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
    const str = esc(v);
    if (str.length > 32000) {
      return `<c r="${ref}"${s} t="inlineStr"><is><t>${str.slice(0, 32000)}…（内容过长已截断）</t></is></c>`;
    }
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${str}</t></is></c>`;
  }

  /**
   * @param sheets [{ name, columns:[{title,width,type}], rows:[[...]] , freeze:number}]
   *   rows 中每个元素是数组；第一行可为表头（由 columns 生成）。
   */
  function buildSheetXml(sheet) {
    const cols = sheet.columns || [];
    const widths = cols.map((c) => `<col min="${cols.indexOf(c) + 1}" max="${cols.indexOf(c) + 1}" width="${c.width || 14}" customWidth="1"/>`).join('');
    const rows = [];
    // 表头
    rows.push(`<row r="1" ht="22" customHeight="1">${cols.map((c, i) => cellXml(`${colName(i)}1`, c.title, 1)).join('')}</row>`);
    (sheet.rows || []).forEach((r, ri) => {
      const rn = ri + 2;
      rows.push(`<row r="${rn}">${r.map((v, ci) => cellXml(`${colName(ci)}${rn}`, v, 0)).join('')}</row>`);
    });
    const dim = `A1:${colName(Math.max(cols.length - 1, 0))}${(sheet.rows || []).length + 1}`;
    const pane = sheet.freeze
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freeze}" topLeftCell="A${sheet.freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${dim}"/>${pane}
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths}</cols>
<sheetData>${rows.join('')}</sheetData>
<autoFilter ref="A1:${colName(Math.max(cols.length - 1, 0))}1"/>
</worksheet>`;
  }

  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="10"/><name val="等线"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="等线"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1E4D8C"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function safeSheetName(n, used) {
    let s = String(n).replace(/[\\\/\?\*\[\]:]/g, '_').slice(0, 31) || 'Sheet';
    let base = s, i = 2;
    while (used.has(s)) { s = (base.slice(0, 28) + '_' + i).slice(0, 31); i++; }
    used.add(s);
    return s;
  }

  /** 生成 xlsx 的 Uint8Array */
  function writeXlsx(sheets) {
    const used = new Set();
    const norm = sheets.map((s) => ({ ...s, name: safeSheetName(s.name, used) }));

    const files = [];
    files.push({
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${norm.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`,
    });
    files.push({
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    });
    files.push({
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${norm.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`,
    });
    files.push({
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${norm.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${norm.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    });
    files.push({ name: 'xl/styles.xml', data: STYLES_XML });
    norm.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: buildSheetXml(s) }));

    return zip(files);
  }

  global.XlsxWriter = { writeXlsx, colName };
  if (typeof module !== 'undefined' && module.exports) module.exports = { writeXlsx, colName };
})(typeof window !== 'undefined' ? window : globalThis);
