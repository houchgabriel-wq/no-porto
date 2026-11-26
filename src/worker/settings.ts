// Configurações da editora (26/11/2026). Por enquanto, só o prazo da chegada prevista pelo BL: ao ler o
// BL, o Novo embarque e a ficha do embarque sugerem a chegada prevista na data do BL mais esse prazo
// (src/core/billArrival.ts). Admin e editor, que registram os embarques, leem; só o admin muda, e cada
// mudança fica nos eventos. Os outros perfis, inclusive o Agente de cargas, que é de fora, não recebem nada.

import { z } from 'zod';
import { ARRIVAL_DAYS_DEFAULT, arrivalDaysProblem } from '../core/billArrival';
import { can } from '../core/roles';
import type { Session } from './auth';
import type { Env } from './env';
import { checkMutation, error, json, readBody } from './http';

const ARRIVAL_DAYS = 'arrival_days';

export interface Settings {
  /** Dias da data do BL até a chegada prevista. */
  arrivalDays: number;
  /** Quando e quem mudou o prazo; null enquanto vale o padrão. */
  arrivalDaysUpdatedAt: string | null;
  arrivalDaysUpdatedBy: string | null;
}

async function readSettings(env: Env): Promise<Settings> {
  const row = await env.DB.prepare('SELECT s.value, s.updated_at, u.name FROM settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.key = ?')
    .bind(ARRIVAL_DAYS)
    .first<{ value: string; updated_at: string; name: string | null }>();
  const days = row ? Number(row.value) : Number.NaN;
  // Um valor estragado no banco não pode travar o Novo embarque: vale o padrão.
  if (!row || arrivalDaysProblem(days)) return { arrivalDays: ARRIVAL_DAYS_DEFAULT, arrivalDaysUpdatedAt: null, arrivalDaysUpdatedBy: null };
  return { arrivalDays: days, arrivalDaysUpdatedAt: row.updated_at, arrivalDaysUpdatedBy: row.name };
}

const settingsBody = z.object({ arrivalDays: z.number({ error: 'Informe o prazo em dias.' }) });

async function saveSettings(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, settingsBody);
  const problem = arrivalDaysProblem(body.arrivalDays);
  if (problem) return error(400, problem);
  const before = await readSettings(env);
  const at = now.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).bind(ARRIVAL_DAYS, String(body.arrivalDays), at, session.user.id),
    env.DB.prepare("INSERT INTO events (id, entity, entity_id, user_id, type, detail, created_at) VALUES (?, 'setting', ?, ?, 'changed', ?, ?)").bind(
      crypto.randomUUID(),
      ARRIVAL_DAYS,
      session.user.id,
      JSON.stringify({ from: before.arrivalDays, to: body.arrivalDays }),
      at,
    ),
  ]);
  return json(await readSettings(env));
}

export async function routeSettings(request: Request, env: Env, session: Session, key: string, now: Date): Promise<Response | null> {
  if (key !== 'GET /api/settings' && key !== 'PUT /api/settings') return null;
  if (!can(session.user.role, 'edit')) return error(403, 'Seu perfil não usa as configurações.');
  if (key === 'GET /api/settings') return json(await readSettings(env));
  if (!can(session.user.role, 'settings')) return error(403, 'Só o admin muda as configurações.');
  return saveSettings(request, env, session, now);
}
