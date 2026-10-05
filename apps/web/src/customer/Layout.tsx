import { Link, NavLink, Outlet } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { LOCALE_LABELS, useI18n } from '../lib/i18n';
import { api, getGuestToken } from '../lib/api';
import { cx } from '../components/ui';
import { useOnline } from './useNow';
import type { MyCycle } from './types';

export function LangSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div role="group" aria-label={t('language')} className="flex rounded-full bg-surface-2 p-0.5 text-xs">
      {LOCALE_LABELS.map((l) => (
        <button
          key={l.code}
          onClick={() => setLocale(l.code)}
          aria-pressed={locale === l.code}
          className={cx('whitespace-nowrap rounded-full px-2.5 py-1 font-medium', locale === l.code ? 'bg-surface text-ink shadow-sm' : 'text-muted')}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

export function useMyCycles() {
  return useQuery({
    queryKey: ['me', 'cycles'],
    queryFn: () => api.get<{ cycles: MyCycle[] }>('/public/me/cycles', { guest: true }),
    enabled: !!getGuestToken(),
    refetchInterval: 30_000,
  });
}

export function CustomerLayout() {
  const { t } = useI18n();
  const online = useOnline();
  const my = useMyCycles();
  const active = my.data?.cycles.filter((c) => c.status === 'running' || c.status === 'finished').length ?? 0;
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-bg/90 px-4 py-3 backdrop-blur">
        <Link to="/" className="flex min-w-0 items-center gap-2 font-semibold">
          <img src="/icon.svg" alt="" className="h-7 w-7 shrink-0" />
          <span className="hidden min-[430px]:inline">{t('appName')}</span>
        </Link>
        <div className="flex items-center gap-2">
          <NavLink to="/me" className="relative whitespace-nowrap rounded-full px-2.5 py-1.5 text-sm font-medium text-ink-2 hover:bg-surface-2">
            {t('myLaundry')}
            {active > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-ink">{active}</span>
            )}
          </NavLink>
          <LangSwitcher />
        </div>
      </header>
      {!online && <div className="bg-warning/20 px-4 py-2 text-center text-xs text-warning-ink">{t('offline')}</div>}
      <main className="flex-1 px-4 pb-10 pt-4">
        <Outlet />
      </main>
      <footer className="flex flex-wrap justify-center gap-x-4 gap-y-1 px-4 pb-6 text-center text-xs text-muted">
        <Link to="/privacy" className="underline-offset-2 hover:underline">
          {t('privacy')}
        </Link>
        <Link to="/terms" className="underline-offset-2 hover:underline">
          {t('terms')}
        </Link>
        <Link to="/owner" className="underline-offset-2 hover:underline">
          {t('owner')}
        </Link>
      </footer>
    </div>
  );
}
