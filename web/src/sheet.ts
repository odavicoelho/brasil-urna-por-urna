// Folha de baixo do celular: abre pela metade (placar e botão de compartilhar à vista), arrasta para cima
// para ver tudo, arrasta para baixo para fechar. No computador vira painel lateral fixo (só CSS).

const computador = window.matchMedia("(min-width: 900px)");

export interface Folha {
  abrir(): void;
  fechar(): void;
  aberta(): boolean;
}

export function criarFolha(el: HTMLElement, conteudo: HTMLElement, aoFechar: () => void): Folha {
  let estado: "fechada" | "meio" | "cheia" = "fechada";

  const altura = () => el.offsetHeight;
  // Quanto da folha aparece no meio: o suficiente para o placar e o botão de compartilhar.
  const yMeio = () => Math.max(0, altura() - Math.min(450, Math.round(window.innerHeight * 0.6)));
  const posicao = (y: number) => el.style.setProperty("--folha-y", `${Math.round(y)}px`);

  function ir(novo: "meio" | "cheia") {
    estado = novo;
    posicao(novo === "cheia" ? 0 : yMeio());
  }

  function abrir() {
    document.body.classList.add("com-folha");
    if (estado === "fechada") {
      el.hidden = false;
      posicao(altura()); // começa escondida embaixo e sobe
      void el.offsetHeight;
      requestAnimationFrame(() => ir("meio"));
    } else if (!computador.matches && estado === "cheia") {
      ir("meio");
    }
    conteudo.scrollTop = 0;
  }

  function fechar() {
    if (estado === "fechada") return;
    estado = "fechada";
    document.body.classList.remove("com-folha");
    if (computador.matches) {
      el.hidden = true;
    } else {
      posicao(altura());
      setTimeout(() => estado === "fechada" && (el.hidden = true), 280);
    }
    aoFechar();
  }

  // Arrastar pela alça ou pelo título do local.
  let inicio: { y: number; base: number; t: number } | null = null;
  el.addEventListener("pointerdown", (ev) => {
    if (computador.matches || !(ev.target as HTMLElement).closest("#folha-alca, .local-topo")) return;
    inicio = { y: ev.clientY, base: estado === "cheia" ? 0 : yMeio(), t: performance.now() };
    el.classList.add("arrastando");
    el.setPointerCapture(ev.pointerId);
  });
  el.addEventListener("pointermove", (ev) => {
    if (!inicio) return;
    posicao(Math.min(altura(), Math.max(0, inicio.base + ev.clientY - inicio.y)));
  });
  const soltar = (ev: PointerEvent) => {
    if (!inicio) return;
    const dy = ev.clientY - inicio.y;
    const rapido = Math.abs(dy) / Math.max(1, performance.now() - inicio.t) > 0.5;
    const y = inicio.base + dy;
    inicio = null;
    el.classList.remove("arrastando");
    if (Math.abs(dy) < 6) {
      // toque na alça: alterna
      if ((ev.target as HTMLElement).closest("#folha-alca")) ir(estado === "cheia" ? "meio" : "cheia");
      else ir(estado as "meio" | "cheia");
      return;
    }
    if (dy > 0 && (y > yMeio() + 90 || (rapido && estado === "meio"))) fechar();
    else if (dy > 0) ir("meio");
    else ir("cheia");
  };
  el.addEventListener("pointerup", soltar);
  el.addEventListener("pointercancel", soltar);

  // Rolar o conteúdo com a folha pela metade: sobe a folha inteira (senão o fim fica fora da tela).
  conteudo.addEventListener("scroll", () => {
    if (!computador.matches && estado === "meio" && conteudo.scrollTop > 4) ir("cheia");
  });

  window.addEventListener("resize", () => {
    if (estado !== "fechada" && !computador.matches) ir(estado);
  });

  return { abrir, fechar, aberta: () => estado !== "fechada" };
}
