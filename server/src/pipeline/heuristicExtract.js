import { splitLines, headingKind, stripBullet } from './grounding.js';

const BULLET = /^\s*([-*•·▪◦‣–]|\d+[.)])\s+/;
const SKILLISH = /\b(experience|years?|proficien|familiar|knowledge|understanding|expertise|skilled|ability to|comfortable|fluent|background in|degree)\b/i;
const BEHAVIOURAL = /\b(mentor|coach|communicat|collaborat|stakeholder|leadership|lead(ing)? (a |the )?team|ownership|feedback|cross[- ]functional|teamwork|empath|conflict|influence|presentation|autonom|self[- ]starter|interpersonal)\w*/i;
const DOMAIN = /\b(fintech|finance|financial|banking|payments?|healthcare|health ?tech|medical|insurance|e-?commerce|retail|logistics|compliance|regulat\w+|gaming|advertising|ad ?tech|edtech|education|legal|real estate|telecom|automotive|energy|crypto|blockchain|saas|b2b|marketplace|industry|domain)\b/i;
const RESP_HEADER = /responsibilit|what you('ll| will) do|the role|day[- ]to[- ]day|you will/i;

export function classifyKind(text) {
  if (BEHAVIOURAL.test(text)) return 'behavioural';
  if (DOMAIN.test(text)) return 'domain';
  return 'technical';
}

/**
 * A no-model reading of a posting: bullets under requirement-like headings become
 * requirements, bullets under responsibility headings become responsibilities.
 * It never paraphrases, so it cannot invent anything. Used when every model provider
 * is unavailable, and by the offline mock provider in tests.
 */
export function heuristicExtract(jd) {
  const lines = splitLines(jd);
  const requirements = [];
  const responsibilities = [];
  let section = 'none';
  let sawHeadings = false;
  const firstLine = lines.map((l) => l.trim()).find(Boolean) || '';

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const kind = headingKind(line);
    if (kind) {
      sawHeadings = true;
      section = kind === 'other' ? (RESP_HEADER.test(line) ? 'resp' : 'other') : kind;
      continue;
    }
    const text = stripBullet(line).replace(/[.;]+$/, '');
    if (!text || text.length < 3 || text.length > 300) continue;
    const bullet = BULLET.test(raw);
    if (section === 'must' || section === 'nice') {
      requirements.push({ text, kind: classifyKind(text), priority: section, evidence: text });
    } else if (section === 'resp' && bullet) {
      responsibilities.push(text);
    } else if ((!sawHeadings || section === 'none') && (bullet || SKILLISH.test(text)) && SKILLISH.test(text)) {
      const nice = /\b(plus|bonus|nice|preferred|ideally)\b/i.test(text);
      requirements.push({ text, kind: classifyKind(text), priority: nice ? 'nice' : 'must', evidence: text });
    }
  }

  // Very short postings: pull skill-like sentences out of the prose.
  if (!requirements.length) {
    for (const sentence of String(jd).split(/(?<=[.!?])\s+|\n/)) {
      const s = sentence.trim().replace(/[.]+$/, '');
      if (s && s.length < 250 && SKILLISH.test(s)) requirements.push({ text: s, kind: classifyKind(s), priority: 'must', evidence: s });
    }
  }

  // Two-line stubs ("Python and SQL."): name the technologies the posting literally mentions.
  if (!requirements.length) {
    const body = lines.slice(1).join('\n') || jd;
    for (const [re, label] of TECH) {
      const m = body.match(re);
      if (m) requirements.push({ text: label, kind: 'technical', priority: 'must', evidence: m[0] });
    }
  }

  const title = firstLine.length <= 90 && !BULLET.test(firstLine) ? firstLine.replace(/[:.]$/, '') : '';
  return { title, seniority: '', company: '', location: '', responsibilities, requirements };
}

const TECH = [
  'Python', 'SQL', 'Java', 'JavaScript', 'TypeScript', 'React', 'Node.js', 'Go', 'Rust', 'C++', 'C#', 'Ruby', 'PHP', 'Kotlin', 'Swift',
  'AWS', 'GCP', 'Azure', 'Kubernetes', 'Docker', 'Terraform', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Kafka', 'Spark', 'Airflow',
  'dbt', 'Snowflake', 'GraphQL', 'Linux', 'Next.js', 'Django', 'Flask', 'Spring', 'Excel', 'Tableau', 'Figma', 'machine learning',
].map((label) => [new RegExp(`(?<![\\w.])${label.replace(/[.+#]/g, (c) => `\\${c}`)}(?![\\w])`, label === 'Go' ? '' : 'i'), label]);
