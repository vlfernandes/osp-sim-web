// Integração da página com o navegador (lado JavaScript de crates/osp-app/src/web.rs, `window.ospWeb`):
//  - recursos baixados em paralelo com o .wasm (pacote da máquina/exemplos e fontes) e o módulo compilado;
//  - armazenamento no IndexedDB (arquivos, espaços de trabalho, cópia das preferências);
//  - compartilhar (Web Share API com arquivos) e arquivos recebidos de outros apps (Share Target / launchQueue);
//  - teclado virtual (visualViewport) e barra de teclas extras do editor;
//  - classificação do aparelho (modo leve) e aviso de versão nova do service worker.
// pacote-1b63fdc1b08b431a.bin e __VERSAO__ são trocados pelo build.sh.
(function () {
  "use strict";
  const PACOTE = "pacote-1b63fdc1b08b431a.bin";
  const FONTES = ["fonts/Inter-Regular.otf", "fonts/JetBrainsMono-Regular.ttf"];
  const TARDIAS = ["fonts/emoji-icon-font.ttf", "fonts/NotoEmoji-Regular.ttf"];
  const W = (window.ospWeb = {});

  // ------------------------------------------------------------------ recursos (MOB-BLD-7)
  const barra = () => document.querySelector("#osp_loading .barra i");
  let total = 0, feito = 0;
  const progresso = () => {
    const b = barra();
    if (b && total > 0) {
      b.style.animation = "none";
      b.style.width = Math.min(100, (100 * feito) / total).toFixed(0) + "%";
    }
  };
  const baixar = (u, peso) => {
    total += peso;
    return fetch(u)
      .then((r) => {
        if (!r.ok) throw new Error(u + ": HTTP " + r.status);
        return r.arrayBuffer();
      })
      .then((b) => {
        feito += peso;
        progresso();
        return [u, new Uint8Array(b)];
      });
  };
  // pacote e fontes começam a baixar já, junto com o .wasm (o app espera por eles antes de abrir)
  window.ospRecursos = Promise.all([baixar(PACOTE, 1), ...FONTES.map((f) => baixar(f, 1))]);
  W.recursosTardios = () =>
    Promise.all(TARDIAS.map((u) => fetch(u).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? [u, new Uint8Array(b)] : null)).catch(() => null))).then((l) =>
      l.filter(Boolean)
    );
  // o .wasm compilado uma vez: a página instancia e o Web Worker do motor recebe o mesmo módulo (MOB-BLD-5)
  window.ospModuloPronto = (async () => {
    const url = "osp_sim_bg.wasm";
    let m;
    try {
      m = await WebAssembly.compileStreaming(fetch(url));
    } catch (e) {
      // servidor sem application/wasm
      m = await WebAssembly.compile(await (await fetch(url)).arrayBuffer());
    }
    window.ospModulo = m;
    return m;
  })();

  // ------------------------------------------------------------------ IndexedDB (MOB-ARQ-3)
  const DB = "osp-sim", LOJA = "kv";
  let dbp = null;
  const abrir = () =>
    (dbp ??= new Promise((ok, erro) => {
      if (!("indexedDB" in window)) return erro(new Error("sem IndexedDB"));
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(LOJA);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => erro(r.error);
      r.onblocked = () => erro(new Error("IndexedDB bloqueado"));
    }));
  const tx = (modo, f) =>
    abrir().then(
      (db) =>
        new Promise((ok, erro) => {
          const t = db.transaction(LOJA, modo);
          f(t.objectStore(LOJA));
          t.oncomplete = () => ok(true);
          t.onerror = () => erro(t.error);
          t.onabort = () => erro(t.error);
        })
    );
  let persistiu = false;
  W.carregar = () =>
    abrir().then(
      (db) =>
        new Promise((ok, erro) => {
          const out = [];
          const t = db.transaction(LOJA, "readonly");
          const c = t.objectStore(LOJA).openCursor();
          c.onsuccess = () => {
            const cur = c.result;
            if (cur) {
              out.push([String(cur.key), cur.value instanceof Uint8Array ? cur.value : new Uint8Array(cur.value)]);
              cur.continue();
            }
          };
          t.oncomplete = () => ok(out);
          t.onerror = () => erro(t.error);
        })
    );
  W.gravar = (k, v) =>
    tx("readwrite", (st) => st.put(v, k)).then((r) => {
      // pede ao navegador para não apagar os dados do site quando faltar espaço
      if (!persistiu && navigator.storage && navigator.storage.persist) {
        persistiu = true;
        navigator.storage.persist().catch(() => {});
      }
      return r;
    });
  W.apagar = (k) => tx("readwrite", (st) => st.delete(k));

  // ------------------------------------------------------------------ compartilhar (MOB-ARQ-4)
  W.podeCompartilhar = (nome, tipo) => {
    try {
      return !!(navigator.canShare && navigator.canShare({ files: [new File([""], nome, { type: tipo })] }));
    } catch (e) {
      return false;
    }
  };
  // "ok", "cancelado" ou "nao" (sem a API, tipo recusado ou fora de um toque): o app baixa o arquivo
  W.compartilhar = async (nome, bytes, tipo) => {
    try {
      const f = new File([bytes], nome, { type: tipo || "application/octet-stream" });
      if (!navigator.canShare || !navigator.canShare({ files: [f] })) return "nao";
      await navigator.share({ files: [f], title: nome });
      return "ok";
    } catch (e) {
      return e && e.name === "AbortError" ? "cancelado" : "nao";
    }
  };

  // ------------------------------------------------------------------ arquivos recebidos (MOB-ARQ-5)
  window.ospRecebidos = [];
  // pede um quadro ao app (web.rs define window.ospAcordar na partida)
  const acordar = () => window.ospAcordar && window.ospAcordar();
  // "Abrir com" do app instalado (File Handling API, Chrome no computador e Android)
  if ("launchQueue" in window) {
    window.launchQueue.setConsumer(async (p) => {
      for (const h of p.files || []) {
        try {
          const f = await h.getFile();
          window.ospRecebidos.push([f.name, new Uint8Array(await f.arrayBuffer())]);
          acordar();
        } catch (e) {}
      }
    });
  }
  // Compartilhar ▸ OSP Sim (Share Target do Android): o service worker guardou os arquivos e abriu ?recebido
  if (location.search.includes("recebido") && "caches" in window) {
    caches.open("osp-recebidos").then(async (c) => {
      for (const req of await c.keys()) {
        const r = await c.match(req);
        const nome = decodeURIComponent(new URL(req.url).pathname.split("/").pop() || "recebido.MIN");
        window.ospRecebidos.push([nome, new Uint8Array(await r.arrayBuffer())]);
        await c.delete(req);
        acordar();
      }
      history.replaceState(null, "", location.pathname);
    });
  }

  // ------------------------------------------------------------------ teclado virtual (MOB-TOQ-4)
  // A moldura do app acompanha a parte visível da tela (visualViewport): com o teclado aberto o canvas encolhe,
  // a linha editada fica acima dele e a barra de teclas extras aparece colada no teclado.
  const vv = window.visualViewport;
  let tecladoPx = 0;
  const ajustar = () => {
    const mold = document.getElementById("moldura");
    if (!vv || !mold) return;
    const coberto = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    tecladoPx = coberto > 80 ? coberto : 0;
    const kb = document.getElementById("teclas");
    const kbH = kb && kb.classList.contains("on") && tecladoPx > 0 ? kb.offsetHeight : 0;
    if (tecladoPx > 0) {
      mold.style.top = vv.offsetTop + "px";
      mold.style.height = vv.height - kbH + "px";
      mold.style.bottom = "auto";
      mold.style.paddingBottom = "0px";
      if (kb) kb.style.bottom = coberto + "px";
    } else {
      mold.style.top = mold.style.height = mold.style.bottom = mold.style.paddingBottom = "";
      if (kb) kb.style.bottom = "";
    }
    document.body.classList.toggle("teclado", tecladoPx > 0);
    acordar();
  };
  if (vv) {
    vv.addEventListener("resize", ajustar);
    vv.addEventListener("scroll", ajustar);
  }
  W.teclado = () => tecladoPx;
  const tocadas = [];
  W.teclasTocadas = () => tocadas.splice(0, tocadas.length);
  W.barraTeclas = (mostrar) => {
    let kb = document.getElementById("teclas");
    if (!kb) {
      kb = document.createElement("div");
      kb.id = "teclas";
      kb.setAttribute("role", "toolbar");
      kb.setAttribute("aria-label", "Teclas NC");
      for (const t of ["G", "M", "X", "Y", "Z", "F", "S", "T", ".", "-", "=", "←", "→"]) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = t;
        // pointerdown/touchstart sem padrão: o campo de texto não perde o foco e o teclado do sistema não fecha
        const toque = (e) => {
          e.preventDefault();
          tocadas.push(t);
          acordar();
          b.classList.add("ativa");
          setTimeout(() => b.classList.remove("ativa"), 120);
          if (navigator.vibrate) navigator.vibrate(8);
        };
        b.addEventListener("pointerdown", toque);
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
        kb.appendChild(b);
      }
      document.body.appendChild(kb);
    }
    kb.classList.toggle("on", !!mostrar);
    ajustar();
  };

  // ------------------------------------------------------------------ aparelho (MOB-DES-2, MOB-TST-1)
  let gpuNome = null;
  const gpu = () => {
    if (gpuNome !== null) return gpuNome;
    gpuNome = "";
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      gpuNome = (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl ? gl.getParameter(gl.RENDERER) : "") || "";
      const lose = gl && gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    } catch (e) {}
    return gpuNome;
  };
  W.aparelhoFraco = () => {
    const mem = navigator.deviceMemory; // Chrome/Android; o Safari não informa
    const nuc = navigator.hardwareConcurrency || 4;
    const soft = /swiftshader|llvmpipe|software|basic render/i.test(gpu());
    // sem WebGPU (só WebGL2) e com poucos núcleos: aparelho antigo
    return soft || (mem !== undefined && mem <= 3) || nuc <= 2 || (!("gpu" in navigator) && nuc <= 4);
  };
  W.aparelho = () => {
    const m = navigator.deviceMemory;
    const instalado = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    return [
      "Navegador: " + navigator.userAgent,
      "Tela: " + screen.width + "×" + screen.height + " @" + devicePixelRatio + "x",
      "Memória: " + (m ? m + " GB" : "não informada") + " · núcleos: " + (navigator.hardwareConcurrency || "?"),
      "GPU: " + (gpu() || "?") + " · WebGPU: " + ("gpu" in navigator ? "sim" : "não"),
      "Instalado (tela de início): " + (instalado ? "sim" : "não") + " · service worker: " + (navigator.serviceWorker && navigator.serviceWorker.controller ? "ativo" : "não"),
      "Classificado como fraco (modo leve automático): " + (W.aparelhoFraco() ? "sim" : "não"),
    ].join("\n");
  };

  // ------------------------------------------------------------------ versão nova (MOB-PWA-5)
  // O service worker novo instala em segundo plano e espera; o aviso pede para atualizar (sem recarregar no meio
  // de uma edição). "Atualizar" manda o worker novo assumir e a página recarrega quando ele assume.
  const avisoVersao = (reg) => {
    const el = document.getElementById("versao");
    if (!el || !reg.waiting) return;
    el.style.display = "flex";
    document.getElementById("versao_sim").onclick = () => {
      el.querySelector(".txt").textContent = "Atualizando…";
      reg.waiting.postMessage({ tipo: "assumir" });
    };
    document.getElementById("versao_fechar").onclick = () => (el.style.display = "none");
  };
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      const tinha = !!navigator.serviceWorker.controller;
      navigator.serviceWorker
        .register("sw.js")
        .then((reg) => {
          if (reg.waiting && tinha) avisoVersao(reg);
          reg.addEventListener("updatefound", () => {
            const n = reg.installing;
            if (!n) return;
            n.addEventListener("statechange", () => {
              // só é "nova versão" se já havia um worker controlando (primeira instalação não avisa)
              if (n.state === "installed" && navigator.serviceWorker.controller) avisoVersao(reg);
            });
          });
          // app aberto por muito tempo (PWA instalado): procura versão nova a cada hora e ao voltar para o app
          setInterval(() => reg.update().catch(() => {}), 3600 * 1000);
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") reg.update().catch(() => {});
          });
        })
        .catch(() => {});
      let recarregou = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (tinha && !recarregou) {
          recarregou = true;
          location.reload();
        }
      });
    });
  }

  // ------------------------------------------------------------------ instalado (MOB-PWA-3)
  const instalado = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  document.documentElement.classList.toggle("instalado", instalado);
  W.instalado = () => instalado;
})();
