// Carrega os arquivos gerados pelo pipeline (`urna publish`) em public/dados/.

const BASE = `${import.meta.env.BASE_URL}dados/`;

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

export interface Meta {
  eleicao: string;
  gerado_em: string;
  candidatos: Candidato[];
  totais: Totais[];
  segundo_turno: [number, number];
  locais: { locais_com_urna: number; locais_exterior: number; locais_sem_ponto: number; locais_no_mapa: number };
}

// Um array por campo, todos na mesma ordem.
export interface Locais {
  id: string[];
  lat: number[];
  lon: number[];
  mun: string[];
  aprox: number[];
  aptos: number[];
  v1: (number | null)[];
  v1pct: (number | null)[];
  a1: number[];
  a2: number[];
  b1: number[];
  b2: number[];
  comp1: (number | null)[];
  comp2: (number | null)[];
  bn1: (number | null)[];
  bn2: (number | null)[];
}

export interface Busca {
  nome: string[];
  bairro: string[];
  municipio: string[];
  uf: string[];
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

export interface Municipio {
  municipio: string;
  uf: string;
  locais: Record<string, Local>;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return (await r.json()) as T;
}

export const loadMeta = () => get<Meta>("meta.json");
export const loadLocais = () => get<Locais>("locais.json");

let busca: Promise<Busca> | null = null;
export const loadBusca = () => (busca ??= get<Busca>("busca.json"));

const municipios = new Map<string, Promise<Municipio>>();
export function loadMunicipio(codigo: string): Promise<Municipio> {
  let p = municipios.get(codigo);
  if (!p) {
    p = get<Municipio>(`municipios/${codigo}.json`);
    municipios.set(codigo, p);
  }
  return p;
}
