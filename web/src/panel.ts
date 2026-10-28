// Conteúdo da folha de um local de votação: placar do 2º turno no topo (o que cabe na tela ao abrir),
// depois comparação com o município e o Brasil, o 1º turno, o comparecimento e o entorno.

import type { Candidato, Entorno, Local, Meta, MunicipioInfo, Turno } from "./data";
import { brl, escapeHtml, num, pct, share, titleCase } from "./format";
import { NEUTRO, ROXO, VERDE } from "./layers";

const CINZA = "#8a8a8a";
export const ICONE_COMPARTILHAR =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';

export function nomeCurto(meta: Meta, numero: number): string {
  const c = meta.candidatos.find((x) => x.numero === numero);
  return c ? titleCase(c.nome) : `Nº ${numero}`;
}

function nomeCandidato(c: Candidato | undefined, numero: string): string {
  return c ? `${titleCase(c.nome)} (${c.partido})` : `Nº ${numero}`;
}

function corCandidato(meta: Meta, numero: number): string {
  const [a, b] = meta.segundo_turno;
  return numero === a ? ROXO[3] : numero === b ? VERDE[3] : CINZA;
}

function barra(rotulo: string, valor: number, total: number, cor: string): string {
  const p = share(valor, total);
  return `
    <div class="barra">
      <div class="barra-rotulo">
        <span>${escapeHtml(rotulo)}</span>
        <span><small>${num(valor)} ${valor === 1 ? "voto" : "votos"}</small> <strong>${pct(p)}</strong></span>
      </div>
      <div class="barra-fundo"><div style="width:${p.toFixed(2)}%;background:${cor}"></div></div>
    </div>`;
}

/** Barra dividida A | B (com 2px de respiro entre as partes). */
export function barraDividida(classe: string, va: number, vb: number): string {
  const total = va + vb;
  if (!total) return `<div class="${classe}"><div style="flex:1;background:${NEUTRO}"></div></div>`;
  return `<div class="${classe}">
    <div style="flex:${va};background:${ROXO[3]}"></div><div style="flex:${vb};background:${VERDE[3]}"></div>
  </div>`;
}

function placar(meta: Meta, t: Turno | undefined, mun: MunicipioInfo): string {
  const [na, nb] = meta.segundo_turno;
  if (!t) return '<p class="nota">Este local não teve votação no 2º turno.</p>';
  const va = t.votos?.[na] ?? 0;
  const vb = t.votos?.[nb] ?? 0;
  const br = meta.totais.find((x) => x.turno === 2)!;
  const bra = br.votos[na] ?? 0;
  const brb = br.votos[nb] ?? 0;
  const linha = (rotulo: string, a: number, b: number) => `
    <dt>${rotulo}</dt>
    <dd>${barraDividida("mini-barra", a, b)}</dd>
    <dd>${pct(share(a, a + b))} · ${pct(share(b, a + b))}</dd>`;
  return `
    <div class="placar">
      <p class="sobretitulo">2º turno · votos válidos</p>
      <div class="placar-nomes">
        <div><span style="color:${ROXO[3]}">${escapeHtml(nomeCurto(meta, na))}</span>
          <strong>${pct(share(va, va + vb))}</strong><small>${num(va)} ${va === 1 ? "voto" : "votos"}</small></div>
        <div><span style="color:${VERDE[3]}">${escapeHtml(nomeCurto(meta, nb))}</span>
          <strong>${pct(share(vb, va + vb))}</strong><small>${num(vb)} ${vb === 1 ? "voto" : "votos"}</small></div>
      </div>
      ${barraDividida("placar-barra", va, vb)}
      <dl class="comparar">
        ${linha(escapeHtml(titleCase(mun[1])), mun[4], mun[5])}
        ${linha("Brasil", bra, brb)}
      </dl>
    </div>`;
}

function turno(meta: Meta, numero: number, t: Turno | undefined, aberto: boolean): string {
  if (!t) return "";
  const candidatos = new Map(meta.candidatos.filter((c) => c.turno === numero).map((c) => [String(c.numero), c]));
  const votos = Object.entries(t.votos ?? {}).sort((x, y) => y[1] - x[1]);
  const barras = votos
    .map(([n, v]) => barra(nomeCandidato(candidatos.get(n), n), v, t.validos, corCandidato(meta, Number(n))))
    .join("");
  const numeros = `
    <dl class="numeros">
      <div><dt>Comparecimento</dt><dd>${pct(share(t.comparecimento, t.aptos))} <small>${num(t.comparecimento)} de ${num(t.aptos)}</small></dd></div>
      <div><dt>Brancos</dt><dd>${num(t.brancos)}</dd></div>
      <div><dt>Nulos</dt><dd>${num(t.nulos)}</dd></div>
    </dl>`;
  return `
    <section>
      <details ${aberto ? "open" : ""}>
        <summary><h3>${numero}º turno <small>todos os candidatos</small></h3></summary>
        ${barras || '<p class="nota">Nenhum voto válido.</p>'}
        ${numeros}
      </details>
    </section>`;
}

function entorno(e: Entorno | null): string {
  if (!e) return "";
  const metodo =
    e.metodo === "raio_500m"
      ? "Setores censitários num raio de 500 m do local."
      : "Setor censitário rural onde fica o local (o raio de 500 m pegaria quase ninguém).";
  const cores: [string, number | null, string][] = [
    // Paleta categórica neutra (de propósito, nada de tons de pele).
    ["Branca", e.pct_branca, "#7aa6c2"],
    ["Parda", e.pct_parda, "#e0a458"],
    ["Preta", e.pct_preta, "#4f6d7a"],
    ["Amarela", e.pct_amarela, "#c96f6f"],
    ["Indígena", e.pct_indigena, "#81b29a"],
  ];
  const pilha = cores
    .filter(([, v]) => v)
    .map(([r, v, c]) => `<div title="${r}: ${pct(v)}" style="flex:${v};background:${c}"></div>`)
    .join("");
  const itens = cores
    .filter(([, v]) => v && v >= 0.5)
    .map(([r, v, c]) => `<li><i style="background:${c}"></i>${r} ${pct(v)}</li>`)
    .join("");
  return `
    <section>
      <h3>Quem mora em volta <small>Censo 2022</small></h3>
      <dl class="numeros">
        <div><dt>Renda média do responsável</dt><dd>${brl(e.renda_media_responsavel)}</dd></div>
        <div><dt>Moradores</dt><dd>${num(e.populacao_estimada)}</dd></div>
        <div><dt>Alfabetizados (15+)</dt><dd>${pct(e.pct_alfabetizados_15_mais)}</dd></div>
      </dl>
      <p class="mini-titulo">Idade</p>
      <dl class="numeros">
        <div><dt>15 a 29 anos</dt><dd>${pct(e.pct_15_a_29_anos)}</dd></div>
        <div><dt>30 a 59 anos</dt><dd>${pct(e.pct_30_a_59_anos)}</dd></div>
        <div><dt>60 ou mais</dt><dd>${pct(e.pct_60_anos_ou_mais)}</dd></div>
      </dl>
      <p class="mini-titulo">Cor ou raça</p>
      <div class="pilha">${pilha}</div>
      <ul class="legenda-itens">${itens}</ul>
      <p class="nota">${metodo} É uma aproximação: o eleitor costuma votar perto de casa, mas nem sempre.</p>
    </section>`;
}

export function renderLocal(meta: Meta, mun: MunicipioInfo, l: Local): string {
  const t2 = l.turnos["2"];
  const aptos = t2?.aptos ?? l.turnos["1"]?.aptos;
  const aviso =
    l.precisao === "aproximada"
      ? '<p class="aviso-local">Localização aproximada: a coordenada do TSE estava errada e o ponto foi posto pelo CEP.</p>'
      : "";
  const endereco = [titleCase(l.endereco), titleCase(l.bairro)].filter(Boolean).join(" · ");
  return `
    <header class="local-topo">
      <p class="sobretitulo">${escapeHtml(titleCase(mun[1]))} – ${escapeHtml(mun[2])}</p>
      <h2>${escapeHtml(titleCase(l.nome))}</h2>
      <p class="endereco">${escapeHtml(endereco)}</p>
    </header>
    <ul class="etiquetas">
      <li>Zona ${l.zona}</li>
      <li>${l.secoes} ${l.secoes === 1 ? "seção" : "seções"}</li>
      <li>${num(aptos)} eleitores</li>
    </ul>
    ${aviso}
    ${placar(meta, t2, mun)}
    <button class="compartilhar" type="button" data-compartilhar>${ICONE_COMPARTILHAR} Compartilhar este local</button>
    ${entorno(l.entorno)}
    ${turno(meta, 2, t2, false)}
    ${turno(meta, 1, l.turnos["1"], false)}`;
}
