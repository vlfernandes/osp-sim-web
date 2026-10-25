// Service worker do OSP Sim: guarda o app (HTML, JS, wasm com a máquina e os exemplos embutidos e ícones)
// na primeira abertura e responde do cache depois (cache primeiro), para simular sem internet.
// VERSAO é trocada pelo build.sh a cada build (hash do wasm): um app novo cria outro cache e apaga o antigo.
const VERSAO = "59127ad35415";
const CACHE = "osp-sim-" + VERSAO;
const ARQUIVOS = [
  "./",
  "./index.html",
  "./osp_sim.js",
  "./osp_sim_bg.wasm",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith("osp-sim-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
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
