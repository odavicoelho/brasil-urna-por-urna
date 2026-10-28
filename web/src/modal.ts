// Cartões que sobem por cima do mapa (Renda e voto, Como foi feito, Camadas). Enquanto um está aberto, o
// app atrás encolhe e escurece, como as folhas do iOS. Fecha pelo X, tocando fora, Esc ou puxando o topo.

import { ICONE } from "./panel";

const fundo = document.querySelector<HTMLElement>("#fundo-modal")!;
let aberto: { el: HTMLElement; aoFechar?: () => void } | null = null;

export interface Modal {
  abrir(): void;
  fechar(): void;
  corpo: HTMLElement;
}

export function criarModal(el: HTMLElement, titulo: string, aoFechar?: () => void): Modal {
  el.innerHTML = `
    <header class="modal-topo"><h2>${titulo}</h2>
      <button class="fechar" type="button" aria-label="Fechar">${ICONE.fechar}</button></header>
    <div class="modal-corpo"></div>`;
  const corpo = el.querySelector<HTMLElement>(".modal-corpo")!;
  corpo.addEventListener("scroll", () => el.classList.toggle("rolou", corpo.scrollTop > 44), { passive: true });

  function abrir() {
    if (aberto?.el === el) return;
    if (aberto) fecharAtual(false);
    aberto = { el, aoFechar };
    el.hidden = false;
    fundo.hidden = false;
    void el.offsetHeight; // força o layout para a transição começar de baixo
    document.body.classList.add("com-modal");
    el.classList.add("aberto");
    el.style.transform = "";
    corpo.scrollTop = 0;
  }

  function fechar() {
    if (aberto?.el === el) fecharAtual(true);
  }

  el.querySelector(".fechar")!.addEventListener("click", fechar);

  // Puxar o topo para baixo fecha (o cartão acompanha o dedo).
  const topo = el.querySelector<HTMLElement>(".modal-topo")!;
  let y0: number | null = null;
  let dy = 0;
  topo.addEventListener("touchstart", (ev) => {
    y0 = ev.touches[0].clientY;
    dy = 0;
    el.style.transition = "none";
  });
  topo.addEventListener(
    "touchmove",
    (ev) => {
      if (y0 == null) return;
      dy = Math.max(0, ev.touches[0].clientY - y0);
      el.style.transform = `translateY(${dy}px)`;
      ev.preventDefault();
    },
    { passive: false },
  );
  topo.addEventListener("touchend", () => {
    el.style.transition = "";
    y0 = null;
    if (dy > 110) fechar();
    else el.style.transform = "";
  });

  return { abrir, fechar, corpo };
}

function fecharAtual(avisar: boolean) {
  if (!aberto) return;
  const { el, aoFechar } = aberto;
  aberto = null;
  el.classList.remove("aberto");
  el.style.transform = "";
  document.body.classList.remove("com-modal");
  setTimeout(() => {
    if (!el.classList.contains("aberto")) el.hidden = true;
    if (!aberto) fundo.hidden = true;
  }, 500);
  if (avisar) aoFechar?.();
}

fundo.addEventListener("click", () => fecharAtual(true));
document.addEventListener("keydown", (ev) => ev.key === "Escape" && fecharAtual(true));

export const modalAberto = () => aberto !== null;

/** Fecha o cartão aberto sem avisar quem abriu (usado pelas rotas, que já sabem para onde vão). */
export const fecharModais = () => fecharAtual(false);
