'use client';
import { EditableText } from './EditableText';
import { Button, Pill, SectionHeader } from './ui';
import { MetaBadges, PinToggle } from './MetaBadges';

export function OverviewPanel({ kit, send, regenerate, regenerating }) {
  const b = kit.company_brief;
  const r = kit.role;
  const q = kit.quality || {};
  const research = kit.research || {};
  const briefBusy = regenerating?.section === 'company_brief';
  const patchBrief = (body) => send('/brief', 'PATCH', body);

  function regen() {
    if (b.meta?.edited && !window.confirm('Regenerating the brief replaces your edits to it. Pin it instead if you want to keep them. Continue?')) return;
    regenerate('company_brief');
  }

  return (
    <div className="space-y-10">
      {(q.thin_jd || !research.company_reachable || !research.hiring_page_found || q.degraded_steps?.length > 0) && (
        <aside aria-label="What we could and couldn't find" className="rounded-lg border border-warn/40 bg-warn/5 px-5 py-4">
          <p className="font-semibold text-warn">What this kit is based on</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {(q.notes || []).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </aside>
      )}

      <section aria-labelledby="brief-h" aria-busy={briefBusy}>
        <SectionHeader
          title={<span id="brief-h">{kit.source.company || 'Company'} brief</span>}
          description={b.sources?.length ? `From ${b.sources.length} page(s) on their site.` : 'Nothing could be read from the company site.'}
          actions={
            <>
              <MetaBadges meta={b.meta} />
              <PinToggle pinned={b.meta?.pinned} onChange={(pinned) => patchBrief({ pinned })} label="brief" />
              <Button size="sm" onClick={regen} busy={briefBusy} disabled={b.meta?.pinned || !!regenerating} title={b.meta?.pinned ? 'Unpin to regenerate' : undefined}>
                Regenerate brief
              </Button>
            </>
          }
        />
        <div className={`grid gap-6 rounded-lg border border-rule bg-sheet p-5 md:grid-cols-2 ${briefBusy ? 'opacity-60' : ''}`}>
          <div>
            <h3 className="text-sm font-semibold text-muted">Summary</h3>
            <EditableText multiline label="Company summary" value={b.summary} onSave={(v) => patchBrief({ summary: v })} textClassName="text-[15px] leading-relaxed" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-muted">What they do</h3>
            <EditableText multiline label="What they do" value={b.what_they_do} onSave={(v) => patchBrief({ what_they_do: v })} textClassName="leading-relaxed" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-muted">How they hire</h3>
            <EditableText multiline label="Hiring process" value={b.hiring_process || ''} onSave={(v) => patchBrief({ hiring_process: v })} />
            {b.hiring_stages?.length > 0 && (
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                {b.hiring_stages.map((s, i) => (
                  <li key={i}>
                    <span className="font-medium">{s.name}</span>
                    {s.description && s.description !== s.name && <span className="text-muted">: {s.description}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="space-y-4">
            {b.talking_points?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-muted">Worth mentioning</h3>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {b.talking_points.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            {b.unknowns?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-muted">Not known: ask your interviewer</h3>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {b.unknowns.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="text-sm md:col-span-2">
            <h3 className="font-semibold text-muted">Sources</h3>
            {b.sources?.length ? (
              <ul className="mt-1 space-y-0.5">
                {b.sources.map((s) => (
                  <li key={s} className="truncate">
                    <a className="text-action underline-offset-2 hover:underline" href={s} target="_blank" rel="noreferrer noopener">
                      {s}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">None: this brief is based on the job description only.</p>
            )}
            {b.public_discussion?.length > 0 && (
              <>
                <h3 className="mt-3 font-semibold text-muted">Public discussion (unverified)</h3>
                <ul className="mt-1 space-y-0.5">
                  {b.public_discussion.map((d) => (
                    <li key={d.url} className="truncate">
                      <a className="text-action hover:underline" href={d.url} target="_blank" rel="noreferrer noopener">
                        {d.title || d.url}
                      </a>{' '}
                      <span className="text-muted">({d.source}, {d.confidence} confidence)</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {research.failed_sources?.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-muted">{research.failed_sources.length} source(s) skipped</summary>
                <ul className="mt-1 space-y-0.5 text-muted">
                  {research.failed_sources.map((f, i) => (
                    <li key={i} className="truncate">
                      {f.url}: {f.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="role-h">
        <SectionHeader
          title={<span id="role-h">{r.title}</span>}
          description={`${r.seniority !== 'unspecified' ? `${r.seniority[0].toUpperCase()}${r.seniority.slice(1)} level · ` : ''}${r.requirements.length} requirements, ${r.requirements.filter((x) => x.priority === 'must').length} must-have`}
        />
        {r.requirements.length === 0 ? (
          <p className="text-muted">The posting doesn’t state any concrete requirements, so the questions focus on the role and the company.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-rule bg-sheet">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Requirements extracted from the job description</caption>
              <thead className="border-b border-rule text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Requirement
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Priority
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Kind
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Questions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {r.requirements.map((req) => {
                  const n = kit.questions.filter((x) => x.requirement_ids.includes(req.id)).length;
                  return (
                    <tr key={req.id}>
                      <td className="px-4 py-2">
                        <span className="mr-2 text-xs text-muted">{req.id}</span>
                        {req.text}
                        {req.evidence && <span className="block text-xs text-muted">“{req.evidence}”</span>}
                      </td>
                      <td className="px-4 py-2">
                        <Pill tone={req.priority}>{req.priority === 'must' ? 'Must-have' : 'Nice to have'}</Pill>
                      </td>
                      <td className="px-4 py-2 text-muted">{req.kind}</td>
                      <td className={`px-4 py-2 ${n ? '' : 'font-semibold text-danger'}`}>{n || 'None'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {r.responsibilities?.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold">Responsibilities ({r.responsibilities.length})</summary>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {r.responsibilities.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
