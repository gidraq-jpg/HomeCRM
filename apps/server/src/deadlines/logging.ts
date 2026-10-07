/** Только класс и код: сообщение, стек, SQL и параметры могут содержать данные семьи. */
export function reportWorkerError(error: unknown, message = 'Deadline worker operation failed') {
  const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
  let source: unknown = error;
  let errorCode: string | null = null;
  // Drizzle оборачивает ошибку PostgreSQL: код берём из cause, тексты не читаем.
  for (let depth = 0; depth < 5 && typeof source === 'object' && source !== null; depth++) {
    const code = 'code' in source ? source.code : null;
    if (typeof code === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(code)) {
      errorCode = code;
      break;
    }
    source = 'cause' in source ? source.cause : null;
  }
  console.error(message, {
    errorClass: /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(errorClass) ? errorClass : 'UnknownError',
    errorCode,
  });
}
