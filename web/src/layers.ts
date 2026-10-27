// As camadas do mapa: o que pinta cada ponto e a legenda de cada uma.
// Cores neutras para os dois candidatos do 2º turno (roxo e verde, nenhuma é cor de partido):
// o de menor número na urna fica com o roxo.

import type { ExpressionSpecification } from "maplibre-gl";
import { escapeHtml } from "./format";

export const ROXO = ["#f2e8f3", "#c2a5cf", "#9970ab", "#762a83", "#40004b"];
export const VERDE = ["#e8f5e4", "#a6dba0", "#5aae61", "#1b7837", "#00441b"];
const NEUTRO = "#f4f4f2";
const SEM_DADO = "#b8b8b8";
const OUTROS = "#7a7a7a";
const AZUL = ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"];
const LARANJA = ["#fff5eb", "#fdd0a2", "#fd8d3c", "#d94801", "#7f2704"];

export interface Nomes {
  a: string; // candidato roxo (menor número), ex.: "Fulano (13)"
  b: string;
  numA: number;
  numB: number;
}

export interface Camada {
  id: string;
  rotulo: string;
  cor: ExpressionSpecification;
  legenda: string;
}

const teve2Turno: ExpressionSpecification = [">", ["+", ["get", "a2"], ["get", "b2"]], 0];

function faixa(titulo: string, cores: string[], esquerda: string, direita: string, nota = ""): string {
  const gradiente = `linear-gradient(to right, ${cores.join(", ")})`;
  return `
    <p class="legenda-titulo">${titulo}</p>
    <div class="legenda-barra" style="background:${gradiente}"></div>
    <div class="legenda-pontas"><span>${esquerda}</span><span>${direita}</span></div>
    ${nota ? `<p class="legenda-nota">${nota}</p>` : ""}`;
}

export function camadas(n: Nomes): Camada[] {
  const a = escapeHtml(n.a);
  const b = escapeHtml(n.b);
  const divergente = [...VERDE].reverse().concat([NEUTRO], ROXO);
  return [
    {
      id: "segundo",
      rotulo: "2º turno",
      cor: [
        "case",
        teve2Turno,
        ["interpolate", ["linear"], ["get", "a2"],
          0, VERDE[4], 20, VERDE[3], 40, VERDE[1], 50, NEUTRO, 60, ROXO[1], 80, ROXO[3], 100, ROXO[4]],
        SEM_DADO,
      ],
      legenda: faixa(
        "Votos válidos no 2º turno",
        divergente,
        `${b} 100%`,
        `${a} 100%`,
        "No meio, empate. Quanto mais forte a cor, maior a vantagem.",
      ),
    },
    {
      id: "primeiro",
      rotulo: "1º turno",
      cor: [
        "match",
        ["get", "v1"],
        n.numA,
        ["interpolate", ["linear"], ["get", "v1pct"], 30, ROXO[1], 50, ROXO[2], 70, ROXO[3], 90, ROXO[4]],
        n.numB,
        ["interpolate", ["linear"], ["get", "v1pct"], 30, VERDE[1], 50, VERDE[2], 70, VERDE[3], 90, VERDE[4]],
        OUTROS,
      ],
      legenda: `
        <p class="legenda-titulo">Mais votado no 1º turno</p>
        <ul class="legenda-itens">
          <li><i style="background:${ROXO[3]}"></i>${a}</li>
          <li><i style="background:${VERDE[3]}"></i>${b}</li>
          <li><i style="background:${OUTROS}"></i>Outro candidato</li>
        </ul>
        <p class="legenda-nota">Quanto mais forte a cor, maior a fatia dos votos válidos.</p>`,
    },
    {
      id: "variacao",
      rotulo: "Variação",
      cor: [
        "case",
        teve2Turno,
        ["interpolate", ["linear"],
          ["-", ["-", ["get", "a2"], ["get", "a1"]], ["-", ["get", "b2"], ["get", "b1"]]],
          -20, VERDE[4], -10, VERDE[3], -3, VERDE[1], 0, NEUTRO, 3, ROXO[1], 10, ROXO[3], 20, ROXO[4]],
        SEM_DADO,
      ],
      legenda: faixa(
        "Quem mais cresceu do 1º para o 2º turno",
        divergente,
        `${b} +20 p.p. ou mais`,
        `${a} +20 p.p. ou mais`,
        "Crescimento de cada um em pontos percentuais dos votos válidos, um menos o outro.",
      ),
    },
    {
      id: "comparecimento",
      rotulo: "Comparecimento",
      cor: [
        "case",
        ["!=", ["get", "comp2"], null],
        ["interpolate", ["linear"], ["get", "comp2"], 60, AZUL[0], 70, AZUL[1], 78, AZUL[2], 85, AZUL[3], 92, AZUL[4]],
        SEM_DADO,
      ],
      legenda: faixa("Comparecimento no 2º turno", AZUL, "60% ou menos", "92% ou mais"),
    },
    {
      id: "brancos",
      rotulo: "Brancos e nulos",
      cor: [
        "case",
        ["!=", ["get", "bn2"], null],
        ["interpolate", ["linear"], ["get", "bn2"], 0, LARANJA[0], 3, LARANJA[1], 6, LARANJA[2], 10, LARANJA[3], 15, LARANJA[4]],
        SEM_DADO,
      ],
      legenda: faixa("Brancos e nulos no 2º turno", LARANJA, "0%", "15% ou mais", "Em relação a quem compareceu."),
    },
  ];
}
