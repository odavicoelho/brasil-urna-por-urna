// Busca por nome do local, bairro ou município. O índice só é baixado quando a pessoa usa a busca.

import { loadBusca, type Busca } from "./data";
import { escapeHtml, normalize, titleCase } from "./format";

const MAX = 12;

export function setupSearch(onPick: (index: number) => void): void {
  const campo = document.querySelector<HTMLInputElement>("#busca-campo")!;
  const lista = document.querySelector<HTMLUListElement>("#busca-resultados")!;
  let indice: { busca: Busca; textos: string[] } | null = null;

  async function preparar() {
    if (indice) return indice;
    const busca = await loadBusca();
    const textos = busca.nome.map((n, i) => normalize(`${n} ${busca.bairro[i]} ${busca.municipio[i]} ${busca.uf[i]}`));
    indice = { busca, textos };
    return indice;
  }

  campo.addEventListener("focus", () => void preparar(), { once: true });

  let timer = 0;
  campo.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const termos = normalize(campo.value).split(/\s+/).filter((t) => t.length > 1);
      if (termos.length === 0) {
        lista.hidden = true;
        return;
      }
      const { busca, textos } = await preparar();
      const achados: number[] = [];
      for (let i = 0; i < textos.length && achados.length < MAX; i++) {
        if (termos.every((t) => textos[i].includes(t))) achados.push(i);
      }
      lista.innerHTML = achados.length
        ? achados
            .map(
              (i) => `<li><button data-i="${i}">
                <strong>${escapeHtml(titleCase(busca.nome[i]))}</strong>
                <span>${escapeHtml([titleCase(busca.bairro[i]), `${titleCase(busca.municipio[i])} – ${busca.uf[i]}`].filter(Boolean).join(" · "))}</span>
              </button></li>`,
            )
            .join("")
        : '<li class="vazio">Nenhum local encontrado.</li>';
      lista.hidden = false;
    }, 150);
  });

  lista.addEventListener("click", (ev) => {
    const botao = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-i]");
    if (!botao) return;
    lista.hidden = true;
    campo.blur();
    onPick(Number(botao.dataset.i));
  });
}
