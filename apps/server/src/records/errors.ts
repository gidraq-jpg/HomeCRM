// Общий обработчик ошибок для модулей с простыми ответами { code }: заметки, дом.
// Текст Drizzle содержит параметры запроса: в журнал уходят только классификация и SQLSTATE.
// Модули на dataRoutes используют расширенный обработчик из support.ts; у сроков, ИИ и MCP
// свои ответы (ADR-0053).
import type { FastifyInstance } from 'fastify';
import { pgError } from '../auth/provision.ts';
import { Failure } from './support.ts';

export function plainErrorHandler(app: FastifyInstance, label: string): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof Failure) return reply.code(error.status).send({ code: error.code });
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? error.statusCode
        : undefined;
    if (status === 400 || status === 413) return reply.code(status).send({ code: 'INVALID_INPUT' });
    const { code } = pgError(error);
    if (code === '42501') return reply.code(403).send({ code: 'ACCESS_DENIED' });
    if (['23503', '23505', '23514', '40P01', '40001'].includes(code ?? ''))
      return reply.code(409).send({ code: 'CONFLICT' });
    request.log.error(
      { databaseCode: /^[A-Z0-9]{5}$/.test(code ?? '') ? code : undefined },
      `${label} request failed`,
    );
    return reply.code(500).send({ code: 'INTERNAL_ERROR' });
  });
}
