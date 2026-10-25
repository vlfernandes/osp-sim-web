// Service worker do OSP Sim: guarda o app (HTML, JS, wasm, pacote da máquina/exemplos, fontes e ícones) na
// primeira abertura e responde do cache depois (cache primeiro), para simular sem internet.
// VERSAO é trocada pelo build.sh a cada build (hash do app): um app novo cria outro cache. O worker novo instala em
// segundo plano e ESPERA: a página mostra "Nova versão disponível — Atualizar" (osp-web.js) e, no toque, manda
// {tipo: "assumir"}; aí ele assume, apaga o cache antigo e a página recarrega.
// Também recebe arquivos compartilhados por outros apps (Share Target do manifesto, POST em ./receber).
const VERSAO = "7671dc21712f";
const CACHE = "osp-sim-" + VERSAO;
const RECEBIDOS = "osp-recebidos";
const ARQUIVOS = [
  "./",
  "./index.html",
  "./osp-web.js",
  "./worker.js",
  "./osp_sim.js",
  "./osp_sim_bg.wasm",
  "./manifest.webmanifest",
  "./pacote-1b63fdc1b08b431a.bin",
  "./fonts/Inter-Regular.otf",
  "./fonts/JetBrainsMono-Regular.ttf",
  "./fonts/emoji-icon-font.ttf",
  "./fonts/NotoEmoji-Regular.ttf",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/abertura-1080x2340.png",
  "./icons/abertura-1125x2436.png",
  "./icons/abertura-1170x2532.png",
  "./icons/abertura-1179x2556.png",
  "./icons/abertura-1206x2622.png",
  "./icons/abertura-1242x2208.png",
  "./icons/abertura-1242x2688.png",
  "./icons/abertura-1284x2778.png",
  "./icons/abertura-1290x2796.png",
  "./icons/abertura-1320x2868.png",
  "./icons/abertura-640x1136.png",
  "./icons/abertura-750x1334.png",
  "./icons/abertura-828x1792.png",
];

self.addEventListener("install", (e) => {
  // cache: "reload" — não pega do cache HTTP uma cópia velha do .wasm
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS.map((u) => new Request(u, { cache: "reload" })))));
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.tipo === "assumir") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith("osp-sim-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Share Target (Android: Compartilhar ▸ OSP Sim): guarda os arquivos e abre o app com ?recebido
async function receber(req) {
  try {
    const fd = await req.formData();
    const c = await caches.open(RECEBIDOS);
    for (const f of fd.getAll("arquivos")) {
      if (f && typeof f === "object" && f.name) {
        await c.put(new Request(new URL("recebido/" + encodeURIComponent(f.name), self.registration.scope)), new Response(f));
      }
    }
  } catch (err) {}
  return Response.redirect(new URL("./?recebido", self.registration.scope).href, 303);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method === "POST" && url.pathname.endsWith("/receber")) {
    e.respondWith(receber(req));
    return;
  }
  if (req.method !== "GET") return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((resp) => {
          if (resp.ok) {
            const copia = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
          }
          return resp;
        })
    )
  );
});
