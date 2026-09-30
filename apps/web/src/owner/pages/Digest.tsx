import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button, Card, EmptyState } from '../../components/ui';
import { pct } from '../../lib/format';
import { MutationError, PageHeader, QueryState, Section, Segmented, SeverityTag, StatTile, TableWrap, Toggle, td, th } from '../components/common';
import { k, useApi, useApiMutation } from '../lib/queries';
import { useMe } from '../lib/session';

interface Digest {
  tenantName: string;
  weekStart: string;
  weekEnd: string;
  partial: boolean;
  includesRevenue: boolean;
  totals: {
    cycles: number;
    cyclesPrev: number;
    estRevenueSen: number | null;
    estRevenuePrevSen: number | null;
    cashSen: number | null;
    appSen: number | null;
    utilisation: number;
    utilisationPrev: number;
    downtimeHours: number;
    sensorOfflineHours: number;
    ticketsOpened: number;
    ticketsResolved: number;
    openTickets: number;
    medianResolveHours: number | null;
    refundsPending: number;
    checklistDone: number;
    checklistExpected: number;
  };
  shops: Array<{ id: string; name: string; cycles: number; cyclesPrev: number; utilisation: number; downtimeHours: number; openTickets: number; checklistDone: number; checklistExpected: number; estRevenueSen: number | null }>;
  actions: Array<{ severity: 'high' | 'medium' | 'low'; text: string; link: string }>;
}

const rm0 = (sen: number | null) => (sen == null ? '—' : `RM ${Math.round(sen / 100).toLocaleString('en-MY')}`);
function delta(cur: number, prev: number) {
  if (!prev) return 'no data for the week before';
  const d = (cur - prev) / prev;
  return `${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d * 100))}% vs week before`;
}
const fmtDate = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** The weekly summary owners get by email/WhatsApp every Monday — same content, browsable by week. */
export function DigestPage() {
  const [weeksAgo, setWeeksAgo] = useState(1);
  const q = useApi<Digest>(['owner', 'digest', weeksAgo], `/owner/digest?weeksAgo=${weeksAgo}`, { keepPrevious: true });
  return (
    <>
      <PageHeader title="Weekly summary" subtitle="What happened, how it compares, and what needs you — sent every Monday at 8 am" />
      <div className="mb-4">
        <Segmented
          label="Week"
          value={weeksAgo}
          onChange={setWeeksAgo}
          options={[
            { value: 0, label: 'This week so far' },
            { value: 1, label: 'Last week' },
            { value: 2, label: '2 weeks ago' },
          ]}
        />
      </div>
      <QueryState q={q}>
        {() => <DigestBody d={q.data!} />}
      </QueryState>
      <Delivery />
    </>
  );
}

function DigestBody({ d }: { d: Digest }) {
  const t = d.totals;
  return (
    <>
      <p className="mb-3 text-sm text-muted">
        {fmtDate(d.weekStart)} – {fmtDate(d.weekEnd)}
        {d.partial ? ' (so far)' : ''}
      </p>
      <Section title={d.actions.length ? `Needs you (${d.actions.length})` : 'Needs you'}>
        {d.actions.length === 0 ? (
          <EmptyState title="Nothing needs you this week 🎉" />
        ) : (
          <Card className="divide-y divide-line">
            {d.actions.map((a, i) => (
              <Link key={i} to={a.link} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                <SeverityTag severity={a.severity} withWord />
                <span className="text-sm">{a.text}</span>
              </Link>
            ))}
          </Card>
        )}
      </Section>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Cycles" value={t.cycles.toLocaleString('en-MY')} hint={delta(t.cycles, t.cyclesPrev)} />
        {d.includesRevenue && <StatTile label="Est. revenue" value={rm0(t.estRevenueSen)} hint={`from recorded cycles · ${delta(t.estRevenueSen ?? 0, t.estRevenuePrevSen ?? 0)}`} />}
        {d.includesRevenue && <StatTile label="Collected" value={rm0((t.cashSen ?? 0) + (t.appSen ?? 0))} hint={`cash ${rm0(t.cashSen)} · app ${rm0(t.appSen)}`} />}
        <StatTile label="Utilisation" value={pct(t.utilisation)} hint={`week before ${pct(t.utilisationPrev)}`} />
        <StatTile label="Out of service" value={`${t.downtimeHours} h`} tone={t.downtimeHours > 24 ? 'serious' : undefined} hint={t.sensorOfflineHours ? `sensors offline ${t.sensorOfflineHours} h` : 'machine-hours unusable'} />
        <StatTile
          label="Reports"
          value={`${t.ticketsOpened} new`}
          hint={`${t.ticketsResolved} resolved${t.medianResolveHours != null ? ` (median ${t.medianResolveHours} h)` : ''} · ${t.openTickets} open`}
          to="/owner/tickets"
        />
        {t.checklistExpected > 0 && (
          <StatTile
            label="Cleaning checklists"
            value={`${t.checklistDone}/${t.checklistExpected}`}
            tone={t.checklistDone / t.checklistExpected < 0.8 ? 'warning' : 'good'}
            hint="shop-days completed"
            to="/owner/checklists"
          />
        )}
        {t.refundsPending > 0 && <StatTile label="Refunds waiting" value={String(t.refundsPending)} tone="serious" to="/owner/refunds" />}
      </div>
      {d.shops.length > 1 && (
        <Section title="By branch" className="mt-6">
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Branch</th>
                  <th className={`${th} text-right`}>Cycles</th>
                  <th className={`${th} text-right`}>Utilisation</th>
                  <th className={`${th} text-right`}>Out of service</th>
                  <th className={`${th} text-right`}>Open reports</th>
                  <th className={`${th} text-right`}>Checklists</th>
                  {d.includesRevenue && <th className={`${th} text-right`}>Est. revenue</th>}
                </tr>
              </thead>
              <tbody className="tabular">
                {d.shops.map((s) => (
                  <tr key={s.id}>
                    <td className={td}>
                      <Link to={`/owner/shops/${s.id}`} className="font-medium text-brand">
                        {s.name}
                      </Link>
                    </td>
                    <td className={`${td} text-right`}>
                      {s.cycles} <span className="text-xs text-muted">({s.cyclesPrev})</span>
                    </td>
                    <td className={`${td} text-right`}>{pct(s.utilisation)}</td>
                    <td className={`${td} text-right`}>{s.downtimeHours} h</td>
                    <td className={`${td} text-right`}>{s.openTickets}</td>
                    <td className={`${td} text-right`}>{s.checklistExpected ? `${s.checklistDone}/${s.checklistExpected}` : '—'}</td>
                    {d.includesRevenue && <td className={`${td} text-right`}>{rm0(s.estRevenueSen)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="mt-2 text-xs text-muted">Cycles in brackets: the week before. Revenue is estimated from recorded cycles × list price.</p>
        </Section>
      )}
    </>
  );
}

/** How the summary reaches me: email (default), WhatsApp (optional), or not at all. */
function Delivery() {
  const me = useMe();
  const qc = useQueryClient();
  const [sent, setSent] = useState<string | null>(null);
  const [link, setLink] = useState<{ code: string; url: string; mode: string } | null>(null);
  const prefs = useApiMutation((digestOptOut: boolean) => api.patch('/owner/me/preferences', { digestOptOut }), [k.me]);
  const test = useApiMutation(() => api.post<{ delivered: number }>('/owner/digest/send-test'), [], (r) => setSent(r.delivered ? `Sent to ${me.user.email}` : 'Nothing was sent'));
  const waLink = useApiMutation(() => api.post<{ code: string; url: string; mode: string }>('/owner/whatsapp/link'), [], (r) => {
    setLink(r);
    if (r.mode === 'cloud') window.open(r.url, '_blank', 'noopener');
  });
  const waUnlink = useApiMutation(() => api.post('/owner/whatsapp/unlink'), [k.me], () => setLink(null));
  const simulate = async () => {
    if (!link) return;
    await api.post('/dev/whatsapp/inbound', { from: `6019${String(Date.now()).slice(-7)}`, text: `DOBI-${link.code}` });
    await qc.invalidateQueries({ queryKey: k.me });
  };
  const optedOut = me.preferences.digestOptOut;

  return (
    <Section title="Delivery" className="mt-8">
      <Card className="space-y-4 p-4">
        <Toggle checked={!optedOut} onChange={(on) => prefs.mutate(!on)} disabled={prefs.isPending} label="Email me this every Monday" hint={`To ${me.user.email}`} />
        {me.preferences.whatsappMode !== 'disabled' && (
        <div className="border-t border-line pt-4">
          <div className="text-sm font-medium">WhatsApp</div>
          {me.preferences.whatsappLinked ? (
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
              <span className="text-good-ink">✓ Linked — you’ll also get it on WhatsApp</span>
              <Button size="sm" variant="ghost" disabled={waUnlink.isPending} onClick={() => waUnlink.mutate(undefined)}>
                Unlink
              </Button>
            </div>
          ) : (
            <div className="mt-1 space-y-2 text-sm">
              <p className="text-muted">Link your number by sending us a short code. The summary is sent as an approved WhatsApp template (a few sen per message).</p>
              {link && link.mode === 'mock' ? (
                <div className="space-y-2">
                  <code className="block rounded-lg bg-surface-2 p-2 text-xs">DOBI-{link.code}</code>
                  <Button size="sm" variant="secondary" onClick={simulate}>
                    Dev: simulate sending it
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="secondary" disabled={waLink.isPending} onClick={() => waLink.mutate(undefined)}>
                  Link WhatsApp
                </Button>
              )}
            </div>
          )}
        </div>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button size="sm" variant="secondary" disabled={test.isPending} onClick={() => test.mutate(undefined)}>
            {test.isPending ? 'Sending…' : 'Send me last week’s summary now'}
          </Button>
          {sent && <span className="text-sm text-good-ink">{sent}</span>}
        </div>
        <MutationError error={prefs.error ?? test.error ?? waLink.error ?? waUnlink.error} />
      </Card>
    </Section>
  );
}
