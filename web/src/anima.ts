// Pequenas animações: números que contam até o valor e barras que crescem ao aparecer.

const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)");
const suave = (t: number) => 1 - (1 - t) ** 3;

/** Conta de 0 até o valor de cada elemento com data-conta (e data-casas para decimais). */
export function contar(raiz: ParentNode, duracao = 750): void {
  const els = [...raiz.querySelectorAll<HTMLElement>("[data-conta]")];
  if (!els.length || reduzido.matches) return;
  const alvos = els.map((el) => ({
    el,
    valor: Number(el.dataset.conta),
    casas: Number(el.dataset.casas ?? 1),
    sufixo: el.dataset.sufixo ?? "%",
  }));
  const fmt = (v: number, casas: number) =>
    v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const t0 = performance.now();
  const passo = (t: number) => {
    const p = Math.min(1, (t - t0) / duracao);
    for (const a of alvos) a.el.textContent = `${fmt(a.valor * suave(p), a.casas)}${a.sufixo}`;
    if (p < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

/** Elementos com data-revela aparecem da esquerda para a direita (transição de clip-path no CSS). */
export function revelar(raiz: ParentNode): void {
  if (reduzido.matches) return;
  const els = [...raiz.querySelectorAll<HTMLElement>("[data-revela]")];
  els.forEach((el) => el.classList.add("escondido"));
  requestAnimationFrame(() => requestAnimationFrame(() => els.forEach((el) => el.classList.remove("escondido"))));
}
