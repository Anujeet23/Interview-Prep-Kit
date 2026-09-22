import { primaryCategory } from './categoryPlanner.js';
import { generateCategoryQuestions, templateQuestion } from './generateQuestions.js';

/** Deterministic: a requirement is covered iff at least one question lists its id. */
export function findGaps(requirements, questions) {
  const covered = new Set(questions.flatMap((q) => q.requirement_ids || []));
  return requirements.filter((r) => !covered.has(r.id));
}

export const MAX_MODEL_PASSES = 3;

/**
 * The second pass. Pass 1 is the draft. While gaps remain and we still have model passes
 * left, ask for questions targeted at exactly the uncovered requirements (grouped by the
 * category that owns them), then check again.
 *
 * Why 3: pass 2 closes almost every gap because the prompt names the missing ids; pass 3
 * catches the odd stubborn one; beyond that each pass costs a rate-limited call for
 * diminishing return. If anything is still uncovered, a labelled template question is
 * added so a must-have never ships uncovered, and the kit records that it happened.
 *
 * `coverage.passes` = how many times the coverage check ran.
 */
export async function closeCoverageGaps({ llm, requirements, questions, role, brief, signals, onPass = () => {}, maxPasses = MAX_MODEL_PASSES }) {
  let all = [...questions];
  let gaps = findGaps(requirements, all);
  let passes = 1;
  const log = [{ pass: 1, gaps: gaps.map((g) => g.id) }];
  onPass(log[0]);

  while (gaps.length && passes < maxPasses) {
    passes++;
    const byCategory = new Map();
    for (const g of gaps) {
      const cat = primaryCategory(g);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(g);
    }
    for (const [category, reqs] of byCategory) {
      try {
        const added = await generateCategoryQuestions({
          llm,
          category,
          requirements: reqs,
          allRequirements: requirements,
          count: reqs.length,
          role,
          brief,
          signals,
          existing: all,
          gapMode: true,
        });
        all = all.concat(added.map((q) => ({ ...q, from_pass: passes })));
      } catch {
        /* the check below decides what happens next */
      }
    }
    gaps = findGaps(requirements, all);
    log.push({ pass: passes, gaps: gaps.map((g) => g.id) });
    onPass(log[log.length - 1]);
  }

  const templated = [];
  if (gaps.length) {
    for (const g of gaps) {
      const t = { ...templateQuestion(g), from_pass: passes };
      all.push(t);
      templated.push(g.id);
    }
    passes++;
    gaps = findGaps(requirements, all);
    log.push({ pass: passes, gaps: gaps.map((g) => g.id), templated });
    onPass(log[log.length - 1]);
  }

  return { questions: all, uncovered: gaps.map((g) => g.id), passes, log, templated };
}
