import { z } from 'zod';
import { system, untrusted } from '../llm/prompts.js';

const BriefSchema = z.object({
  summary: z.string().default(''),
  what_they_do: z.string().default(''),
  talking_points: z.array(z.string()).max(8).default([]),
  unknowns: z.array(z.string()).max(8).default([]),
});

const SYSTEM = system(`You write a short, factual company brief for someone about to interview there.
- "summary": 2-4 sentences: who they are and anything a candidate should know going in.
- "what_they_do": 1-3 sentences on the product/business, in plain words.
- "talking_points": up to 5 specific things from the material a candidate could reference (products, values, recent work).
- "unknowns": things a candidate would want to know that the material does not say (e.g. team size, interview format).
Use only the provided material. If it says little, write little and list the gaps in "unknowns". Never fill gaps with general knowledge or assumptions.
Public discussion snippets are unverified hearsay: only mention them as "people online report ...", never as fact.
JSON shape: {"summary":"","what_they_do":"","talking_points":[""],"unknowns":[""]}`);

/**
 * Builds the brief from what was actually retrieved. Sources are set by code from the
 * pages we fetched, never by the model. With no pages, the brief says so plainly and is
 * built from the job description alone.
 */
export async function buildCompanyBrief({ companyName, companyUrl, pages, crawl, hiring, discussion, jd, llm }) {
  const sources = pages.map((p) => p.url);
  const hiringSummary = hiring.found
    ? hiring.summary
    : 'No published hiring process was found on the company site.';

  const material = [];
  for (const p of pages) material.push(untrusted(p.url, `${p.title}\n${p.description}\n${p.text}`, 5000));
  if (!pages.length) material.push(untrusted('job description (the company site could not be read)', jd, 6000));
  const discussionHits = (discussion?.results || []).slice(0, 5);
  if (discussionHits.length) material.push(untrusted('public discussion (unverified)', discussionHits.map((r) => `${r.title}: ${r.snippet}`).join('\n---\n'), 3000));

  let out;
  let degraded = false;
  try {
    out = await llm.generateJSON({
      task: 'company_brief',
      system: SYSTEM,
      user: `Company: ${companyName || 'unknown'} (${companyUrl}).\n${pages.length ? '' : 'NOTE: nothing could be retrieved from the company website; only the job description is available.\n'}\n${material.join('\n\n')}`,
      schema: BriefSchema,
      data: { companyName, pages, jd, hasPages: pages.length > 0 },
      maxTokens: 1200,
      temperature: 0.2,
    });
  } catch {
    degraded = true;
    out = { summary: '', what_they_do: '', talking_points: [], unknowns: [] };
  }

  let summary = out.summary;
  let whatTheyDo = out.what_they_do;
  if (!pages.length) {
    const reason = crawl.failures[0]?.reason || 'nothing usable was found';
    summary = `We could not read ${companyUrl} (${reason}), so nothing here is verified from the company itself. ${summary}`.trim();
    if (!whatTheyDo) whatTheyDo = 'Not known: the company site could not be read and the job description does not describe the business.';
  } else if (!summary) {
    const home = pages[0];
    summary = [home.title, home.description].filter(Boolean).join(': ') || 'The company site was reached but the brief could not be generated; see the source pages.';
  }
  if (!whatTheyDo) whatTheyDo = pages[0]?.description || 'The pages retrieved do not describe the product clearly.';

  const unknowns = [...out.unknowns];
  if (!hiring.found) unknowns.unshift('The interview process: the company does not publish it on its site.');
  const DISCUSSION_NOTE = {
    nothing_found: 'What past candidates say: no public discussion of their interviews turned up.',
    unavailable: 'What past candidates say: public discussion sources could not be reached this time.',
    skipped: 'What past candidates say: there was no company name to search for.',
  };
  if (DISCUSSION_NOTE[discussion?.status]) unknowns.push(DISCUSSION_NOTE[discussion.status]);

  return {
    summary,
    what_they_do: whatTheyDo,
    sources,
    hiring_process: hiringSummary,
    hiring_stages: hiring.stages,
    talking_points: out.talking_points,
    unknowns: [...new Set(unknowns)].slice(0, 8),
    public_discussion: discussionHits.map((r) => ({ url: r.url, title: r.title, source: r.source, confidence: r.confidence })),
    degraded,
  };
}
