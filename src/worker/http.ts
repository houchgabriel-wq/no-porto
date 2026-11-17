// Respostas JSON e as conferências comuns a todos os pedidos.

import { z } from 'zod';

// Mensagens padrão do zod em português, para os casos sem mensagem própria no esquema.
z.config(z.locales.ptBR());

/** Cabeçalhos de segurança das respostas da API (as páginas recebem os seus em public/_headers). */
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000',
};

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...headers },
  });
}

/** Teto do corpo de um pedido. Uma carga de planilha em partes de 500 linhas cabe com folga. */
export const MAX_BODY_BYTES = 2_000_000;

export function error(status: number, message: string): Response {
  return json({ error: message }, status);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Pedidos que alteram dados precisam vir do próprio site e em JSON (SPEC.md, seção 4).
 * Um formulário de outro site não consegue mandar esse cabeçalho sem ser barrado pelo navegador.
 */
export function checkMutation(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) {
    throw new HttpError(403, 'Pedido recusado: origem não reconhecida.');
  }
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Pedido recusado: o conteúdo precisa ser JSON.');
  }
}

export async function readBody<T>(request: Request, schema: z.ZodType<T>, maxBytes = MAX_BODY_BYTES): Promise<T> {
  // Recusa antes de ler, quando o tamanho vem declarado; e confere de novo depois de ler.
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw new HttpError(413, 'Conteúdo grande demais.');
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > maxBytes) throw new HttpError(413, 'Conteúdo grande demais.');
    raw = JSON.parse(text);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'Conteúdo inválido.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Dados inválidos.');
  }
  return parsed.data;
}
