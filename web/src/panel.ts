// Painel com o detalhe de um local de votação.

import type { Candidato, Entorno, Local, Meta, Municipio, Turno } from "./data";
import { brl, escapeHtml, num, pct, share, titleCase } from "./format";
import { ROXO, VERDE } from "./layers";

const CINZA = "#8a8a8a";

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

function turno(meta: Meta, numero: number, t: Turno | undefined): string {
  if (!t) return `<section><h3>${numero}º turno</h3><p class="nota">Este local não teve votação neste turno.</p></section>`;
  const candidatos = new Map(meta.candidatos.filter((c) => c.turno === numero).map((c) => [String(c.numero), c]));
  const votos = Object.entries(t.votos ?? {}).sort((x, y) => y[1] - x[1]);
  const barras = votos
    .map(([n, v]) => barra(nomeCandidato(candidatos.get(n), n), v, t.validos, corCandidato(meta, Number(n))))
    .join("");
  return `
    <section>
      <h3>${numero}º turno</h3>
      ${barras || '<p class="nota">Nenhum voto válido.</p>'}
      <dl class="numeros">
        <div><dt>Comparecimento</dt><dd>${pct(share(t.comparecimento, t.aptos))} <small>${num(t.comparecimento)} de ${num(t.aptos)}</small></dd></div>
        <div><dt>Brancos</dt><dd>${num(t.brancos)}</dd></div>
        <div><dt>Nulos</dt><dd>${num(t.nulos)}</dd></div>
      </dl>
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
    .map(([r, v, c]) => `<div title="${r}: ${pct(v)}" style="width:${v}%;background:${c}"></div>`)
    .join("");
  const itens = cores
    .filter(([, v]) => v && v >= 0.5)
    .map(([r, v, c]) => `<li><i style="background:${c}"></i>${r} ${pct(v)}</li>`)
    .join("");
  return `
    <section>
      <h3>Entorno <small>Censo 2022</small></h3>
      <dl class="numeros">
        <div><dt>População estimada</dt><dd>${num(e.populacao_estimada)}</dd></div>
        <div><dt>Renda média do responsável</dt><dd>${brl(e.renda_media_responsavel)}</dd></div>
        <div><dt>Alfabetização (15+ anos)</dt><dd>${pct(e.pct_alfabetizados_15_mais)}</dd></div>
      </dl>
      <p class="mini-titulo">Idade</p>
      <dl class="numeros">
        <div><dt>15 a 29 anos</dt><dd>${pct(e.pct_15_a_29_anos)}</dd></div>
        <div><dt>30 a 59 anos</dt><dd>${pct(e.pct_30_a_59_anos)}</dd></div>
        <div><dt>60 anos ou mais</dt><dd>${pct(e.pct_60_anos_ou_mais)}</dd></div>
      </dl>
      <p class="mini-titulo">Cor ou raça</p>
      <div class="pilha">${pilha}</div>
      <ul class="legenda-itens pequena">${itens}</ul>
      <p class="nota">${metodo} Aproximação: o eleitor costuma votar perto de casa, mas nem sempre.</p>
    </section>`;
}

export function renderLocal(meta: Meta, mun: Municipio, l: Local): string {
  const aptos = l.turnos["2"]?.aptos ?? l.turnos["1"]?.aptos;
  const aviso =
    l.precisao === "aproximada"
      ? '<p class="aviso">Localização aproximada: a coordenada do TSE estava errada e o ponto foi posto pelo CEP.</p>'
      : "";
  const endereco = [titleCase(l.endereco), titleCase(l.bairro)].filter(Boolean).join(" · ");
  return `
    <header>
      <p class="sobretitulo">${escapeHtml(titleCase(mun.municipio))} – ${escapeHtml(mun.uf)}</p>
      <h2>${escapeHtml(titleCase(l.nome))}</h2>
      <p class="endereco">${escapeHtml(endereco)}</p>
      <p class="meta-local">Zona ${l.zona} · ${l.secoes} ${l.secoes === 1 ? "seção" : "seções"} · ${num(aptos)} eleitores aptos</p>
      ${aviso}
    </header>
    ${turno(meta, 2, l.turnos["2"])}
    ${turno(meta, 1, l.turnos["1"])}
    ${entorno(l.entorno)}`;
}
