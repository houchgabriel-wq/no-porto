import { describe, expect, it } from 'vitest';
import {
  formatUnitPrice,
  formatUsd,
  formatUsdShort,
  itemTotalCents,
  looksLikeReais,
  parseCents,
  parseExchangeRate,
  parseSheetUnitPrice,
  parseUnitPrice,
  reaisCents,
  unitPriceInput,
} from './money';

describe('preço unitário', () => {
  it('lê ponto ou vírgula como decimal, sem erro de arredondamento', () => {
    expect(parseUnitPrice('0.575')).toBe(575_000);
    expect(parseUnitPrice('0,575')).toBe(575_000);
    expect(parseUnitPrice('2.674')).toBe(2_674_000);
    expect(parseUnitPrice('0.33')).toBe(330_000);
    expect(parseUnitPrice('1')).toBe(1_000_000);
    expect(parseUnitPrice('US$ 2,80')).toBe(2_800_000);
    expect(parseUnitPrice('0.29')).toBe(290_000);
  });

  it('entende separador de milhar', () => {
    expect(parseCents('1.234,56')).toBe(123_456);
    expect(parseCents('1,234.56')).toBe(123_456);
    expect(parseCents('1.234.567')).toBe(123_456_700);
  });

  it('recusa o que não é preço', () => {
    expect(parseUnitPrice('')).toBeNull();
    expect(parseUnitPrice('R$2,06')).toBeNull();
    expect(parseUnitPrice('TBC')).toBeNull();
    expect(parseUnitPrice('-1')).toBeNull();
    expect(parseUnitPrice('0.1234567')).toBeNull();
    expect(parseUnitPrice('0.5800000')).toBe(580_000);
  });

  it('da planilha, arredonda preço calculado com muitas casas, avisando', () => {
    expect(parseSheetUnitPrice('0.653924268502582')).toEqual({ micros: 653_924, rounded: true });
    expect(parseSheetUnitPrice('0.395748709122203')).toEqual({ micros: 395_749, rounded: true });
    expect(parseSheetUnitPrice('0.9999995')).toEqual({ micros: 1_000_000, rounded: true });
    expect(parseSheetUnitPrice('0.575')).toEqual({ micros: 575_000, rounded: false });
    expect(parseSheetUnitPrice('R$2,06')).toBeNull();
  });

  it('reconhece preço em reais', () => {
    expect(looksLikeReais('R$2,06')).toBe(true);
    expect(looksLikeReais(' r$ 10,00')).toBe(true);
    expect(looksLikeReais('2.06')).toBe(false);
  });
});

describe('totais', () => {
  it('quantidade × preço, em centavos', () => {
    expect(itemTotalCents(6000, 575_000)).toBe(345_000);
    expect(itemTotalCents(9440, 330_000)).toBe(311_520);
    expect(itemTotalCents(1270, 1_630_000)).toBe(207_010);
    // 392 × 0,53 = 207,76
    expect(itemTotalCents(392, 530_000)).toBe(20_776);
  });

  it('arredonda ao centavo', () => {
    // 3 × 0,3335 = 1,0005 → 1,00
    expect(itemTotalCents(3, 333_500)).toBe(100);
    // 7 × 0,0015 = 0,0105 → 0,01
    expect(itemTotalCents(7, 1_500)).toBe(1);
  });

  it('valor em reais pelo câmbio do pagamento', () => {
    expect(parseExchangeRate('5,4321')).toBe(54_321);
    expect(parseExchangeRate('0')).toBeNull();
    expect(reaisCents(100_000, 54_321)).toBe(543_210);
  });
});

describe('formatos', () => {
  it('dólar com centavos', () => {
    expect(formatUsd(345_000)).toBe('US$ 3.450,00');
    expect(formatUsd(5)).toBe('US$ 0,05');
  });

  it('forma curta para o destaque', () => {
    expect(formatUsdShort(608_411_300)).toBe('US$ 6,1 mi');
    expect(formatUsdShort(84_512_300)).toBe('US$ 845 mil');
    expect(formatUsdShort(98_000)).toBe('US$ 980');
  });

  it('preço unitário com as casas que tem', () => {
    expect(formatUnitPrice(575_000)).toBe('US$ 0,575');
    expect(formatUnitPrice(2_800_000)).toBe('US$ 2,80');
    expect(formatUnitPrice(1_000_000)).toBe('US$ 1,00');
    expect(unitPriceInput(575_000)).toBe('0,575');
    expect(unitPriceInput(null)).toBe('');
  });
});
