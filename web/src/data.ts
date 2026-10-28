// Carrega os arquivos gerados pelo pipeline (`urna publish`) em public/dados/.
// Formato dos .bin: ver pipeline/src/urnaporurna/publish.py (POINT_COLUMNS e LAYER_COLUMNS).

const BASE = `${import.meta.env.BASE_URL}dados/`;

/** Percentuais nos .bin: 0–100; este valor quer dizer "sem dado". */
export const SEM = 255;

export interface Candidato {
  turno: number;
  numero: number;
  nome: string;
  partido: string;
  situacao: string;
}

export interface Totais {
  turno: number;
  aptos: number;
  comparecimento: number;
  abstencoes: number;
  validos: number;
  brancos: number;
  nulos: number;
  votos: Record<string, number>;
}

export interface FaixaRenda {
  faixa: number;
  locais: number;
  renda_min: number;
  renda_max: number;
  aptos: number;
  votos_a: number;
  votos_b: number;
}

export interface Conferencia {
  nome: string;
  turno: number;
  status: "ok" | "aguardando" | "falha";
  comparados: number;
  divergentes: number;
  detalhe: string;
}

export interface Meta {
  eleicao: string;
  gerado_em: string;
  candidatos: Candidato[];
  totais: Totais[];
  segundo_turno: [number, number];
  locais: {
    locais_com_urna: number;
    locais_exterior: number;
    locais_sem_ponto: number;
    secoes_sem_ponto: number;
    locais_no_mapa: number;
  };
  faixas_renda: Record<string, FaixaRenda[]>;
  conferencia: { ok: boolean; conferencias: Conferencia[] };
  fontes: Record<string, { url: string; atualizado_em: string | null }>;
}

/** O que pinta o mapa logo de cara. */
export interface Pontos {
  n: number;
  lon: Float64Array;
  lat: Float64Array;
  aprox: Uint8Array;
  a2: Uint8Array;
}

/** O resto, que chega logo depois. Mesma ordem de `Pontos`. */
export interface Camadas {
  mun: Uint16Array;
  pos: Uint16Array;
  zona: Uint16Array;
  aptos: Uint16Array;
  renda: Uint16Array;
  v1: Uint8Array;
  v1pct: Uint8Array;
  a1: Uint8Array;
  b1: Uint8Array;
  comp1: Uint8Array;
  comp2: Uint8Array;
  bn1: Uint8Array;
  bn2: Uint8Array;
}

/** [código TSE, nome, UF, dividido por zona (0/1), votos do candidato A e do B no 2º turno] */
export type MunicipioInfo = [string, string, string, number, number, number];

export interface Busca {
  nome: string[];
  bairro: string[];
}

export interface Turno {
  aptos: number;
  comparecimento: number;
  abstencoes: number;
  validos: number;
  brancos: number;
  nulos: number;
  votos?: Record<string, number>;
}

export interface Entorno {
  metodo: "raio_500m" | "setor_rural";
  populacao_estimada: number | null;
  renda_media_responsavel: number | null;
  pct_alfabetizados_15_mais: number | null;
  pct_15_a_29_anos: number | null;
  pct_30_a_59_anos: number | null;
  pct_60_anos_ou_mais: number | null;
  pct_branca: number | null;
  pct_preta: number | null;
  pct_parda: number | null;
  pct_amarela: number | null;
  pct_indigena: number | null;
}

export interface Local {
  id: string;
  nome: string;
  tipo: string;
  endereco: string | null;
  bairro: string | null;
  zona: number;
  secoes: number;
  localizacao: "tse" | "geocodificado" | null;
  precisao: "exata" | "aproximada" | null;
  turnos: Record<string, Turno>;
  entorno: Entorno | null;
}

export interface Detalhe {
  municipio: string;
  uf: string;
  locais: Local[];
}

async function fetchOk(path: string): Promise<Response> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r;
}

async function get<T>(path: string): Promise<T> {
  return (await (await fetchOk(path)).json()) as T;
}

/** Os .bin vêm comprimidos com gzip pelo pipeline. Se o servidor já descomprimiu, usa direto. */
async function bytes(path: string): Promise<Uint8Array> {
  const raw = new Uint8Array(await (await fetchOk(path)).arrayBuffer());
  if (raw[0] !== 0x1f || raw[1] !== 0x8b) return raw;
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lê um .bin: cabeçalho "URN1" + N, depois cada coluna com os bytes em planos. */
async function readColumns(path: string, columns: [string, "i" | "H" | "B"][]) {
  const buf = await bytes(path);
  const view = new DataView(buf.buffer);
  if (String.fromCharCode(...buf.subarray(0, 4)) !== "URN1") throw new Error(`${path}: formato desconhecido`);
  const n = view.getUint32(4, true);
  let off = 8;
  const out: Record<string, Int32Array | Uint16Array | Uint8Array> = {};
  for (const [name, code] of columns) {
    const size = code === "i" ? 4 : code === "H" ? 2 : 1;
    // Desfaz os planos: o byte k de cada valor está em off + k*n + i.
    const bytes = new Uint8Array(n * size);
    for (let k = 0; k < size; k++) {
      const plane = buf.subarray(off + k * n, off + (k + 1) * n);
      for (let i = 0; i < n; i++) bytes[i * size + k] = plane[i];
    }
    out[name] = code === "i" ? new Int32Array(bytes.buffer) : code === "H" ? new Uint16Array(bytes.buffer) : bytes;
    off += n * size;
  }
  return { n, cols: out };
}

export async function loadPontos(): Promise<Pontos> {
  const { n, cols } = await readColumns("pontos.bin", [
    ["lon", "i"],
    ["lat", "i"],
    ["aprox", "B"],
    ["a2", "B"],
  ]);
  // Coordenadas vêm em diferenças, × 100.000.
  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  const dLon = cols.lon as Int32Array;
  const dLat = cols.lat as Int32Array;
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    x += dLon[i];
    y += dLat[i];
    lon[i] = x / 1e5;
    lat[i] = y / 1e5;
  }
  return { n, lon, lat, aprox: cols.aprox as Uint8Array, a2: cols.a2 as Uint8Array };
}

export async function loadCamadas(): Promise<Camadas> {
  const { cols } = await readColumns("camadas.bin", [
    ["mun", "H"],
    ["pos", "H"],
    ["zona", "H"],
    ["aptos", "H"],
    ["renda", "H"],
    ["v1", "B"],
    ["v1pct", "B"],
    ["a1", "B"],
    ["b1", "B"],
    ["comp1", "B"],
    ["comp2", "B"],
    ["bn1", "B"],
    ["bn2", "B"],
  ]);
  return cols as unknown as Camadas;
}

export const loadMeta = () => get<Meta>("meta.json");
export const loadMunicipios = () => get<MunicipioInfo[]>("municipios.json");

let busca: Promise<Busca> | null = null;
export const loadBusca = () => (busca ??= get<Busca>("busca.json"));

let exterior: Promise<Record<string, Detalhe>> | null = null;
export const loadExterior = () => (exterior ??= get<Record<string, Detalhe>>("exterior.json"));

const detalhes = new Map<string, Promise<Detalhe>>();
/** O arquivo de detalhe de um local: por município, ou por município e zona nos grandes. */
export function loadDetalhe(mun: MunicipioInfo, zona: number): Promise<Detalhe> {
  const key = mun[3] ? `${mun[0]}-${zona}` : mun[0];
  let p = detalhes.get(key);
  if (!p) {
    p = get<Detalhe>(`detalhe/${key}.json`);
    p.catch(() => detalhes.delete(key)); // deixa tentar de novo se a rede falhar
    detalhes.set(key, p);
  }
  return p;
}
