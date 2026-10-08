import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { dropCacheOnAccountChange, ME_KEY } from './session-cache.ts';

function filled() {
  const client = new QueryClient();
  client.setQueryData([ME_KEY], { id: 'fictional-anna' });
  client.setQueryData(['notes', 'list'], [{ title: 'Квартира у парка' }]);
  client.setQueryData(['deadlines', 'trash'], []);
  return client;
}

describe('кэш при смене участника', () => {
  it('другой участник: списки и названия прежнего выброшены, сам me остаётся', () => {
    const client = filled();
    dropCacheOnAccountChange(client, { id: 'fictional-anna' }, { id: 'fictional-boris' });
    expect(client.getQueryData(['notes', 'list'])).toBeUndefined();
    expect(client.getQueryData(['deadlines', 'trash'])).toBeUndefined();
    expect(client.getQueryData([ME_KEY])).toEqual({ id: 'fictional-anna' });
  });

  it('сессия закончилась: кэш тоже выброшен', () => {
    const client = filled();
    dropCacheOnAccountChange(client, { id: 'fictional-anna' }, null);
    expect(client.getQueryData(['notes', 'list'])).toBeUndefined();
  });

  it('тот же участник или первая загрузка: кэш не трогаем', () => {
    const client = filled();
    dropCacheOnAccountChange(client, { id: 'fictional-anna' }, { id: 'fictional-anna' });
    dropCacheOnAccountChange(client, undefined, { id: 'fictional-anna' });
    dropCacheOnAccountChange(client, null, { id: 'fictional-boris' });
    expect(client.getQueryData(['notes', 'list'])).toHaveLength(1);
  });
});
