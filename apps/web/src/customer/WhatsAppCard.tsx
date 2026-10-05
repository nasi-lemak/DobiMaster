import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Button } from '../components/ui';

interface WaStatus {
  linked: boolean;
  optedOut: boolean;
  windowOpen: boolean;
  mode: 'cloud' | 'mock' | 'disabled';
}

/**
 * "Notify me on WhatsApp": opens WhatsApp with a one-time code pre-filled. The customer presses send,
 * which links their number and opens WhatsApp's free 24 h reply window for this laundry cycle.
 */
export function WhatsAppCard({ cycleId }: { cycleId?: string }) {
  const { t, locale } = useI18n();
  const status = useQuery({ queryKey: ['me', 'whatsapp'], queryFn: () => api.get<WaStatus>('/public/me/whatsapp', { guest: true }), refetchInterval: (q) => (q.state.data?.linked || q.state.data?.mode === 'disabled' ? false : 5000) });
  const [pending, setPending] = useState<{ code: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ code: string; url: string; mode: string }>('/public/whatsapp/link', { cycleId, locale }, { guest: true });
      setPending(res);
      if (res.mode === 'cloud') window.location.href = res.url;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('error'));
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    if (!pending) return;
    await api.post('/dev/whatsapp/inbound', { from: `6011${String(Date.now()).slice(-7)}`, text: `DOBI-${pending.code}` });
    await status.refetch();
  }

  async function unlink() {
    await api.post('/public/me/whatsapp/unlink', {}, { guest: true });
    setPending(null);
    await status.refetch();
  }

  if (!status.data || status.data.mode === 'disabled') return null;
  if (status.data.linked) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-good-ink">✅ {t('wa.linked')}</span>
        <button type="button" onClick={unlink} className="text-xs text-muted underline">
          {t('wa.stop')}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">💬 {t('wa.title')}</p>
      <p className="text-xs text-muted">{t('wa.body')}</p>
      {pending && status.data?.mode === 'mock' ? (
        <div className="space-y-2">
          <a href={pending.url} target="_blank" rel="noreferrer" className="block break-all rounded-xl bg-surface-2 p-2 font-mono text-xs">
            {decodeURIComponent(pending.url.split('text=')[1] ?? '')}
          </a>
          <Button size="sm" variant="secondary" onClick={simulate}>
            {t('wa.dev')}
          </Button>
        </div>
      ) : (
        <Button size="sm" className="bg-[#1f8f4e] text-white" disabled={busy} onClick={link}>
          {t('wa.button')}
        </Button>
      )}
      {error && <p className="text-xs text-critical-ink">{error}</p>}
    </div>
  );
}
