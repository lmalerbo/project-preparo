# Setup — project-preparo

## Estrutura do repositório

```
project-preparo/
├── index.html                              ← redireciona para formulario.html (GitHub Pages root)
├── portal.html                             ← portal de download dos arquivos por fazenda
└── sistema_preenchimento/
    ├── formulario.html                     ← sistema de preenchimento (SPA)
    ├── favicon.svg
    ├── config.json                         ← config da engine (ex: prefixo de fazenda administrativa)
    ├── supabase_config.example.json        ← template do config local da engine (copiar → supabase_config.json)
    ├── ATUALIZAR.bat                        ← atalho para rodar a engine
    ├── base_preparo/                        ← (local, fora do git) planilha de sequência de preparo
    ├── base_fazendas/                       ← (local, fora do git) base mestre de talhões (área)
    ├── engine/
    │   ├── atualizar_programacao.py        ← lê base_preparo + base_fazendas, faz upsert no Supabase
    │   ├── utils.py
    │   └── requirements.txt
    ├── cloudflare-worker/
    │   └── release-proxy.js               ← Worker Cloudflare (upload para Releases)
    └── supabase/
        └── migrations/
            ├── 0001_init.sql
            ├── 0002_programacao_insert_anon.sql
            ├── 0003_add_equipe_voo.sql
            ├── 0004_voo_status.sql              ← sync do portal dronemgmt (engine/atualizar_voos.py)
            └── 0005_fazenda_analise.sql         ← acompanhamento do fluxo de analistas, por fazenda
```

## 1. GitHub — configurar Pages

1. Acesse o repo `lmalerbo/project-preparo` no GitHub.
2. Settings → Pages → Source: **Deploy from a branch** → Branch: `main` / `/ (root)`.
3. A URL do site será `https://lmalerbo.github.io/project-preparo/`.
4. O formulário estará em: `https://lmalerbo.github.io/project-preparo/sistema_preenchimento/formulario.html`
5. O portal estará em: `https://lmalerbo.github.io/project-preparo/portal.html`

## 2. Supabase — novo projeto

1. Crie um novo projeto em [supabase.com](https://supabase.com).
2. Anote o **Project URL** e a **Publishable key** (anon key).
3. Aplique as migrations:
   ```bash
   supabase link --project-ref <PROJECT_REF>
   supabase db push
   ```
4. No `formulario.html`, substitua os placeholders:
   ```js
   const SUPABASE_URL = 'https://msdkrkakuwmskoidxmxl.supabase.co';  // → URL real
   const SUPABASE_KEY = 'sb_publishable_eJA9YDyXdRI73lqPPYnATA_INEU3vzu';  // → anon key real
   ```

## 3. Cloudflare Worker — proxy de upload

1. No Cloudflare Dashboard → Workers & Pages → Create Worker.
2. Cole o conteúdo de `cloudflare-worker/release-proxy.js`.
3. Settings → Variables → Add secret: `GH_TOKEN` = PAT do GitHub com permissão `Contents: Read/Write` no repo `project-preparo`.
4. Anote a URL do worker (ex: `https://project-preparo-proxy.leonardo-malerbo.workers.dev`).
5. No `formulario.html`, substitua:
   ```js
   const RELEASE_PROXY_URL = 'https://project-preparo-proxy.leonardo-malerbo.workers.dev/';  // → URL real do worker
   ```

## 4. Nomenclatura dos arquivos de projeto

| Tipo                | Padrão                                    | Exemplo                                      |
|---------------------|-------------------------------------------|----------------------------------------------|
| Projeto             | `{COD_FAZ}_{NOME}_Rev0.dwg`               | `10503_SANTA LUZIA 5_Rev0.dwg`               |
| Exportação          | `{COD_FAZ}_{NOME}_Exp0.zip`               | `10503_SANTA LUZIA 5_Exp0.zip`               |
| Mapa Escoamento     | `{COD_FAZ}_{NOME}_Rev0-Escoamento.pdf`    | `10503_SANTA LUZIA 5_Rev0-Escoamento.pdf`    |
| Mapa Sistematização | `{COD_FAZ}_{NOME}_Rev0-Sistematização.pdf`| `10503_SANTA LUZIA 5_Rev0-Sistematização.pdf`|

## 5. Base de dados (atualizar programação)

A base de demanda do **preparo** vem de uma planilha real de sequenciamento (aba **"CONSERVAÇÃO"**),
bem diferente do modelo ICOL usado na colheita. Cada linha da aba cobre um *grupo* de talhões
(lista `"1,2,3"`, faixa `"1 AO 4"` ou número único) com uma área total — o sistema explode cada
linha em um registro por talhão e busca a área individual de cada um na base de fazendas.

Pode ser carregada de duas formas equivalentes (mesma lógica, mesmo upsert na tabela `programacao`):

- Direto no formulário, via "⚙ Gerenciar → Atualizar base / Fazendas".
- Pelo desktop, via `engine/atualizar_programacao.py` (útil para automatizar/agendar a atualização).

Colunas lidas da aba CONSERVAÇÃO: `FRENTE` (equipe), `MÊS`, `CODIGO`, `SEÇÃO`, `TALHÕES`,
`TIPO AREA` (vira `estagio`) e `VOOS`. O cabeçalho é localizado automaticamente (procura a linha
que contém CODIGO + SEÇÃO + TALHÕES) — não depende de estar numa posição fixa.

Para usar o script:

1. `pip install -r sistema_preenchimento/engine/requirements.txt`
2. Copie `sistema_preenchimento/supabase_config.example.json` para
   `sistema_preenchimento/supabase_config.json` e preencha com a mesma URL/key publishable
   já usadas no `formulario.html` (as policies RLS de `programacao` já liberam esse upsert para
   `anon` — não precisa de uma service key separada).
3. Coloque a planilha de preparo (`.xlsx`, com a aba CONSERVAÇÃO) em
   `sistema_preenchimento/base_preparo/` e a base de fazendas (`.xlsx`, colunas `SECAO`,
   `DESC_SECAO`, `TALHAO`, `AREA_PROD`) em `sistema_preenchimento/base_fazendas/`.
4. Rode `sistema_preenchimento/ATUALIZAR.bat` (ou `python engine/atualizar_programacao.py`).

> O preparo não usa o conceito de "frente" numérica da colheita (várias frentes de corte
> simultâneas). Em vez disso, a coluna `FRENTE` da planilha real traz nome de equipe/equipamento
> (ex: "FRAN TERRA", "MEGACENTER") — isso é importado como `equipe` (texto livre), com seu próprio
> filtro, coluna na consulta e gráfico "Ha por Equipe" no dashboard.

## 6. Fluxo dos analistas (aba "Registros")

Diferente da colheita (preenchimento por talhão, em campo), o preparo é trabalhado por dois
analistas de escritório, em sequência, **por fazenda** (não por talhão):

1. **Analista A** — vê as fazendas pendentes de **identificação** e/ou **escoamento**. Marca cada
   etapa como OK (com upload opcional do PDF de escoamento).
2. **Analista B** — só vê (e só consegue agir) numa fazenda depois que identificação **e**
   escoamento estiverem OK. Marca o **projeto de preparo** como OK (com upload opcional do
   `.dwg`/`.zip`).

Isso é controlado pela tabela `fazenda_analise` (migration `0005`, uma linha por `cod_faz`) e por
dois novos perfis de usuário — `analista_a` e `analista_b` — geridos em "⚙ Gerenciar" (substituem o
perfil antigo `preenchimento`, que era espelhado 1:1 da colheita e não se aplicava ao preparo).

A aba "Registros" mostra automaticamente a fila de pendências de cada analista (sem necessidade de
montar uma lista manual) — fazendas podem ser fixadas manualmente no topo da lista (📌) para
priorizar, mas a fila em si é calculada a partir do estágio de cada fazenda.

> Importante: até o momento, a liberação de uma fazenda para o Analista A **não depende** do status
> do voo (`voo_status`/dronemgmt) — isso ficou pendente porque o mapeamento `STATUS_LABELS` em
> `engine/atualizar_voos.py` ainda está vazio (os códigos numéricos de `control_status` não foram
> confirmados na tela do portal). Quando esse mapeamento existir, dá para adicionar esse gate.
