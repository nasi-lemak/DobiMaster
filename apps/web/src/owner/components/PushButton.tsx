import { useState } from 'react';
import { Button } from '../../components/ui';
import { enableOwnerPush, pushSupport } from '../../lib/push';
import { errorMessage } from '../lib/queries';
import { Icon } from './icons';

/** "Get alerts on this phone" — asks for notification permission only when tapped. */
export function PushButton() {
  const [state, setState] = useState<'idle' | 'busy' | 'on' | 'error'>(() =>
    typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'on' : 'idle',
  );
  const [msg, setMsg] = useState<string | null>(null);
  const support = pushSupport();

  if (support === 'unsupported') return null;
  if (support === 'needs-install')
    return <p className="text-xs text-muted">To get alerts on iPhone, add this page to your Home Screen first.</p>;
  if (support === 'denied') return <p className="text-xs text-muted">Notifications are blocked for this site in your browser settings.</p>;

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="secondary"
        size="sm"
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy');
          setMsg(null);
          try {
            const ok = await enableOwnerPush();
            setState(ok ? 'on' : 'idle');
            if (!ok) setMsg('Permission was not granted.');
          } catch (e) {
            setState('error');
            setMsg(errorMessage(e));
          }
        }}
      >
        <Icon name="bell" className="h-4 w-4" />
        {state === 'on' ? 'Alerts on for this phone' : state === 'busy' ? 'Enabling…' : 'Get alerts on this phone'}
      </Button>
      {msg && <span className="text-xs text-critical-ink">{msg}</span>}
    </div>
  );
}
