import { setIdentity, ticket } from './identity.ts';
import { offlineDB } from './store.ts';
export async function prepareLogout(): Promise<boolean> {
  const active = await ticket();
  if (!active.owner) return true;
  const pending = await offlineDB.outbox
    .where('owner')
    .equals(active.owner)
    .filter((row) => row.state !== 'confirmed')
    .count();
  if (
    pending &&
    !window.confirm(
      'На устройстве есть неотправленные изменения и фото. При выходе они будут удалены. Выйти и удалить их?',
    )
  )
    return false;
  await setIdentity(null);
  return true;
}
