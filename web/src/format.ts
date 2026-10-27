const inteiro = new Intl.NumberFormat("pt-BR");
const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const real = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export const num = (n: number | null | undefined) => (n == null ? "—" : inteiro.format(n));
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${decimal.format(n)}%`);
export const brl = (n: number | null | undefined) => (n == null ? "—" : real.format(n));
export const share = (part: number, total: number) => (total > 0 ? (100 * part) / total : 0);

// "ESCOLA ESTADUAL JOÃO DE DEUS" -> "Escola Estadual João de Deus"
const LOWER = new Set(["de", "da", "do", "das", "dos", "e", "em", "na", "no"]);
export function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && LOWER.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Para a busca: sem acento, minúsculo.
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
