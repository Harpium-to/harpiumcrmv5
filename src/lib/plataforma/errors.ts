// ============================================================
// /api/plataforma/v1 response envelope — the v1 shape plus a
// machine `reason` on 403s, so the Agency OS can tell "no login in
// the CRM" from "only metrics" from "no access" and say it in words.
//
//   success → { data } / { data: [...], meta: { next_cursor } }
//   failure → { error: { code, reason?, message } }
// ============================================================

import { NextResponse } from 'next/server';

import { ApiError } from '@/lib/api/v1/respond';
import type { RateLimitResult } from '@/lib/rate-limit';

export { ok, okList } from '@/lib/api/v1/respond';

export type PlatformErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'bad_request'
  | 'not_found'
  | 'unavailable'
  | 'internal';

export type PlatformReason = 'no_crm_login' | 'no_access' | 'metrics_only' | 'missing_scope';

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  readonly status: number;
  readonly reason?: PlatformReason;
  readonly headers?: Record<string, string>;

  constructor(
    code: PlatformErrorCode,
    message: string,
    status: number,
    opts: { reason?: PlatformReason; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = 'PlatformError';
    this.code = code;
    this.status = status;
    this.reason = opts.reason;
    this.headers = opts.headers;
  }
}

export const platformErrors = {
  unauthorized: () =>
    new PlatformError('unauthorized', 'Chave da plataforma ausente, inválida ou revogada', 401),
  badRequest: (message: string) => new PlatformError('bad_request', message, 400),
  notFound: (message = 'Não encontrado') => new PlatformError('not_found', message, 404),
  unavailable: (message: string) => new PlatformError('unavailable', message, 503),
  missingScope: (scope: string) =>
    new PlatformError('forbidden', `Esta chave não tem o escopo '${scope}'`, 403, {
      reason: 'missing_scope',
    }),
  noCrmLogin: (email: string) =>
    new PlatformError('forbidden', `O e-mail ${email} não tem login no Harpium CRM`, 403, {
      reason: 'no_crm_login',
    }),
  noAccess: () =>
    new PlatformError('forbidden', 'Esta pessoa não tem acesso a este CRM', 403, {
      reason: 'no_access',
    }),
  metricsOnly: () =>
    new PlatformError(
      'forbidden',
      'O dono deste CRM liberou só métricas para a agência',
      403,
      { reason: 'metrics_only' },
    ),
  rateLimited: (result: RateLimitResult) => {
    const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
    return new PlatformError('rate_limited', 'Muitas consultas seguidas com esta chave', 429, {
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.reset / 1000)),
      },
    });
  },
};

export function toPlatformErrorResponse(err: unknown): NextResponse {
  if (err instanceof PlatformError) {
    return NextResponse.json(
      {
        error: {
          code: err.code,
          ...(err.reason ? { reason: err.reason } : {}),
          message: err.message,
        },
      },
      { status: err.status, headers: err.headers },
    );
  }
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status, headers: err.headers },
    );
  }
  console.error('[api/plataforma] uncategorized error:', err);
  return NextResponse.json(
    { error: { code: 'internal', message: 'Erro interno do servidor' } },
    { status: 500 },
  );
}
