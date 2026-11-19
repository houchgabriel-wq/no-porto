import { describe, expect, it } from 'vitest';
import {
  addMonths,
  formatMonth,
  mergePlans,
  monthOptions,
  parcelPassed,
  parseShipPlanText,
  plannedTotal,
  readShipPlanText,
  readStoredPlan,
  shipPlanProblem,
  shipPlanText,
  takeFromPlan,
} from './shipPlan';

const TRES = [
  { month: '2026-12', quantity: 20_000 },
  { month: '2027-02', quantity: 20_000 },
  { month: '2027-04', quantity: 20_000 },
];

describe('meses', () => {
  it('formata e conta meses, virando o ano', () => {
    expect(formatMonth('2026-12')).toBe('dez/2026');
    expect(formatMonth('2027-02')).toBe('fev/2027');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -2)).toBe('2026-11');
    expect(addMonths('2026-11', 14)).toBe('2028-01');
  });

  it('lista os meses de escolha, com os já usados mesmo fora do intervalo', () => {
    expect(monthOptions('2026-11', 1, 2)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    expect(monthOptions('2026-11', 0, 1, ['2025-06', 'x'])).toEqual(['2025-06', '2026-11', '2026-12']);
  });
});

describe('programação válida', () => {
  it('aceita até três embarques que somam até a quantidade do item', () => {
    expect(shipPlanProblem(TRES, 60_000)).toBeNull();
    expect(shipPlanProblem(TRES.slice(0, 2), 60_000)).toBeNull();
    expect(shipPlanProblem([], 60_000)).toBeNull();
  });

  it('recusa mais de três, mês repetido, sem quantidade e soma maior que o item', () => {
    expect(shipPlanProblem([...TRES, { month: '2027-06', quantity: 1 }], 99_999)).toBe('No máximo 3 embarques na programação de envio.');
    expect(shipPlanProblem([TRES[0]!, { month: '2026-12', quantity: 5 }], 60_000)).toBe('O mês dez/2026 aparece em dois embarques. Junte as quantidades num só.');
    expect(shipPlanProblem([{ month: '2026-13', quantity: 5 }], 60_000)).toBe('Escolha o mês do embarque 1.');
    expect(shipPlanProblem([TRES[0]!, { month: '2027-01', quantity: 0 }], 60_000)).toBe('Informe a quantidade do embarque 2.');
    expect(shipPlanProblem(TRES, 50_000)).toBe('A programação de envio soma 60.000 exemplares, mais que os 50.000 do item.');
    expect(plannedTotal(TRES)).toBe(60_000);
  });
});

describe('embarque em parte', () => {
  it('sai primeiro o que está programado para antes', () => {
    expect(takeFromPlan(TRES, 20_000)).toEqual({ taken: [TRES[0]], left: [TRES[1], TRES[2]] });
    expect(takeFromPlan(TRES, 25_000)).toEqual({
      taken: [TRES[0], { month: '2027-02', quantity: 5_000 }],
      left: [{ month: '2027-02', quantity: 15_000 }, TRES[2]],
    });
  });

  it('embarcando mais que o programado, o saldo fica sem programação', () => {
    expect(takeFromPlan([TRES[0]!], 30_000)).toEqual({ taken: [TRES[0]], left: [] });
    expect(takeFromPlan([], 1000)).toEqual({ taken: [], left: [] });
  });

  it('desfeito o embarque, as quantidades de cada mês se somam de novo', () => {
    const { taken, left } = takeFromPlan(TRES, 25_000);
    expect(mergePlans(left, taken)).toEqual(TRES);
  });
});

describe('na tela e na planilha', () => {
  it('o embarque passou quando o mês acabou', () => {
    expect(parcelPassed('2026-10', '2026-11-19')).toBe(true);
    expect(parcelPassed('2026-11', '2026-11-19')).toBe(false);
  });

  it('escreve e lê de volta a programação', () => {
    expect(shipPlanText(TRES)).toBe('dez/2026: 20.000; fev/2027: 20.000; abr/2027: 20.000');
    expect(shipPlanText([])).toBe('');
    expect(parseShipPlanText(shipPlanText(TRES), 60_000)).toEqual(TRES);
  });

  it('aceita o mês como número e um mês sozinho para o item inteiro', () => {
    expect(parseShipPlanText('12/2026: 20000\n2027-02: 20.000', 60_000)).toEqual(TRES.slice(0, 2));
    expect(parseShipPlanText('Dez/2026', 8_000)).toEqual([{ month: '2026-12', quantity: 8_000 }]);
    expect(parseShipPlanText('  ', 8_000)).toEqual([]);
  });

  it('aceita o mês que a planilha transformou em data ao digitar "dez/2026"; o dia não conta', () => {
    expect(parseShipPlanText('01/12/2026', 8_000)).toEqual([{ month: '2026-12', quantity: 8_000 }]);
    expect(parseShipPlanText('15/12/2026: 3.000; 2027-02-01: 5.000', 8_000)).toEqual([
      { month: '2026-12', quantity: 3_000 },
      { month: '2027-02', quantity: 5_000 },
    ]);
    expect(parseShipPlanText('31/13/2026', 8_000)).toBeNull();
  });

  it('diz o que está errado na escrita, sem conferir a soma', () => {
    expect(readShipPlanText('dezembro', 8_000)).toEqual({ error: '"dezembro" não é um embarque. Escreva como "dez/2026: 20.000; fev/2027: 20.000".' });
    expect(readShipPlanText('dez/2026; fev/2027: 2.000', 8_000)).toEqual({
      error: 'Falta a quantidade em "dez/2026". Com mais de um embarque, escreva como "dez/2026: 20.000; fev/2027: 20.000".',
    });
    // A soma passa do item: a escrita está certa; quem confere a soma é shipPlanProblem.
    expect(readShipPlanText('fev/2027: 9.000', 8_000)).toEqual({ plan: [{ month: '2027-02', quantity: 9_000 }] });
    expect(readShipPlanText('', 8_000)).toEqual({ plan: [] });
  });

  it('o que não dá para ler, ou não vale para o item, volta null', () => {
    expect(parseShipPlanText('dezembro', 8_000)).toBeNull();
    expect(parseShipPlanText('6k dec + 6k apr', 18_000)).toBeNull();
    expect(parseShipPlanText('dez/2026; fev/2027', 8_000)).toBeNull();
    expect(parseShipPlanText('dez/2026: 9.000', 8_000)).toBeNull();
  });

  it('o que vem do banco: lista válida, em ordem; o resto vira vazio', () => {
    expect(readStoredPlan('[{"month":"2027-02","quantity":5},{"month":"2026-12","quantity":7}]')).toEqual([
      { month: '2026-12', quantity: 7 },
      { month: '2027-02', quantity: 5 },
    ]);
    expect(readStoredPlan('{}')).toEqual([]);
    expect(readStoredPlan('não é json')).toEqual([]);
    expect(readStoredPlan(null)).toEqual([]);
  });
});
