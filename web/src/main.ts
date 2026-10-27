import type { FeatureCollection, Point } from "geojson";
import {
  type GeoJSONSource,
  Map as MapLibre,
  type MapLayerMouseEvent,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

import { loadLocais, loadMeta, loadMunicipio, type Locais, type Meta } from "./data";
import { escapeHtml, titleCase } from "./format";
import { camadas, type Camada } from "./layers";
import { renderLocal } from "./panel";
import { setupSearch } from "./search";

const BRASIL: [[number, number], [number, number]] = [
  [-74.5, -34.5],
  [-28.5, 6],
];

// O worker do MapLibre é copiado para public/ (npm run copiar-worker): servido sem transformação,
// porque o Vite em modo dev injeta código de página nele e o worker quebra.
setWorkerUrl(`${import.meta.env.BASE_URL}maplibre/maplibre-gl-worker.mjs`);

const map = new MapLibre({
  container: "mapa",
  style: "https://tiles.openfreemap.org/styles/positron",
  bounds: BRASIL,
  fitBoundsOptions: { padding: 20 },
  attributionControl: { compact: true },
});
map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");

const painel = document.querySelector<HTMLElement>("#painel")!;
const conteudo = document.querySelector<HTMLElement>("#painel-conteudo")!;

function toGeoJSON(l: Locais): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: l.id.map((_, i) => ({
      type: "Feature",
      id: i,
      geometry: { type: "Point", coordinates: [l.lon[i], l.lat[i]] },
      properties: {
        aprox: l.aprox[i],
        v1: l.v1[i],
        v1pct: l.v1pct[i],
        a1: l.a1[i],
        a2: l.a2[i],
        b1: l.b1[i],
        b2: l.b2[i],
        comp2: l.comp2[i],
        bn2: l.bn2[i],
      },
    })),
  };
}

function nomes(meta: Meta) {
  const [numA, numB] = meta.segundo_turno;
  const nome = (n: number) => {
    const c = meta.candidatos.find((x) => x.turno === 2 && x.numero === n);
    return c ? titleCase(c.nome) : `Nº ${n}`;
  };
  return { a: nome(numA), b: nome(numB), numA, numB };
}

function setupLayers(lista: Camada[]) {
  const nav = document.querySelector<HTMLElement>("#camadas")!;
  const legenda = document.querySelector<HTMLElement>("#legenda")!;
  nav.innerHTML = lista
    .map((c, i) => `<button data-id="${c.id}" aria-pressed="${i === 0}">${escapeHtml(c.rotulo)}</button>`)
    .join("");
  const escolher = (id: string) => {
    const c = lista.find((x) => x.id === id)!;
    map.setPaintProperty("locais", "circle-color", c.cor);
    legenda.innerHTML = c.legenda;
    nav.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === id)));
  };
  nav.addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
    if (b) escolher(b.dataset.id!);
  });
  escolher(lista[0].id);
}

async function abrir(meta: Meta, locais: Locais, i: number) {
  const fonte = map.getSource("selecionado") as GeoJSONSource;
  fonte.setData({ type: "Point", coordinates: [locais.lon[i], locais.lat[i]] });
  painel.hidden = false;
  document.body.classList.add("com-painel");
  conteudo.innerHTML = '<p class="nota">Carregando…</p>';
  try {
    const mun = await loadMunicipio(locais.mun[i]);
    const local = mun.locais[locais.id[i]];
    conteudo.innerHTML = local ? renderLocal(meta, mun, local) : '<p class="nota">Local não encontrado.</p>';
    conteudo.scrollTop = 0;
  } catch {
    conteudo.innerHTML = '<p class="nota">Não foi possível carregar este local. Tente de novo.</p>';
  }
}

function fechar() {
  painel.hidden = true;
  document.body.classList.remove("com-painel");
  (map.getSource("selecionado") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
}

// Nomes do mapa de fundo em português, quando o OpenStreetMap tem.
function nomesEmPortugues() {
  for (const layer of map.getStyle().layers) {
    if (layer.type === "symbol" && map.getLayoutProperty(layer.id, "text-field")) {
      map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name:pt"], ["get", "name"]]);
    }
  }
}

// Registrado já na criação do mapa: o evento "load" pode acontecer antes dos dados chegarem.
const mapaPronto = new Promise<void>((r) => map.once("load", () => r()));

async function iniciar() {
  const [meta, locais] = await Promise.all([loadMeta(), loadLocais(), mapaPronto]);
  nomesEmPortugues();

  map.addSource("locais", { type: "geojson", data: toGeoJSON(locais) });
  map.addLayer({
    id: "locais",
    type: "circle",
    source: "locais",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 1.1, 6, 1.8, 9, 3, 12, 6, 15, 10],
      "circle-opacity": ["case", ["==", ["get", "aprox"], 1], 0.45, 0.9],
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 0, 12, 0.8],
      "circle-stroke-color": "#ffffff",
    },
  });
  map.addSource("selecionado", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "selecionado",
    type: "circle",
    source: "selecionado",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 6, 12, 11, 15, 16],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-width": 2.5,
      "circle-stroke-color": "#111111",
    },
  });

  setupLayers(camadas(nomes(meta)));

  map.on("click", "locais", (ev: MapLayerMouseEvent) => {
    const f = ev.features?.[0];
    if (f?.id != null) void abrir(meta, locais, Number(f.id));
  });
  map.on("mouseenter", "locais", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "locais", () => (map.getCanvas().style.cursor = ""));

  setupSearch((i) => {
    map.flyTo({ center: [locais.lon[i], locais.lat[i]], zoom: 15 });
    void abrir(meta, locais, i);
  });

  document.querySelector("#carregando")!.remove();
}

document.querySelector("#painel-fechar")!.addEventListener("click", fechar);
document.addEventListener("keydown", (ev) => ev.key === "Escape" && fechar());

iniciar().catch(() => {
  document.querySelector("#carregando")!.textContent = "Não foi possível carregar os dados. Recarregue a página.";
});
