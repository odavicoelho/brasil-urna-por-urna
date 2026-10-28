// Página "Como foi feito": de onde vêm os dados, a conferência com os totais oficiais, o que ficou de fora
// do mapa e os votos no exterior (exterior.json, baixado só quando a página abre).

import { loadExterior, type Meta } from "./data";
import { escapeHtml, num, pct, share, titleCase } from "./format";
import { barraDividida, nomeCurto } from "./panel";

const REPO = "https://github.com/odavicoelho/brasil-urna-por-urna";
const AUTOR = "https://davicoelho-comercial.vercel.app/";

const NOMES_CONFERENCIA: Record<string, string> = {
  "votos por candidato x UF (oficial)": "Votos de cada candidato em cada UF = total oficial do TSE",
  "comparecimento, brancos e nulos x UF (oficial)": "Comparecimento, brancos e nulos em cada UF = total oficial",
  "seção: arquivo de votos = arquivo de detalhe": "Cada seção: os dois arquivos do TSE batem entre si",
  "seção: aptos = comparecimento + abstenções": "Cada seção: aptos = comparecimento + abstenções",
  "seção: comparecimento = soma dos votos": "Cada seção: comparecimento = soma de todos os votos",
  "seções com local de votação cadastrado": "Cada seção ligada a um local de votação cadastrado",
};

export function setupSobre(el: HTMLElement, meta: Meta): () => void {
  let montado = false;
  const [na, nb] = meta.segundo_turno;
  const A = escapeHtml(nomeCurto(meta, na));
  const B = escapeHtml(nomeCurto(meta, nb));
  const L = meta.locais;

  function conferencia(): string {
    const linhas = meta.conferencia.conferencias
      .map((c) => {
        const status =
          c.status === "ok"
            ? '<span class="ok">✓ bate</span>'
            : c.status === "aguardando"
              ? '<span class="pendente">aguardando o TSE</span>'
              : `<span class="pendente">${num(c.divergentes)} diferenças</span>`;
        return `<tr><td>${escapeHtml(NOMES_CONFERENCIA[c.nome] ?? c.nome)}</td><td>${c.turno}º</td>
          <td class="n">${c.comparados ? num(c.comparados) : "—"}</td><td>${status}</td></tr>`;
      })
      .join("");
    return `<table class="tabela"><thead><tr><th>Conferência</th><th>Turno</th><th class="n">Itens</th><th>Resultado</th></tr></thead>
      <tbody>${linhas}</tbody></table>`;
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
                  ? `${A} ${pct(share(c.va, c.va + c.vb))} · ${num(c.va + c.vb)} votos`
                  : "sem votos no 2º turno"
              }</span></summary>
            ${barraDividida("mini-barra", c.va, c.vb)}
            <ul>${c.locais
              .map((l) => `<li>${escapeHtml(titleCase(l.nome))}: ${A} ${num(l.va)} · ${B} ${num(l.vb)}</li>`)
              .join("")}</ul>
          </details>`,
        )
        .join("");
    } catch {
      alvo.innerHTML = '<p class="nota">Não foi possível carregar a lista agora.</p>';
    }
  }

  function montar() {
    const br = meta.totais.find((t) => t.turno === 2)!;
    el.innerHTML = `<div class="pagina-corpo">
      <h1>Como foi feito</h1>
      <p class="lide">O resultado oficial sai por município. Aqui ele aparece em cada um dos
        <strong>${num(L.locais_no_mapa)}</strong> locais de votação do Brasil: a escola, o clube, a faculdade
        onde as pessoas votaram. São os mesmos números do TSE, só que com muito mais detalhe.</p>

      <section>
        <h2>De onde vêm os dados</h2>
        <p>Tudo é dado aberto e oficial. Do <a href="https://dadosabertos.tse.jus.br/" target="_blank" rel="noopener">TSE</a>:
          os votos de cada seção eleitoral, o cadastro dos locais de votação (com endereço e coordenadas) e os totais
          oficiais. Do <a href="https://www.ibge.gov.br/estatisticas/sociais/trabalho/22827-censo-demografico-2022.html" target="_blank" rel="noopener">IBGE</a>:
          o Censo 2022 por setor censitário (renda, idade, alfabetização, cor ou raça).</p>
        <p>As seções de cada local foram somadas. O perfil do entorno junta os setores censitários num raio de 500 m de
          cada local, pesando cada setor pela parte da área dele que cai dentro do círculo. Na zona rural, onde 500 m
          pegariam quase ninguém, uso o setor onde o local fica.</p>
      </section>

      <section>
        <h2>Conferido contra os totais oficiais</h2>
        <p>Antes de publicar, o programa soma tudo de novo e compara com os números oficiais do TSE. Se qualquer
          conferência falha, nada é publicado. No 2º turno, ${A} teve <strong>${num(br.votos[na])}</strong> votos e
          ${B}, <strong>${num(br.votos[nb])}</strong>, exatamente como na totalização oficial.</p>
        <div style="overflow-x:auto">${conferencia()}</div>
      </section>

      <section>
        <h2>O que ficou fora do mapa</h2>
        <p><strong>${num(L.locais_sem_ponto)}</strong> locais (${num(L.secoes_sem_ponto)} seções, menos de 1% dos votos)
          não aparecem no mapa porque o cadastro do TSE traz a coordenada errada ou vazia e não deu para achar o
          endereço com segurança. Os votos deles estão em todos os totais; só falta o ponto.</p>
        <p>Alguns pontos aparecem mais claros: a coordenada do TSE estava errada e o local foi posto pelo CEP, então a
          posição é aproximada.</p>
      </section>

      <section>
        <h2>Como ler o mapa</h2>
        <p>Cada ponto é um local de votação. As cores são neutras de propósito (roxo e verde não são cores de partido).
          O perfil do entorno é uma aproximação: mostra quem mora perto do local, e o eleitor costuma votar perto de
          casa, mas nem sempre. O voto é secreto; nada aqui diz como uma pessoa votou.</p>
      </section>

      <section>
        <h2>Votos no exterior</h2>
        <p>${num(L.locais_exterior)} locais em embaixadas e consulados, agrupados por cidade (2º turno).</p>
        <div class="cidades" id="sobre-exterior"><p class="nota">Carregando…</p></div>
      </section>

      <section>
        <h2>Código aberto</h2>
        <p>Todo o código, do download dos arquivos do TSE até este site, está no
          <a href="${REPO}" target="_blank" rel="noopener">GitHub</a>. Dá para refazer tudo do zero e conferir.</p>
      </section>

      <p class="rodape-pagina">Feito por <a href="${AUTOR}" target="_blank" rel="noopener">Davi Coelho</a>.
        Dados atualizados em ${new Date(meta.gerado_em).toLocaleDateString("pt-BR")}.
        Mapa de fundo: © OpenStreetMap, OpenFreeMap.</p></div>`;
    void exterior();
  }

  return () => {
    if (!montado) {
      montar();
      montado = true;
    }
  };
}
