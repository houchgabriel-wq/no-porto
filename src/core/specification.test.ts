import { describe, expect, it } from 'vitest';
import { cleanSpecification, isReprintSpecification, latestSpecification } from './specification';

describe('cleanSpecification', () => {
  it('mantém as linhas, tira espaços sobrando e linhas vazias repetidas', () => {
    expect(cleanSpecification('  20,5x27,5\r\nwire-o   binding \n\n\n\n1 pen + 3 refill  ')).toBe('20,5x27,5\nwire-o binding\n\n1 pen + 3 refill');
    expect(cleanSpecification('x'.repeat(5000))).toHaveLength(4000);
  });
});

describe('isReprintSpecification', () => {
  it('reconhece a reimpressão que só remete à compra anterior', () => {
    expect(isReprintSpecification('REPRINT — same specs as last order (2026-08-27 (3))')).toBe(true);
    expect(isReprintSpecification('reprint')).toBe(true);
    expect(isReprintSpecification('Same specs as PO-050')).toBe(true);
    expect(isReprintSpecification('25x25cm cover 300gsm C1S 4/4c')).toBe(false);
  });
});

describe('latestSpecification', () => {
  it('a mais recente que não é só "reprint"', () => {
    const items = [
      { specification: '20,5x27,5 wire-o', createdAt: '2026-01-10T00:00:00Z', orderCode: 'PO-040' },
      { specification: '21x28 wire-o, 16p', createdAt: '2026-08-27T00:00:00Z', orderCode: 'PO-055' },
      { specification: 'REPRINT — same specs as last order', createdAt: '2026-11-09T00:00:00Z', orderCode: 'PO-064' },
      { specification: '', createdAt: '2026-11-10T00:00:00Z', orderCode: null },
    ];
    expect(latestSpecification(items)).toEqual(items[1]);
    expect(latestSpecification([items[2]!, items[3]!])).toBeNull();
  });
});
