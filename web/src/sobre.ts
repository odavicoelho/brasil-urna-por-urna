// "Como foi feito": de onde vêm os dados, a conferência com os totais oficiais, o que ficou fora do mapa e os
// votos no exterior (exterior.json, baixado só quando o cartão abre).

import { revelar } from "./anima";
import { loadExterior, type Meta } from "./data";
import { dataBR, escapeHtml, num, share, titleCase } from "./format";
import { COR_A, COR_B } from "./layers";
import { barraDupla, nomeCurto } from "./panel";

const REPO = "https://github.com/odavicoelho/brasil-urna-por-urna";
const AUTOR = "https://davicoelho-comercial.vercel.app/";

// Nome legível de cada arquivo baixado pelo pipeline (chaves de meta.fontes).
const NOMES_FONTES: Record<string, string> = {
  votos_secao: "Votos por seção eleitoral",
  detalhe_secao: "Comparecimento, brancos e nulos por seção",
  locais: "Locais de votação (endereços e coordenadas)",
  candidatos: "Candidatos",
  totais_votos: "Totais oficiais por candidato",
  totais_detalhe: "Totais oficiais de comparecimento",
  municipios_ibge: "Contorno dos municípios (malha 2025)",
  setores_ibge: "Contorno dos setores censitários (Censo 2022)",
  censo_basico: "Censo 2022: população e domicílios",
  censo_demografia: "Censo 2022: idade",
  censo_alfabetizacao: "Censo 2022: alfabetização",
  censo_cor_raca: "Censo 2022: cor ou raça",
  censo_renda: "Censo 2022: renda do responsável",
};

const NOMES_CONFERENCIA: Record<string, string> = {
  "votos por candidato x UF (oficial)": "Votos de cada candidato em cada UF = total oficial do TSE",
  "comparecimento, brancos e nulos x UF (oficial)": "Comparecimento, brancos e nulos em cada UF = total oficial",
  "seção: arquivo de votos = arquivo de detalhe": "Em cada seção, os dois arquivos do TSE batem",
  "seção: aptos = comparecimento + abstenções": "Em cada seção, aptos = comparecimento + abstenções",
  "seção: comparecimento = soma dos votos": "Em cada seção, comparecimento = soma dos votos",
  "seções com local de votação cadastrado": "Cada seção ligada a um local de votação",
};

export function setupSobre(el: HTMLElement, meta: Meta): (ancora?: string) => void {
  let montado = false;
  const [na, nb] = meta.segundo_turno;
  const A = escapeHtml(nomeCurto(meta, na));
  const B = escapeHtml(nomeCurto(meta, nb));
  const L = meta.locais;

  function conferencia(): string {
    return meta.conferencia.conferencias
      .map((c) => {
        const status =
          c.status === "ok"
            ? '<span class="ok">✓ Bate</span>'
            : c.status === "aguardando"
              ? '<span class="pendente">Aguardando o TSE</span>'
              : `<span class="pendente">${num(c.divergentes)} diferenças</span>`;
        return `<tr><td>${escapeHtml(NOMES_CONFERENCIA[c.nome] ?? c.nome)}<br />
          <span class="secundario">${c.turno}º turno${c.comparados ? ` · ${num(c.comparados)} itens` : ""}</span></td>
          <td class="n">${status}</td></tr>`;
      })
      .join("");
  }

  function fontes(): string {
    return Object.entries(meta.fontes)
      .map(([k, f]) => ({ k, f, orgao: new URL(f.url).hostname.endsWith("tse.jus.br") ? "TSE" : "IBGE" }))
      .sort((a, b) => {
        const t = (x: string | null) => (x ? new Date(x).getTime() : 0);
        return b.orgao.localeCompare(a.orgao) || t(b.f.atualizado_em) - t(a.f.atualizado_em); // TSE primeiro, mais novo no topo
      })
      .map(
        ({ k, f, orgao }) => `<tr><td><a href="${escapeHtml(f.url)}" target="_blank" rel="noopener">${escapeHtml(NOMES_FONTES[k] ?? k)}</a><br />
          <span class="secundario">${orgao}</span></td>
          <td class="n">${f.atualizado_em ? dataBR(new Date(f.atualizado_em)) : "—"}</td></tr>`,
      )
      .join("");
  }

  async function exterior() {
    const alvo = el.querySelector<HTMLElement>("#sobre-exterior")!;
    try {
      const dados = await loadExterior();
      const cidades = Object.values(dados)
        .map((c) => {
          let va = 0;
          let vb = 0;
          const locais = c.locais.map((l) => {
            const v = l.turnos["2"]?.votos ?? {};
            va += v[na] ?? 0;
            vb += v[nb] ?? 0;
            return { nome: l.nome, va: v[na] ?? 0, vb: v[nb] ?? 0 };
          });
          return { cidade: c.municipio, va, vb, locais };
        })
        .sort((x, y) => y.va + y.vb - (x.va + x.vb));
      alvo.innerHTML = cidades
        .map(
          (c) => `
          <details>
            <summary><strong>${escapeHtml(titleCase(c.cidade))}</strong>
              <span>${
                c.va + c.vb
                  ? `<span style="color:${COR_A}">${Math.round(share(c.va, c.va + c.vb))}%</span> · <span style="color:${COR_B}">${Math.round(share(c.vb, c.va + c.vb))}%</span> · ${num(c.va + c.vb)} votos`
                  : "sem votos no 2º turno"
              }</span></summary>
            <div>
              ${barraDupla(c.va, c.vb, "fina")}
              <ul>${c.locais
                .map((l) => `<li>${escapeHtml(titleCase(l.nome))}: ${A} ${num(l.va)} · ${B} ${num(l.vb)}</li>`)
                .join("")}</ul>
            </div>
          </details>`,
        )
        .join("");
    } catch {
      alvo.innerHTML = '<p class="nota">Não foi possível carregar a lista agora.</p>';
    }
  }

  function montar() {
    const br = meta.totais.find((t) => t.turno === 2)!;
    el.innerHTML = `
      <h1 class="titulo-grande">Como foi feito</h1>
      <p class="lide">O resultado oficial sai por município. Aqui ele aparece em cada um dos
        <strong>${num(L.locais_no_mapa)}</strong> locais de votação do Brasil: a escola, o clube, a faculdade onde as
        pessoas votaram. São os mesmos números do TSE, com muito mais detalhe.</p>

      <p class="titulo-secao">Conferido contra o TSE</p>
      <div class="cartao">
        <div class="placar-cabeca"><span>Total do 2º turno, somando todos os locais</span></div>
        <div class="placar compacto">
          <div><span class="nome"><i class="ponto" style="background:${COR_A}"></i>${A}</span>
            <span class="pct">${num(br.votos[na])}</span></div>
          <div><span class="nome">${B}<i class="ponto" style="background:${COR_B}"></i></span>
            <span class="pct">${num(br.votos[nb])}</span></div>
        </div>
        <p class="nota">Exatamente os números da totalização oficial. Antes de publicar, o programa soma tudo de novo
          e compara com o TSE; se qualquer conferência falha, nada é publicado.</p>
      </div>
      <div class="cartao"><table class="tabela"><tbody>${conferencia()}</tbody></table></div>

      <p class="titulo-secao">De onde vêm os dados</p>
      <div class="cartao texto-corrido">
        <p>Tudo é dado aberto e oficial. Do <a href="https://dadosabertos.tse.jus.br/" target="_blank" rel="noopener">TSE</a>:
          os votos de cada seção eleitoral, o cadastro dos locais de votação (com endereço e coordenadas) e os totais
          oficiais. Do <a href="https://www.ibge.gov.br/estatisticas/sociais/trabalho/22827-censo-demografico-2022.html" target="_blank" rel="noopener">IBGE</a>:
          o Censo 2022 por setor censitário e o contorno dos municípios.</p>
        <p>As seções de cada local foram somadas. O perfil do entorno junta os setores censitários num raio de 500 m de
          cada local, pesando cada setor pela parte da área dele que cai dentro do círculo. Na zona rural, onde 500 m
          pegariam quase ninguém, entra o setor onde o local fica.</p>
      </div>

      <p class="titulo-secao" id="sobre-ancora-fontes">Data de cada arquivo</p>
      <div class="cartao">
        <p class="nota" style="margin:0 0 6px">Data de publicação informada pelo próprio servidor do TSE e do IBGE quando
          o arquivo foi baixado. Se uma instituição atualizar um arquivo depois disso, a data dela vai ser mais recente
          que a daqui.</p>
        <table class="tabela"><tbody>${fontes()}</tbody></table>
        <p class="nota">Mapa gerado em ${dataBR(new Date(meta.gerado_em))}.</p>
      </div>

      <p class="titulo-secao">O que ficou fora do mapa</p>
      <div class="cartao texto-corrido">
        <p><strong>${num(L.locais_sem_ponto)}</strong> locais (${num(L.secoes_sem_ponto)} seções, menos de 1% dos
          votos) não aparecem porque o cadastro do TSE traz a coordenada errada ou vazia e não deu para achar o endereço
          com segurança. Os votos deles estão em todos os totais; só falta o ponto.</p>
        <p>Pontos mais claros têm posição aproximada: a coordenada do TSE estava errada e o local foi posto pelo CEP.</p>
        <p>O perfil do entorno é uma aproximação: mostra quem mora perto do local, e o eleitor costuma votar perto de
          casa, mas nem sempre. O voto é secreto; nada aqui diz como uma pessoa votou.</p>
      </div>

      <p class="titulo-secao" id="sobre-ancora-exterior">Votos no exterior · ${num(L.locais_exterior)} locais</p>
      <div class="cartao cidades" id="sobre-exterior"><p class="nota" style="margin:0">Carregando…</p></div>

      <p class="titulo-secao">Código aberto</p>
      <div class="cartao texto-corrido">
        <p>Todo o código, do download dos arquivos do TSE até este site, está no
          <a href="${REPO}" target="_blank" rel="noopener">GitHub</a>. Dá para refazer tudo do zero e conferir.</p>
      </div>

      <p class="rodape">Feito por <a href="${AUTOR}" target="_blank" rel="noopener">Davi Coelho</a>.
        Dados gerados em ${new Date(meta.gerado_em).toLocaleDateString("pt-BR")}.<br />Mapa: © OpenStreetMap, OpenFreeMap.</p>`;
    void exterior().then(() => revelar(el));
  }

  return (ancora?: string) => {
    if (!montado) {
      montar();
      montado = true;
    }
    if (ancora) {
      setTimeout(() => el.querySelector(`#sobre-ancora-${ancora}`)?.scrollIntoView({ behavior: "smooth" }), 450);
    }
  };
}
