// Busca: municípios na hora (a lista já está carregada) e locais logo depois (busca.json, baixado só
// quando a pessoa abre a busca). No celular ocupa a tela toda; no computador desce sob a pílula.

import { loadBusca, type MunicipioInfo } from "./data";
import { escapeHtml, normalize, titleCase } from "./format";

const MAX_LOCAIS = 30;
const MAX_MUNICIPIOS = 5;

export interface Escolha {
  municipio?: number; // índice em municipios.json
  local?: number; // índice nos .bin
}

export function setupSearch(
  municipios: MunicipioInfo[],
  munDoLocal: () => Promise<Uint16Array>,
  aoEscolher: (e: Escolha) => void,
  pertoDeMim: () => void,
): { abrir: () => void; fechar: () => void } {
  const tela = document.querySelector<HTMLElement>("#busca")!;
  const campo = document.querySelector<HTMLInputElement>("#busca-campo")!;
  const lista = document.querySelector<HTMLUListElement>("#busca-resultados")!;
  const textosMun = municipios.map((m) => normalize(`${m[1]} ${m[2]}`));
  let indice: Promise<{ textos: string[]; nome: string[]; bairro: string[]; mun: Uint16Array }> | null = null;

  const preparar = () =>
    (indice ??= Promise.all([loadBusca(), munDoLocal()]).then(([b, mun]) => ({
      ...b,
      mun,
      textos: b.nome.map((n, i) => {
        const m = municipios[mun[i]];
        return normalize(`${n} ${b.bairro[i]} ${m[1]} ${m[2]}`);
      }),
    })));

  function abrir() {
    tela.hidden = false;
    campo.focus();
    campo.select();
    void preparar();
    render();
  }

  function fechar() {
    tela.hidden = true;
    campo.blur();
  }

  const item = (attr: string, titulo: string, sub: string) =>
    `<li><button type="button" ${attr}><strong>${escapeHtml(titulo)}</strong><span>${escapeHtml(sub)}</span></button></li>`;

  let geracao = 0;
  async function render() {
    const g = ++geracao;
    const termos = normalize(campo.value).split(/\s+/).filter((t) => t.length > 1);
    if (!termos.length) {
      lista.innerHTML = '<li class="vazio">Digite o nome da escola, do bairro ou da cidade.</li>';
      return;
    }
    const casa = (t: string) => termos.every((x) => t.includes(x));
    const muns: number[] = [];
    for (let i = 0; i < textosMun.length && muns.length < MAX_MUNICIPIOS; i++) if (casa(textosMun[i])) muns.push(i);
    const htmlMun = muns.length
      ? '<li class="grupo">Cidades</li>' +
        muns.map((i) => item(`data-mun="${i}"`, titleCase(municipios[i][1]), municipios[i][2])).join("")
      : "";
    lista.innerHTML = htmlMun + '<li class="grupo">Locais de votação</li><li class="vazio">Procurando…</li>';

    const idx = await preparar();
    if (g !== geracao) return; // a pessoa já digitou outra coisa
    const achados: number[] = [];
    for (let i = 0; i < idx.textos.length && achados.length < MAX_LOCAIS; i++) if (casa(idx.textos[i])) achados.push(i);
    const htmlLocais = achados.length
      ? achados
          .map((i) => {
            const m = municipios[idx.mun[i]];
            const sub = [titleCase(idx.bairro[i]), `${titleCase(m[1])} – ${m[2]}`].filter(Boolean).join(" · ");
            return item(`data-local="${i}"`, titleCase(idx.nome[i]), sub);
          })
          .join("")
      : '<li class="vazio">Nenhum local encontrado.</li>';
    lista.innerHTML = htmlMun + '<li class="grupo">Locais de votação</li>' + htmlLocais;
  }

  let timer = 0;
  campo.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(render, 120);
  });
  campo.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") lista.querySelector<HTMLButtonElement>("button")?.click();
  });

  lista.addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    fechar();
    if (b.dataset.mun) aoEscolher({ municipio: Number(b.dataset.mun) });
    else if (b.dataset.local) aoEscolher({ local: Number(b.dataset.local) });
  });

  document.querySelector("#abrir-busca")!.addEventListener("click", abrir);
  document.querySelector("#busca-voltar")!.addEventListener("click", fechar);
  document.querySelector("#busca-perto")!.addEventListener("click", () => {
    fechar();
    pertoDeMim();
  });
  tela.addEventListener("keydown", (ev) => ev.key === "Escape" && fechar());

  return { abrir, fechar };
}
