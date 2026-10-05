import { useEffect } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { ErrorBox, PageLoader } from '../components/ui';
import { privacyNotice, termsOfUse, type Block, type LegalInfo, type LegalLocale } from './content';

/** /privacy and /terms, in the customer's language (Tamil falls back to English for now). */
export function LegalPage({ doc }: { doc: 'privacy' | 'terms' }) {
  const { locale, t } = useI18n();
  const q = useQuery({ queryKey: ['legal'], queryFn: () => api.get<LegalInfo>('/public/legal'), staleTime: 60 * 60_000 });
  const lang: LegalLocale = locale === 'ms' || locale === 'zh' ? locale : 'en';
  const d = q.data ? (doc === 'privacy' ? privacyNotice : termsOfUse)(lang, q.data) : null;
  useEffect(() => {
    if (d) document.title = `${d.title} · DobiMaster`;
  }, [d]);

  if (q.isPending) return <PageLoader />;
  if (q.isError || !d) return <ErrorBox message={t('error')} onRetry={() => q.refetch()} retryLabel={t('retry')} />;

  return (
    <article className="mx-auto max-w-2xl space-y-5 pb-6 text-sm leading-relaxed">
      <header>
        <h1 className="text-2xl font-semibold">{d.title}</h1>
        <p className="mt-1 text-xs text-muted">{t('lastUpdated', { date: q.data!.version })}</p>
      </header>
      <Blocks blocks={d.intro} />
      {d.sections.map((s) => (
        <section key={s.h} className="space-y-2">
          <h2 className="text-base font-semibold">{s.h}</h2>
          <Blocks blocks={s.blocks} />
        </section>
      ))}
      <p className="border-t border-line pt-4 text-xs text-muted">
        <Link to={doc === 'privacy' ? '/terms' : '/privacy'} className="text-brand underline-offset-2 hover:underline">
          {doc === 'privacy' ? t('terms') : t('privacy')} →
        </Link>
      </p>
    </article>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        typeof b === 'string' ? (
          <p key={i} className="text-ink-2">
            {b}
          </p>
        ) : (
          <ul key={i} className="list-disc space-y-1.5 pl-5 text-ink-2">
            {b.map((li) => (
              <li key={li}>{li}</li>
            ))}
          </ul>
        ),
      )}
    </>
  );
}
