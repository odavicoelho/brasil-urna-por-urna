// Estilo do mapa de fundo: só o Brasil.
// De longe, o mapa é o nosso contorno (brasil.json: país branco, divisas e siglas dos estados) sobre a cor do
// mar; nenhum tile do OpenFreeMap é baixado. A partir do zoom ZOOM_RUAS entram as ruas do OpenFreeMap
// (estilo Positron) e a máscara (mascara.json) cobre os outros países com a mesma cor do mar.

import type { GeoJSONSource, LayerSpecification, Map as MapLibre, StyleSpecification } from "maplibre-gl";

const POSITRON = "https://tiles.openfreemap.org/styles/positron";
const DADOS = `${import.meta.env.BASE_URL}dados/`;
export const ZOOM_RUAS = 6.5;

export const MAR = "#dce6ef";
const TERRA_LONGE = "#fdfdfc";
const TERRA_PERTO = "#f5f5f2";

// Camadas do Positron que não fazem sentido aqui (outros países, fronteiras, relevo).
const FORA = new Set(["boundary_2", "boundary_disputed", "label_country_1", "label_country_2", "label_country_3"]);

export async function estiloBrasil(): Promise<StyleSpecification> {
  const base = (await (await fetch(POSITRON)).json()) as StyleSpecification;
  const positron: LayerSpecification[] = [];
  let fundo: LayerSpecification | null = null;
  for (const l of base.layers) {
    if (FORA.has(l.id) || ("source" in l && l.source === "ne2_shaded")) continue;
    if (l.type === "background") {
      fundo = {
        ...l,
        paint: { "background-color": ["interpolate", ["linear"], ["zoom"], 6, MAR, 7.5, TERRA_PERTO] },
      };
      continue;
    }
    const c = { ...l, minzoom: Math.max(l.minzoom ?? 0, ZOOM_RUAS) } as LayerSpecification;
    if (c.id === "water" && c.type === "fill") c.paint = { ...c.paint, "fill-color": MAR };
    if (c.type === "symbol" && c.layout?.["text-field"]) {
      c.layout = { ...c.layout, "text-field": ["coalesce", ["get", "name:pt"], ["get", "name"]] };
    }
    positron.push(c);
  }
  const sources = { ...base.sources };
  delete (sources as Record<string, unknown>).ne2_shaded;

  const transicao = (perto: number, longe = 1): ["interpolate", ["linear"], ["zoom"], number, number, number, number] => [
    "interpolate", ["linear"], ["zoom"], ZOOM_RUAS - 0.5, longe, ZOOM_RUAS + 1.5, perto,
  ];

  return {
    ...base,
    sources: {
      ...sources,
      brasil: { type: "geojson", data: `${DADOS}brasil.json` },
      mascara: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
      fundo ?? { id: "background", type: "background", paint: { "background-color": MAR } },
      {
        id: "br-terra",
        type: "fill",
        source: "brasil",
        filter: ["==", ["get", "tipo"], "pais"],
        paint: { "fill-color": TERRA_LONGE, "fill-opacity": transicao(0) },
      },
      ...positron,
      {
        id: "br-mascara",
        type: "fill",
        source: "mascara",
        minzoom: 5,
        paint: { "fill-color": MAR },
      },
      {
        id: "br-divisas",
        type: "line",
        source: "brasil",
        filter: ["==", ["get", "tipo"], "divisa"],
        paint: {
          "line-color": "#c5ccd4",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 7, 1.2],
          "line-opacity": transicao(0),
        },
      },
      {
        id: "br-contorno",
        type: "line",
        source: "brasil",
        filter: ["==", ["get", "tipo"], "pais"],
        paint: {
          "line-color": "#aab4bf",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 7, 1.5],
          "line-opacity": transicao(0),
        },
      },
      {
        id: "br-siglas",
        type: "symbol",
        source: "brasil",
        maxzoom: ZOOM_RUAS,
        filter: ["==", ["get", "tipo"], "sigla"],
        layout: {
          "text-field": ["get", "uf"],
          "text-font": ["Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 9, 6, 12],
          "text-letter-spacing": 0.08,
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "rgba(60,60,67,0.42)",
          "text-halo-color": "rgba(255,255,255,0.85)",
          "text-halo-width": 1.2,
        },
      },
    ],
  };
}

/** A máscara dos outros países só é baixada quando alguém aproxima o mapa. */
export function mascaraSobDemanda(map: MapLibre): void {
  let pedida = false;
  const ver = () => {
    if (pedida || map.getZoom() < 4.8) return;
    pedida = true;
    fetch(`${DADOS}mascara.json`)
      .then((r) => r.json())
      .then((g) => (map.getSource("mascara") as GeoJSONSource | undefined)?.setData(g))
      .catch(() => (pedida = false));
  };
  map.on("zoomend", ver);
  ver();
}
