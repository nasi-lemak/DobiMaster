import { useNavigate, useParams } from 'react-router';
import { api } from '../../lib/api';
import { Card } from '../../components/ui';
import { ConfirmButton, PageHeader, QueryState } from '../components/common';
import { MachineForm, type MachinePayload } from '../components/MachineForm';
import { k, useApi, useApiMutation } from '../lib/queries';
import type { MachineDetail } from '../lib/types';

export function MachineEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useApi<MachineDetail>(k.machine(id), `/owner/machines/${id}`);
  const save = useApiMutation((b: MachinePayload) => api.patch(`/owner/machines/${id}`, b), [['owner']], () => navigate(`/owner/machines/${id}`));
  // Return to the list of the machine's own shop (the list otherwise defaults to the first shop, hiding the result).
  const del = useApiMutation(() => api.del(`/owner/machines/${id}`), [['owner']], () =>
    navigate(q.data ? `/owner/machines?shop=${q.data.machine.shopId}` : '/owner/machines'),
  );

  return (
    <QueryState q={q}>
      {() => {
        const m = q.data!.machine;
        return (
          <>
            <PageHeader
              back={`/owner/machines/${id}`}
              title={`Edit ${m.code}`}
              actions={
                <ConfirmButton
                  title={`Remove ${m.code}?`}
                  message={<>The machine disappears from the shop page and its QR sticker stops working. History is kept. This can't be undone from the app.</>}
                  confirmLabel="Remove machine"
                  onConfirm={() => del.mutateAsync(undefined)}
                  pending={del.isPending}
                  error={del.error}
                >
                  Remove machine
                </ConfirmButton>
              }
            />
            <Card className="p-4 sm:p-6">
              <MachineForm mode="edit" initial={m} onSubmit={(b) => save.mutate(b)} pending={save.isPending} error={save.error} onCancel={() => navigate(-1)} />
            </Card>
          </>
        );
      }}
    </QueryState>
  );
}
