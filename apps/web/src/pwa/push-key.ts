// Публичный ключ VAPID: сервер отдаёт base64url, `pushManager.subscribe` ждёт байты.
// Модуль без обращений к окну: его используют и страница, и сервис-воркер.

export function keyToBytes(key: string): Uint8Array<ArrayBuffer> {
  const base64 = key.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Ключ, с которым уже сделана подписка, совпадает с нынешним ключом сервера. */
export function sameKey(current: ArrayBuffer | null | undefined, expected: Uint8Array): boolean {
  // Браузер мог не сообщить ключ: тогда сравнивать нечего, подписку оставляем.
  if (!current) return true;
  const bytes = new Uint8Array(current);
  return (
    bytes.length === expected.length && bytes.every((value, index) => value === expected[index])
  );
}
