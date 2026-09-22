'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useKit } from '@/lib/useKit';
import { AppHeader } from '@/components/AppHeader';
import { GenerationProgress } from '@/components/GenerationProgress';
import { OverviewPanel } from '@/components/OverviewPanel';
import { QuestionsPanel } from '@/components/QuestionsPanel';
import { FlashcardsPanel } from '@/components/FlashcardsPanel';
import { SchedulePanel } from '@/components/SchedulePanel';
import { PracticePanel } from '@/components/PracticePanel';
import { StoryBankPanel } from '@/components/StoryBankPanel';
import { Button, ErrorState, Spinner } from '@/components/ui';

const SECTIONS = [
  ['overview', 'Company & role'],
  ['questions', 'Questions'],
  ['flashcards', 'Flashcards'],
  ['schedule', 'Schedule'],
  ['practice', 'Practice'],
  ['stories', 'Story bank'],
];

export default function KitPage() {
  const { id } = useParams();
  const k = useKit(id);
  const [section, setSection] = useState('overview');

  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (SECTIONS.some(([key]) => key === fromHash)) setSection(fromHash);
  }, []);
  function go(key) {
    setSection(key);
    history.replaceState(null, '', `#${key}`);
    document.getElementById('main')?.focus();
  }

  const { doc, kit, error } = k;

  let body;
  if (error) {
    body = (
      <ErrorState
        title={error.status === 404 ? 'Kit not found' : 'Could not load this kit'}
        message={error.status === 404 ? 'It may have been deleted, or it belongs to another account.' : error.message}
        action={
          <Link href="/kits" className="text-sm font-semibold text-action underline">
            Back to your kits
          </Link>
        }
      />
    );
  } else if (!doc) {
    body = (
      <p className="flex items-center gap-2 text-muted" aria-busy="true">
        <Spinner /> Loading kit…
      </p>
    );
  } else if (doc.status === 'queued' || doc.status === 'running') {
    body = <GenerationProgress doc={doc} />;
  } else if (doc.status === 'failed') {
    body = (
      <div className="mx-auto max-w-2xl space-y-6">
        <ErrorState
          title="This kit couldn’t be generated"
          message={`${doc.error?.message || 'Unknown error.'}${doc.error?.code === 'LLM_UNAVAILABLE' ? ' The AI provider was unavailable or out of free quota; waiting a minute usually fixes it.' : ''}`}
          action={
            <Button variant="primary" onClick={k.retry}>
              Try again
            </Button>
          }
        />
        {doc.progress?.length > 0 && <GenerationProgress doc={{ ...doc, status: 'failed' }} />}
      </div>
    );
  } else if (kit) {
    const props = { kit, send: k.send, optimistic: k.optimistic, regenerate: k.regenerate, regenerating: doc.regenerating };
    body = (
      <div className="grid gap-6 md:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label="Kit sections" className="-mx-4 overflow-x-auto border-b border-rule px-4 md:mx-0 md:border-0 md:px-0">
          <ul className="flex gap-1 md:sticky md:top-4 md:flex-col">
            {SECTIONS.map(([key, label]) => (
              <li key={key}>
                <button
                  onClick={() => go(key)}
                  aria-current={section === key ? 'page' : undefined}
                  className={`w-full whitespace-nowrap rounded-md px-3 py-2 text-left text-sm font-medium ${section === key ? 'bg-ink text-paper' : 'text-muted hover:bg-rule/50 hover:text-ink'}`}
                >
                  {label}
                  {key === 'questions' && kit.coverage.uncovered_requirement_ids.length > 0 && <span className="ml-1 text-danger">•</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          {section === 'overview' && <OverviewPanel {...props} />}
          {section === 'questions' && <QuestionsPanel {...props} />}
          {section === 'flashcards' && <FlashcardsPanel {...props} />}
          {section === 'schedule' && <SchedulePanel {...props} />}
          {section === 'practice' && <PracticePanel kitId={id} kit={kit} />}
          {section === 'stories' && <StoryBankPanel kitId={id} kit={kit} />}
        </div>
      </div>
    );
  }

  return (
    <>
      <AppHeader>
        {doc && (
          <span>
            <Link href="/kits" className="hover:text-ink">
              Kits
            </Link>{' '}
            / <span className="text-ink">{kit?.source.role || doc.title}</span>
            {kit?.source.company && <span> at {kit.source.company}</span>}
          </span>
        )}
      </AppHeader>
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 focus:outline-none">
        {body}
      </main>
    </>
  );
}
