// Web Worker do motor NC (MOB-BLD-5): o mesmo app (osp_sim.js + o WebAssembly.Module já compilado pela página)
// instanciado fora da thread da tela. A página manda o pedido (engine::wire) e recebe o resultado em bytes; se este
// worker falhar, a página roda o motor nela mesma (mesmo código, mesmo resultado).
import init, { osp_motor } from "./osp_sim.js";

self.onmessage = async (e) => {
  const m = e.data;
  if (m.tipo === "iniciar") {
    try {
      await init({ module_or_path: m.modulo });
      self.postMessage({ tipo: "pronto" });
    } catch (err) {
      self.postMessage({ tipo: "erro", msg: "iniciar: " + err });
    }
    return;
  }
  if (m.tipo === "job") {
    try {
      const out = osp_motor(m.req);
      self.postMessage({ tipo: "saida", id: m.id, out }, [out.buffer]);
    } catch (err) {
      self.postMessage({ tipo: "erro", id: m.id, msg: String(err) });
    }
  }
};
