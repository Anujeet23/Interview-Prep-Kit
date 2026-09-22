import { z } from 'zod';
import { system, untrusted } from '../llm/prompts.js';
import { locateEvidence, priorityFromPosting } from './grounding.js';
import { heuristicExtract, classifyKind } from './heuristicExtract.js';
import { jaccard, collapse, truncate } from '../lib/text.js';

const lowerEnum = (values, fallback) =>
  z.preprocess((v) => String(v ?? '').toLowerCase().replace(/[^a-z]/g, ''), z.string()).transform((v) => (values.includes(v) ? v : fallback));

const ExtractionSchema = z.object({
  title: z.string().default(''),
  seniority: z.string().default(''),
  company: z.string().default(''),
  location: z.string().default(''),
  responsibilities: z.array(z.string()).default([]),
  requirements: z
    .array(
      z.object({
        text: z.string().min(2),
        kind: lowerEnum(['technical', 'behavioural', 'behavioral', 'domain'], 'technical').transform((k) => (k === 'behavioral' ? 'behavioural' : k)),
        priority: lowerEnum(['must', 'nice'], 'must'),
        evidence: z.string().default(''),
      })
    )
    .default([]),
});

const SYSTEM = system(`You extract hiring requirements from a job posting for an interview-preparation tool.
Rules:
- A requirement is a skill, experience, qualification or trait the posting asks the candidate to HAVE. Duties ("you will build X") are responsibilities, not requirements, unless the posting also asks for experience doing them.
- One requirement per distinct skill. Split "React and Node.js" into two only if the posting treats them separately.
- "text": a short, faithful restatement (max 12 words). Never add skills the posting does not mention.
- "evidence": copy the exact phrase from the posting that states it (verbatim, 3-25 words).
- "kind": technical (tools, languages, engineering skills), behavioural (collaboration, mentoring, communication, leadership), or domain (industry or business knowledge).
- "priority": "must" if presented as required/expected; "nice" if the posting words it as preferred, bonus, a plus, nice-to-have, ideally.
- A short or vague posting should produce few requirements. Returning zero is acceptable.
- title/seniority/company/location: only if stated in the posting, else "".
JSON shape: {"title":"","seniority":"","company":"","location":"","responsibilities":[""],"requirements":[{"text":"","kind":"technical","priority":"must","evidence":""}]}`);

const SENIORITY = [
  [/\b(intern|internship)\b/i, 'intern'],
  [/\b(junior|entry[- ]level|graduate|new grad|associate)\b/i, 'junior'],
  [/\b(principal|distinguished)\b/i, 'principal'],
  [/\b(staff)\b/i, 'staff'],
  [/\b(lead|head of|manager)\b/i, 'lead'],
  [/\b(senior|sr\.?)\b/i, 'senior'],
  [/\b(mid[- ]level|intermediate)\b/i, 'mid'],
];

export function inferSeniority(title, jd) {
  for (const [re, label] of SENIORITY) if (re.test(title)) return label;
  const years = String(jd).match(/(\d{1,2})\+?\s*(?:years|yrs)/i);
  if (years) {
    const n = Number(years[1]);
    return n >= 8 ? 'staff' : n >= 5 ? 'senior' : n >= 2 ? 'mid' : 'junior';
  }
  return 'unspecified';
}

/**
 * Keep only requirements the posting supports, fix priority from the posting's wording,
 * merge duplicates, and assign stable ids r1..rn in posting order.
 */
export function groundRequirements(jd, raw) {
  const kept = [];
  const dropped = [];
  for (const r of raw) {
    const evidence = collapse(r.evidence) || collapse(r.text);
    let loc = locateEvidence(jd, evidence);
    if (loc.score < 0.6) {
      const alt = locateEvidence(jd, r.text);
      if (alt.score > loc.score) loc = alt;
    }
    if (loc.score < 0.6) {
      dropped.push({ text: r.text, reason: 'not found in the job description' });
      continue;
    }
    const fromPosting = priorityFromPosting(jd, loc.line);
    const text = truncate(collapse(r.text), 140);
    const dup = kept.find((k) => jaccard(k.text, text) >= 0.75);
    if (dup) {
      if (fromPosting === 'must' || r.priority === 'must') dup.priority = dup.priorityLocked ? dup.priority : 'must';
      continue;
    }
    kept.push({
      text,
      kind: ['technical', 'behavioural', 'domain'].includes(r.kind) ? r.kind : classifyKind(text),
      priority: fromPosting ?? r.priority ?? 'must',
      priority_source: fromPosting ? 'posting' : 'model',
      priorityLocked: Boolean(fromPosting),
      evidence: truncate(evidence, 200),
      line: loc.line,
    });
  }
  kept.sort((a, b) => a.line - b.line);
  const requirements = kept.map((k, i) => ({
    id: `r${i + 1}`,
    text: k.text,
    kind: k.kind,
    priority: k.priority,
    evidence: k.evidence,
    priority_source: k.priority_source,
  }));
  return { requirements, dropped };
}

export async function extractRequirements(jd, { llm }) {
  const notes = [];
  let raw;
  let method = 'model';
  try {
    raw = await llm.generateJSON({
      task: 'extract_requirements',
      system: SYSTEM,
      user: `Extract the requirements from this job posting.\n\n${untrusted('job description', jd, 16_000)}`,
      schema: ExtractionSchema,
      data: { jd },
      maxTokens: 3000,
      temperature: 0.1,
    });
  } catch (e) {
    method = 'heuristic';
    notes.push(`Requirement extraction fell back to a rule-based reading of the posting because the model was unavailable (${e.code || e.message}).`);
    raw = heuristicExtract(jd);
  }

  const { requirements, dropped } = groundRequirements(jd, raw.requirements);
  if (dropped.length) notes.push(`${dropped.length} model-suggested requirement(s) were discarded because the posting does not contain them.`);

  const heur = heuristicExtract(jd);
  const title = collapse(raw.title) || heur.title || 'Untitled role';
  const responsibilities = raw.responsibilities
    .map(collapse)
    .filter((r) => r && locateEvidence(jd, r).score >= 0.5)
    .slice(0, 15);

  const thin = jd.trim().length < 400 || requirements.length < 3;
  if (thin) {
    notes.push(
      `The job description is short (${jd.trim().length} characters) and only ${requirements.length} requirement(s) could be identified. The kit is deliberately small rather than padded with guesses.`
    );
  }

  return {
    role: {
      title,
      seniority: inferSeniority(title, jd) !== 'unspecified' ? inferSeniority(title, jd) : collapse(raw.seniority).toLowerCase() || 'unspecified',
      responsibilities,
      requirements,
    },
    company_from_jd: collapse(raw.company),
    location: collapse(raw.location),
    thin,
    method,
    dropped,
    notes,
  };
}
