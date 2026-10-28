const inteiro = new Intl.NumberFormat("pt-BR");
const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const real = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export const num = (n: number | null | undefined) => (n == null ? "—" : inteiro.format(n));
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${decimal.format(n)}%`);
export const brl = (n: number | null | undefined) => (n == null ? "—" : real.format(n));
export const share = (part: number, total: number) => (total > 0 ? (100 * part) / total : 0);

// "ESCOLA ESTADUAL JOÃO DE DEUS" -> "Escola Estadual João de Deus"; "EMEF" e "PUC" continuam em maiúsculas.
const LOWER = new Set(["de", "da", "do", "das", "dos", "e", "em", "na", "no"]);
// Siglas com vogal que aparecem muito nos nomes dos locais (as sem vogal, como PSF e CTG, já ficam em maiúsculas).
const SIGLAS = new Set(
  "emef emei emeb cmei ciep cei cemei caic sesi apae senai sesc etec ceu puc uneb cefet ifba ufba uepa unesp ufpa ifpa usp ufrj ufmg eeef eef eeefm ee ii iii iv vi vii viii ix xi xii xx".split(" "),
);
// Abreviações sem vogal que não são siglas: Dr., Sr., Jr., Km...
const ABREVIACOES = new Set(["dr", "sr", "jr", "jd", "st", "km", "pq", "vl", "bl", "pc", "pca", "nsa", "nsra"]);
function palavra(w: string, i: number): string {
  if (i > 0 && LOWER.has(w)) return w;
  const nucleo = w.replace(/[^a-zà-ú]/g, "");
  if (SIGLAS.has(nucleo) || (nucleo.length >= 2 && nucleo.length <= 5 && !/[aeiouáéíóúâêôãõà]/.test(nucleo) && !ABREVIACOES.has(nucleo))) {
    return w.toUpperCase();
  }
  return w.charAt(0).toUpperCase() + w.slice(1);
}
export function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().split(/\s+/).map(palavra).join(" ");
}

/** "no Rio de Janeiro", "em São Paulo" */
const COM_ARTIGO: Record<string, string> = { "RIO DE JANEIRO": "no", RECIFE: "no" };
export const emCidade = (municipio: string) => `${COM_ARTIGO[municipio] ?? "em"} ${titleCase(municipio)}`;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Para a busca: sem acento, minúsculo.
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
