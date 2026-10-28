import type { FeatureCollection, Point } from "geojson";
import {
  type GeoJSONSource,
  type LngLatBoundsLike,
  Map as MapLibre,
  type MapMouseEvent,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

import {
  type Camadas,
  loadCamadas,
  loadDetalhe,
  loadMeta,
  loadMunicipios,
  loadPontos,
  type Meta,
  type MunicipioInfo,
  type Pontos,
} from "./data";
import { escapeHtml, titleCase } from "./format";
import { camadas as listaCamadas, type Camada } from "./layers";
import { nomeCurto, renderLocal } from "./panel";
import { setupRenda } from "./renda";
import { setupSearch } from "./search";
import { criarFolha } from "./sheet";
import { setupSobre } from "./sobre";

const BRASIL: LngLatBoundsLike = [
  [-74, -33.8],
  [-34.8, 5.3],
];
const computador = window.matchMedia("(min-width: 900px)");

// O worker do MapLibre é copiado para public/ (npm run copiar-worker): servido sem transformação,
// porque o Vite em modo dev injeta código de página nele e o worker quebra.
setWorkerUrl(`${import.meta.env.BASE_URL}maplibre/maplibre-gl-worker.mjs`);

// Começa a baixar tudo já, em paralelo com o mapa de fundo.
const pMeta = loadMeta();
const pPontos = loadPontos();
const pMunicipios = loadMunicipios();
let pCamadas: Promise<Camadas> | null = null;
const camadasProntas = () => (pCamadas ??= loadCamadas());

const map = new MapLibre({
  container: "mapa",
  style: "https://tiles.openfreemap.org/styles/positron",
  bounds: BRASIL,
  // No celular, o Brasil cabe entre a busca (em cima) e o cartão da legenda (embaixo).
  fitBoundsOptions: { padding: computador.matches ? { top: 20, bottom: 20, left: 400, right: 20 } : { top: 120, bottom: 220, left: 8, right: 8 } },
  attributionControl: { compact: true },
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  maxZoom: 17.5,
});
map.touchZoomRotate.disableRotation();
if (computador.matches) map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
const mapaPronto = new Promise<void>((r) => map.once("load", () => r()));

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const conteudo = $("#folha-conteudo");

function avisar(texto: string) {
  const el = $("#aviso");
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(Number(el.dataset.timer));
  el.dataset.timer = String(setTimeout(() => (el.hidden = true), 2600));
}

async function compartilhar(titulo: string, texto: string, url = location.href) {
  try {
    if (navigator.share) {
      await navigator.share({ title: titulo, text: texto, url });
      return;
    }
  } catch (e) {
    if ((e as DOMException).name === "AbortError") return; // a pessoa cancelou
  }
  try {
    await navigator.clipboard.writeText(`${texto} ${url}`);
    avisar("Link copiado");
  } catch {
    prompt("Copie o link:", url);
  }
}

// ---------- Mapa ----------

function geojson(p: Pontos, c: Camadas | null): FeatureCollection<Point> {
  const features = new Array(p.n);
  for (let i = 0; i < p.n; i++) {
    features[i] = {
      type: "Feature",
      id: i,
      geometry: { type: "Point", coordinates: [p.lon[i], p.lat[i]] },
      properties: c
        ? {
            a2: p.a2[i],
            aprox: p.aprox[i],
            a1: c.a1[i],
            b1: c.b1[i],
            v1: c.v1[i],
            v1pct: c.v1pct[i],
            comp2: c.comp2[i],
            bn2: c.bn2[i],
            renda: c.renda[i],
          }
        : { a2: p.a2[i], aprox: p.aprox[i] },
    };
  }
  return { type: "FeatureCollection", features };
}

function nomesEmPortugues() {
  for (const layer of map.getStyle().layers) {
    if (layer.type === "symbol" && map.getLayoutProperty(layer.id, "text-field")) {
      map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name:pt"], ["get", "name"]]);
    }
  }
}

function setupCamadas(lista: Camada[]) {
  const nav = $("#camadas");
  const legenda = $("#legenda");
  nav.innerHTML = lista
    .map(
      (c, i) =>
        `<button type="button" data-id="${c.id}" aria-pressed="${i === 0}" ${c.completa ? "disabled" : ""}>${escapeHtml(c.rotulo)}</button>`,
    )
    .join("");
  const escolher = (id: string) => {
    const c = lista.find((x) => x.id === id)!;
    map.setPaintProperty("locais", "circle-color", c.cor);
    legenda.innerHTML = c.legenda;
    nav.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === id)));
  };
  nav.addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
    if (b && !b.disabled) escolher(b.dataset.id!);
  });
  escolher(lista[0].id);
  return () => nav.querySelectorAll("button").forEach((b) => (b.disabled = false));
}

// A altura do cartão de baixo decide onde fica o botão "perto de mim".
new ResizeObserver(([e]) => {
  document.documentElement.style.setProperty("--resumo-altura", `${Math.round(e.contentRect.height + 24)}px`);
}).observe($("#resumo"));

// ---------- Folha do local ----------

const folha = criarFolha($("#folha"), conteudo, () => {
  (map.getSource("selecionado") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
  if (location.hash.startsWith("#/local/")) {
    if (history.state?.folha) history.back();
    else history.replaceState(null, "", "#/");
  }
});

/** Espaço que a folha ocupa, para o ponto não ficar escondido atrás dela. */
const margemFolha = () =>
  computador.matches
    ? { top: 40, bottom: 40, left: 420, right: 440 }
    : { top: 130, bottom: Math.min(450, Math.round(innerHeight * 0.6)) + 20, left: 30, right: 30 };

async function abrirLocal(
  ctx: { meta: Meta; municipios: MunicipioInfo[]; pontos: Pontos },
  i: number,
  opcoes: { voar?: boolean; historico?: "push" | "replace" } = {},
) {
  const { meta, municipios, pontos } = ctx;
  mostrar("mapa");
  (map.getSource("selecionado") as GeoJSONSource).setData({
    type: "Point",
    coordinates: [pontos.lon[i], pontos.lat[i]],
  });
  conteudo.innerHTML = '<p class="nota" style="padding-top:8px">Carregando…</p>';
  folha.abrir();
  const centro: [number, number] = [pontos.lon[i], pontos.lat[i]];
  if (opcoes.voar) map.flyTo({ center: centro, zoom: Math.max(map.getZoom(), 15), padding: margemFolha(), speed: 1.6 });
  // Tocou com o país inteiro na tela: aproxima um pouco, para a pessoa ver onde fica.
  else map.easeTo({ center: centro, zoom: Math.max(map.getZoom(), 9), padding: margemFolha(), duration: 600 });

  try {
    const cam = await camadasProntas();
    const mun = municipios[cam.mun[i]];
    const det = await loadDetalhe(mun, cam.zona[i]);
    const local = det.locais[cam.pos[i]];
    conteudo.innerHTML = renderLocal(meta, mun, local);
    conteudo.scrollTop = 0;
    const hash = `#/local/${local.id}`;
    if (location.hash !== hash) {
      if (opcoes.historico === "replace" || location.hash.startsWith("#/local/")) history.replaceState({ folha: true }, "", hash);
      else history.pushState({ folha: true }, "", hash);
    }
    conteudo.querySelector("[data-compartilhar]")?.addEventListener("click", () => {
      const t2 = local.turnos["2"];
      const [na, nb] = meta.segundo_turno;
      const va = t2?.votos?.[na] ?? 0;
      const vb = t2?.votos?.[nb] ?? 0;
      const vence = va >= vb ? nomeCurto(meta, na) : nomeCurto(meta, nb);
      const p = Math.round((100 * Math.max(va, vb)) / Math.max(1, va + vb));
      compartilhar(
        `${titleCase(local.nome)} – ${titleCase(mun[1])}`,
        `Em ${titleCase(local.nome)} (${titleCase(mun[1])}), ${vence} teve ${p}% dos votos válidos no 2º turno. Veja o seu local de votação:`,
      );
    });
  } catch {
    conteudo.innerHTML = '<p class="nota" style="padding-top:8px">Não foi possível carregar este local. Verifique a conexão e tente de novo.</p>';
  }
}

// ---------- Páginas ----------

type Aba = "mapa" | "renda" | "sobre";
let aoMostrar: Partial<Record<Aba, () => void>> = {};

function mostrar(aba: Aba) {
  $("#pagina-renda").hidden = aba !== "renda";
  $("#pagina-sobre").hidden = aba !== "sobre";
  document.querySelectorAll<HTMLAnchorElement>("#abas a").forEach((a) => {
    if (a.dataset.aba === aba) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.body.classList.toggle("com-folha", aba === "mapa" && folha.aberta());
  aoMostrar[aba]?.();
}

// ---------- Início ----------

async function iniciar() {
  const [meta, pontos, municipios] = await Promise.all([pMeta, pPontos, pMunicipios, mapaPronto]);
  const ctx = { meta, municipios, pontos };
  nomesEmPortugues();

  map.addSource("locais", { type: "geojson", data: geojson(pontos, null), buffer: 32, tolerance: 0.5 });
  map.addLayer({
    id: "locais",
    type: "circle",
    source: "locais",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 1.3, 5, 1.8, 8, 2.7, 11, 4.5, 14, 8, 16, 11],
      "circle-opacity": ["case", ["==", ["get", "aprox"], 1], 0.5, 0.92],
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 0, 13, 1],
      "circle-stroke-color": "#ffffff",
    },
  });
  map.addSource("selecionado", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "selecionado",
    type: "circle",
    source: "selecionado",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 7, 12, 12, 16, 18],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-width": 3,
      "circle-stroke-color": "#18181b",
    },
  });
  map.addSource("eu", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "eu",
    type: "circle",
    source: "eu",
    paint: { "circle-radius": 8, "circle-color": "#1a73e8", "circle-stroke-width": 3, "circle-stroke-color": "#fff" },
  });

  const [na, nb] = meta.segundo_turno;
  const liberarCamadas = setupCamadas(listaCamadas({ a: nomeCurto(meta, na), b: nomeCurto(meta, nb), numA: na, numB: nb }));
  $("#carregando").remove();

  // Toque: o local mais perto do dedo, num raio de ~16 px (pontos pequenos são difíceis de acertar).
  map.on("click", (ev: MapMouseEvent) => {
    const r = computador.matches ? 8 : 16;
    const { x, y } = ev.point;
    const achados = map.queryRenderedFeatures(
      [
        [x - r, y - r],
        [x + r, y + r],
      ],
      { layers: ["locais"] },
    );
    if (!achados.length) {
      if (folha.aberta()) folha.fechar();
      return;
    }
    let melhor = achados[0];
    let d = Infinity;
    for (const f of achados) {
      const p = map.project((f.geometry as Point).coordinates as [number, number]);
      const dd = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (dd < d) {
        d = dd;
        melhor = f;
      }
    }
    void abrirLocal(ctx, Number(melhor.id));
  });
  map.on("mouseenter", "locais", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "locais", () => (map.getCanvas().style.cursor = ""));

  // O resto das camadas chega em segundo plano.
  camadasProntas()
    .then((cam) => {
      (map.getSource("locais") as GeoJSONSource).setData(geojson(pontos, cam));
      liberarCamadas();
    })
    .catch(() => avisar("Algumas camadas não carregaram. Recarregue a página."));

  function pertoDeMim() {
    if (!navigator.geolocation) return avisar("Seu navegador não informa a localização.");
    avisar("Procurando você…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const c: [number, number] = [coords.longitude, coords.latitude];
        (map.getSource("eu") as GeoJSONSource).setData({ type: "Point", coordinates: c });
        mostrar("mapa");
        if (folha.aberta()) folha.fechar();
        map.flyTo({ center: c, zoom: 14.5, speed: 1.6 });
        $("#aviso").hidden = true;
      },
      () => avisar("Não foi possível pegar sua localização."),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }
  $("#perto").addEventListener("click", pertoDeMim);

  setupSearch(
    municipios,
    async () => (await camadasProntas()).mun,
    async (e) => {
      mostrar("mapa");
      if (location.hash !== "#/" && !location.hash.startsWith("#/local/")) history.replaceState(null, "", "#/");
      if (e.local != null) return abrirLocal(ctx, e.local, { voar: true });
      const cam = await camadasProntas();
      let [x0, y0, x1, y1] = [180, 90, -180, -90];
      for (let i = 0; i < pontos.n; i++) {
        if (cam.mun[i] !== e.municipio) continue;
        x0 = Math.min(x0, pontos.lon[i]);
        x1 = Math.max(x1, pontos.lon[i]);
        y0 = Math.min(y0, pontos.lat[i]);
        y1 = Math.max(y1, pontos.lat[i]);
      }
      if (folha.aberta()) folha.fechar();
      if (x0 <= x1)
        map.fitBounds(
          [
            [x0, y0],
            [x1, y1],
          ],
          { padding: computador.matches ? { top: 60, bottom: 60, left: 430, right: 60 } : { top: 130, bottom: 190, left: 30, right: 30 }, maxZoom: 15 },
        );
    },
    pertoDeMim,
  );

  aoMostrar = {
    renda: setupRenda($("#pagina-renda"), {
      meta,
      municipios,
      pontos,
      camadas: camadasProntas(),
      abrirLocal: (i) => {
        history.pushState(null, "", "#/");
        void abrirLocal(ctx, i, { voar: true, historico: "replace" });
      },
      compartilhar: (t, x) => compartilhar(t, x),
    }),
    sobre: setupSobre($("#pagina-sobre"), meta),
  };

  // Rotas: #/ (mapa), #/local/<id>, #/renda, #/sobre
  async function rota() {
    const h = location.hash;
    if (h === "#/renda") return mostrar("renda");
    if (h === "#/sobre") return mostrar("sobre");
    mostrar("mapa");
    const m = h.match(/^#\/local\/(\d{5})-(\d+)-(\d+)$/);
    if (!m) {
      if (folha.aberta()) folha.fechar();
      return;
    }
    const id = m[0].slice(8);
    const munIdx = municipios.findIndex((x) => x[0] === m[1]);
    if (munIdx < 0) return;
    const cam = await camadasProntas();
    const det = await loadDetalhe(municipios[munIdx], Number(m[2]));
    const pos = det.locais.findIndex((l) => l.id === id);
    for (let i = 0; i < pontos.n; i++) {
      if (cam.mun[i] === munIdx && cam.pos[i] === pos && cam.zona[i] === Number(m[2])) {
        return abrirLocal(ctx, i, { voar: true, historico: "replace" });
      }
    }
    avisar("Este local não está no mapa.");
  }
  // Voltar e avançar do navegador também disparam hashchange (pushState/replaceState não).
  window.addEventListener("hashchange", () => void rota());
  void rota();
}

document.addEventListener("keydown", (ev) => ev.key === "Escape" && folha.aberta() && folha.fechar());
$("#folha-fechar").addEventListener("click", () => folha.fechar());

iniciar().catch(() => {
  const el = document.querySelector("#carregando");
  if (el) el.textContent = "Não foi possível carregar os dados. Recarregue a página.";
  else avisar("Algo deu errado. Recarregue a página.");
});
