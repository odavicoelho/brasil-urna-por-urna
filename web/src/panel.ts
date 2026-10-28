// Conteúdo do painel: a tela inicial (resultado no Brasil, prévia de Renda e voto, links) e a tela de um
// local de votação (placar do 2º turno no topo, depois o entorno e os dois turnos completos).

import type { Candidato, Entorno, FaixaRenda, Local, Meta, MunicipioInfo, Turno } from "./data";
import { brl, escapeHtml, num, pct, share, titleCase } from "./format";
import { COR_A, COR_B } from "./layers";

const CINZA = "#8e8e93";

export const ICONE = {
  compartilhar:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
  fechar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  chevron: '<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
  baixo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  selo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8.5 12.5 2.5 2.5 4.5-5"/><path d="M12 3 14.4 4.6 17.3 4.5 18.3 7.2 20.6 9 19.7 11.8 20.6 14.6 18.3 16.4 17.3 19.1 14.4 19 12 20.6 9.6 19 6.7 19.1 5.7 16.4 3.4 14.6 4.3 11.8 3.4 9 5.7 7.2 6.7 4.5 9.6 4.6Z"/></svg>',
  globo: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  codigo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 7-5 5 5 5M16 7l5 5-5 5"/></svg>',
  grafico: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
};

export function nomeCurto(meta: Meta, numero: number): string {
  const c = meta.candidatos.find((x) => x.numero === numero);
  return c ? titleCase(c.nome) : `Nº ${numero}`;
}

function nomeCandidato(c: Candidato | undefined, numero: string): string {
  return c ? `${titleCase(c.nome)} (${c.partido})` : `Nº ${numero}`;
}

function corCandidato(meta: Meta, numero: number): string {
  const [a, b] = meta.segundo_turno;
  return numero === a ? COR_A : numero === b ? COR_B : CINZA;
}

/** Barra dividida A | B, com 2 px de respiro entre as partes. */
export function barraDupla(va: number, vb: number, classe = ""): string {
  if (!va && !vb) return `<div class="barra-dupla ${classe}"><div style="flex:1;background:#e5e5ea"></div></div>`;
  return `<div class="barra-dupla ${classe}" data-revela>
    <div style="flex:${va};background:${COR_A}"></div><div style="flex:${vb};background:${COR_B}"></div>
  </div>`;
}

const pctConta = (p: number) => `<span class="pct" data-conta="${p.toFixed(1)}">${pct(p)}</span>`;

/** Placar A × B: nomes coloridos, percentuais grandes (que contam ao aparecer) e a barra. */
export function placar(meta: Meta, va: number, vb: number, compacto = false): string {
  const [na, nb] = meta.segundo_turno;
  const t = va + vb;
  const votos = (v: number) => (compacto ? "" : `<small>${num(v)} ${v === 1 ? "voto" : "votos"}</small>`);
  return `
    <div class="placar ${compacto ? "compacto" : ""}">
      <div><span class="nome"><i class="ponto" style="background:${COR_A}"></i>${escapeHtml(nomeCurto(meta, na))}</span>
        ${pctConta(share(va, t))}${votos(va)}</div>
      <div><span class="nome">${escapeHtml(nomeCurto(meta, nb))}<i class="ponto" style="background:${COR_B}"></i></span>
        ${pctConta(share(vb, t))}${votos(vb)}</div>
    </div>
    ${barraDupla(va, vb)}`;
}

// ---------- Tela inicial ----------

export function renderInicio(meta: Meta): string {
  const [na, nb] = meta.segundo_turno;
  const br = meta.totais.find((x) => x.turno === 2)!;
  const f = meta.faixas_renda.BR;
  const pa = (x: FaixaRenda) => share(x.votos_a, x.votos_a + x.votos_b);
  const rotulos = ["Mais pobres", "", "", "", "Mais ricos"];
  // Frase calculada dos dados: quem venceu na faixa mais pobre e na mais rica.
  const frase = (x: FaixaRenda) => {
    const p = pa(x);
    return p >= 50
      ? `<span class="cor-a">${escapeHtml(nomeCurto(meta, na))} ${Math.round(p)}%</span>`
      : `<span class="cor-b">${escapeHtml(nomeCurto(meta, nb))} ${Math.round(100 - p)}%</span>`;
  };
  const miniFaixas = f
    .map(
      (x, i) => `<div class="linha-faixa"><span>${rotulos[i] || `${i + 1}ª faixa`}</span>
        ${barraDupla(x.votos_a, x.votos_b, "fina")}<b>${Math.round(pa(x))}%</b></div>`,
    )
    .join("");
  return `
    <div class="cartao" id="cartao-brasil">
      <div class="placar-cabeca"><span>Resultado no Brasil</span><span>2º turno</span></div>
      ${placar(meta, br.votos[na] ?? 0, br.votos[nb] ?? 0, true)}
    </div>
    <p class="titulo-secao">Descubra</p>
    <button class="cartao cartao-link apertavel" type="button" data-abrir="renda">
      <h3>Renda e voto</h3>
      <p class="nota" style="margin-top:4px;font-size:15px;color:var(--rotulo)">Onde o entorno é mais pobre,
        ${frase(f[0])}. Onde é mais rico, ${frase(f[4])}.</p>
      <div class="mini-faixas">${miniFaixas}</div>
      <span class="ver">Ver o gráfico completo ${ICONE.chevron}</span>
    </button>
    <p class="titulo-secao">Sobre os dados</p>
    <ul class="lista">
      <li><button class="linha" type="button" data-abrir="sobre">
        <span class="icone" style="background:#34c759">${ICONE.selo}</span>
        <span class="texto">Como foi feito<small>Fontes e conferência com o TSE</small></span>${ICONE.chevron}</button></li>
      <li><button class="linha" type="button" data-abrir="exterior">
        <span class="icone" style="background:#5856d6">${ICONE.globo}</span>
        <span class="texto">Votos no exterior<small>${num(meta.locais.locais_exterior)} locais fora do mapa</small></span>${ICONE.chevron}</button></li>
      <li><a class="linha" href="https://github.com/odavicoelho/brasil-urna-por-urna" target="_blank" rel="noopener">
        <span class="icone" style="background:#1c1c1e">${ICONE.codigo}</span>
        <span class="texto">Código aberto<small>Refaça tudo do zero no GitHub</small></span>${ICONE.chevron}</a></li>
    </ul>
    <p class="rodape">Dados oficiais do TSE e do IBGE (Censo 2022).<br />
      Feito por <a href="https://davicoelho-comercial.vercel.app/" target="_blank" rel="noopener">Davi Coelho</a>.</p>`;
}

// ---------- Tela do local ----------

export function renderCarregandoLocal(): string {
  return `
    <div class="local-cabeca">
      <div class="esqueleto" style="height:26px;width:75%"></div>
      <div class="esqueleto" style="height:15px;width:50%;margin-top:10px"></div>
      <button class="fechar" type="button" data-fechar aria-label="Fechar">${ICONE.fechar}</button>
    </div>
    <div class="cartao" style="margin-top:16px"><div class="esqueleto" style="height:96px"></div></div>
    <div class="esqueleto" style="height:50px;margin-top:12px;border-radius:14px"></div>`;
}

function barra(rotulo: string, valor: number, total: number, cor: string): string {
  const p = share(valor, total);
  return `
    <div class="barra">
      <div class="barra-rotulo">
        <span>${escapeHtml(rotulo)}</span>
        <span><small>${num(valor)}</small> <strong>${pct(p)}</strong></span>
      </div>
      <div class="barra-fundo"><div style="width:${p.toFixed(2)}%;background:${cor}"></div></div>
    </div>`;
}

function turno(meta: Meta, numero: number, t: Turno | undefined): string {
  if (!t) return "";
  const candidatos = new Map(meta.candidatos.filter((c) => c.turno === numero).map((c) => [String(c.numero), c]));
  const votos = Object.entries(t.votos ?? {}).sort((x, y) => y[1] - x[1]);
  const barras = votos
    .map(([n, v]) => barra(nomeCandidato(candidatos.get(n), n), v, t.validos, corCandidato(meta, Number(n))))
    .join("");
  return `
    <details class="cartao">
      <summary><h3>${numero}º turno <small>todos os números</small></h3>${ICONE.chevron}</summary>
      <div>
        ${barras || '<p class="nota">Nenhum voto válido.</p>'}
        <dl class="numeros">
          <div><dt>Comparecimento</dt><dd>${pct(share(t.comparecimento, t.aptos))}<small>${num(t.comparecimento)} de ${num(t.aptos)}</small></dd></div>
          <div><dt>Brancos</dt><dd>${num(t.brancos)}</dd></div>
          <div><dt>Nulos</dt><dd>${num(t.nulos)}</dd></div>
        </dl>
      </div>
    </details>`;
}

function entorno(e: Entorno | null): string {
  if (!e) return "";
  const metodo =
    e.metodo === "raio_500m"
      ? "Setores censitários num raio de 500 m do local."
      : "Setor censitário rural onde fica o local (o raio de 500 m pegaria quase ninguém).";
  const cores: [string, number | null, string][] = [
    // Paleta categórica neutra (de propósito, nada de tons de pele).
    ["Branca", e.pct_branca, "#64a6c9"],
    ["Parda", e.pct_parda, "#e3a857"],
    ["Preta", e.pct_preta, "#4c6676"],
    ["Amarela", e.pct_amarela, "#b986c9"],
    ["Indígena", e.pct_indigena, "#7fb59a"],
  ];
  const pilha = cores
    .filter(([, v]) => v)
    .map(([r, v, c]) => `<div title="${r}: ${pct(v)}" style="flex:${v};background:${c}"></div>`)
    .join("");
  const itens = cores
    .filter(([, v]) => v && v >= 0.5)
    .map(([r, v, c]) => `<li><i class="ponto" style="background:${c}"></i>${r} ${pct(v)}</li>`)
    .join("");
  return `
    <p class="titulo-secao">Quem mora em volta · Censo 2022</p>
    <div class="cartao">
      <dl class="numeros">
        <div><dt>Renda média</dt><dd>${brl(e.renda_media_responsavel)}</dd></div>
        <div><dt>Moradores</dt><dd>${num(e.populacao_estimada)}</dd></div>
        <div><dt>Alfabetizados</dt><dd>${pct(e.pct_alfabetizados_15_mais)}</dd></div>
      </dl>
      <p class="mini-titulo">Idade</p>
      <dl class="numeros" style="margin-top:6px">
        <div><dt>15 a 29 anos</dt><dd>${pct(e.pct_15_a_29_anos)}</dd></div>
        <div><dt>30 a 59 anos</dt><dd>${pct(e.pct_30_a_59_anos)}</dd></div>
        <div><dt>60 ou mais</dt><dd>${pct(e.pct_60_anos_ou_mais)}</dd></div>
      </dl>
      <p class="mini-titulo">Cor ou raça</p>
      <div class="pilha" data-revela>${pilha}</div>
      <ul class="itens">${itens}</ul>
      <p class="nota">${metodo} A renda é a média do responsável pelo domicílio. É uma aproximação: o eleitor
        costuma votar perto de casa, mas nem sempre.</p>
    </div>`;
}

export function renderLocal(meta: Meta, mun: MunicipioInfo, l: Local): string {
  const [na, nb] = meta.segundo_turno;
  const t2 = l.turnos["2"];
  const aptos = t2?.aptos ?? l.turnos["1"]?.aptos;
  const aviso =
    l.precisao === "aproximada"
      ? '<p class="aviso-local">Localização aproximada: a coordenada do TSE estava errada e o ponto foi posto pelo CEP.</p>'
      : "";
  const endereco = [titleCase(l.endereco), titleCase(l.bairro)].filter(Boolean).join(", ");
  const br = meta.totais.find((x) => x.turno === 2)!;
  const linha = (rotulo: string, a: number, b: number) => `
    <dt>${rotulo}</dt><dd>${barraDupla(a, b, "fina")}</dd>
    <dd>${Math.round(share(a, a + b))}% · ${Math.round(share(b, a + b))}%</dd>`;
  const resultado = t2
    ? `<div class="cartao" style="margin-top:16px">
        <div class="placar-cabeca"><span>2º turno · votos válidos</span></div>
        ${placar(meta, t2.votos?.[na] ?? 0, t2.votos?.[nb] ?? 0)}
        <dl class="comparar">
          ${linha(escapeHtml(titleCase(mun[1])), mun[4], mun[5])}
          ${linha("Brasil", br.votos[na] ?? 0, br.votos[nb] ?? 0)}
        </dl>
      </div>`
    : '<div class="cartao" style="margin-top:16px"><p class="nota" style="margin:0">Este local não teve votação no 2º turno.</p></div>';
  return `
    <header class="local-cabeca">
      <h2>${escapeHtml(titleCase(l.nome))}</h2>
      <p>${escapeHtml(titleCase(mun[1]))} – ${escapeHtml(mun[2])}${endereco ? ` · ${escapeHtml(endereco)}` : ""}</p>
      <p style="font-size:13px">Zona ${l.zona} · ${l.secoes} ${l.secoes === 1 ? "seção" : "seções"} · ${num(aptos)} eleitores</p>
      <button class="fechar" type="button" data-fechar aria-label="Fechar">${ICONE.fechar}</button>
    </header>
    ${aviso}
    ${resultado}
    <button class="botao-grande" type="button" data-compartilhar>${ICONE.compartilhar} Compartilhar este local</button>
    ${entorno(l.entorno)}
    <p class="titulo-secao">Resultado completo</p>
    ${turno(meta, 2, t2)}
    ${turno(meta, 1, l.turnos["1"])}`;
}
