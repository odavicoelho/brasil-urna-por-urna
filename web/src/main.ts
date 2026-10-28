import type { FeatureCollection, Point } from "geojson";
import {
  type GeoJSONSource,
  type LngLatBoundsLike,
  Map as MapLibre,
  type MapMouseEvent,
  NavigationControl,
  type PaddingOptions,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

import { contar, revelar } from "./anima";
import { type Acao, ativarCarrossel, setupDescobertas } from "./descobertas";
import { type Camadas, loadCamadas, loadDetalhe, loadMeta, loadMunicipios, loadPontos, type Pontos } from "./data";
import { escapeHtml, titleCase } from "./format";
import { type Camada, camadas as listaCamadas, COR_A, COR_B, gradiente } from "./layers";
import { estiloBrasil, mascaraSobDemanda } from "./mapa";
import { criarModal, fecharModais } from "./modal";
import { ICONE, nomeCurto, renderCarregandoLocal, renderInicio, renderLocal } from "./panel";
import { setupRenda } from "./renda";
import { setupSearch } from "./search";
import { type Altura, criarPainel } from "./sheet";
import { setupSobre } from "./sobre";

const BRASIL: LngLatBoundsLike = [
  [-73.99, -33.75],
  [-34.79, 5.27],
];
const computador = window.matchMedia("(min-width: 900px)");
const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;

// O worker do MapLibre é copiado para public/ (npm run copiar-worker): servido sem transformação,
// porque o Vite em modo dev injeta código de página nele e o worker quebra.
setWorkerUrl(`${import.meta.env.BASE_URL}maplibre/maplibre-gl-worker.mjs`);

// Começa a baixar tudo já, em paralelo.
const pMeta = loadMeta();
const pPontos = loadPontos();
const pMunicipios = loadMunicipios();
const pEstilo = estiloBrasil();
let pCamadas: Promise<Camadas> | null = null;
const camadasProntas = () => (pCamadas ??= loadCamadas());

// ---------- Painel (folha de baixo / barra lateral) ----------

const painel = criarPainel($("#painel"), $("#vistas"), () => document.querySelector("#cartao-brasil"));
type Vista = "inicio" | "busca" | "local";
let vista: Vista = "inicio";

function mostrarVista(v: Vista, voltando = false) {
  if (v === vista) return;
  for (const id of ["inicio", "busca", "local"] as const) $(`#vista-${id}`).hidden = id !== v;
  const el = $(`#vista-${v}`);
  el.classList.remove("entrando", "voltando");
  void el.offsetWidth;
  el.classList.add(voltando ? "voltando" : "entrando");
  $("#vistas").scrollTop = 0;
  vista = v;
}

function avisar(texto: string) {
  const el = $("#aviso");
  el.textContent = texto;
  el.hidden = false;
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
  clearTimeout(Number(el.dataset.timer));
  el.dataset.timer = String(setTimeout(() => (el.hidden = true), 2400));
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

/** Margens da câmera: o que a legenda e o painel escondem do mapa. */
function margens(altura?: Altura): PaddingOptions {
  if (computador.matches) return { top: 100, bottom: 40, left: 440, right: 80 };
  const topo = ($("#flutuantes").getBoundingClientRect().bottom || 90) + 14;
  return { top: topo, bottom: painel.visivel(altura) + 16, left: 20, right: 20 };
}

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

// ---------- Início ----------

async function iniciar() {
  const [meta, pontos, municipios, estilo] = await Promise.all([pMeta, pPontos, pMunicipios, pEstilo]);
  const [na, nb] = meta.segundo_turno;

  $("#vista-inicio").innerHTML = renderInicio(meta);
  document.querySelectorAll<HTMLElement>("#vista-inicio .carrossel-caixa").forEach(ativarCarrossel);
  painel.ir("mini");
  contar($("#vista-inicio"));
  revelar($("#vista-inicio"));

  const map = new MapLibre({
    container: "mapa",
    style: estilo,
    bounds: BRASIL,
    // Começa um pouco mais longe e assenta no Brasil quando os pontos aparecem.
    fitBoundsOptions: { padding: { ...margens("mini"), left: 60, right: 60 } },
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    minZoom: 2.5,
    maxZoom: 17.5,
    // Folgado na vertical: numa tela alta de celular, um limite justo obrigaria o mapa a aproximar.
    maxBounds: [
      [-110, -72],
      [0, 38],
    ],
  });
  map.touchZoomRotate.disableRotation();
  if (computador.matches) map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
  await new Promise<void>((r) => map.once("load", () => r()));
  mascaraSobDemanda(map);
  // Créditos do mapa: o MapLibre reabre sozinho quando o texto muda; aqui só abrem se a pessoa tocar no "i".
  const creditos = document.querySelector(".maplibregl-ctrl-attrib");
  creditos?.querySelector(".maplibregl-ctrl-attrib-button")?.addEventListener("click", () => {
    const abrir = !creditos.classList.contains("creditos-abertos");
    // depois do clique do próprio MapLibre, que alterna a classe dele
    setTimeout(() => {
      creditos.classList.toggle("creditos-abertos", abrir);
      creditos.classList.toggle("maplibregl-compact-show", abrir);
    });
  });

  // Pontos: entram transparentes e aparecem suavemente; a cor também anima ao trocar de camada.
  map.addSource("locais", { type: "geojson", data: geojson(pontos, null), buffer: 32, tolerance: 0.5 });
  map.addLayer({
    id: "locais",
    type: "circle",
    source: "locais",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 1.25, 5, 1.8, 8, 2.8, 11, 4.6, 14, 8, 16, 11],
      "circle-opacity": 0,
      "circle-opacity-transition": { duration: 1000, delay: 0 },
      "circle-color-transition": { duration: 550, delay: 0 },
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 0, 13, 1.2],
      "circle-stroke-color": "#ffffff",
    },
  });
  for (const id of ["pulso", "selecionado", "eu"]) {
    map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  map.addLayer({
    id: "pulso",
    type: "circle",
    source: "pulso",
    paint: { "circle-radius": 14, "circle-color": "#1c1c1e", "circle-opacity": 0 },
  });
  map.addLayer({
    id: "selecionado",
    type: "circle",
    source: "selecionado",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 7, 12, 11, 16, 15],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-width": 3,
      "circle-stroke-color": "#1c1c1e",
    },
  });
  map.addLayer({
    id: "eu",
    type: "circle",
    source: "eu",
    paint: { "circle-radius": 8, "circle-color": "#1c1c1e", "circle-stroke-width": 3, "circle-stroke-color": "#fff" },
  });
  requestAnimationFrame(() =>
    map.setPaintProperty("locais", "circle-opacity", ["case", ["==", ["get", "aprox"], 1], 0.5, 0.92]),
  );

  // Onda que pulsa em volta do local escolhido.
  let pulsando = 0;
  function pulsar(c: [number, number] | null) {
    cancelAnimationFrame(pulsando);
    const dados = c ? { type: "Point" as const, coordinates: c } : { type: "FeatureCollection" as const, features: [] };
    (map.getSource("pulso") as GeoJSONSource).setData(dados);
    (map.getSource("selecionado") as GeoJSONSource).setData(dados);
    if (!c) return;
    const t0 = performance.now();
    const passo = (t: number) => {
      const p = ((t - t0) % 1700) / 1700;
      map.setPaintProperty("pulso", "circle-radius", 10 + 24 * p);
      map.setPaintProperty("pulso", "circle-opacity", 0.3 * (1 - p) ** 1.5);
      pulsando = requestAnimationFrame(passo);
    };
    pulsando = requestAnimationFrame(passo);
  }

  // ---------- Camadas e legenda ----------
  const lista = listaCamadas({ a: nomeCurto(meta, na), b: nomeCurto(meta, nb), numA: na, numB: nb });
  let camadaAtual = lista[0];
  let completas = false;

  function desenharLegenda(c: Camada) {
    const esperando = c.completa && !completas;
    const esquerda = c.candidatos
      ? `<span><i class="ponto" style="background:${COR_B}"></i>${escapeHtml(c.esquerda)}</span>`
      : `<span>${escapeHtml(c.esquerda)}</span>`;
    const direita = c.candidatos
      ? `<span>${escapeHtml(c.direita)}<i class="ponto" style="background:${COR_A}"></i></span>`
      : `<span>${escapeHtml(c.direita)}</span>`;
    $("#legenda").innerHTML = `<div class="legenda-conteudo">
      <div class="legenda-topo">${escapeHtml(c.rotulo)} ${ICONE.baixo}
        ${esperando ? '<span class="girando carregando"></span>' : ""}</div>
      <div class="legenda-barra" style="background:${gradiente(c.cores)}"></div>
      <div class="legenda-pontas">${esquerda}${direita}</div></div>`;
  }

  const modalCamadas = criarModal($("#modal-camadas"), "O que o mapa mostra");
  const grade = document.createElement("div");
  grade.className = "grade-camadas";
  modalCamadas.corpo.replaceWith(grade);
  function renderCamadas() {
    grade.innerHTML = lista
      .map(
        (c) => `<button class="camada" type="button" data-id="${c.id}" aria-pressed="${c.id === camadaAtual.id}"
          ${c.completa && !completas ? "disabled" : ""}>
          <span class="previa" style="background:${gradiente(c.cores)}"></span>
          <strong>${escapeHtml(c.rotulo)}</strong><small>${escapeHtml(c.descricao)}</small></button>`,
      )
      .join("");
  }
  function escolherCamada(c: Camada) {
    const mudou = c.id !== camadaAtual.id;
    camadaAtual = c;
    map.setPaintProperty("locais", "circle-color", c.cor);
    if (mudou || completas) desenharLegenda(c);
    renderCamadas();
  }
  grade.addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
    if (!b || b.disabled) return;
    escolherCamada(lista.find((x) => x.id === b.dataset.id)!);
    setTimeout(() => modalCamadas.fechar(), 200);
  });
  $("#legenda").addEventListener("click", () => modalCamadas.abrir());
  $("#botao-camadas").addEventListener("click", () => modalCamadas.abrir());
  map.setPaintProperty("locais", "circle-color", camadaAtual.cor);
  desenharLegenda(camadaAtual);
  renderCamadas();

  // O resto das camadas chega em segundo plano.
  camadasProntas()
    .then((cam) => {
      (map.getSource("locais") as GeoJSONSource).setData(geojson(pontos, cam));
      completas = true;
      escolherCamada(camadaAtual);
    })
    .catch(() => avisar("Algumas camadas não carregaram"));

  // ---------- Local ----------
  let localAberto: number | null = null;

  /** Volta para o mapa: desfaz a entrada no histórico, se foi o app que a criou. */
  function sair() {
    if (history.state?.app) history.back();
    else history.replaceState(null, "", "#/");
  }

  function fecharLocal(navegar = true) {
    if (localAberto == null) return;
    localAberto = null;
    pulsar(null);
    mostrarVista("inicio", true);
    painel.ir("mini");
    if (navegar && location.hash.startsWith("#/local/")) sair();
  }

  async function abrirLocal(i: number, opcoes: { voar?: boolean; substituir?: boolean } = {}) {
    fecharModais();
    localAberto = i;
    const c: [number, number] = [pontos.lon[i], pontos.lat[i]];
    pulsar(c);
    $("#vista-local").innerHTML = renderCarregandoLocal();
    mostrarVista("local");
    painel.ir("meio");
    const zoom = opcoes.voar ? Math.max(map.getZoom(), 15) : Math.max(map.getZoom(), 9);
    map.flyTo({ center: c, zoom, padding: margens("meio"), speed: 1.4, curve: 1.5, essential: true });

    try {
      const cam = await camadasProntas();
      const mun = municipios[cam.mun[i]];
      const det = await loadDetalhe(mun, cam.zona[i]);
      if (localAberto !== i) return;
      const local = det.locais[cam.pos[i]];
      const el = $("#vista-local");
      el.innerHTML = renderLocal(meta, mun, local);
      contar(el);
      revelar(el);
      const hash = `#/local/${local.id}`;
      if (location.hash !== hash) {
        if (opcoes.substituir || location.hash.startsWith("#/local/")) history.replaceState({ app: true }, "", hash);
        else history.pushState({ app: true }, "", hash);
      }
      el.querySelector("[data-compartilhar]")?.addEventListener("click", () => {
        const t2 = local.turnos["2"];
        const va = t2?.votos?.[na] ?? 0;
        const vb = t2?.votos?.[nb] ?? 0;
        const vence = va >= vb ? nomeCurto(meta, na) : nomeCurto(meta, nb);
        const p = Math.round((100 * Math.max(va, vb)) / Math.max(1, va + vb));
        void compartilhar(
          `${titleCase(local.nome)} – ${titleCase(mun[1])}`,
          `Em ${titleCase(local.nome)} (${titleCase(mun[1])}), ${vence} teve ${p}% dos votos válidos no 2º turno. Veja como votou o seu local:`,
        );
      });
    } catch {
      if (localAberto === i)
        $("#vista-local").innerHTML = `<div class="local-cabeca"><h2>Sem conexão</h2>
          <p>Não foi possível carregar este local. Tente de novo.</p>
          <button class="fechar" type="button" data-fechar aria-label="Fechar">${ICONE.fechar}</button></div>`;
    }
  }

  $("#vista-local").addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).closest("[data-fechar]")) fecharLocal();
  });

  // Toque no mapa: o local mais perto do dedo, num raio de ~18 px (pontos pequenos são difíceis de acertar).
  map.on("click", (ev: MapMouseEvent) => {
    const r = computador.matches ? 8 : 18;
    const { x, y } = ev.point;
    const achados = map.queryRenderedFeatures(
      [
        [x - r, y - r],
        [x + r, y + r],
      ],
      { layers: ["locais"] },
    );
    if (!achados.length) {
      if (vista === "local") fecharLocal();
      else if (!computador.matches && painel.altura() !== "mini") painel.ir("mini");
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
    void abrirLocal(Number(melhor.id));
  });
  map.on("mouseenter", "locais", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "locais", () => (map.getCanvas().style.cursor = ""));

  // ---------- Perto de mim ----------
  function pertoDeMim() {
    if (!navigator.geolocation) return avisar("Seu navegador não informa a localização");
    avisar("Procurando você…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const c: [number, number] = [coords.longitude, coords.latitude];
        (map.getSource("eu") as GeoJSONSource).setData({ type: "Point", coordinates: c });
        fecharModais();
        if (localAberto != null) fecharLocal();
        painel.ir("mini");
        map.flyTo({ center: c, zoom: 14.5, padding: margens("mini"), speed: 1.4 });
        $("#aviso").hidden = true;
      },
      () => avisar("Não foi possível pegar sua localização"),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }
  $("#botao-perto").addEventListener("click", pertoDeMim);

  /** Enquadra todos os locais de um município (índice em municipios.json). */
  async function verMunicipio(idx: number) {
    if (localAberto != null) fecharLocal();
    mostrarVista("inicio", true);
    painel.ir("mini");
    const cam = await camadasProntas();
    let [x0, y0, x1, y1] = [180, 90, -180, -90];
    for (let i = 0; i < pontos.n; i++) {
      if (cam.mun[i] !== idx) continue;
      x0 = Math.min(x0, pontos.lon[i]);
      x1 = Math.max(x1, pontos.lon[i]);
      y0 = Math.min(y0, pontos.lat[i]);
      y1 = Math.max(y1, pontos.lat[i]);
    }
    if (x0 <= x1)
      map.fitBounds(
        [
          [x0, y0],
          [x1, y1],
        ],
        { padding: margens("mini"), maxZoom: 14.5, duration: 1600 },
      );
  }

  // ---------- Busca ----------
  let vistaAntesDaBusca: Vista = "inicio";
  setupSearch({
    municipios,
    munDoLocal: async () => (await camadasProntas()).mun,
    aoAbrir: () => {
      if (vista !== "busca") vistaAntesDaBusca = vista;
      mostrarVista("busca");
      painel.ir("cheia");
    },
    aoFechar: () => {
      mostrarVista(vistaAntesDaBusca, true);
      painel.ir(vistaAntesDaBusca === "local" ? "meio" : "mini");
    },
    aoEscolher: async (e) => {
      if (e.local != null) return abrirLocal(e.local, { voar: true });
      await verMunicipio(e.municipio!);
    },
    pertoDeMim,
  });

  // ---------- Cartões: Renda e voto, Como foi feito ----------
  const modalRenda = criarModal($("#modal-renda"), "Renda e voto", sair);
  const modalSobre = criarModal($("#modal-sobre"), "Como foi feito", sair);
  const mostrarRenda = setupRenda(modalRenda.corpo, {
    meta,
    municipios,
    pontos,
    camadas: camadasProntas(),
    abrirLocal: (i) => void abrirLocal(i, { voar: true, substituir: true }),
    compartilhar: (t, x) => void compartilhar(t, x),
  });
  const mostrarSobre = setupSobre(modalSobre.corpo, meta);
  const modalDescobertas = criarModal($("#modal-descobertas"), "Descobertas", sair);

  /** "Ver no mapa" das descobertas: troca a camada, enquadra uma cidade ou abre um local. */
  async function irPara(a: Acao) {
    if (a.rota) {
      history.replaceState({ app: true }, "", a.rota);
      return void rota();
    }
    if (a.local) {
      history.replaceState({ app: true }, "", `#/local/${a.local}`);
      return void rota();
    }
    fecharModais();
    history.replaceState(null, "", "#/");
    if (a.camada) {
      const c = lista.find((x) => x.id === a.camada);
      if (c) {
        if (c.completa) await camadasProntas();
        escolherCamada(c);
      }
    }
    const idx = a.municipio ? municipios.findIndex((m) => m[0] === a.municipio) : -1;
    if (idx >= 0) await verMunicipio(idx);
    else {
      if (localAberto != null) fecharLocal(false);
      painel.ir("mini");
      map.fitBounds(BRASIL, { padding: margens("mini"), duration: 1400 });
    }
  }
  const mostrarDescobertas = setupDescobertas(modalDescobertas.corpo, {
    meta,
    irPara: (a) => void irPara(a),
    compartilhar: (t, x, url) => void compartilhar(t, x, url),
    copiar: (texto) =>
      void navigator.clipboard.writeText(texto).then(
        () => avisar("Link copiado"),
        () => prompt("Copie o link:", texto),
      ),
  });

  $("#vista-inicio").addEventListener("click", (ev) => {
    const alvo = ev.target as HTMLElement;
    const d = alvo.closest<HTMLElement>("[data-descoberta]");
    const b = alvo.closest<HTMLElement>("[data-abrir]");
    if (!d && !b) return;
    const destinos: Record<string, string> = {
      renda: "#/renda",
      exterior: "#/sobre/exterior",
      fontes: "#/sobre/fontes",
      sobre: "#/sobre",
      descobertas: "#/descobertas",
    };
    history.pushState({ app: true }, "", d ? `#/descobertas/${d.dataset.descoberta}` : destinos[b!.dataset.abrir!]);
    void rota();
  });

  // ---------- Rotas: #/ (mapa), #/local/<id>, #/renda, #/sobre ----------
  async function rota() {
    const h = location.hash;
    if (h === "#/renda") {
      modalRenda.abrir();
      return mostrarRenda();
    }
    if (h.startsWith("#/descobertas")) {
      modalDescobertas.abrir();
      return mostrarDescobertas(h.split("/")[2]);
    }
    if (h.startsWith("#/sobre")) {
      modalSobre.abrir();
      return mostrarSobre(h.split("/")[2]);
    }
    fecharModais();
    const m = h.match(/^#\/local\/(\d{5})-(\d+)-(\d+)$/);
    if (!m) return fecharLocal(false);
    const id = m[0].slice(8);
    const munIdx = municipios.findIndex((x) => x[0] === m[1]);
    if (munIdx < 0) return;
    const cam = await camadasProntas();
    const zona = Number(m[2]);
    const det = await loadDetalhe(municipios[munIdx], zona);
    const pos = det.locais.findIndex((l) => l.id === id);
    for (let i = 0; i < pontos.n; i++) {
      if (cam.mun[i] === munIdx && cam.zona[i] === zona && cam.pos[i] === pos) {
        if (localAberto !== i) void abrirLocal(i, { voar: true, substituir: true });
        return;
      }
    }
    avisar("Este local não está no mapa");
  }
  // Voltar e avançar do navegador disparam hashchange (pushState/replaceState não).
  window.addEventListener("hashchange", () => void rota());

  // Abertura: os pontos aparecem e a câmera assenta suavemente no Brasil.
  if (location.hash && location.hash !== "#/") void rota();
  else map.fitBounds(BRASIL, { padding: margens("mini"), duration: 1600 });
}

iniciar().catch((e) => {
  console.error(e);
  $("#legenda").innerHTML = '<div class="legenda-topo">Não foi possível carregar. Recarregue a página.</div>';
});
