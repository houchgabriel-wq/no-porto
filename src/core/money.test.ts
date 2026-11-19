import { describe, expect, it } from 'vitest';
import {
  formatUnitPrice,
  formatUsd,
  formatUsdShort,
  formatUsdWhole,
  isValidUnitPrice,
  itemTotalCents,
  looksLikeReais,
  parseCents,
  parseExchangeRate,
  parseMoneyCents,
  parseSheetUnitPrice,
  parseUnitPrice,
  reaisCents,
  roundUnitPrice,
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
    expect(parseUnitPrice('0.1234')).toBeNull();
    expect(parseUnitPrice('0.5800000')).toBe(580_000);
  });

  it('preço com no máximo três casas', () => {
    expect(isValidUnitPrice(575_000)).toBe(true);
    expect(isValidUnitPrice(653_924)).toBe(false);
    expect(isValidUnitPrice(-1000)).toBe(false);
    expect(roundUnitPrice(653_924)).toBe(654_000);
    expect(roundUnitPrice(395_749)).toBe(396_000);
    expect(roundUnitPrice(478_500)).toBe(479_000);
    expect(roundUnitPrice(575_000)).toBe(575_000);
  });

  it('da planilha, arredonda na terceira casa, avisando', () => {
    expect(parseSheetUnitPrice('0.653924268502582')).toEqual({ micros: 654_000, rounded: true });
    expect(parseSheetUnitPrice('0.395748709122203')).toEqual({ micros: 396_000, rounded: true });
    expect(parseSheetUnitPrice('0.9995')).toEqual({ micros: 1_000_000, rounded: true });
    expect(parseSheetUnitPrice('0.4785')).toEqual({ micros: 479_000, rounded: true });
    expect(parseSheetUnitPrice('0.575')).toEqual({ micros: 575_000, rounded: false });
    expect(parseSheetUnitPrice('R$2,06')).toBeNull();
  });

  it('reconhece preço em reais', () => {
    expect(looksLikeReais('R$2,06')).toBe(true);
    expect(looksLikeReais(' r$ 10,00')).toBe(true);
    expect(looksLikeReais('2.06')).toBe(false);
  });
});

describe('valor em dólar digitado', () => {
  it('ponto ou vírgula seguidos de três dígitos separam os milhares', () => {
    expect(parseMoneyCents('12.300')).toBe(1_230_000);
    expect(parseMoneyCents('12,300')).toBe(1_230_000);
    expect(parseMoneyCents('2.850')).toBe(285_000);
    expect(parseMoneyCents('1.000')).toBe(100_000);
    expect(parseMoneyCents('1.234.567')).toBe(123_456_700);
    expect(parseMoneyCents('1,234,567')).toBe(123_456_700);
    expect(parseMoneyCents('US$ 12.300')).toBe(1_230_000);
    expect(parseMoneyCents(' 12.300 ')).toBe(1_230_000);
  });

  it('com centavos, decimal ou sem separador, como a leitura comum', () => {
    expect(parseMoneyCents('12.300,50')).toBe(1_230_050);
    expect(parseMoneyCents('12,300.50')).toBe(1_230_050);
    expect(parseMoneyCents('12.300,00')).toBe(1_230_000);
    expect(parseMoneyCents('2,85')).toBe(285);
    expect(parseMoneyCents('12.30')).toBe(1_230);
    expect(parseMoneyCents('0,5')).toBe(50);
    expect(parseMoneyCents('US$ 1.234,56')).toBe(123_456);
    expect(parseMoneyCents('12300')).toBe(1_230_000);
  });

  it('um primeiro grupo zero não é de milhar', () => {
    expect(parseMoneyCents('0,500')).toBe(50);
    expect(parseMoneyCents('0.500')).toBe(50);
    expect(parseMoneyCents('0,050')).toBe(5);
  });

  it('o que não é valor', () => {
    for (const t of ['', 'abc', '-12.300', '1.234,567', '0,123', 'R$ 12.300', '12.300 reais']) expect(parseMoneyCents(t), t).toBeNull();
  });

  it('a leitura comum, a das planilhas, continua a mesma', () => {
    expect(parseCents('12.300')).toBe(1_230);
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
    // 3 × 0,335 = 1,005 → 1,01 (meio para cima)
    expect(itemTotalCents(3, 335_000)).toBe(101);
    // 7 × 0,001 = 0,007 → 0,01
    expect(itemTotalCents(7, 1_000)).toBe(1);
    // 30.000 × 0,654 = 19.620,00
    expect(itemTotalCents(30_000, 654_000)).toBe(1_962_000);
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

  it('dólares inteiros para o destaque', () => {
    expect(formatUsdWhole(304_205_646)).toBe('US$ 3.042.056');
    expect(formatUsdWhole(3_192_960)).toBe('US$ 31.930');
    expect(formatUsdWhole(0)).toBe('US$ 0');
  });

  it('forma curta', () => {
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
