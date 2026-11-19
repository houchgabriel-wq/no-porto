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
  supplierId: claire,
  departurePort: 'Shenzhen',
  departureDate: '2026-12-05',
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
      supplierId: claire,
      supplierName: 'Claire',
      departurePort: 'Shenzhen',
      departureDate: '2026-12-05',
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
      [{ supplierId: '' }, 'Escolha o fornecedor.'],
      [{ supplierId: 'nao-existe' }, 'Fornecedor não encontrado. Escolha um da lista.'],
      [{ departurePort: '   ' }, 'Informe o porto de saída.'],
      [{ departureDate: '05/12/2026' }, 'Informe a data de saída.'],
      [{ departureDate: '2062-12-05' }, 'A data de saída parece errada. Confira o dia e o ano.'],
      [{ lines: [] }, 'Informe pelo menos um tipo de container.'],
      [{ lines: [{ containerType: '45', quantity: 1, priceCents: 1 }] }, 'Tipo de container inválido.'],
      [{ lines: [{ containerType: '40', quantity: 2, priceCents: 250_000 }, { containerType: '40', quantity: 1, priceCents: 250_000 }] }, "O container 40' aparece duas vezes. Junte as quantidades numa linha só."],
      [{ lines: [{ containerType: '40', quantity: 1, priceCents: 285 }] }, "O valor de cada container de 40' está abaixo de US$ 100,00. Confira."],
      [{ lines: [{ containerType: '40', quantity: 0, priceCents: 250_000 }] }, "Informe quantos containers de 40'."],
      [{ lines: [{ containerType: '40', quantity: 1, priceCents: 0 }] }, "Informe o valor de cada container de 40'."],
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
  it('admin, editor e Consulta veem todas as solicitações; só o aprovador pode decidir', async () => {
    await pedir();
    for (const [w, canDecide] of [
      [who.admin, true],
      [who.editor, false],
      [who.consulta, false],
    ] as const) {
      const res = await app.call('GET', '/api/bookings', { cookie: w.cookie });
      expect(res.status).toBe(200);
      expect(res.data.requests).toHaveLength(1);
      expect(res.data.canDecide).toBe(canDecide);
    }
  });

  it('leitor, Embarques e Vendas não veem as solicitações', async () => {
    for (const w of [who.leitor, who.embarques, who.vendas]) expect((await app.call('GET', '/api/bookings', { cookie: w.cookie })).status).toBe(403);
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
