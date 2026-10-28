// Página "Renda e voto": as cinco faixas de renda (contagens exatas do pipeline) e a dispersão de todos os
// locais (renda do entorno × votos do candidato A no 2º turno), com filtro por UF.

import type { Camadas, FaixaRenda, Meta, MunicipioInfo, Pontos } from "./data";
import { SEM } from "./data";
import { brl, escapeHtml, pct, share, titleCase } from "./format";
import { NEUTRO, ROXO, VERDE } from "./layers";
import { ICONE_COMPARTILHAR, nomeCurto } from "./panel";

const NOMES_FAIXA = ["20% de menor renda", "2ª faixa", "Faixa do meio", "4ª faixa", "20% de maior renda"];
const R_MIN = 500;
const R_MAX = 15_000;

interface Ctx {
  meta: Meta;
  municipios: MunicipioInfo[];
  pontos: Pontos;
  camadas: Promise<Camadas>;
  abrirLocal: (i: number) => void;
  compartilhar: (titulo: string, texto: string) => void;
}

// Mesmas paradas da camada "2º turno" do mapa.
const PARADAS: [number, string][] = [
  [0, VERDE[4]], [20, VERDE[3]], [40, VERDE[1]], [50, NEUTRO], [60, ROXO[1]], [80, ROXO[3]], [100, ROXO[4]],
];
function hexRgb(h: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
const PALETA = Array.from({ length: 101 }, (_, p) => {
  const k = PARADAS.findIndex(([v]) => v >= p);
  if (k <= 0) return PARADAS[0][1];
  const [v0, c0] = PARADAS[k - 1];
  const [v1, c1] = PARADAS[k];
  const t = (p - v0) / (v1 - v0);
  const [a, b] = [hexRgb(c0), hexRgb(c1)];
  return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(",")})`;
});

export function setupRenda(el: HTMLElement, ctx: Ctx): () => void {
  const { meta, municipios } = ctx;
  const [na, nb] = meta.segundo_turno;
  const A = escapeHtml(nomeCurto(meta, na));
  const B = escapeHtml(nomeCurto(meta, nb));
  const ufs = Object.keys(meta.faixas_renda).filter((k) => k !== "BR").sort();
  let montado = false;
  let uf = "BR";

  function lide(f: FaixaRenda[]): string {
    const frase = (x: FaixaRenda, onde: string) => {
      const pa = share(x.votos_a, x.votos_a + x.votos_b);
      const [quem, classe, p] = pa >= 50 ? [A, "destaque-a", pa] : [B, "destaque-b", 100 - pa];
      return `${onde}, <span class="${classe}">${quem}</span> teve <strong>${pct(p)}</strong> dos votos válidos`;
    };
    const lugar = uf === "BR" ? "do Brasil" : `de ${uf}`;
    return `${frase(f[0], `Entre os 20% de eleitores ${lugar} que votam nos lugares de menor renda`)}.
      ${frase(f[4], "Entre os 20% que votam nos lugares de maior renda")}.`;
  }

  function faixas(f: FaixaRenda[]): string {
    return f
      .map((x, i) => {
        const t = x.votos_a + x.votos_b;
        const pa = share(x.votos_a, t);
        const ate = i === 4 ? `acima de ${brl(x.renda_min)}` : `${brl(x.renda_min)} a ${brl(x.renda_max)}`;
        return `
          <li>
            <div class="faixa-rotulo"><strong>${NOMES_FAIXA[i]}</strong><span>${ate}</span></div>
            <div class="faixa-barra" role="img" aria-label="${A} ${pct(pa)}, ${B} ${pct(100 - pa)}">
              <div style="flex:${x.votos_a};background:${ROXO[3]}">${pct(pa)}</div>
              <div style="flex:${x.votos_b};background:${VERDE[3]}">${pct(100 - pa)}</div>
            </div>
          </li>`;
      })
      .join("");
  }

  function atualizarTexto() {
    const f = meta.faixas_renda[uf];
    el.querySelector("#renda-lide")!.innerHTML = lide(f);
    el.querySelector("#renda-faixas")!.innerHTML = faixas(f);
  }

  function montar() {
    el.innerHTML = `<div class="pagina-corpo">
      <h1>Renda e voto</h1>
      <p class="lide" id="renda-lide"></p>
      <label class="filtro">Ver
        <select id="renda-uf">
          <option value="BR">Brasil inteiro</option>
          ${ufs.map((u) => `<option value="${u}">${u}</option>`).join("")}
        </select>
      </label>
      <div class="chave">
        <span><i style="background:${ROXO[3]}"></i>${A}</span>
        <span><i style="background:${VERDE[3]}"></i>${B}</span>
      </div>
      <ol class="faixas" id="renda-faixas"></ol>
      <p class="nota">Votos válidos no 2º turno. Cada faixa reúne um quinto dos eleitores aptos, ordenados pela
        renda média do responsável pelo domicílio num raio de 500 m do local onde votam (Censo 2022).
        As porcentagens são somas exatas de votos, não médias.</p>
      <section>
        <h2>Cada ponto é um local de votação</h2>
        <p class="nota">Para a direita, entorno mais rico. Para cima, mais votos para ${A}; para baixo, para ${B}.
          Toque num ponto para ver qual é.</p>
        <div class="dispersao" id="renda-dispersao">
          <canvas aria-label="Gráfico de dispersão: renda do entorno e voto em cada local"></canvas>
        </div>
        <p class="nota" id="renda-carregando">Carregando os locais…</p>
      </section>
      <button class="compartilhar" type="button" id="renda-compartilhar">${ICONE_COMPARTILHAR} Compartilhar</button>
      <section>
        <p class="nota">Renda do entorno não é a renda de quem votou: o voto é secreto, e o local é só uma
          aproximação de onde o eleitor mora. O gráfico mostra uma associação entre lugares, não explica o voto
          de cada pessoa.</p>
      </section></div>`;
    el.querySelector<HTMLSelectElement>("#renda-uf")!.addEventListener("change", (ev) => {
      uf = (ev.target as HTMLSelectElement).value;
      atualizarTexto();
      void desenhar();
    });
    el.querySelector("#renda-compartilhar")!.addEventListener("click", () => {
      const f = meta.faixas_renda.BR;
      const pa0 = share(f[0].votos_a, f[0].votos_a + f[0].votos_b);
      const pa4 = share(f[4].votos_a, f[4].votos_a + f[4].votos_b);
      ctx.compartilhar(
        "Renda e voto, local por local",
        `Nos locais de votação de menor renda, ${nomeCurto(meta, na)} teve ${pct(pa0)} dos votos válidos; nos de maior renda, ${pct(pa4)}.`,
      );
    });
    atualizarTexto();
    configurarToque();
    window.addEventListener("resize", () => !el.hidden && void desenhar());
  }

  // ---------- Dispersão ----------
  let visiveis: Int32Array = new Int32Array(0);
  let px = new Float32Array(0);
  let py = new Float32Array(0);
  let geom = { w: 0, h: 0, esq: 0, dir: 0, cima: 0, baixo: 0 };

  const xDe = (r: number) =>
    geom.esq + ((Math.log(Math.min(R_MAX, Math.max(R_MIN, r))) - Math.log(R_MIN)) / (Math.log(R_MAX) - Math.log(R_MIN))) * (geom.w - geom.esq - geom.dir);
  const yDe = (p: number) => geom.cima + (1 - p / 100) * (geom.h - geom.cima - geom.baixo);

  async function desenhar() {
    const cam = await ctx.camadas;
    el.querySelector("#renda-carregando")?.remove();
    const caixa = el.querySelector<HTMLElement>("#renda-dispersao")!;
    const canvas = caixa.querySelector("canvas")!;
    const w = caixa.clientWidth;
    const h = Math.round(Math.min(460, Math.max(300, w * 0.85)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    geom = { w, h, esq: 8, dir: 8, cima: 22, baixo: 30 };
    const g = canvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Texto com contorno branco, para ler por cima dos pontos.
    const texto = (t: string, x: number, y: number) => {
      g.save();
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.lineWidth = 3;
      g.lineJoin = "round";
      g.strokeText(t, x, y);
      g.restore();
      g.fillText(t, x, y);
    };
    g.clearRect(0, 0, w, h);

    // Grade discreta e rótulos
    g.font = "12px system-ui, sans-serif";
    g.lineWidth = 1;
    g.strokeStyle = "#ececea";
    g.fillStyle = "#5c5f66";
    for (const r of [1000, 2000, 5000, 10000]) {
      const x = Math.round(xDe(r)) + 0.5;
      g.beginPath();
      g.moveTo(x, geom.cima);
      g.lineTo(x, h - geom.baixo);
      g.stroke();
      g.textAlign = "center";
      texto(`R$ ${r / 1000} mil`, x, h - 10);
    }
    g.strokeStyle = "#c9c9c6";
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(geom.esq, Math.round(yDe(50)) + 0.5);
    g.lineTo(w - geom.dir, Math.round(yDe(50)) + 0.5);
    g.stroke();
    g.setLineDash([]);
    g.textAlign = "right";
    texto("empate", w - geom.dir, Math.round(yDe(50)) - 5);

    // Pontos
    const { pontos } = ctx;
    const lista: number[] = [];
    for (let i = 0; i < pontos.n; i++) {
      if (pontos.a2[i] === SEM || !cam.renda[i]) continue;
      if (uf !== "BR" && municipios[cam.mun[i]][2] !== uf) continue;
      lista.push(i);
    }
    visiveis = Int32Array.from(lista);
    px = new Float32Array(visiveis.length);
    py = new Float32Array(visiveis.length);
    const raio = visiveis.length > 20000 ? 1.1 : 1.8;
    g.globalAlpha = visiveis.length > 20000 ? 0.45 : 0.7;
    for (let k = 0; k < visiveis.length; k++) {
      const i = visiveis[k];
      px[k] = xDe(cam.renda[i]);
      // espalha um pouco no eixo y (os percentuais são inteiros) para não formar faixas
      py[k] = yDe(pontos.a2[i] + ((i * 2654435761) % 1000) / 1000 - 0.5);
      g.fillStyle = PALETA[pontos.a2[i]];
      g.fillRect(px[k] - raio, py[k] - raio, raio * 2, raio * 2);
    }
    g.globalAlpha = 1;

    // Linha da média em faixas finas de renda (média dos locais, pesada pelos eleitores aptos)
    const N = 28;
    const soma = new Float64Array(N);
    const peso = new Float64Array(N);
    for (let k = 0; k < visiveis.length; k++) {
      const i = visiveis[k];
      const b = Math.min(N - 1, Math.max(0, Math.floor(((Math.log(cam.renda[i]) - Math.log(R_MIN)) / (Math.log(R_MAX) - Math.log(R_MIN))) * N)));
      soma[b] += pontos.a2[i] * cam.aptos[i];
      peso[b] += cam.aptos[i];
    }
    g.lineWidth = 2.5;
    g.strokeStyle = "#18181b";
    g.beginPath();
    let comecou = false;
    for (let b = 0; b < N; b++) {
      if (peso[b] < 20000) continue; // faixas com pouca gente oscilam demais
      const r = Math.exp(Math.log(R_MIN) + ((b + 0.5) / N) * (Math.log(R_MAX) - Math.log(R_MIN)));
      const x = xDe(r);
      const y = yDe(soma[b] / peso[b]);
      if (comecou) g.lineTo(x, y);
      else g.moveTo(x, y);
      comecou = true;
    }
    g.stroke();

    // Rótulos dos lados (texto sempre na cor do texto, a cor fica no marcador)
    g.textAlign = "left";
    g.fillStyle = "#18181b";
    g.font = "600 12px system-ui, sans-serif";
    texto(`↑ ${nomeCurto(meta, na)}`, geom.esq, 14);
    texto(`↓ ${nomeCurto(meta, nb)}`, geom.esq, h - geom.baixo - 6);
    g.textAlign = "right";
    g.font = "12px system-ui, sans-serif";
    g.fillStyle = "#5c5f66";
    texto("— média da faixa de renda", w - geom.dir, 14);
  }

  function configurarToque() {
    const caixa = el.querySelector<HTMLElement>("#renda-dispersao")!;
    const canvas = caixa.querySelector("canvas")!;
    let dica: HTMLElement | null = null;

    const maisPerto = (x: number, y: number) => {
      let melhor = -1;
      let d = 26 * 26; // alvo de toque de ~26 px
      for (let k = 0; k < visiveis.length; k++) {
        const dx = px[k] - x;
        const dy = py[k] - y;
        const dd = dx * dx + dy * dy;
        if (dd < d) {
          d = dd;
          melhor = k;
        }
      }
      return melhor;
    };

    const mostrar = async (k: number) => {
      dica?.remove();
      if (k < 0) return;
      const cam = await ctx.camadas;
      const i = visiveis[k];
      const m = municipios[cam.mun[i]];
      const pa = ctx.pontos.a2[i];
      dica = document.createElement("div");
      dica.className = "dica";
      dica.innerHTML = `
        <strong>${escapeHtml(titleCase(m[1]))} – ${escapeHtml(m[2])}</strong>
        Renda do entorno: ${brl(cam.renda[i])}<br />
        ${A} ${pa}% · ${B} ${100 - pa}%
        <button type="button">Ver o local no mapa</button>`;
      dica.querySelector("button")!.addEventListener("click", () => ctx.abrirLocal(i));
      const x = Math.min(geom.w - 238, Math.max(0, px[k] - 115));
      const y = py[k] > geom.h / 2 ? py[k] - 130 : py[k] + 14;
      dica.style.left = `${x}px`;
      dica.style.top = `${y}px`;
      caixa.appendChild(dica);
    };

    canvas.addEventListener("click", (ev) => {
      const r = canvas.getBoundingClientRect();
      void mostrar(maisPerto(ev.clientX - r.left, ev.clientY - r.top));
    });
  }

  // Chamado quando a página aparece.
  return () => {
    if (!montado) {
      montar();
      montado = true;
    }
    void desenhar();
  };
}
