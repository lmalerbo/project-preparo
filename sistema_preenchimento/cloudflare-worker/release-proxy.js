// Proxy para upload e visualização de arquivos de projeto (.dwg/.zip/.pdf) nas
// Releases do GitHub.
//
// Motivo do upload: o formulario.html é estático e público (GitHub Pages) — qualquer
// token do GitHub embutido nele é detectado e revogado automaticamente pelo secret
// scanning. Este Worker guarda o token como secret do Cloudflare (nunca commitado).
// Motivo do /view: o GitHub serve assets de release com Content-Disposition:
// attachment e sem CORS — não dá pra visualizar inline direto do navegador.
//
// Endpoints (formulario.html e portal.html chamam sem precisar de credencial):
//   POST /upload?tag=&name=&filename=   (body = arquivo)  → usado no formulario.html
//   GET  /view?url=&name=                                  → usado no portal.html
//   POST /trigger-voos                                     → dispara o workflow atualizar-voos.yml
//   GET  /voos-status                                      → status da última execução desse workflow
//
// Deploy (via dashboard do Cloudflare):
//   1. Workers & Pages → Create → Create Worker → cole este arquivo.
//   2. Settings → Variables → Add secret: GH_TOKEN = <PAT com permissão "Contents" read/write
//      E "Actions" read/write no repo lmalerbo/project-preparo — sem "Actions" os endpoints
//      /trigger-voos e /voos-status respondem 403/404>.
//   3. Anote a URL do worker (https://<nome>.<conta>.workers.dev) e configure
//      RELEASE_PROXY_URL no formulario.html e no portal.html com esse valor.

const GH_OWNER = 'lmalerbo';
const GH_REPO  = 'project-preparo';
const ALLOWED_ORIGIN = 'https://lmalerbo.github.io';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function ghHeaders(env, extra) {
  return Object.assign({
    'Authorization': `Bearer ${env.GH_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'project-preparo-release-proxy',
  }, extra || {});
}

// O GitHub renomeia o asset ao salvar (espaço vira ponto: "CACHOEIRA 2" →
// "CACHOEIRA.2") e nomes antigos podem ter sido salvos sem acento (ex:
// "Sistematizacao" vs "Sistematização" do arquivo novo). Sem normalizar os dois
// lados do mesmo jeito, a comparação falha, o asset antigo nunca é apagado antes
// do reenvio, e o upload novo é rejeitado como "already_exists". Decompõe
// acentos (NFD) e remove tudo que não é letra/número antes de comparar.
const COMBINING_MARKS_RE = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
function normAssetName(name) {
  return String(name)
    .normalize('NFD')
    .replace(COMBINING_MARKS_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// O GitHub serve assets de release com Content-Disposition: attachment (até PDF),
// então abrir a URL direto ou via <iframe> força download em vez de visualizar.
// Esse endpoint busca o arquivo no servidor (sem CORS, é fetch server-to-server)
// e devolve com Content-Disposition: inline + o Content-Type certo.
function mimeFromName(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  const map = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml' };
  return map[ext] || 'application/octet-stream';
}

async function getOrCreateRelease(env, tag, name) {
  let res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/tags/${tag}`,
    { headers: ghHeaders(env) });
  if (res.status === 404) {
    res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases`, {
      method: 'POST',
      headers: ghHeaders(env, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ tag_name: tag, name, target_commitish: 'main' }),
    });
  }
  if (!res.ok) throw new Error(`release ${tag}: ${res.status} ${await res.text()}`);
  return res.json();
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === '/upload' && request.method === 'POST') {
        const tag      = url.searchParams.get('tag');
        const name     = url.searchParams.get('name') || tag;
        const filename = url.searchParams.get('filename');
        if (!tag || !filename) {
          return new Response('tag e filename são obrigatórios', { status: 400, headers: corsHeaders() });
        }

        const release = await getOrCreateRelease(env, tag, name);

        const existente = (release.assets || []).find(a => normAssetName(a.name) === normAssetName(filename));
        if (existente) {
          await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/assets/${existente.id}`,
            { method: 'DELETE', headers: ghHeaders(env) });
        }

        const uploadUrl = release.upload_url.replace('{?name,label}', '') + `?name=${encodeURIComponent(filename)}`;
        const res = await fetch(uploadUrl, {
          method: 'POST',
          headers: ghHeaders(env, { 'Content-Type': request.headers.get('Content-Type') || 'application/octet-stream' }),
          body: await request.arrayBuffer(),
        });
        if (!res.ok) throw new Error(`upload ${filename}: ${res.status} ${await res.text()}`);

        return new Response(await res.text(), { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
      }

      if (url.pathname === '/view' && request.method === 'GET') {
        const assetUrl = url.searchParams.get('url') || '';
        const name     = url.searchParams.get('name') || '';
        const allowedPrefix = `https://github.com/${GH_OWNER}/${GH_REPO}/releases/download/`;
        if (!assetUrl.startsWith(allowedPrefix)) {
          return new Response('url inválida', { status: 400, headers: corsHeaders() });
        }

        const res = await fetch(assetUrl);
        if (!res.ok) return new Response(`erro ao buscar arquivo: ${res.status}`, { status: res.status, headers: corsHeaders() });

        return new Response(res.body, {
          headers: { ...corsHeaders(), 'Content-Type': mimeFromName(name), 'Content-Disposition': 'inline' },
        });
      }

      if (url.pathname === '/trigger-voos' && request.method === 'POST') {
        const res = await fetch(
          `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/atualizar-voos.yml/dispatches`,
          { method: 'POST', headers: ghHeaders(env, { 'Content-Type': 'application/json' }), body: JSON.stringify({ ref: 'main' }) }
        );
        if (!res.ok) return new Response(`erro ao disparar: ${res.status} ${await res.text()}`, { status: res.status, headers: corsHeaders() });
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
      }

      if (url.pathname === '/voos-status' && request.method === 'GET') {
        const res = await fetch(
          `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/atualizar-voos.yml/runs?per_page=1`,
          { headers: ghHeaders(env) }
        );
        if (!res.ok) return new Response(`erro ao consultar status: ${res.status} ${await res.text()}`, { status: res.status, headers: corsHeaders() });
        return new Response(await res.text(), { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
      }

      return new Response('Not found', { status: 404, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }
  },
};
