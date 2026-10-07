// Единое правило происхождения запроса для плагина Better Auth и маршрутов Fastify.
interface SourceError {
  code: 'INVALID_ORIGIN' | 'CROSS_SITE_NAVIGATION_BLOCKED';
  message: string;
}

const INVALID_ORIGIN: SourceError = {
  code: 'INVALID_ORIGIN',
  message: 'Request origin is not allowed',
};

export function checkRequestSource(
  headers: Headers,
  isTrustedOrigin: (origin: string) => boolean,
  requireOrigin = false,
): SourceError | null {
  let origin = headers.get('origin');
  const referer = headers.get('referer');
  if (origin === null && referer !== null) {
    try {
      origin = new URL(referer).origin;
    } catch {
      return INVALID_ORIGIN;
    }
  }
  if ((origin === null && requireOrigin) || (origin !== null && !isTrustedOrigin(origin))) {
    return INVALID_ORIGIN;
  }
  if (
    headers.get('sec-fetch-site') === 'cross-site' &&
    headers.get('sec-fetch-mode') === 'navigate'
  ) {
    return {
      code: 'CROSS_SITE_NAVIGATION_BLOCKED',
      message: 'Cross-site navigation is not allowed',
    };
  }
  return null;
}
