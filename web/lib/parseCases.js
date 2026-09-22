/**
 * Reads a batch file into [{ jd, company_url, days }].
 * Accepts the same JSON as `npm run evaluate` (an array of cases), or a CSV with a header
 * row containing jd, company_url and (optionally) days. CSV fields may be quoted and
 * contain commas and newlines.
 */
export function parseCasesFile(name, text, defaultDays = 5) {
  const rows = name.toLowerCase().endsWith('.csv') ? parseCsv(text) : parseJson(text);
  if (!rows.length) throw new Error('The file has no entries.');
  return rows.map((r, i) => ({
    row: i + 1,
    jd: String(r.jd ?? r.job_description ?? r.description ?? '').trim(),
    company_url: String(r.company_url ?? r.url ?? r.company ?? '').trim(),
    days: Number(r.days) || defaultDays,
  }));
}

function parseJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not valid JSON.');
  }
  if (!Array.isArray(data)) throw new Error('The JSON must be an array of { jd, company_url, days } objects.');
  return data;
}

export function parseCsv(text) {
  const records = [];
  let field = '';
  let record = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      if (record.some((f) => f.trim())) records.push(record);
      record = [];
      field = '';
    } else field += c;
  }
  record.push(field);
  if (record.some((f) => f.trim())) records.push(record);
  if (records.length < 2) throw new Error('The CSV needs a header row and at least one entry.');
  const header = records[0].map((h) => h.trim().toLowerCase());
  if (!header.includes('jd') && !header.includes('job_description')) throw new Error('The CSV header must include a "jd" column.');
  return records.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
