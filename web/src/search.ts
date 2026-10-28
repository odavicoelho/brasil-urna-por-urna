// Busca dentro do painel: cidades na hora (a lista já está carregada) e locais logo depois (busca.json,
// baixado só quando a pessoa toca no campo). Tocar no campo abre a folha inteira, como no Mapas da Apple.

import { loadBusca, type MunicipioInfo } from "./data";
import { escapeHtml, normalize, titleCase } from "./format";

const MAX_LOCAIS = 30;
const MAX_MUNICIPIOS = 4;

export interface Escolha {
  municipio?: number; // índice em municipios.json
  local?: number; // índice nos .bin
}

const PIN =
  '<span class="icone" style="background:#ff3b30"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11Z"/><circle cx="12" cy="10" r="2.2"/></svg></span>';
const CIDADE =
  '<span class="icone" style="background:#8e8e93"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V9l5-3v15M9 21V4l7 3v14M16 21v-9l4 2v7M3 21h18"/></svg></span>';
const PERTO =
  '<span class="icone" style="background:#1c1c1e"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5 3.8 10.4a.6.6 0 0 0 .05 1.13l6.6 2.02 2.02 6.6a.6.6 0 0 0 1.13.05L20.5 3.5Z"/></svg></span>';

export function setupSearch(opcoes: {
  municipios: MunicipioInfo[];
  munDoLocal: () => Promise<Uint16Array>;
  aoAbrir: () => void;
  aoFechar: () => void;
  aoEscolher: (e: Escolha) => void;
  pertoDeMim: () => void;
}): { fechar: () => void } {
  const { municipios } = opcoes;
  const campo = document.querySelector<HTMLInputElement>("#busca-campo")!;
  const cancelar = document.querySelector<HTMLButtonElement>("#busca-cancelar")!;
  const lista = document.querySelector<HTMLUListElement>("#busca-resultados")!;
  const textosMun = municipios.map((m) => normalize(`${m[1]} ${m[2]}`));
  let indice: Promise<{ textos: string[]; nome: string[]; bairro: string[]; mun: Uint16Array }> | null = null;
  let aberta = false;

  const preparar = () =>
    (indice ??= Promise.all([loadBusca(), opcoes.munDoLocal()]).then(([b, mun]) => ({
      ...b,
      mun,
      textos: b.nome.map((n, i) => {
        const m = municipios[mun[i]];
        return normalize(`${n} ${b.bairro[i]} ${m[1]} ${m[2]}`);
      }),
    })));

  function abrir() {
    if (aberta) return;
    aberta = true;
    cancelar.hidden = false;
    void preparar();
    render();
    opcoes.aoAbrir();
  }

  function fechar() {
    if (!aberta) return;
    aberta = false;
    cancelar.hidden = true;
    campo.value = "";
    campo.blur();
    opcoes.aoFechar();
  }

  const linha = (attr: string, icone: string, titulo: string, sub: string, i = 0) =>
    `<li style="animation-delay:${Math.min(i, 10) * 18}ms"><button class="linha" type="button" ${attr}>${icone}
      <span class="texto">${escapeHtml(titulo)}<small>${escapeHtml(sub)}</small></span></button></li>`;

  let geracao = 0;
  async function render() {
    const g = ++geracao;
    const termos = normalize(campo.value).split(/\s+/).filter((t) => t.length > 1);
    if (!termos.length) {
      lista.innerHTML = `<li><ul class="lista">${linha('data-perto="1"', PERTO, "Locais perto de mim", "Usa a localização do seu celular")}</ul></li>
        <li class="vazio">Digite o nome da escola, do bairro ou da cidade.</li>`;
      return;
    }
    const casa = (t: string) => termos.every((x) => t.includes(x));
    const muns: number[] = [];
    for (let i = 0; i < textosMun.length && muns.length < MAX_MUNICIPIOS; i++) if (casa(textosMun[i])) muns.push(i);
    const blocoMun = muns.length
      ? `<li class="grupo">Cidades</li><li><ul class="lista">${muns
          .map((i, k) => linha(`data-mun="${i}"`, CIDADE, titleCase(municipios[i][1]), municipios[i][2], k))
          .join("")}</ul></li>`
      : "";
    lista.innerHTML = `${blocoMun}<li class="grupo">Locais de votação</li><li class="vazio"><span class="girando" style="display:inline-block;vertical-align:-2px"></span></li>`;

    const idx = await preparar();
    if (g !== geracao) return; // a pessoa já digitou outra coisa
    const achados: number[] = [];
    for (let i = 0; i < idx.textos.length && achados.length < MAX_LOCAIS; i++) if (casa(idx.textos[i])) achados.push(i);
    const blocoLocais = achados.length
      ? `<li><ul class="lista">${achados
          .map((i, k) => {
            const m = municipios[idx.mun[i]];
            const sub = [titleCase(idx.bairro[i]), `${titleCase(m[1])} – ${m[2]}`].filter(Boolean).join(" · ");
            return linha(`data-local="${i}"`, PIN, titleCase(idx.nome[i]), sub, k + muns.length);
          })
          .join("")}</ul></li>`
      : '<li class="vazio">Nenhum local encontrado.</li>';
    lista.innerHTML = `${blocoMun}<li class="grupo">Locais de votação</li>${blocoLocais}`;
  }

  let timer = 0;
  campo.addEventListener("focus", abrir);
  campo.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(render, 120);
  });
  campo.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      lista.querySelector<HTMLButtonElement>("button[data-mun], button[data-local]")?.click();
      campo.blur();
    }
    if (ev.key === "Escape") fechar();
  });
  cancelar.addEventListener("click", fechar);

  lista.addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.dataset.perto) {
      fechar();
      return opcoes.pertoDeMim();
    }
    const escolha: Escolha = b.dataset.mun ? { municipio: Number(b.dataset.mun) } : { local: Number(b.dataset.local) };
    aberta = false;
    cancelar.hidden = true;
    campo.value = "";
    campo.blur();
    opcoes.aoEscolher(escolha);
  });

  return { fechar };
}
