// Solicitações de embarque (SPEC.md, seção 3): o Agente pede, só o Gabriel (o aprovador) decide, e o
// Agente não recebe nada além das próprias solicitações.
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;
let claire: string;
let sara: string;

// "Hoje" dos testes: 17/11/2026 (test-api.ts).
const novo = (over: object = {}) => ({
  reference: 'SZX-2026-118',
  supplierId: claire,
  departurePort: 'Shenzhen',
  departureDate: '2026-12-05',
  readyDate: '2026-12-01',
  arrivalDate: '2027-01-15',
  notes: 'Navio da COSCO',
  lines: [
    { containerType: '40HC', quantity: 3, priceCents: 285_000 },
    { containerType: '20', quantity: 1, priceCents: 180_000 },
  ],
  ...over,
});

async function pedir(over: object = {}, cookie = who.agente.cookie) {
  return app.call('POST', '/api/bookings', { cookie, body: novo(over) });
}

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
  const line = { row: 7, description: 'Coleção Alice', isbn: '9786583970527', quantity: 1000, piecesPerCarton: null, unitPriceMicros: 1_750_000, notes: '' };
  await app.call('POST', '/api/orders', { cookie: who.editor.cookie, body: { code: 'PO-024', supplier: 'Claire', items: [line] } });
  await app.call('POST', '/api/orders', { cookie: who.editor.cookie, body: { code: 'PO-030', supplier: 'Sara', items: [{ ...line, description: 'Livro da Sara', isbn: null }] } });
  const suppliers = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data.suppliers as { id: string; name: string }[];
  claire = suppliers.find((s) => s.name === 'Claire')!.id;
  sara = suppliers.find((s) => s.name === 'Sara')!.id;
});

describe('o agente pede', () => {
  it('cadastra a solicitação, que aguarda a aprovação', async () => {
    const res = await pedir();
    expect(res.status).toBe(201);
    expect(res.data.request).toMatchObject({
      reference: 'SZX-2026-118',
      supplierId: claire,
      supplierName: 'Claire',
      departurePort: 'Shenzhen',
      departureDate: '2026-12-05',
      readyDate: '2026-12-01',
      arrivalDate: '2027-01-15',
      ibcReference: '',
      shippedAt: null,
      shippedBy: null,
      notes: 'Navio da COSCO',
      status: 'aguardando',
      createdBy: { id: who.agente.id, name: 'Ana Agente' },
      decidedAt: null,
      decidedBy: null,
    });
    expect(res.data.request.lines).toHaveLength(2);
    expect(res.data.request.lines).toEqual(
      expect.arrayContaining([
        { containerType: '40HC', quantity: 3, approvedQuantity: null, priceCents: 285_000 },
        { containerType: '20', quantity: 1, approvedQuantity: null, priceCents: 180_000 },
      ]),
    );
  });

  it('vê só as próprias solicitações e os nomes dos fornecedores', async () => {
    await pedir();
    const outro = await app.call('POST', '/api/users', { cookie: who.admin.cookie, body: { name: 'Outro Agente', email: 'outro@agente.exemplo', role: 'agente' } });
    const login = await app.call('POST', '/api/login', { body: { email: 'outro@agente.exemplo', password: outro.data.tempPassword } });
    await app.call('POST', '/api/password', { cookie: login.cookie, body: { password: 'senha-outro-agente' } });
    await pedir({ supplierId: sara }, login.cookie!);

    const mine = await app.call('GET', '/api/bookings', { cookie: who.agente.cookie });
    expect(mine.status).toBe(200);
    expect(mine.data.requests.map((r: { supplierName: string }) => r.supplierName)).toEqual(['Claire']);
    expect(mine.data.suppliers).toEqual([
      { id: claire, name: 'Claire' },
      { id: sara, name: 'Sara' },
    ]);
    expect(mine.data.canDecide).toBe(false);
    expect(mine.data.today).toBe('2026-11-17');
  });

  it('recusa pedido incompleto ou estranho, com a explicação', async () => {
    const cases: [object, string][] = [
      [{ reference: undefined }, 'Informe o número de referência.'],
      [{ reference: '   ' }, 'Informe o número de referência.'],
      [{ reference: 'X'.repeat(41) }, 'O número de referência pode ter no máximo 40 caracteres.'],
      [{ supplierId: '' }, 'Escolha o fornecedor.'],
      [{ supplierId: 'nao-existe' }, 'Fornecedor não encontrado. Escolha um da lista.'],
      [{ departurePort: '   ' }, 'Informe o porto de saída.'],
      [{ departureDate: '05/12/2026' }, 'Informe a data de saída.'],
      [{ departureDate: '2062-12-05' }, 'A data de saída parece errada. Confira o dia e o ano.'],
      [{ readyDate: undefined }, 'Informe a prontidão do container.'],
      [{ readyDate: '2026-12-06' }, 'A prontidão do container passa da saída prevista. Confira as datas.'],
      [{ arrivalDate: '' }, 'Informe a previsão de chegada.'],
      [{ arrivalDate: '2026-12-04' }, 'A previsão de chegada deve ser depois da saída prevista.'],
      [{ lines: [] }, 'Informe pelo menos um tipo de container.'],
      [{ lines: [{ containerType: '45', quantity: 1, priceCents: 1 }] }, 'Tipo de container inválido.'],
      [{ lines: [{ containerType: '40', quantity: 2, priceCents: 250_000 }, { containerType: '40', quantity: 1, priceCents: 250_000 }] }, "O container 40' NOR aparece duas vezes. Junte as quantidades numa linha só."],
      [{ lines: [{ containerType: '40', quantity: 1, priceCents: 285 }] }, "O valor de cada container de 40' NOR está abaixo de US$ 100,00. Confira."],
      [{ lines: [{ containerType: '40', quantity: 0, priceCents: 250_000 }] }, "Informe quantos containers de 40' NOR."],
      [{ lines: [{ containerType: '40', quantity: 1, priceCents: 0 }] }, "Informe o valor de cada container de 40' NOR."],
      [{ lines: [{ containerType: '40', quantity: 1, priceCents: 2500.5 }] }, 'Valor do container inválido.'],
    ];
    for (const [over, message] of cases) {
      const res = await pedir(over);
      expect(res.status, message).toBe(400);
      expect(res.data.error).toBe(message);
    }
    expect((await app.call('GET', '/api/bookings', { cookie: who.agente.cookie })).data.requests).toEqual([]);
  });

  it('cancela a própria solicitação enquanto aguarda, e só ela', async () => {
    const id = (await pedir()).data.request.id;
    const outra = (await pedir({ supplierId: sara })).data.request.id;
    const res = await app.call('POST', `/api/bookings/${id}/cancel`, { cookie: who.agente.cookie, at: new Date('2026-11-17T15:00:00Z') });
    expect(res.status).toBe(200);
    expect(res.data.request).toMatchObject({ status: 'cancelada', decidedAt: '2026-11-17T15:00:00.000Z', decidedBy: { id: who.agente.id } });
    const again = await app.call('POST', `/api/bookings/${id}/cancel`, { cookie: who.agente.cookie });
    expect(again.status).toBe(409);
    expect(again.data.error).toBe('Esta solicitação já está cancelada.');
    // A equipe não cancela pelo agente.
    expect((await app.call('POST', `/api/bookings/${outra}/cancel`, { cookie: who.admin.cookie })).status).toBe(403);
    expect((await app.call('POST', '/api/bookings/nao-existe/cancel', { cookie: who.agente.cookie })).status).toBe(404);
  });

  it('não aprova nem recusa, nem a própria', async () => {
    const id = (await pedir()).data.request.id;
    expect((await app.call('POST', `/api/bookings/${id}/approve`, { cookie: who.agente.cookie, body: { lines: [], note: '' } })).status).toBe(403);
    expect((await app.call('POST', `/api/bookings/${id}/refuse`, { cookie: who.agente.cookie, body: { note: 'x' } })).status).toBe(403);
  });

  it('não recebe nada do resto do app', async () => {
    const admin = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data;
    for (const path of ['/api/data', '/api/sales', '/api/history', '/api/suppliers', `/api/products/${admin.items[0].productId}`, `/api/items/${admin.items[0].id}/specification`, '/api/export', '/api/users', '/api/lookup']) {
      expect((await app.call('GET', path, { cookie: who.agente.cookie })).status, path).toBe(403);
    }
    const tries: [string, string, object][] = [
      ['POST', '/api/items', { description: 'X', isbn: null, supplier: 'Claire', orderCode: null, quantity: 1, piecesPerCarton: null, unitPriceMicros: null, notes: '' }],
      ['PATCH', `/api/items/${admin.items[0].id}`, { quantity: 5 }],
      ['PATCH', '/api/items', { items: [{ id: admin.items[0].id, row: 2, notes: 'x', marks: { notes: '000000' } }] }],
      ['POST', '/api/orders', { code: 'PO-099', supplier: 'Sara', items: [] }],
      ['POST', '/api/ship', { lines: [{ itemId: admin.items[0].id, quantity: 1 }], newInvoice: { number: 'X', ref: '', bill: null, eta: null } }],
      ['PATCH', `/api/suppliers/${claire}`, { notes: 'x' }],
      ['POST', '/api/users', { name: 'X', email: 'x@x.exemplo', role: 'admin' }],
      ['POST', '/api/reset', { confirm: 'APAGAR' }],
    ];
    for (const [method, path, body] of tries) expect((await app.call(method, path, { cookie: who.agente.cookie, body })).status, `${method} ${path}`).toBe(403);
  });
});

describe('a equipe acompanha', () => {
  it('admin e editor veem todas as solicitações; só o aprovador pode decidir', async () => {
    await pedir();
    for (const [w, canDecide] of [
      [who.admin, true],
      [who.editor, false],
    ] as const) {
      const res = await app.call('GET', '/api/bookings', { cookie: w.cookie });
      expect(res.status).toBe(200);
      expect(res.data.requests).toHaveLength(1);
      expect(res.data.canDecide).toBe(canDecide);
    }
  });

  it('Consulta, leitor, Embarques e Vendas não veem as solicitações (a Consulta deixou de ver em 19/11/2026)', async () => {
    await pedir();
    for (const w of [who.consulta, who.leitor, who.embarques, who.vendas]) expect((await app.call('GET', '/api/bookings', { cookie: w.cookie })).status).toBe(403);
  });

  it('ninguém da equipe cadastra solicitação no lugar do agente', async () => {
    for (const w of [who.admin, who.editor, who.consulta, who.leitor]) expect((await pedir({}, w.cookie)).status).toBe(403);
  });
});

describe('o Gabriel decide', () => {
  it('o primeiro acesso é o aprovador, e /api/me diz isso', async () => {
    expect((await app.call('GET', '/api/me', { cookie: who.admin.cookie })).data.user.approvesBookings).toBe(true);
    expect((await app.call('GET', '/api/me', { cookie: who.editor.cookie })).data.user.approvesBookings).toBe(false);
    const users = (await app.call('GET', '/api/users', { cookie: who.admin.cookie })).data.users as { name: string; approvesBookings: boolean }[];
    expect(users.filter((u) => u.approvesBookings).map((u) => u.name)).toEqual(['Gabriel']);
  });

  it('aprova, podendo aprovar menos containers que o pedido', async () => {
    const id = (await pedir()).data.request.id;
    const res = await app.call('POST', `/api/bookings/${id}/approve`, {
      cookie: who.admin.cookie,
      at: new Date('2026-11-17T16:00:00Z'),
      body: {
        lines: [
          { containerType: '40HC', approvedQuantity: 2 },
          { containerType: '20', approvedQuantity: 1 },
        ],
        note: 'Só 2 de 40 HC por enquanto.',
      },
    });
    expect(res.status).toBe(200);
    expect(res.data.request).toMatchObject({ status: 'aprovada', decidedAt: '2026-11-17T16:00:00.000Z', decidedBy: { id: who.admin.id, name: 'Gabriel' }, decisionNote: 'Só 2 de 40 HC por enquanto.' });
    expect(res.data.request.lines).toEqual(
      expect.arrayContaining([
        { containerType: '40HC', quantity: 3, approvedQuantity: 2, priceCents: 285_000 },
        { containerType: '20', quantity: 1, approvedQuantity: 1, priceCents: 180_000 },
      ]),
    );
    // O agente vê a decisão.
    const seen = (await app.call('GET', '/api/bookings', { cookie: who.agente.cookie })).data.requests[0];
    expect(seen).toMatchObject({ status: 'aprovada', decidedBy: { name: 'Gabriel' }, decisionNote: 'Só 2 de 40 HC por enquanto.' });
    // Decidida, não muda mais.
    const again = await app.call('POST', `/api/bookings/${id}/refuse`, { cookie: who.admin.cookie, body: { note: 'Mudei de ideia' } });
    expect(again.status).toBe(409);
    expect(again.data.error).toBe('Esta solicitação já está aprovada.');
    expect((await app.call('POST', `/api/bookings/${id}/cancel`, { cookie: who.agente.cookie })).status).toBe(409);
  });

  it('recusa aprovação acima do pedido ou sem nenhum container', async () => {
    const id = (await pedir()).data.request.id;
    const over = await app.call('POST', `/api/bookings/${id}/approve`, {
      cookie: who.admin.cookie,
      body: { lines: [{ containerType: '40HC', approvedQuantity: 4 }, { containerType: '20', approvedQuantity: 1 }] },
    });
    expect(over.status).toBe(400);
    expect(over.data.error).toBe("Foram pedidos 3 containers de 40' HC: aprove no máximo isso.");
    const none = await app.call('POST', `/api/bookings/${id}/approve`, {
      cookie: who.admin.cookie,
      body: { lines: [{ containerType: '40HC', approvedQuantity: 0 }, { containerType: '20', approvedQuantity: 0 }] },
    });
    expect(none.data.error).toBe('Aprove pelo menos um container, ou recuse a solicitação.');
    const missing = await app.call('POST', `/api/bookings/${id}/approve`, { cookie: who.admin.cookie, body: { lines: [{ containerType: '40HC', approvedQuantity: 3 }] } });
    expect(missing.data.error).toBe('Informe quantos containers de cada tipo pedido são aprovados.');
    expect((await app.call('GET', '/api/bookings', { cookie: who.admin.cookie })).data.requests[0].status).toBe('aguardando');
  });

  it('recusa com o motivo, que o agente vê', async () => {
    const id = (await pedir()).data.request.id;
    const empty = await app.call('POST', `/api/bookings/${id}/refuse`, { cookie: who.admin.cookie, body: { note: '  ' } });
    expect(empty.status).toBe(400);
    expect(empty.data.error).toBe('Informe o motivo da recusa.');
    const res = await app.call('POST', `/api/bookings/${id}/refuse`, { cookie: who.admin.cookie, body: { note: 'A Claire ainda não terminou a PO-024.' } });
    expect(res.status).toBe(200);
    expect(res.data.request).toMatchObject({ status: 'recusada', decisionNote: 'A Claire ainda não terminou a PO-024.' });
    expect(res.data.request.lines.every((l: { approvedQuantity: number | null }) => l.approvedQuantity === null)).toBe(true);
    expect((await app.call('GET', '/api/bookings', { cookie: who.agente.cookie })).data.requests[0]).toMatchObject({ status: 'recusada', decisionNote: 'A Claire ainda não terminou a PO-024.' });
  });

  it('outro admin, editor e Consulta não decidem', async () => {
    const id = (await pedir()).data.request.id;
    const outro = await app.call('POST', '/api/users', { cookie: who.admin.cookie, body: { name: 'Marcelo', email: 'marcelo@grupo.exemplo', role: 'admin' } });
    const login = await app.call('POST', '/api/login', { body: { email: 'marcelo@grupo.exemplo', password: outro.data.tempPassword } });
    await app.call('POST', '/api/password', { cookie: login.cookie, body: { password: 'senha-do-marcelo' } });
    for (const cookie of [login.cookie!, who.editor.cookie, who.consulta.cookie]) {
      const approve = await app.call('POST', `/api/bookings/${id}/approve`, { cookie, body: { lines: [{ containerType: '40HC', approvedQuantity: 3 }, { containerType: '20', approvedQuantity: 1 }] } });
      expect(approve.status).toBe(403);
      expect(approve.data.error).toBe('Você não aprova nem recusa solicitações de embarque.');
      expect((await app.call('POST', `/api/bookings/${id}/refuse`, { cookie, body: { note: 'Não' } })).status).toBe(403);
    }
    expect((await app.call('GET', '/api/bookings', { cookie: login.cookie })).data.canDecide).toBe(false);
  });

  it('solicitação que não existe', async () => {
    const res = await app.call('POST', '/api/bookings/nao-existe/refuse', { cookie: who.admin.cookie, body: { note: 'x' } });
    expect(res.status).toBe(404);
    expect(res.data.error).toBe('Solicitação não encontrada.');
  });
});

describe('começar do zero', () => {
  it('as solicitações ficam, com o nome do fornecedor, sem a ligação', async () => {
    await pedir();
    expect((await app.call('POST', '/api/reset', { cookie: who.admin.cookie, body: { confirm: 'APAGAR' } })).status).toBe(200);
    const [r] = (await app.call('GET', '/api/bookings', { cookie: who.admin.cookie })).data.requests;
    expect(r).toMatchObject({ supplierId: null, supplierName: 'Claire', status: 'aguardando' });
  });

  it('o nome corrigido do fornecedor aparece nas solicitações', async () => {
    await pedir();
    await app.call('PATCH', `/api/suppliers/${claire}`, { cookie: who.editor.cookie, body: { name: 'Claire (Miyi)' } });
    expect((await app.call('GET', '/api/bookings', { cookie: who.agente.cookie })).data.requests[0].supplierName).toBe('Claire (Miyi)');
  });
});

describe('número de referência, prontidão e previsão de chegada (23/11/2026)', () => {
  const corrigir = (id: string, reference: unknown, cookie: string) => app.call('PATCH', `/api/bookings/${id}`, { cookie, body: { reference } });
  const datas = (id: string, body: object, cookie: string) => app.call('PATCH', `/api/bookings/${id}`, { cookie, body });

  it('a solicitação antiga, sem as datas, recebe uma de cada vez; as datas são conferidas com a saída', async () => {
    const id = (await pedir()).data.request.id;
    await app.env.DB.prepare("UPDATE booking_requests SET reference = '', ready_date = NULL, arrival_date = NULL WHERE id = ?").bind(id).run();
    expect((await app.call('GET', '/api/bookings', { cookie: who.agente.cookie })).data.requests[0]).toMatchObject({ readyDate: null, arrivalDate: null });

    expect((await datas(id, { readyDate: '2026-11-30' }, who.agente.cookie)).data.request).toMatchObject({ readyDate: '2026-11-30', arrivalDate: null });
    expect((await datas(id, { arrivalDate: '2027-01-20' }, who.editor.cookie)).data.request).toMatchObject({ readyDate: '2026-11-30', arrivalDate: '2027-01-20' });
    expect((await datas(id, { reference: 'SZX-1', arrivalDate: '2027-01-22' }, who.admin.cookie)).data.request).toMatchObject({ reference: 'SZX-1', arrivalDate: '2027-01-22' });

    for (const [body, message] of [
      [{ readyDate: '2026-12-09' }, 'A prontidão do container passa da saída prevista. Confira as datas.'],
      [{ arrivalDate: '2026-12-01' }, 'A previsão de chegada deve ser depois da saída prevista.'],
      [{ arrivalDate: '2027-12-01' }, 'A previsão de chegada está muito longe da saída. Confira o dia e o ano.'],
      [{ readyDate: '' }, 'Informe a prontidão do container.'],
      [{}, 'Informe o que corrigir.'],
    ] as const) {
      const res = await datas(id, body, who.agente.cookie);
      expect([res.status, res.data.error]).toEqual([400, message]);
    }
    for (const w of [who.consulta, who.leitor, who.embarques, who.vendas]) expect((await datas(id, { arrivalDate: '2027-01-25' }, w.cookie)).status).toBe(403);
  });

  it('o agente preenche o número na solicitação antiga, mesmo aprovada, e corrige depois', async () => {
    const id = (await pedir()).data.request.id;
    await app.call('POST', `/api/bookings/${id}/approve`, {
      cookie: who.admin.cookie,
      body: { lines: [{ containerType: '40HC', approvedQuantity: 3 }, { containerType: '20', approvedQuantity: 1 }], note: '' },
    });
    // As solicitações de antes da migração 0013 ficaram sem número.
    await app.env.DB.prepare("UPDATE booking_requests SET reference = '' WHERE id = ?").bind(id).run();
    expect((await app.call('GET', '/api/bookings', { cookie: who.agente.cookie })).data.requests[0]).toMatchObject({ reference: '', status: 'aprovada' });

    const filled = await corrigir(id, '  SZX  2026-120 ', who.agente.cookie);
    expect(filled.status).toBe(200);
    expect(filled.data.request).toMatchObject({ reference: 'SZX 2026-120', status: 'aprovada' });
    expect((await corrigir(id, 'SZX-2026-121', who.agente.cookie)).data.request.reference).toBe('SZX-2026-121');
  });

  it('admin e editor corrigem qualquer uma; o outro agente não acha a solicitação; os outros perfis não corrigem', async () => {
    const id = (await pedir()).data.request.id;
    expect((await corrigir(id, 'ADM-1', who.admin.cookie)).data.request.reference).toBe('ADM-1');
    expect((await corrigir(id, 'EDT-1', who.editor.cookie)).data.request.reference).toBe('EDT-1');

    const outro = await app.call('POST', '/api/users', { cookie: who.admin.cookie, body: { name: 'Outro Agente', email: 'outro@agente.exemplo', role: 'agente' } });
    const login = await app.call('POST', '/api/login', { body: { email: 'outro@agente.exemplo', password: outro.data.tempPassword } });
    await app.call('POST', '/api/password', { cookie: login.cookie, body: { password: 'senha-outro-agente' } });
    const other = await corrigir(id, 'OUTRO-1', login.cookie!);
    expect([other.status, other.data.error]).toEqual([404, 'Solicitação não encontrada.']);

    for (const w of [who.consulta, who.leitor, who.embarques, who.vendas]) {
      const res = await corrigir(id, 'X-1', w.cookie);
      expect([res.status, res.data.error]).toEqual([403, 'Seu perfil não vê as solicitações de embarque.']);
    }
    expect((await app.call('GET', '/api/bookings', { cookie: who.admin.cookie })).data.requests[0].reference).toBe('EDT-1');
  });

  it('recusa número vazio ou comprido demais, e solicitação que não existe', async () => {
    const id = (await pedir()).data.request.id;
    for (const [reference, message] of [
      ['  ', 'Informe o número de referência.'],
      ['X'.repeat(41), 'O número de referência pode ter no máximo 40 caracteres.'],
    ] as const) {
      const res = await corrigir(id, reference, who.agente.cookie);
      expect([res.status, res.data.error]).toEqual([400, message]);
    }
    expect((await corrigir('nao-existe', 'X-1', who.admin.cookie)).status).toBe(404);
  });
});

describe('referência IBC e pré e pós-embarque (23/11/2026)', () => {
  const aprovar = (id: string) =>
    app.call('POST', `/api/bookings/${id}/approve`, {
      cookie: who.admin.cookie,
      body: { lines: [{ containerType: '40HC', approvedQuantity: 3 }, { containerType: '20', approvedQuantity: 1 }], note: '' },
    });
  const embarcou = (id: string, shippedAt: unknown, cookie: string, at?: Date) => app.call('POST', `/api/bookings/${id}/shipped`, { cookie, body: { shippedAt }, at });
  const desfazer = (id: string, cookie: string) => app.call('POST', `/api/bookings/${id}/unship`, { cookie, body: {} });

  it('a referência IBC é opcional ao pedir e se corrige depois', async () => {
    const sem = await pedir();
    expect(sem.data.request.ibcReference).toBe('');
    const com = await pedir({ ibcReference: '  IBC  7781 ' });
    expect(com.data.request.ibcReference).toBe('IBC 7781');
    const longa = await pedir({ ibcReference: 'X'.repeat(41) });
    expect([longa.status, longa.data.error]).toEqual([400, 'A referência IBC pode ter no máximo 40 caracteres.']);
    const id = sem.data.request.id;
    expect((await app.call('PATCH', `/api/bookings/${id}`, { cookie: who.agente.cookie, body: { ibcReference: 'IBC-9' } })).data.request.ibcReference).toBe('IBC-9');
    expect((await app.call('PATCH', `/api/bookings/${id}`, { cookie: who.editor.cookie, body: { ibcReference: '' } })).data.request.ibcReference).toBe('');
  });

  it('o agente marca que a aprovada embarcou, com o dia; admin e editor também; dá para desfazer', async () => {
    const id = (await pedir()).data.request.id;
    const antes = await embarcou(id, '2026-11-16', who.agente.cookie);
    expect([antes.status, antes.data.error]).toEqual([409, 'Só a solicitação aprovada pode ser marcada como embarcada.']);
    await aprovar(id);
    const ok = await embarcou(id, '2026-11-16', who.agente.cookie);
    expect(ok.status).toBe(200);
    expect(ok.data.request).toMatchObject({ status: 'aprovada', shippedAt: '2026-11-16', shippedBy: { id: who.agente.id, name: 'Ana Agente' } });
    expect((await desfazer(id, who.editor.cookie)).data.request).toMatchObject({ shippedAt: null, shippedBy: null });
    const outra = await desfazer(id, who.editor.cookie);
    expect([outra.status, outra.data.error]).toEqual([409, 'Esta solicitação não está marcada como embarcada.']);
    expect((await embarcou(id, '2026-11-17', who.admin.cookie)).data.request).toMatchObject({ shippedAt: '2026-11-17', shippedBy: { id: who.admin.id } });
  });

  it('confere o dia; os outros perfis não marcam; o outro agente nem acha', async () => {
    const id = (await pedir()).data.request.id;
    await aprovar(id);
    for (const [shippedAt, message] of [
      ['2026-11-18', 'O dia em que embarcou não pode ser depois de hoje.'],
      ['2025-11-18', 'O dia em que embarcou está muito antes da saída prevista. Confira o dia e o ano.'],
      [undefined, 'Informe o dia em que embarcou.'],
    ] as const) {
      const res = await embarcou(id, shippedAt, who.agente.cookie);
      expect([res.status, res.data.error]).toEqual([400, message]);
    }
    for (const w of [who.consulta, who.leitor, who.embarques, who.vendas]) {
      const res = await embarcou(id, '2026-11-16', w.cookie);
      expect([res.status, res.data.error]).toEqual([403, 'Seu perfil não vê as solicitações de embarque.']);
    }
    const outro = await app.call('POST', '/api/users', { cookie: who.admin.cookie, body: { name: 'Outro Agente', email: 'outro@agente.exemplo', role: 'agente' } });
    const login = await app.call('POST', '/api/login', { body: { email: 'outro@agente.exemplo', password: outro.data.tempPassword } });
    await app.call('POST', '/api/password', { cookie: login.cookie, body: { password: 'senha-outro-agente' } });
    expect((await embarcou(id, '2026-11-16', login.cookie!)).status).toBe(404);
  });
});
