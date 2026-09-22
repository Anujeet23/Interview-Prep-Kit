/**
 * Decides, in code, which question categories a kit gets and which requirements each
 * category is responsible for. The model is then called once per category with
 * instructions specific to that category.
 *
 *   technical      <- technical + domain requirements
 *   behavioural    <- behavioural requirements
 *   system-design  <- architecture/scale requirements, when the role is senior enough
 *                     or the company says it runs a design round
 *   company-fit    <- always; grounded in the company brief rather than a requirement list
 */
export const CATEGORIES = ['technical', 'behavioural', 'system-design', 'company-fit'];

const SD_STRONG = /\b(system design|architect\w*|distributed|scalab\w+|high[- ]availability|microservices?|large[- ]scale|at scale|event[- ]driven)\b/i;
const SD_WEAK = /\b(design|infrastructure|performance|reliab\w+|throughput|latency|databases?|api design|data model\w*|kafka|queue\w*|caching|cloud|aws|gcp|azure|kubernetes)\b/i;
const SENIOR = new Set(['senior', 'staff', 'principal', 'lead']);

export function primaryCategory(req) {
  return req.kind === 'behavioural' ? 'behavioural' : 'technical';
}

export function planCategories({ requirements, seniority, signals = {} }) {
  const technical = requirements.filter((r) => r.kind !== 'behavioural');
  const behavioural = requirements.filter((r) => r.kind === 'behavioural');
  const senior = SENIOR.has(seniority);
  const sdReqs = technical.filter((r) => SD_STRONG.test(r.text) || (senior && SD_WEAK.test(r.text)));
  const includeSD = sdReqs.length > 0 && (senior || signals.system_design || sdReqs.some((r) => SD_STRONG.test(r.text)));

  const plan = [];
  if (technical.length) {
    plan.push({ category: 'technical', requirement_ids: technical.map((r) => r.id), count: clamp(Math.ceil(technical.length * 1.5), 2, 12) });
  }
  if (behavioural.length) {
    plan.push({ category: 'behavioural', requirement_ids: behavioural.map((r) => r.id), count: clamp(behavioural.length + 1, 2, 7) });
  }
  if (includeSD) {
    plan.push({ category: 'system-design', requirement_ids: sdReqs.map((r) => r.id), count: signals.system_design ? 3 : 2 });
  }
  plan.push({ category: 'company-fit', requirement_ids: requirements.map((r) => r.id), count: requirements.length ? 2 : 3 });
  return plan;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
