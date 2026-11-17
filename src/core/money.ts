// Dinheiro sem ponto flutuante (SPEC.md, seção 6): dólar em centavos, preço unitário em milionésimos
// de dólar (a planilha tem preços como 0,575 e 2,674) e câmbio multiplicado por 10.000.

/** Casas decimais aceitas no preço unitário. */
export const PRICE_DECIMALS = 6;

/**
 * Lê um número escrito à mão ou vindo da planilha ("0.575", "0,575", "1.234,56", "1,234.56", "US$ 2.80")
 * e devolve o valor multiplicado por 10^decimals, sem passar por ponto flutuante. Devolve null quando o
 * texto não é um número, é negativo ou tem mais casas do que o permitido.
 */
export function parseScaled(text: string, decimals: number, opts: { round?: boolean } = {}): number | null {
  let t = text.trim().replace(/^US\$|^\$|^USD/i, '').replace(/\s/g, '');
  if (!t || !/^[\d.,]+$/.test(t)) return null;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  let intPart: string;
  let fracPart = '';
  if (lastDot >= 0 && lastComma >= 0) {
    // Os dois aparecem: o último é o separador decimal; o outro, de milhar.
    const dec = Math.max(lastDot, lastComma);
    intPart = t.slice(0, dec).replace(/[.,]/g, '');
    fracPart = t.slice(dec + 1);
  } else {
    const sep = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : '';
    const parts = sep ? t.split(sep) : [t];
    if (parts.length > 2) {
      // "1.234.567": só separador de milhar.
      intPart = parts.join('');
    } else {
      intPart = parts[0]!;
      fracPart = parts[1] ?? '';
    }
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart) || (intPart === '' && fracPart === '')) return null;
  // Zeros sobrando no fim não contam como casas a mais (0.5800 vale 0.58).
  fracPart = fracPart.replace(/0+$/, '');
  // Casas a mais: recusa, ou arredonda na última casa aceita (meio para cima), quando pedido.
  let roundUp = 0;
  if (fracPart.length > decimals) {
    if (!opts.round) return null;
    roundUp = Number(fracPart[decimals]) >= 5 ? 1 : 0;
    fracPart = fracPart.slice(0, decimals);
  }
  const value = Number(intPart || '0') * 10 ** decimals + Number((fracPart + '0'.repeat(decimals)).slice(0, decimals) || '0') + roundUp;
  return Number.isSafeInteger(value) ? value : null;
}

/** Preço unitário em dólar → milionésimos. */
export function parseUnitPrice(text: string): number | null {
  return parseScaled(text, PRICE_DECIMALS);
}

/**
 * Preço unitário vindo da planilha, que às vezes tem um preço calculado com muitas casas
 * (0,653924268502582): arredonda para seis casas. `rounded` avisa que houve arredondamento.
 */
export function parseSheetUnitPrice(text: string): { micros: number; rounded: boolean } | null {
  const exact = parseScaled(text, PRICE_DECIMALS);
  if (exact !== null) return { micros: exact, rounded: false };
  const micros = parseScaled(text, PRICE_DECIMALS, { round: true });
  return micros === null ? null : { micros, rounded: true };
}

/** Valor em dólar → centavos. */
export function parseCents(text: string): number | null {
  return parseScaled(text, 2);
}

/** Taxa de câmbio (reais por dólar) → inteiro com quatro casas. */
export function parseExchangeRate(text: string): number | null {
  const v = parseScaled(text, 4);
  return v === null || v === 0 ? null : v;
}

/** O texto é um valor em reais ("R$2,06")? A planilha tem alguns preços assim. */
export function looksLikeReais(text: string): boolean {
  return /^\s*R\$/i.test(text);
}

/** Total do item em centavos: quantidade × preço unitário, arredondado ao centavo. */
export function itemTotalCents(quantity: number, unitPriceMicros: number): number {
  // milionésimos → centavos: divide por 10.000. Quantidade e preço cabem com folga num inteiro seguro.
  return Math.round((quantity * unitPriceMicros) / 10_000);
}

/** Valor em reais de um pagamento: dólar × câmbio, em centavos de real. */
export function reaisCents(amountCents: number, exchangeRateE4: number): number {
  return Math.round((amountCents * exchangeRateE4) / 10_000);
}

const usd = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdShort = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const usdWhole = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** Dólares inteiros, para os números em destaque: "US$ 3.042.056". */
export function formatUsdWhole(cents: number): string {
  return `US$ ${usdWhole.format(Math.round(cents / 100))}`;
}

/** "US$ 3.450,00". */
export function formatUsd(cents: number): string {
  return `US$ ${usd.format(cents / 100)}`;
}

/** Forma curta para números em destaque: "US$ 6,1 mi", "US$ 845 mil", "US$ 980". */
export function formatUsdShort(cents: number): string {
  const v = cents / 100;
  if (Math.abs(v) >= 1_000_000) return `US$ ${usdShort.format(v / 1_000_000)} mi`;
  if (Math.abs(v) >= 10_000) return `US$ ${Math.round(v / 1000).toLocaleString('pt-BR')} mil`;
  return `US$ ${Math.round(v).toLocaleString('pt-BR')}`;
}

/** Preço unitário com as casas que ele tem, no mínimo duas: "US$ 0,575", "US$ 2,80". */
export function formatUnitPrice(micros: number): string {
  const whole = Math.floor(micros / 1_000_000);
  let frac = String(micros % 1_000_000).padStart(PRICE_DECIMALS, '0').replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `US$ ${whole.toLocaleString('pt-BR')},${frac}`;
}

/** Preço unitário para editar num campo: "0,575". */
export function unitPriceInput(micros: number | null): string {
  if (micros === null) return '';
  return formatUnitPrice(micros).replace('US$ ', '').replace(/\./g, '');
}

const qty = new Intl.NumberFormat('pt-BR');

/** Quantidade de exemplares: "10.080". */
export function formatQuantity(n: number): string {
  return qty.format(n);
}
