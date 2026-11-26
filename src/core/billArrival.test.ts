import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_DAYS_DEFAULT,
  arrivalDaysProblem,
  arrivalFromBill,
  arrivalText,
  billDateProblem,
  billDateText,
  datesInText,
  readBillDate,
  type PdfItem,
} from './billArrival';

const item = (text: string, x: number, y: number, width: number, page = 1): PdfItem => ({ text, x, y, width, page });

// As posições do HBL do 57º embarque da Miyi, como o pdf.js entrega (y cresce para cima).
const hbl57: PdfItem[] = [
  item('B/L No.', 432.4, 772.9, 23.3),
  item('ROECHN26112871', 432.4, 763.3, 70.2),
  item('CNPJ: 04.207.648/0001-94', 15.7, 648.9, 96.9),
  item('5441CARTONS', 134.7, 383.5, 56.9),
  item('40NOR*2', 225.4, 316.7, 34.2),
  item('YMLU5432079/YMAX802369/40NOR/2497CARTONS/24430.000KGS/57.840CBM', 19, 266, 300),
  item('Carrier has issued the number of Bill of Lading stated below,all of this tenor and date,one', 296.3, 110.2, 275.5),
  item('Place and date of issue', 15.7, 56.4, 72.8),
  item('Shipped on Board', 185.8, 56.4, 56.0),
  item('(Terms continued on the back hereof, please read carefully)', 296.3, 59.4, 185.2),
  item('Nov 28, 2026', 22.3, 40.3, 47.6),
  item('Nov 28, 2026', 185.8, 40.3, 47.6),
];

describe('datas escritas no BL', () => {
  it('lê os jeitos comuns de escrever a data', () => {
    const cases: [string, string[]][] = [
      ['Nov 28, 2026', ['2026-11-28']],
      ['NOV.28,2026', ['2026-11-28']],
      ['November 28th 2026', ['2026-11-28']],
      ['28 Nov 2026', ['2026-11-28']],
      ['28-NOV-26', ['2026-11-28']],
      ['28th November, 2026', ['2026-11-28']],
      ['SHENZHEN 2026-11-28', ['2026-11-28']],
      ['2026/11/28', ['2026-11-28']],
      ['28/11/2026', ['2026-11-28']],
      ['11/28/2026', ['2026-11-28']],
      ['05/05/2026', ['2026-05-05']],
      ['Sept 3, 2026', ['2026-09-03']],
      ['Nov 28, 2026 Nov 30, 2026', ['2026-11-28', '2026-11-30']],
    ];
    for (const [text, dates] of cases) expect(datesInText(text), text).toEqual(dates);
  });

  it('não inventa data: mês e dia trocáveis, data que não existe e números que não são data', () => {
    for (const text of ['05/11/2026', 'Feb 30, 2026', 'CNPJ: 04.207.648/0001-94', '5441CARTONS', '40NOR*2', 'MARKS & NOS', 'MAY 2026', 'DECLARED VALUE 2026', '24430.000KGS/57.840CBM', 'Tel: +55 13- 3301-0154', 'Nov 28, 1999']) {
      expect(datesInText(text), text).toEqual([]);
    }
  });
});

describe('a data do BL', () => {
  it('no HBL do 57º embarque, a do embarque a bordo, embaixo do rótulo', () => {
    expect(readBillDate(hbl57)).toEqual({ date: '2026-11-28', source: 'embarque' });
  });

  it('o embarque a bordo vale mais que a emissão; sem ele, a emissão, cada uma na sua coluna', () => {
    const issued = hbl57.map((it) => (it.x === 22.3 ? { ...it, text: 'Nov 30, 2026' } : it));
    expect(readBillDate(issued)).toEqual({ date: '2026-11-28', source: 'embarque' });
    expect(readBillDate(issued.filter((it) => it.text !== 'Shipped on Board'))).toEqual({ date: '2026-11-30', source: 'emissao' });
  });

  it('a data no próprio rótulo ou à direita dele, na mesma linha', () => {
    expect(readBillDate([item('SHIPPED ON BOARD DATE: 28-NOV-2026', 20, 100, 160)])).toEqual({ date: '2026-11-28', source: 'embarque' });
    expect(readBillDate([item('Laden on board:', 20, 300, 60), item('2026-11-27', 90, 300, 45), item('Date of issue:', 20, 280, 55), item('2026-11-29', 90, 280, 45)])).toEqual({
      date: '2026-11-27',
      source: 'embarque',
    });
    expect(readBillDate([item('Date of issue:', 20, 280, 55), item('2026-11-29', 90, 280, 45), item('2026-12-24', 400, 280, 45)])).toEqual({ date: '2026-11-29', source: 'emissao' });
  });

  it('a cláusula que fala em "shipped on board" não é rótulo; sem rótulo, só a única data do documento', () => {
    const clause = item('SHIPPED on board the vessel named above in apparent good order and condition, unless otherwise indicated', 20, 200, 500);
    expect(readBillDate([clause, item('Dec 1, 2026', 20, 180, 50)])).toEqual({ date: '2026-12-01', source: 'unica' });
    expect(readBillDate([clause, item('Dec 1, 2026', 20, 180, 50), item('INVOICE DATED 2026-11-20', 20, 400, 120)])).toBeNull();
  });

  it('sem data que dê para ler, nada', () => {
    expect(readBillDate([item('Shipped on Board', 185.8, 56.4, 56), item('05/11/2026', 185.8, 40.3, 47.6)])).toBeNull();
    expect(readBillDate([])).toBeNull();
  });

  it('data fora do razoável é erro de leitura', () => {
    expect(billDateProblem('2026-11-28', '2026-11-26')).toBeNull();
    expect(billDateProblem('2025-12-01', '2026-11-26')).toBeNull();
    expect(billDateProblem('2027-03-01', '2026-11-26')).toBe('A data lida no BL (01/03/2027) parece errada: confira e informe a chegada prevista.');
    expect(billDateProblem('2025-11-01', '2026-11-26')).toMatch(/^A data lida no BL \(01\/11\/2025\)/);
  });
});

describe('a chegada prevista pelo BL', () => {
  it('a data do BL mais o prazo, 35 dias por padrão', () => {
    expect(ARRIVAL_DAYS_DEFAULT).toBe(35);
    expect(arrivalFromBill('2026-11-28', ARRIVAL_DAYS_DEFAULT)).toBe('2027-01-02');
    expect(arrivalText('2026-11-28', 35)).toBe('35 dias depois, em 02/01/2027');
    expect(arrivalText('2026-11-28', 1)).toBe('1 dia depois, em 29/11/2026');
    expect(billDateText({ date: '2026-11-28', source: 'embarque' })).toBe('Data do BL: 28/11/2026, do embarque a bordo.');
    expect(billDateText({ date: '2026-11-28', source: 'emissao' })).toBe('Data do BL: 28/11/2026, da emissão do BL.');
  });

  it('o prazo é um número inteiro de dias, de 1 a 120', () => {
    expect(arrivalDaysProblem(35)).toBeNull();
    expect(arrivalDaysProblem(1)).toBeNull();
    expect(arrivalDaysProblem(120)).toBeNull();
    for (const n of [0, 121, 2.5, Number.NaN, -3]) expect(arrivalDaysProblem(n), String(n)).toBe('Informe o prazo em dias, um número inteiro de 1 a 120.');
  });
});
