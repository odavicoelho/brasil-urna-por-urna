// Descobertas: cartões com os achados calculados pelo pipeline (meta.descobertas). Cada um tem um número
// forte, uma frase, um gráfico pequeno, um botão que leva ao lugar certo do mapa e o de compartilhar.
// As frases são montadas a partir dos dados: se um número muda, o texto acompanha.

import { contar, revelar } from "./anima";
import type { Descobertas, Meta } from "./data";
import { emCidade, escapeHtml, num, pct, titleCase } from "./format";
import { COR_A, COR_B } from "./layers";
import { ICONE, nomeCurto } from "./panel";

export interface Acao {
  camada?: string;
  municipio?: string; // código TSE
  local?: string; // place_id
  rota?: string;
}

interface Cartao {
  id: string;
  rotulo: string;
  grande: string; // número do carrossel
  curto: string; // frase do carrossel
  titulo: string;
  texto: string;
  grafico: string;
  nota: string;
  acao: { rotulo: string; acao: Acao };
  compartilhar: string;
}

const um = (v: number) => pct(v); // "70,4%"
const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const inteiro = (v: number) => `${Math.round(v)}%`;

function cartoes(meta: Meta): Cartao[] {
  const d: Descobertas = meta.descobertas;
  const [na, nb] = meta.segundo_turno;
  const A = escapeHtml(nomeCurto(meta, na));
  const B = escapeHtml(nomeCurto(meta, nb));
  const a = (t: string) => `<span class="cor-a">${t}</span>`;
  const b = (t: string) => `<span class="cor-b">${t}</span>`;

  // 1. A virada
  const v = d.virada;
  const venc1 = v.turno1.a > v.turno1.b ? a(A) : b(B);
  const venc2 = v.turno2.a > v.turno2.b ? a(A) : b(B);
  const emCada10 = Math.round(v.pct_locais / 10);
  const barraTurno = (rotulo: string, partes: [number, string, string][]) => `
    <div class="turno-linha"><span>${rotulo}</span>
      <div class="barra-turno" data-revela>${partes
        .map(([p, cor, txt]) => `<div style="flex:${p};background:${cor}">${p >= 9 ? txt : ""}</div>`)
        .join("")}</div></div>`;
  const maxMov = Math.max(...v.ufs.map((u) => Math.abs(u.m2 - u.m1)));
  const ufs = [...v.ufs].sort((x, y) => y.m2 - y.m1 - (x.m2 - x.m1));
  const virada: Cartao = {
    id: "virada",
    rotulo: "A virada",
    grande: `${emCada10} em 10`,
    curto: `locais andaram para ${A} do 1º para o 2º turno`,
    titulo: `A margem andou para ${a(A)} em ${emCada10} de cada 10 locais`,
    texto: `No 1º turno, ${venc1} ficou na frente. No 2º, ${venc2} venceu. Entre um turno e outro, a margem andou
      a favor de ${a(A)} em <strong>${um(v.pct_locais)}</strong> dos locais de votação, onde votam
      ${um(v.pct_eleitores)} dos eleitores, e em <strong>${v.ufs_para_a} dos ${v.total_ufs}</strong> estados.`,
    grafico: `
      <div class="chave-halter"><span><i class="ponto" style="background:${COR_A}"></i> ${A}</span>
        <span><i class="ponto" style="background:#c7c7cc"></i> Outros</span>
        <span><i class="ponto" style="background:${COR_B}"></i> ${B}</span></div>
      ${barraTurno("1º turno", [
        [v.turno1.a, COR_A, inteiro(v.turno1.a)],
        [v.turno1.outros, "#c7c7cc", ""],
        [v.turno1.b, COR_B, inteiro(v.turno1.b)],
      ])}
      ${barraTurno("2º turno", [
        [v.turno2.a, COR_A, inteiro(v.turno2.a)],
        [v.turno2.b, COR_B, inteiro(v.turno2.b)],
      ])}
      <p class="grafico-titulo">Quanto a margem andou em cada estado</p>
      <div class="colunas-uf" data-revela>${ufs
        .map((u) => {
          const mov = u.m2 - u.m1;
          const h = Math.max(4, Math.round((Math.abs(mov) / maxMov) * 56));
          return `<div title="${u.uf}: ${mov > 0 ? "+" : ""}${mov.toFixed(1)} pontos">
            <i style="height:${h}px;background:${mov > 0 ? COR_A : COR_B}"></i><span>${u.uf}</span></div>`;
        })
        .join("")}</div>`,
    nota: `Quando o humor do país muda, ele costuma mudar em quase todo lugar ao mesmo tempo. Os votos somados de
      todos os locais batem exatamente com a totalização oficial do TSE, candidato por candidato, estado por estado.`,
    acao: { rotulo: "Ver no mapa", acao: { camada: "variacao" } },
    compartilhar: `Entre o 1º e o 2º turno, a margem andou para ${nomeCurto(meta, na)} em ${emCada10} de cada 10 locais de votação do Brasil.`,
  };

  // 2. Quem mora em volta
  const renda = d.entorno.find((e) => e.id === "renda") ?? d.entorno[0];
  const valores = d.entorno.flatMap((e) => [e.serie[0], e.serie[4]]);
  const lo = Math.floor((Math.min(...valores) - 4) / 5) * 5;
  const hi = Math.ceil((Math.max(...valores) + 4) / 5) * 5;
  const xDe = (p: number) => ((p - lo) / (hi - lo)) * 100;
  const entorno: Cartao = {
    id: "entorno",
    rotulo: "Quem mora em volta",
    grande: `${inteiro(renda.serie[0])} × ${inteiro(renda.serie[4])}`,
    curto: `${A} no entorno mais pobre e no mais rico`,
    titulo: `Onde o entorno é mais pobre, ${a(A)} teve ${inteiro(renda.serie[0])}; onde é mais rico, ${inteiro(renda.serie[4])}`,
    texto: `Cada linha compara os 20% do eleitorado que votam nos lugares com a menor e a maior medida de cada
      perfil do Censo 2022, num raio de 500 m do local. Os números são os votos de ${a(A)} no 2º turno.`,
    grafico: `
      <div class="halteres">
        <div class="halter-escala"><span>${lo}%</span><span style="left:${xDe(50)}%">50%</span><span>${hi}%</span></div>
        ${d.entorno
          .map((e) => {
            const [p0, p4] = [e.serie[0], e.serie[4]];
            const [x0, x4] = [xDe(p0), xDe(p4)];
            return `<div class="halter">
              <div class="halter-rotulo"><strong>${escapeHtml(e.rotulo)}</strong></div>
              <div class="halter-trilho" data-revela>
                <i class="meio" style="left:${xDe(50)}%"></i>
                <i class="linha" style="left:${Math.min(x0, x4)}%;width:${Math.abs(x4 - x0)}%"></i>
                <b class="vazio" style="left:${x0}%"></b><b class="cheio" style="left:${x4}%"></b>
              </div>
              <div class="halter-pontas"><span>○ ${escapeHtml(e.baixo)}: ${inteiro(p0)}</span><span>● ${escapeHtml(e.alto)}: ${inteiro(p4)}</span></div>
            </div>`;
          })
          .join("")}
      </div>`,
    nota: `É sobre lugares, não sobre pessoas: o voto é secreto, e o entorno do local é uma aproximação de onde o
      eleitor mora. Mostra associação, não causa.`,
    acao: { rotulo: "Ver Renda e voto", acao: { rota: "#/renda" } },
    compartilhar: `Nos locais de votação de entorno mais pobre, ${nomeCurto(meta, na)} teve ${inteiro(renda.serie[0])} dos votos válidos; nos de entorno mais rico, ${inteiro(renda.serie[4])}.`,
  };

  // 3. Dentro das capitais
  const caps = d.capitais;
  const invertida = caps[0];
  const normal = caps[caps.length - 1];
  const nomeCap = (c: (typeof caps)[number]) => escapeHtml(titleCase(c.municipio));
  const capsTodas = caps.flatMap((c) => [c.a_mais_pobres, c.a_mais_ricos]);
  const clo = Math.floor((Math.min(...capsTodas) - 3) / 5) * 5;
  const chi = Math.ceil((Math.max(...capsTodas) + 3) / 5) * 5;
  const cx = (p: number) => ((p - clo) / (chi - clo)) * 100;
  const capitais: Cartao = {
    id: "capitais",
    rotulo: "Dentro das capitais",
    grande: `${nomeCap(invertida)} ao contrário`,
    curto: `Lá, ${A} foi melhor nos bairros mais ricos`,
    titulo: `${maiuscula(escapeHtml(emCidade(normal.municipio)))}, os bairros mais pobres votaram mais em ${a(A)}. ${maiuscula(escapeHtml(emCidade(invertida.municipio)))}, foi o contrário.`,
    texto: `Entre os 20% de eleitores que votam no entorno mais rico ${escapeHtml(emCidade(invertida.municipio).replace(/^em /, "de ").replace(/^no /, "do "))},
      ${a(A)} teve <strong>${um(invertida.a_mais_ricos)}</strong>; entre os 20% de entorno mais pobre,
      ${um(invertida.a_mais_pobres)}. ${maiuscula(escapeHtml(emCidade(normal.municipio)))}, foi ${um(normal.a_mais_ricos)} contra
      ${um(normal.a_mais_pobres)}.`,
    grafico: `
      <div class="chave-halter"><span>○ 20% mais pobres</span><span>● 20% mais ricos</span><span>votos de ${A}</span></div>
      <div class="halteres compactos">${caps
        .map((c) => {
          const [x0, x4] = [cx(c.a_mais_pobres), cx(c.a_mais_ricos)];
          const sobe = c.a_mais_ricos > c.a_mais_pobres;
          return `<div class="halter linha-cap ${sobe ? "destaque" : ""}">
            <div class="halter-rotulo"><strong>${escapeHtml(titleCase(c.municipio))}</strong></div>
            <div class="halter-trilho" data-revela>
              <i class="meio" style="left:${cx(50)}%"></i>
              <i class="linha" style="left:${Math.min(x0, x4)}%;width:${Math.abs(x4 - x0)}%"></i>
              <b class="vazio" style="left:${x0}%"></b><b class="cheio" style="left:${x4}%"></b>
            </div>
          </div>`;
        })
        .join("")}</div>
      <div class="halter-escala"><span>${clo}%</span><span style="left:${cx(50)}%">50%</span><span>${chi}%</span></div>`,
    nota: "Faixas de renda calculadas dentro de cada cidade, com o mesmo número de eleitores em cada uma.",
    acao: { rotulo: `Ver ${titleCase(invertida.municipio)} no mapa`, acao: { municipio: invertida.cd, camada: "segundo" } },
    compartilhar: `${maiuscula(emCidade(normal.municipio))}, os bairros mais pobres votaram mais em ${nomeCurto(meta, na)}. ${maiuscula(emCidade(invertida.municipio))}, foi o contrário.`,
  };

  // 4. Cidades partidas
  const part = d.cidades_partidas;
  const p0 = part[0];
  const partidas: Cartao = {
    id: "partidas",
    rotulo: "Cidades partidas",
    grande: `${inteiro(p0.pa_min)} e ${inteiro(p0.pa_max)}`,
    curto: `para ${A} em dois locais da mesma ${escapeHtml(titleCase(p0.municipio))}`,
    titulo: `${maiuscula(escapeHtml(emCidade(p0.municipio)))}, um local deu ${inteiro(p0.pa_min)} para ${a(A)} e outro, ${inteiro(p0.pa_max)}`,
    texto: `${escapeHtml(titleCase(p0.nome_min))} e ${escapeHtml(titleCase(p0.nome_max))} ficam na mesma cidade e
      votaram de forma oposta. Estas são as cidades com 100 locais ou mais onde o voto mais
      varia de um local para outro.`,
    grafico: `<div class="faixas-cidade">${part
      .map(
        (c) => `<div class="faixa-cidade">
          <div class="halter-rotulo"><strong>${escapeHtml(titleCase(c.municipio))} – ${c.uf}</strong><span>${num(c.locais)} locais</span></div>
          <div class="trilho-cidade" data-revela>
            <i style="left:${c.pa_min}%;width:${c.pa_max - c.pa_min}%;background:linear-gradient(90deg, ${COR_B}, #efeff1 ${Math.max(5, Math.min(95, ((50 - c.pa_min) / Math.max(1, c.pa_max - c.pa_min)) * 100))}%, ${COR_A})"></i>
          </div>
          <div class="halter-pontas"><span>${inteiro(c.pa_min)}</span><span>${inteiro(c.pa_max)}</span></div>
        </div>`,
      )
      .join("")}
      <div class="halter-escala"><span>0% ${A}</span><span style="left:50%">50%</span><span>100%</span></div></div>`,
    nota: "Só entram locais com 100 votos válidos ou mais, para um local muito pequeno não distorcer.",
    acao: { rotulo: `Ver ${titleCase(p0.municipio)} no mapa`, acao: { municipio: p0.cd, camada: "segundo" } },
    compartilhar: `${maiuscula(emCidade(p0.municipio))}, um local de votação deu ${inteiro(p0.pa_min)} para ${nomeCurto(meta, na)} e outro, ${inteiro(p0.pa_max)}.`,
  };

  // 5. Para onde foi o crescimento onde a direita era forte
  const dir = d.direita;
  const forte = dir[dir.length - 1];
  const direita: Cartao = {
    id: "direita",
    rotulo: "Onde a direita era forte",
    grande: inteiro(100 - forte.b_do_crescimento),
    curto: `do crescimento foi de ${A} onde Zema, Caiado e Renan Santos foram fortes`,
    titulo: `Mesmo onde Zema, Caiado e Renan Santos foram fortes, ${a(A)} cresceu mais`,
    texto: `Nos 20% de eleitores que votam onde esses três somaram mais votos no 1º turno
      (${um(forte.dir_min)} ou mais), ${b(B)} ficou com ${um(forte.b_do_crescimento)} do que os dois finalistas
      cresceram do 1º para o 2º turno, e ${a(A)} com <strong>${um(100 - forte.b_do_crescimento)}</strong>.`,
    grafico: `
      <div class="chave-halter"><span>Quem ficou com o crescimento do 2º turno</span></div>
      <div class="barras-dir">${dir
        .map((f, i) => ({ f, i, ra: Math.round(100 - f.b_do_crescimento) }))
        .map(
          ({ f, i, ra }) => `<div class="barra-dir">
            <span>${i === 0 ? "Direita mais fraca" : i === dir.length - 1 ? "Direita mais forte" : `${i + 1}ª faixa`}</span>
            <div class="barra-dupla" data-revela>
              <div style="flex:${100 - f.b_do_crescimento};background:${COR_A}"></div>
              <div style="flex:${f.b_do_crescimento};background:${COR_B}"></div>
            </div>
            <b>${ra}% · ${100 - ra}%</b>
          </div>`,
        )
        .join("")}</div>`,
    nota: `Mostra onde cada um cresceu, não quem migrou para quem: parte do crescimento veio de quem não tinha
      votado, ou tinha votado branco ou nulo, no 1º turno.`,
    acao: { rotulo: "Ver no mapa", acao: { camada: "variacao" } },
    compartilhar: `Mesmo nos locais onde Zema, Caiado e Renan Santos foram fortes no 1º turno, ${nomeCurto(meta, na)} ficou com ${inteiro(100 - forte.b_do_crescimento)} do crescimento do 2º turno.`,
  };

  // 6. Curiosidades
  const c = d.curiosidades;
  const curiosidades: Cartao = {
    id: "curiosidades",
    rotulo: "Curiosidades",
    grande: num(c.maior_local.aptos),
    curto: `eleitores na ${escapeHtml(titleCase(c.maior_local.nome).split(" - ")[0])}, o maior local do Brasil`,
    titulo: "Números que ninguém costuma ver",
    texto: "",
    grafico: `<div class="fatos">
      <div><strong>${num(c.maior_local.aptos)}</strong><span>eleitores no maior local de votação do Brasil:
        ${escapeHtml(titleCase(c.maior_local.nome))}, em ${escapeHtml(titleCase(c.maior_local.municipio))}.
        ${A} teve ${inteiro(c.maior_local.pa)} ali.</span></div>
      <div><strong>${inteiro(c.exterior.comparecimento)}</strong><span>dos eleitores no exterior foram votar no
        2º turno (no Brasil, mais de 80%). ${A} teve ${inteiro(c.exterior.a)} lá fora.</span></div>
      <div><strong>${num(c.locais_so_a)}</strong><span>locais com 50 votos ou mais deram todos os votos válidos
        para ${A}. Para ${B}: ${num(c.locais_so_b)}.</span></div>
      <div><strong>${num(c.empates)}</strong><span>locais terminaram em empate exato no 2º turno.</span></div>
    </div>`,
    nota: "",
    acao: { rotulo: "Ver o maior local no mapa", acao: { local: c.maior_local.id } },
    compartilhar: `O maior local de votação do Brasil tem ${num(c.maior_local.aptos)} eleitores: ${titleCase(c.maior_local.nome)}.`,
  };

  return [virada, entorno, capitais, partidas, direita, curiosidades];
}

/** Carrossel da tela inicial: um cartão pequeno por descoberta. */
export function carrossel(meta: Meta): string {
  const seta = (lado: "anterior" | "proximo", d: string) =>
    `<button class="seta-carrossel vidro" type="button" data-seta="${lado}" aria-label="${lado === "anterior" ? "Anterior" : "Próximo"}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg></button>`;
  return `<div class="carrossel-caixa">${seta("anterior", "m15 5-7 7 7 7")}${seta("proximo", "m9 5 7 7-7 7")}<div class="carrossel">${cartoes(meta)
    .map(
      (c, i) => `<button class="mini-descoberta apertavel" type="button" data-descoberta="${c.id}" style="--tom:${TONS[i % TONS.length]}">
        <span class="kicker">${escapeHtml(c.rotulo)}</span>
        <strong>${c.grande}</strong>
        <span class="curto">${c.curto}</span>
      </button>`,
    )
    .join("")}</div></div>`;
}
const TONS = ["#fdeceb", "#eef3fc", "#f6eefb", "#eaf6f1", "#fdf5e6", "#eef0f3"];

/** Mouse: arrastar rola o carrossel (e não conta como clique); setas aparecem nas pontas. No toque, o
 * navegador já rola sozinho. */
export function ativarCarrossel(caixa: HTMLElement): void {
  const trilho = caixa.querySelector<HTMLElement>(".carrossel")!;
  const passo = () => (trilho.querySelector<HTMLElement>(".mini-descoberta")?.offsetWidth ?? 240) + 10;
  const setas = () => {
    caixa.classList.toggle("no-inicio", trilho.scrollLeft < 4);
    caixa.classList.toggle("no-fim", trilho.scrollLeft + trilho.clientWidth > trilho.scrollWidth - 4);
  };
  trilho.addEventListener("scroll", setas, { passive: true });
  setas();
  caixa.addEventListener("click", (ev) => {
    const s = (ev.target as HTMLElement).closest<HTMLElement>("[data-seta]");
    if (!s) return;
    ev.stopPropagation();
    trilho.scrollBy({ left: s.dataset.seta === "proximo" ? passo() : -passo(), behavior: "smooth" });
  });

  let arraste: { x: number; scroll: number; moveu: boolean } | null = null;
  trilho.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType !== "mouse" || ev.button !== 0) return;
    arraste = { x: ev.clientX, scroll: trilho.scrollLeft, moveu: false };
  });
  window.addEventListener("pointermove", (ev) => {
    if (!arraste) return;
    const dx = ev.clientX - arraste.x;
    if (!arraste.moveu && Math.abs(dx) < 5) return;
    if (!arraste.moveu) {
      arraste.moveu = true;
      trilho.classList.add("arrastando");
    }
    trilho.scrollLeft = arraste.scroll - dx;
  });
  window.addEventListener("pointerup", () => {
    if (!arraste) return;
    const moveu = arraste.moveu;
    arraste = null;
    if (!moveu) return;
    trilho.classList.remove("arrastando");
    // encaixa no cartão mais próximo, como o dedo faria
    const p = passo();
    trilho.scrollTo({ left: Math.round(trilho.scrollLeft / p) * p, behavior: "smooth" });
    // o clique que vem depois de um arraste não abre o cartão
    trilho.addEventListener("click", (e) => (e.stopPropagation(), e.preventDefault()), { capture: true, once: true });
  });
}

export function setupDescobertas(
  el: HTMLElement,
  ctx: { meta: Meta; irPara: (a: Acao) => void; compartilhar: (titulo: string, texto: string, url: string) => void },
): (ancora?: string) => void {
  let montado = false;
  const lista = cartoes(ctx.meta);

  function montar() {
    el.innerHTML = `
      <h1 class="titulo-grande">Descobertas</h1>
      <p class="lide">O que aparece quando se olha a eleição local por local, e não município por município.</p>
      ${lista
        .map(
          (c) => `
        <article class="cartao descoberta" id="descoberta-${c.id}">
          <p class="kicker">${escapeHtml(c.rotulo)}</p>
          <h2>${c.titulo}</h2>
          ${c.texto ? `<p class="texto">${c.texto}</p>` : ""}
          <div class="grafico">${c.grafico}</div>
          ${c.nota ? `<p class="nota">${c.nota}</p>` : ""}
          <div class="acoes">
            <button class="botao-grande" type="button" data-ir="${c.id}">${escapeHtml(c.acao.rotulo)}</button>
            <button class="botao-grande secundario-botao" type="button" data-compartilhar="${c.id}" aria-label="Compartilhar">${ICONE.compartilhar}</button>
          </div>
        </article>`,
        )
        .join("")}
      <p class="rodape">Todos os números são somas de votos oficiais do TSE e dados do Censo 2022 do IBGE,
        recalculados a cada atualização dos dados.</p>`;
    el.addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement;
      const ir = t.closest<HTMLElement>("[data-ir]");
      if (ir) return ctx.irPara(lista.find((c) => c.id === ir.dataset.ir)!.acao.acao);
      const comp = t.closest<HTMLElement>("[data-compartilhar]");
      if (comp) {
        const c = lista.find((x) => x.id === comp.dataset.compartilhar)!;
        const url = `${location.origin}${location.pathname}#/descobertas/${c.id}`;
        ctx.compartilhar(`Descobertas · ${c.rotulo}`, c.compartilhar, url);
      }
    });
  }

  return (ancora?: string) => {
    if (!montado) {
      montar();
      montado = true;
    }
    revelar(el);
    contar(el);
    const alvo = ancora ? el.querySelector(`#descoberta-${ancora}`) : null;
    if (alvo) setTimeout(() => alvo.scrollIntoView({ behavior: "smooth", block: "start" }), 420);
    else el.scrollTop = 0;
  };
}
