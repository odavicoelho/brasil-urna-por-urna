// Folha de baixo do celular, como no Mapas da Apple: três alturas (mini, meio, cheia), segue o dedo,
// encaixa na altura mais próxima levando em conta a velocidade e resiste um pouco além dos limites.
// Com a folha cheia, o conteúdo rola; puxar para baixo com o conteúdo no topo desce a folha.
// No computador o painel é uma barra lateral fixa (só CSS) e nada disto roda.

export type Altura = "mini" | "meio" | "cheia";

const computador = window.matchMedia("(min-width: 900px)");

export interface Painel {
  ir(a: Altura): void;
  altura(): Altura;
  /** Quantos pixels da folha aparecem na tela (para o mapa não esconder nada atrás dela). */
  visivel(a?: Altura): number;
  aoMudar(f: (a: Altura) => void): void;
}

export function criarPainel(el: HTMLElement, rolagem: HTMLElement, fimDoMini: () => HTMLElement | null): Painel {
  let atual: Altura = "mini";
  const ouvintes: ((a: Altura) => void)[] = [];
  const seguroBaixo = () => {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--seguro-baixo");
    return parseFloat(v) || 0;
  };

  const H = () => el.offsetHeight;
  function visivel(a: Altura = atual): number {
    if (computador.matches) return 0;
    if (a === "cheia") return H();
    if (a === "meio") return Math.round(Math.min(H(), (el.parentElement?.clientHeight ?? innerHeight) * 0.52));
    const fim = fimDoMini();
    // offsetTop é relativo ao painel (o primeiro ancestral posicionado)
    const ate = fim ? fim.offsetTop + fim.offsetHeight + 14 : 150;
    return Math.round(ate + seguroBaixo());
  }
  const yDe = (a: Altura) => H() - visivel(a);

  function posicionar(y: number) {
    el.style.setProperty("--painel-y", `${Math.round(y)}px`);
    document.documentElement.style.setProperty("--painel-visivel", `${Math.max(0, Math.round(H() - y))}px`);
  }

  function ir(a: Altura) {
    if (computador.matches) return;
    const mudou = a !== atual;
    atual = a;
    posicionar(yDe(a));
    // Fora da altura cheia o conteúdo não rola: arrastar em qualquer lugar move a folha.
    rolagem.style.overflowY = a === "cheia" ? "auto" : "hidden";
    if (a !== "cheia") rolagem.scrollTop = 0;
    if (mudou) ouvintes.forEach((f) => f(a));
  }

  // ---------- Arrastar ----------
  let inicio: { y: number; x: number; base: number; arrastando: boolean } | null = null;
  const historico: { y: number; t: number }[] = [];

  function comecar(x: number, y: number) {
    inicio = { x, y, base: yDe(atual), arrastando: false };
    historico.length = 0;
  }

  function mover(x: number, y: number, ev: Event, alvo: EventTarget | null): void {
    if (!inicio) return;
    const dy = y - inicio.y;
    if (!inicio.arrastando) {
      if (Math.abs(dy) < 6 || Math.abs(dy) < Math.abs(x - inicio.x)) return;
      const noConteudo = rolagem.contains(alvo as Node);
      // Folha cheia: o conteúdo rola, a não ser que esteja no topo e o dedo desça.
      if (atual === "cheia" && noConteudo && (rolagem.scrollTop > 0 || dy < 0)) {
        inicio = null;
        return;
      }
      inicio.arrastando = true;
      el.classList.add("arrastando");
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    if (ev.cancelable) ev.preventDefault();
    let alvoY = inicio.base + dy;
    const max = yDe("mini");
    // Resistência além dos limites (como o elástico do iOS)
    if (alvoY < 0) alvoY = -Math.sqrt(-alvoY) * 3;
    if (alvoY > max) alvoY = max + Math.sqrt(alvoY - max) * 3;
    posicionar(alvoY);
    historico.push({ y: alvoY, t: performance.now() });
    if (historico.length > 6) historico.shift();
  }

  function soltar() {
    if (!inicio) return;
    const estava = inicio.arrastando;
    inicio = null;
    el.classList.remove("arrastando");
    if (!estava) return;
    const a = historico[0];
    const b = historico[historico.length - 1];
    const v = a && b && b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0; // px/ms, positivo = descendo
    const projetado = (b?.y ?? yDe(atual)) + v * 220;
    const opcoes: Altura[] = ["cheia", "meio", "mini"];
    let melhor: Altura = atual;
    let d = Infinity;
    for (const o of opcoes) {
      const dd = Math.abs(yDe(o) - projetado);
      if (dd < d) {
        d = dd;
        melhor = o;
      }
    }
    ir(melhor);
  }

  el.addEventListener("touchstart", (ev) => comecar(ev.touches[0].clientX, ev.touches[0].clientY), { passive: true });
  el.addEventListener("touchmove", (ev) => mover(ev.touches[0].clientX, ev.touches[0].clientY, ev, ev.target), { passive: false });
  el.addEventListener("touchend", soltar);
  el.addEventListener("touchcancel", soltar);
  // Mouse (testes e telas de toque pequenas com mouse)
  el.addEventListener("mousedown", (ev) => !computador.matches && comecar(ev.clientX, ev.clientY));
  window.addEventListener("mousemove", (ev) => inicio && mover(ev.clientX, ev.clientY, ev, ev.target));
  window.addEventListener("mouseup", soltar);

  // Toque na alça alterna entre meio e cheia.
  el.querySelector(".alca")?.addEventListener("click", () => ir(atual === "cheia" ? "meio" : atual === "meio" ? "cheia" : "meio"));

  window.addEventListener("resize", () => ir(atual));
  computador.addEventListener("change", () => {
    rolagem.style.overflowY = "auto";
    if (!computador.matches) ir(atual);
  });
  if (computador.matches) rolagem.style.overflowY = "auto";

  return {
    ir,
    altura: () => atual,
    visivel,
    aoMudar: (f) => ouvintes.push(f),
  };
}
