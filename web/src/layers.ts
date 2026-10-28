// As camadas do mapa: o que pinta cada ponto, a legenda e a prévia no seletor de camadas.
// O candidato de menor número no 2º turno (A) fica vermelho, o outro (B) azul. Par validado para
// daltonismo (ΔE 24 em protanopia). Nos dados, percentuais vão de 0 a 100 e 255 = "sem dado" (data.ts).

import type { ExpressionSpecification } from "maplibre-gl";

export const VERMELHO = ["#fde7e4", "#f6a99f", "#e8604f", "#d62d20", "#8f1209"];
export const AZUL = ["#e5eefb", "#9dbdee", "#5089dc", "#1f5fbf", "#0c3a86"];
export const NEUTRO = "#efeff1";
export const COR_A = VERMELHO[3];
export const COR_B = AZUL[3];
const SEM_DADO = "#c7c7cc";
const OUTROS = "#8e8e93";
const VIOLETA = ["#f1edf8", "#cbbde6", "#9c84cc", "#6e4fae", "#47297f"];
const AMBAR = ["#fdf6e3", "#f6dc96", "#e9b54a", "#c88a12", "#8a5b00"];
const PETROLEO = ["#e6f2f2", "#a9d3d1", "#5fa8a6", "#2a7b7c", "#0b4f52"];

export interface Nomes {
  a: string; // ex.: "Lula"
  b: string;
  numA: number;
  numB: number;
}

export interface Camada {
  id: string;
  rotulo: string;
  descricao: string;
  /** Precisa de camadas.bin (o que chega depois de pontos.bin). */
  completa: boolean;
  cor: ExpressionSpecification;
  /** Faixa de cores e os rótulos das pontas, para a legenda e a prévia. */
  cores: string[];
  esquerda: string;
  direita: string;
  /** Pontas com a cor do candidato (legenda com bolinhas). */
  candidatos?: boolean;
}

const tem = (campo: string): ExpressionSpecification => ["!=", ["get", campo], 255];
const teve2Turno = tem("a2");

export function camadas(n: Nomes): Camada[] {
  const divergente = [...AZUL].reverse().concat([NEUTRO], VERMELHO);
  return [
    {
      id: "segundo",
      rotulo: "2º turno",
      descricao: "Quem venceu em cada local e por quanto",
      completa: false,
      cor: [
        "case",
        teve2Turno,
        ["interpolate", ["linear"], ["get", "a2"],
          0, AZUL[4], 20, AZUL[3], 40, AZUL[1], 50, NEUTRO, 60, VERMELHO[1], 80, VERMELHO[3], 100, VERMELHO[4]],
        SEM_DADO,
      ],
      cores: divergente,
      esquerda: n.b,
      direita: n.a,
      candidatos: true,
    },
    {
      id: "primeiro",
      rotulo: "1º turno",
      descricao: "O mais votado em cada local",
      completa: true,
      cor: [
        "case",
        ["==", ["get", "v1"], n.numA],
        ["interpolate", ["linear"], ["get", "v1pct"], 30, VERMELHO[1], 50, VERMELHO[2], 70, VERMELHO[3], 90, VERMELHO[4]],
        ["==", ["get", "v1"], n.numB],
        ["interpolate", ["linear"], ["get", "v1pct"], 30, AZUL[1], 50, AZUL[2], 70, AZUL[3], 90, AZUL[4]],
        ["==", ["get", "v1"], 0],
        SEM_DADO,
        OUTROS,
      ],
      cores: [AZUL[3], AZUL[1], NEUTRO, VERMELHO[1], VERMELHO[3]],
      esquerda: n.b,
      direita: n.a,
      candidatos: true,
    },
    {
      id: "variacao",
      rotulo: "Quem cresceu",
      descricao: "Quem ganhou mais votos do 1º para o 2º turno",
      completa: true,
      cor: [
        "case",
        ["all", teve2Turno, tem("a1"), tem("b1")],
        ["interpolate", ["linear"],
          // crescimento de A menos crescimento de B, em pontos percentuais; B no 2º turno = 100 - a2
          ["-", ["-", ["get", "a2"], ["get", "a1"]], ["-", ["-", 100, ["get", "a2"]], ["get", "b1"]]],
          -20, AZUL[4], -10, AZUL[3], -3, AZUL[1], 0, NEUTRO, 3, VERMELHO[1], 10, VERMELHO[3], 20, VERMELHO[4]],
        SEM_DADO,
      ],
      cores: divergente,
      esquerda: `${n.b} cresceu mais`,
      direita: `${n.a} cresceu mais`,
      candidatos: true,
    },
    {
      id: "renda",
      rotulo: "Renda",
      descricao: "Renda média de quem mora até 500 m do local",
      completa: true,
      cor: [
        "case",
        ["!=", ["get", "renda"], 0],
        ["interpolate", ["linear"], ["get", "renda"],
          1000, PETROLEO[0], 1700, PETROLEO[1], 2700, PETROLEO[2], 4500, PETROLEO[3], 9000, PETROLEO[4]],
        SEM_DADO,
      ],
      cores: PETROLEO,
      esquerda: "R$ 1 mil",
      direita: "R$ 9 mil ou mais",
    },
    {
      id: "comparecimento",
      rotulo: "Comparecimento",
      descricao: "Quantos eleitores foram votar no 2º turno",
      completa: true,
      cor: [
        "case",
        tem("comp2"),
        ["interpolate", ["linear"], ["get", "comp2"], 60, VIOLETA[0], 70, VIOLETA[1], 78, VIOLETA[2], 85, VIOLETA[3], 92, VIOLETA[4]],
        SEM_DADO,
      ],
      cores: VIOLETA,
      esquerda: "60%",
      direita: "92% ou mais",
    },
    {
      id: "brancos",
      rotulo: "Brancos e nulos",
      descricao: "Votos brancos e nulos no 2º turno",
      completa: true,
      cor: [
        "case",
        tem("bn2"),
        ["interpolate", ["linear"], ["get", "bn2"], 0, AMBAR[0], 3, AMBAR[1], 6, AMBAR[2], 10, AMBAR[3], 15, AMBAR[4]],
        SEM_DADO,
      ],
      cores: AMBAR,
      esquerda: "0%",
      direita: "15% ou mais",
    },
  ];
}

export const gradiente = (cores: string[]) => `linear-gradient(90deg, ${cores.join(", ")})`;
