import { describe, expect, it } from 'vitest';
import {
  approvalProblem,
  approvedLess,
  bookingDatesProblem,
  bookingProblem,
  bookingTotalCents,
  canCancelBooking,
  canDecideBookings,
  canEditBookingDetails,
  containerCount,
  containersText,
  departureText,
  groupBookings,
  matchesBooking,
  normalizeReference,
  otherBookingsOfSupplier,
  parseContainerPrice,
  pendingCount,
  portSuggestions,
  sortBookings,
  sortedLines,
  type BookingLine,
  type BookingRequest,
} from './bookings';

const TODAY = '2026-11-19';
const valid = {
  reference: 'SZX-2026-118',
  departurePort: 'Shenzhen',
  departureDate: '2026-12-05',
  readyDate: '2026-12-01',
  arrivalDate: '2027-01-15',
  lines: [{ containerType: '40HC' as const, quantity: 3, priceCents: 285_000 }],
};

function request(over: Partial<BookingRequest> = {}): BookingRequest {
  return {
    id: 'r1',
    reference: 'SZX-2026-118',
    readyDate: '2026-12-01',
    arrivalDate: '2027-01-15',
    supplierId: 'claire',
    supplierName: 'Claire',
    departurePort: 'Shenzhen',
    departureDate: '2026-12-05',
    notes: '',
    status: 'aguardando',
    createdAt: '2026-11-19T12:00:00.000Z',
    createdBy: { id: 'agente', name: 'Ana Agente' },
    decidedAt: null,
    decidedBy: null,
    decisionNote: '',
    lines: [{ containerType: '40HC', quantity: 3, approvedQuantity: null, priceCents: 285_000 }],
    ...over,
  };
}

describe('nova solicitação', () => {
  it('aceita o pedido completo', () => {
    expect(bookingProblem(valid, TODAY)).toBeNull();
    expect(bookingProblem({ ...valid, lines: [...valid.lines, { containerType: '20', quantity: 1, priceCents: 180_000 }] }, TODAY)).toBeNull();
  });

  it('pede o número de referência (23/11/2026), com até 40 caracteres e sem espaços sobrando', () => {
    expect(bookingProblem({ ...valid, reference: '   ' }, TODAY)).toBe('Informe o número de referência.');
    expect(bookingProblem({ ...valid, reference: 'X'.repeat(41) }, TODAY)).toBe('O número de referência pode ter no máximo 40 caracteres.');
    expect(bookingProblem({ ...valid, reference: ` ${'X'.repeat(40)} ` }, TODAY)).toBeNull();
    expect(normalizeReference('  SZX  2026 118 ')).toBe('SZX 2026 118');
  });

  it('pede a prontidão do container e a previsão de chegada (23/11/2026): pronta até a saída, chegada depois dela', () => {
    expect(bookingProblem({ ...valid, readyDate: '' }, TODAY)).toBe('Informe a prontidão do container.');
    expect(bookingProblem({ ...valid, arrivalDate: '15/01/2027' }, TODAY)).toBe('Informe a previsão de chegada.');
    expect(bookingProblem({ ...valid, readyDate: '2026-12-06' }, TODAY)).toBe('A prontidão do container passa da saída prevista. Confira as datas.');
    expect(bookingProblem({ ...valid, readyDate: '2026-12-05' }, TODAY)).toBeNull();
    expect(bookingProblem({ ...valid, readyDate: '2025-12-01' }, TODAY)).toBe('A prontidão do container está muito antes da saída. Confira o dia e o ano.');
    expect(bookingProblem({ ...valid, arrivalDate: '2026-12-05' }, TODAY)).toBe('A previsão de chegada deve ser depois da saída prevista.');
    expect(bookingProblem({ ...valid, arrivalDate: '2028-01-15' }, TODAY)).toBe('A previsão de chegada está muito longe da saída. Confira o dia e o ano.');
    expect(bookingDatesProblem({ departureDate: '2026-12-05', readyDate: '2026-06-08', arrivalDate: '2027-04-04' })).toBeNull();
  });

  it('pede porto, data e pelo menos um tipo de container', () => {
    expect(bookingProblem({ ...valid, departurePort: '  ' }, TODAY)).toBe('Informe o porto de saída.');
    expect(bookingProblem({ ...valid, departureDate: '' }, TODAY)).toBe('Informe a data de saída.');
    expect(bookingProblem({ ...valid, departureDate: '05/12/2026' }, TODAY)).toBe('Informe a data de saída.');
    expect(bookingProblem({ ...valid, departureDate: '2026-02-30' }, TODAY)).toBe('Informe a data de saída.');
    expect(bookingProblem({ ...valid, lines: [] }, TODAY)).toBe('Informe pelo menos um tipo de container.');
  });

  it('desconfia de data muito longe (ano errado), mas aceita saída recente já passada', () => {
    // A saída em outro dia, com a prontidão 4 dias antes e a chegada 41 dias depois.
    const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    const leaving = (departureDate: string) => ({ ...valid, departureDate, readyDate: shift(departureDate, -4), arrivalDate: shift(departureDate, 41) });
    expect(bookingProblem(leaving('2026-10-01'), TODAY)).toBeNull();
    expect(bookingProblem(leaving('2026-08-01'), TODAY)).toBe('A data de saída parece errada. Confira o dia e o ano.');
    expect(bookingProblem(leaving('2027-11-19'), TODAY)).toBeNull();
    expect(bookingProblem(leaving('2028-01-05'), TODAY)).toBe('A data de saída parece errada. Confira o dia e o ano.');
  });

  it('cada tipo uma vez, com quantidade e valor', () => {
    const line = valid.lines[0]!;
    expect(bookingProblem({ ...valid, lines: [line, { ...line, quantity: 1 }] }, TODAY)).toBe("O container 40' HC aparece duas vezes. Junte as quantidades numa linha só.");
    expect(bookingProblem({ ...valid, lines: [{ ...line, quantity: 0 }] }, TODAY)).toBe("Informe quantos containers de 40' HC.");
    expect(bookingProblem({ ...valid, lines: [{ ...line, quantity: 1.5 }] }, TODAY)).toBe("Informe quantos containers de 40' HC.");
    expect(bookingProblem({ ...valid, lines: [{ ...line, quantity: 100 }] }, TODAY)).toBe('No máximo 99 containers de cada tipo.');
    expect(bookingProblem({ ...valid, lines: [{ ...line, priceCents: 0 }] }, TODAY)).toBe("Informe o valor de cada container de 40' HC.");
    expect(bookingProblem({ ...valid, lines: [{ ...line, priceCents: 285 }] }, TODAY)).toBe("O valor de cada container de 40' HC está abaixo de US$ 100,00. Confira.");
    expect(bookingProblem({ ...valid, lines: [{ ...line, priceCents: 10_000 }] }, TODAY)).toBeNull();
    expect(bookingProblem({ ...valid, lines: [{ containerType: '20', quantity: 1, priceCents: 10_000_001 }] }, TODAY)).toBe("O valor de cada container de 20' passa de US$ 100.000,00. Confira.");
  });
});

describe('valor do container digitado', () => {
  it('ponto ou vírgula seguidos de três dígitos separam os milhares', () => {
    expect(parseContainerPrice('2.850')).toBe(285_000);
    expect(parseContainerPrice('2,850')).toBe(285_000);
    expect(parseContainerPrice('12.300')).toBe(1_230_000);
    expect(parseContainerPrice('1.234.567')).toBe(123_456_700);
    expect(parseContainerPrice('US$ 2.850')).toBe(285_000);
  });

  it('com centavos, sem separador ou com decimal, como o resto do app', () => {
    expect(parseContainerPrice('2.850,00')).toBe(285_000);
    expect(parseContainerPrice('2,850.00')).toBe(285_000);
    expect(parseContainerPrice('2850')).toBe(285_000);
    expect(parseContainerPrice('2850,5')).toBe(285_050);
    // "2,85" continua sendo US$ 2,85, e a validação recusa por estar abaixo de US$ 100,00.
    expect(parseContainerPrice('2,85')).toBe(285);
  });

  it('o que não é valor', () => {
    for (const t of ['', 'abc', '1.234,567', '-100']) expect(parseContainerPrice(t), t).toBeNull();
  });
});

describe('aprovação', () => {
  const lines = [
    { containerType: '40HC' as const, quantity: 3 },
    { containerType: '20' as const, quantity: 1 },
  ];

  it('aprova o pedido inteiro ou menos', () => {
    expect(approvalProblem(lines, [{ containerType: '20', approvedQuantity: 1 }, { containerType: '40HC', approvedQuantity: 3 }])).toBeNull();
    expect(approvalProblem(lines, [{ containerType: '40HC', approvedQuantity: 2 }, { containerType: '20', approvedQuantity: 0 }])).toBeNull();
  });

  it('nunca mais que o pedido, e pelo menos um container', () => {
    expect(approvalProblem(lines, [{ containerType: '40HC', approvedQuantity: 4 }, { containerType: '20', approvedQuantity: 1 }])).toBe("Foram pedidos 3 containers de 40' HC: aprove no máximo isso.");
    expect(approvalProblem(lines, [{ containerType: '40HC', approvedQuantity: 3 }, { containerType: '20', approvedQuantity: 2 }])).toBe("Foi pedido 1 container de 20': aprove no máximo isso.");
    expect(approvalProblem(lines, [{ containerType: '40HC', approvedQuantity: 0 }, { containerType: '20', approvedQuantity: 0 }])).toBe('Aprove pelo menos um container, ou recuse a solicitação.');
    expect(approvalProblem(lines, [{ containerType: '40HC', approvedQuantity: -1 }, { containerType: '20', approvedQuantity: 1 }])).toBe("Quantidade aprovada inválida para o container 40' HC.");
  });

  it('as quantidades aprovadas precisam ser dos tipos pedidos, todos eles', () => {
    const msg = 'Informe quantos containers de cada tipo pedido são aprovados.';
    expect(approvalProblem(lines, [{ containerType: '40HC', approvedQuantity: 3 }])).toBe(msg);
    expect(approvalProblem(lines, [{ containerType: '40HC', approvedQuantity: 3 }, { containerType: '40', approvedQuantity: 1 }])).toBe(msg);
    expect(approvalProblem(lines, [{ containerType: '40HC', approvedQuantity: 1 }, { containerType: '40HC', approvedQuantity: 1 }])).toBe(msg);
  });
});

describe('containers e valores', () => {
  const lines: BookingLine[] = [
    { containerType: '40HC', quantity: 2, approvedQuantity: 1, priceCents: 285_000 },
    { containerType: '20', quantity: 1, approvedQuantity: 1, priceCents: 180_050 },
  ];

  it('ordem dos tipos e texto do pedido e do aprovado', () => {
    expect(sortedLines(lines).map((l) => l.containerType)).toEqual(['20', '40HC']);
    expect(containersText(lines)).toBe("1 × 20' + 2 × 40' HC");
    // O 40' agora é o 40' NOR (23/11/2026).
    expect(containersText([{ containerType: '40', quantity: 3, approvedQuantity: null }])).toBe("3 × 40' NOR");
    expect(containersText(lines, 'aprovado')).toBe("1 × 20' + 1 × 40' HC");
    expect(containersText([{ containerType: '40', quantity: 2, approvedQuantity: 0 }], 'aprovado')).toBe('Nenhum container');
    expect(containersText([{ containerType: '40', quantity: 2, approvedQuantity: null }], 'aprovado')).toBe('Nenhum container');
  });

  it('contagem e total em centavos, sem ponto flutuante', () => {
    expect(containerCount(lines)).toBe(3);
    expect(containerCount(lines, 'aprovado')).toBe(2);
    expect(bookingTotalCents(lines)).toBe(750_050);
    expect(bookingTotalCents(lines, 'aprovado')).toBe(465_050);
  });

  it('avisa quando a aprovação ficou abaixo do pedido', () => {
    expect(approvedLess(request({ status: 'aprovada', lines }))).toBe(true);
    expect(approvedLess(request({ status: 'aprovada', lines: lines.map((l) => ({ ...l, approvedQuantity: l.quantity })) }))).toBe(false);
    expect(approvedLess(request({ status: 'recusada', lines }))).toBe(false);
  });
});

describe('saída', () => {
  it('conta os dias até a saída, ou desde ela', () => {
    expect(departureText('2026-12-01', TODAY)).toBe('Saída em 12 dias');
    expect(departureText('2026-11-20', TODAY)).toBe('Saída amanhã');
    expect(departureText(TODAY, TODAY)).toBe('Saída hoje');
    expect(departureText('2026-11-18', TODAY)).toBe('Saída ontem');
    expect(departureText('2026-11-16', TODAY)).toBe('Saída há 3 dias');
  });
});

describe('quem pode o quê', () => {
  it('só o admin com a marca de aprovador decide', () => {
    expect(canDecideBookings({ role: 'admin', approvesBookings: true })).toBe(true);
    expect(canDecideBookings({ role: 'admin', approvesBookings: false })).toBe(false);
    // A marca sozinha não basta: um aprovador que deixou de ser admin não decide.
    expect(canDecideBookings({ role: 'editor', approvesBookings: true })).toBe(false);
    expect(canDecideBookings({ role: 'agente', approvesBookings: true })).toBe(false);
  });

  it('o agente cancela só a própria solicitação, enquanto aguarda', () => {
    const r = request();
    expect(canCancelBooking(r, { id: 'agente', role: 'agente' })).toBe(true);
    expect(canCancelBooking(r, { id: 'outro', role: 'agente' })).toBe(false);
    expect(canCancelBooking({ ...r, status: 'aprovada' }, { id: 'agente', role: 'agente' })).toBe(false);
    expect(canCancelBooking(r, { id: 'agente', role: 'admin' })).toBe(false);
  });
});

describe('lista', () => {
  const a = request({ id: 'a', departureDate: '2026-12-20', createdAt: '2026-11-10T10:00:00Z' });
  const b = request({ id: 'b', departureDate: '2026-12-01', createdAt: '2026-11-18T10:00:00Z' });
  const c = request({ id: 'c', status: 'aprovada', decidedAt: '2026-11-15T10:00:00Z' });
  const d = request({ id: 'd', status: 'recusada', decidedAt: '2026-11-17T10:00:00Z' });
  const e = request({ id: 'e', status: 'aprovada', decidedAt: '2026-11-18T09:00:00Z' });

  it('as que aguardam primeiro, pela saída; depois as decididas, da mais recente', () => {
    expect(sortBookings([c, a, d, b, e]).map((r) => r.id)).toEqual(['b', 'a', 'e', 'd', 'c']);
    expect(pendingCount([a, b, c, d])).toBe(2);
  });

  it('agrupa por situação, só as que têm alguma', () => {
    expect(groupBookings([c, a, d, b, e]).map((g) => [g.status, g.requests.map((r) => r.id)])).toEqual([
      ['aguardando', ['b', 'a']],
      ['aprovada', ['e', 'c']],
      ['recusada', ['d']],
    ]);
  });

  it('busca por fornecedor, porto, containers e quem pediu, sem acento nem maiúsculas', () => {
    const r = request({ departurePort: 'Ningbo', notes: 'Navio da COSCO' });
    expect(matchesBooking(r, 'claire ningbo')).toBe(true);
    expect(matchesBooking(r, '40 hc')).toBe(true);
    expect(matchesBooking(r, 'ana')).toBe(true);
    expect(matchesBooking(r, 'cosco')).toBe(true);
    expect(matchesBooking(r, 'sara')).toBe(false);
    expect(matchesBooking(r, 'szx-2026')).toBe(true);
    expect(matchesBooking(r, '')).toBe(true);
  });

  it('sugere os portos já usados, do mais usado; vale a grafia mais recente', () => {
    expect(
      portSuggestions([
        { departurePort: 'Shenzhen', createdAt: '2026-11-01' },
        { departurePort: 'ningbo', createdAt: '2026-11-02' },
        { departurePort: 'Shenzhen', createdAt: '2026-11-03' },
        { departurePort: 'Ningbo', createdAt: '2026-11-05' },
        { departurePort: 'Nhava Sheva', createdAt: '2026-11-04' },
        { departurePort: ' ', createdAt: '2026-11-06' },
      ]),
    ).toEqual(['Ningbo', 'Shenzhen', 'Nhava Sheva']);
  });

  it('as outras solicitações do mesmo fornecedor, da mais recente', () => {
    const others = [
      request({ id: 'x', createdAt: '2026-11-01T00:00:00Z' }),
      request({ id: 'y', createdAt: '2026-11-05T00:00:00Z' }),
      request({ id: 'z', supplierId: 'sara', supplierName: 'Sara' }),
    ];
    const current = request({ id: 'atual' });
    expect(otherBookingsOfSupplier([current, ...others], current).map((r) => r.id)).toEqual(['y', 'x']);
    expect(otherBookingsOfSupplier([current, ...others], { ...current, supplierId: null })).toEqual([]);
  });
});

describe('número de referência', () => {
  it('o agente corrige o número e as datas das próprias solicitações, em qualquer situação; admin e editor, de qualquer uma; os outros perfis, não', () => {
    const own = request();
    const agent = { id: 'agente', role: 'agente' as const };
    for (const status of ['aguardando', 'aprovada', 'recusada', 'cancelada'] as const) expect(canEditBookingDetails(request({ status }), agent)).toBe(true);
    expect(canEditBookingDetails(own, { id: 'outro-agente', role: 'agente' })).toBe(false);
    for (const role of ['admin', 'editor'] as const) expect(canEditBookingDetails(own, { id: 'x', role }), role).toBe(true);
    for (const role of ['consulta', 'leitor', 'embarques', 'vendas'] as const) expect(canEditBookingDetails(own, { id: 'x', role }), role).toBe(false);
  });
});
