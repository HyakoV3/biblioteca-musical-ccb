// Teste de ponta a ponta do karaokê, num Chrome de verdade (headless e MUDO). Rodar: npm run test:e2e
//
// Sobe o servidor de desenvolvimento do Vite e um Chrome, entrega ao app um hino FICTÍCIO (por um `invoke` simulado
// do Tauri) e confere, na aba Letra: a sílaba acesa acompanha o tempo da sincronia, a pausa congela o destaque e
// desligar o botão apaga tudo. Depois confere a aba Partitura (I-08): quando aparece, o SVG embutido seguindo o tema, o zoom, a
// fonte Leipzig e o aviso para Ajustes. Precisa de um Chrome ou Chromium instalado (variável CHROME para indicar o caminho).
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const PORTA_VITE = 5199;
const PORTA_CHROME = 9340;
const RAIZ = new URL("../../", import.meta.url).pathname;

// Hino fictício: 2 estrofes, 5 sílabas por estrofe, cada uma em 2 batidas, a 120 bpm (1 s por sílaba).
const SILABAS = [0, 2, 4, 6, 8];
const nota = (t, midi) => [t, 2, midi];
const hinario = {
  versao: 1,
  hinario: { id: "e2e", nome: "Teste e2e", idioma: "pt-BR" },
  hinos: [
    {
      numero: 999,
      titulo: "Hino fictício",
      tonalidade: "Si♭ maior",
      andamento: 120,
      letra: ["1. do re mi", "fa sol", "", "2. la si do", "re mi"],
      vozes: ["Soprano", "Contralto", "Tenor", "Baixo"].map((nome, i) => ({
        nome,
        notas: SILABAS.map((t, k) => nota(t, 72 - i * 5 + (k % 2) * 2)),
      })),
      // Karaokê da partitura (I-12, fase B): 3 compassos na vez normal (de 4, 4 e 2 batidas; as batidas são as da vez, de 0 a 10).
      compassos: { normal: [[0, 0], [4, 1], [8, 2]] },
      sincronia: {
        normal: [
          { estrofe: 1, linhas: [[[0, 0, 2], [2, 3, 5], [4, 6, 8]], [[6, 0, 2], [8, 3, 6]]] },
          { estrofe: 2, linhas: [[[0, 0, 2], [2, 3, 5], [4, 6, 8]], [[6, 0, 2], [8, 3, 5]]] },
        ],
      },
    },
    // Só letra e sem partitura: serve para conferir que a aba Partitura não aparece num hino sem ela.
    { numero: 998, titulo: "Hino só com letra", letra: ["1. la la", "la la"], vozes: [] }, // o Rust sempre envia `vozes` (lista vazia por padrão)
  ],
};
// Partitura FICTÍCIA (nada de hino real): cinco linhas de pauta, uma "nota" (elipse) e um texto na fonte Leipzig, com um id para
// conferir o prefixo e o <svg> aninhado com color="black" como o do Verovio. No app de verdade, quem entrega o SVG
// é o Rust, já limpo; aqui o `invoke` simulado devolve o que o Rust devolveria.
// Karaokê por nota (I-26): as notas de cada um dos 3 compassos, como `[id, data-t, data-f, tipo]` (batidas dentro do compasso). O compasso 1 tem
// duas notas em sequência, o 2 tem duas vozes (uma de 4 batidas e uma de 2) e o 3 uma pausa de 2 batidas.
const NOTAS_DO_COMPASSO = [
  [["m0n0", 0, 2], ["m0n1", 2, 4]],
  [["m1n0", 0, 4], ["m1n1", 0, 2]],
  [["m2p0", 0, 2, "rest"]],
];
const SVG_PARTITURA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120" overflow="hidden"><svg class="definition-scale" color="black" viewBox="0 0 400 120"><g id="bm-p-folha">${[20, 35, 50, 65, 80].map((y) => `<path d="M10 ${y} L390 ${y}"></path>`).join("")}<ellipse cx="60" cy="50" rx="10" ry="7"></ellipse><rect x="90" y="30" width="6" height="40"></rect><text x="120" y="110" font-family="Leipzig" font-size="30px">&#xE1D5; = 58</text>${[10, 130, 250].map((x, i) => `<g class="measure" id="bm-p-m${i}"><path d="M${x} 20 L${x} 80"></path><path d="M${x + 120} 20 L${x + 120} 80"></path>${NOTAS_DO_COMPASSO[i].map(([id, ini, fim, tipo], k) => tipo === "rest" ? `<g class="rest" id="bm-p-${id}" data-t="${ini}" data-f="${fim}"><rect x="${x + 20}" y="45" width="14" height="6"></rect></g>` : `<g class="note" id="bm-p-${id}" data-t="${ini}" data-f="${fim}"><g class="notehead"><ellipse cx="${x + 20 + 30 * k}" cy="${55 + 10 * k}" rx="8" ry="6"></ellipse></g><rect x="${x + 27 + 30 * k}" y="${25 + 10 * k}" width="2" height="30"></rect></g>`).join("")}${i === 0 ? '<g class="tie" id="bm-p-lig0" data-t="0" data-f="2"><path d="M28 70 C45 82 65 82 88 70 C65 88 45 88 28 70"></path></g><g class="slur" id="bm-p-exp0" data-t="0" data-f="2"><path d="M28 64 C44 48 72 40 96 38 C74 46 46 60 28 64"></path></g>' : ""}</g>`).join("")}</g></svg></svg>`;
// A versão de paisagem é outro desenho (marcado com data-largo, para saber qual foi entregue).
const SVG_PARTITURA_PAISAGEM = SVG_PARTITURA.replace('id="bm-p-folha"', 'id="bm-p-folha" data-largo="1"');
// Sílabas esperadas na 1ª vez (estrofe 1) e na 2ª (estrofe 2), com o início de cada uma em batidas.
const ESPERADO_VEZ1 = [["do", 0], ["re", 2], ["mi", 4], ["fa", 6], ["sol", 8]];
const ESPERADO_VEZ2 = [["la", 0], ["si", 2], ["do", 4], ["re", 6], ["mi", 8]];
const BPM = 120;
const MS_POR_BATIDA = 60000 / BPM;
// A 2ª vez começa depois da 1ª (10 batidas) mais a pausa de 2 s (4 batidas a 120 bpm). Definido uma vez e usado por tudo.
const BATIDAS_ESTROFE = 10;
const PAUSA_BATIDAS = (2 * BPM) / 60;
const INICIO_VEZ2 = BATIDAS_ESTROFE + PAUSA_BATIDAS;

// `sessionStorage["e2e-sem-partituras"]` faz o app começar como se nenhum pacote com partituras tivesse sido importado.
const STUB = `window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args) => {
    if (cmd === "carregar_hinario") {
      const sem = sessionStorage.getItem("e2e-sem-partituras") === "1";
      // "e2e-exemplo": o app começa só com o pacote de exemplo (o caso do primeiro acesso, em que oferece baixar o hinário).
      return { hinario: ${JSON.stringify(hinario)}, exemplo: sessionStorage.getItem("e2e-exemplo") === "1", partituras: sem ? [] : [999] };
    }
    if (cmd === "remover_partituras") {
      window.__removeu = (window.__removeu ?? 0) + 1;
      sessionStorage.setItem("e2e-sem-partituras", "1"); // depois de remover, o Rust devolve o pacote sem partituras
      return { hinario: ${JSON.stringify(hinario)}, exemplo: false, partituras: [] };
    }
    if (cmd === "ler_partitura") {
      (window.__leituras = window.__leituras ?? []).push(args.paisagem === true); // cada leitura, com a versão pedida
      if (args.numero === 999) {
        // "e2e-falha-partitura": a PRÓXIMA leitura falha (um erro do Rust), e as seguintes dão certo.
        if (sessionStorage.getItem("e2e-falha-partitura") === "1") {
          sessionStorage.removeItem("e2e-falha-partitura");
          throw JSON.stringify(["ler", "falha simulada"]);
        }
        const svg = args.paisagem === true ? ${JSON.stringify(SVG_PARTITURA_PAISAGEM)} : ${JSON.stringify(SVG_PARTITURA)};
        // "e2e-sem-tempo-nas-notas": a partitura vem como a de um pacote antigo, sem data-t e data-f.
        return sessionStorage.getItem("e2e-sem-tempo-nas-notas") === "1" ? svg.replace(/ data-[tf]="[^"]*"/g, "") : svg;
      }
      throw JSON.stringify(["sem_partitura", String(args.numero)]);
    }
    return null;
  },
  transformCallback: () => 0,
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
};`;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const filhos = [];
let perfil = null;

// Encerra o processo e os filhos dele (o Chrome abre vários): sinal para o grupo de processos inteiro.
function encerrar(p, sinal) {
  try {
    if (process.platform === "win32") p.kill(sinal);
    else process.kill(-p.pid, sinal);
  } catch {
    /* já saiu */
  }
}

// O grupo de processos ainda tem alguém vivo? `kill(-pid, 0)` não envia nada: só falha com ESRCH quando o grupo
// esvaziou. O líder (o processo que o Node criou) pode sair antes dos filhos, então olhar só o `exit` dele não basta.
function grupoVivo(p) {
  if (process.platform === "win32") return p.exitCode === null;
  try {
    process.kill(-p.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function aguardarGrupo(p, ms) {
  const fim = Date.now() + ms;
  while (grupoVivo(p) && Date.now() < fim) await dormir(100);
}

let limpando = null;
function limpar() {
  limpando ??= (async () => {
    for (const p of filhos) encerrar(p, "SIGTERM");
    // O Chrome ainda escreve na pasta do perfil ao sair: espera o grupo inteiro sumir (e, se demorar, força).
    await Promise.all(filhos.map((p) => aguardarGrupo(p, 4000)));
    for (const p of filhos) if (grupoVivo(p)) encerrar(p, "SIGKILL");
    await Promise.all(filhos.map((p) => aguardarGrupo(p, 2000)));
    apagarPerfil();
  })();
  return limpando;
}

// Com `detached: true` o Ctrl-C do terminal não chega mais aos filhos: sem isto, interromper o teste (ou cancelar o job)
// deixaria o Chrome e o Vite órfãos, e o Vite seguiria na porta 5199 e quebraria a próxima execução.
for (const [sinal, codigo] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.on(sinal, async () => {
    await limpar();
    process.exit(codigo);
  });
}

function apagarPerfil() {
  if (perfil) {
    try {
      rmSync(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (e) {
      // É só uma pasta temporária: não pode mudar o resultado do teste.
      console.warn(`aviso: não deu para apagar ${perfil}: ${e.code ?? e.message}`);
    }
  }
}

function acharChrome() {
  const candidatos = [process.env.CHROME, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean);
  for (const c of candidatos) {
    try {
      execFileSync(c, ["--version"], { stdio: "ignore" });
      return c;
    } catch {
      /* tenta o próximo */
    }
  }
  throw new Error("Chrome ou Chromium não encontrado (defina CHROME com o caminho do executável)");
}

async function esperarUrl(url, ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* ainda não subiu */
    }
    await dormir(300);
  }
  throw new Error(`não respondeu a tempo: ${url}`);
}

async function principal() {
  // 1. servidor de desenvolvimento
  // Chama o Vite direto pelo Node (com `npx` ele viraria processo neto e sobraria rodando ao fim do teste).
  const vite = spawn(
    process.execPath,
    [join(RAIZ, "node_modules/vite/bin/vite.js"), "dev", "--port", String(PORTA_VITE), "--strictPort", "--host", "127.0.0.1"],
    { cwd: RAIZ, stdio: "ignore", detached: true },
  );
  filhos.push(vite);
  await esperarUrl(`http://127.0.0.1:${PORTA_VITE}/`, 60000);

  // 2. Chrome mudo. No runner do CI o Chrome às vezes sobe COM O INDEXEDDB QUEBRADO (o `open()` nunca responde, o que derrubava o Gravador): o app já tolera isso, mas o teste não tem como
  // provar nada sobre gravações num navegador assim. Por isso, antes de começar, uma SONDA abre um banco de teste; se não responde, esse Chrome é descartado (com o perfil) e outro sobe, até 3 vezes.
  const abrirChrome = async () => {
    perfil = mkdtempSync(join(tmpdir(), "bm-e2e-"));
    const chrome = spawn(
      acharChrome(),
      ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-features=BackForwardCache", "--mute-audio", "--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
        "--window-size=412,915", `--user-data-dir=${perfil}`, `--remote-debugging-port=${PORTA_CHROME}`, "about:blank"],
      { stdio: "ignore", detached: true },
    );
    filhos.push(chrome);
    await esperarUrl(`http://127.0.0.1:${PORTA_CHROME}/json/version`, 30000);
    try {
      console.log(`Chrome: ${(await (await fetch(`http://127.0.0.1:${PORTA_CHROME}/json/version`)).json()).Browser}`); // para comparar o do CI com o da máquina
    } catch {
      /* só informativo */
    }

    // 3. protocolo de depuração do Chrome
    const alvos = await (await fetch(`http://127.0.0.1:${PORTA_CHROME}/json`)).json();
    const ws = new WebSocket(alvos.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let n = 0;
    const espera = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && espera.has(m.id)) espera.get(m.id)(m);
    };
    const enviar = (method, params = {}) =>
      new Promise((r) => {
        const id = ++n;
        espera.set(id, r);
        ws.send(JSON.stringify({ id, method, params }));
      });
    const av = async (expressao) => {
      const r = await enviar("Runtime.evaluate", { expression: expressao, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      return r.result?.result?.value;
    };
    return { chrome, ws, enviar, av, perfilDele: perfil };
  };
  // O gancho do console (para o diagnóstico do Gravador) é instalado em TODO documento novo, logo na criação: assim o rastro pega a 1ª abertura do banco, que acontece quando a tela inicial monta,
  // bem antes de o teste entrar na aba Gravador.
  const GANCHO_CONSOLE = `(() => { if (window.__avisos) return; window.__avisos = []; for (const nivel of ['warn', 'debug']) { const w = console[nivel].bind(console); console[nivel] = (...a) => { try { window.__avisos.push(nivel + ': ' + a.map((x) => { try { return String(x); } catch { return Object.prototype.toString.call(x); } }).join(' ').slice(0, 200)); if (window.__avisos.length > 400) window.__avisos.shift(); } catch {} w(...a); }; } })()`;
  // A SONDA: o app abre (e cria) o banco `bm-gravacoes` quando a tela inicial monta. A sonda NÃO abre banco nenhum (abrir esse com outra versão ou sem as tabelas estragaria o app): espera o
  // banco do APP aparecer em `indexedDB.databases()`, o que só acontece depois de a abertura dele terminar. Se não aparece em 10 s, esse Chrome é descartado e outro sobe.
  const sondaDoBanco = (av) => av(`new Promise((r) => { const ini = Date.now(); let fim = false; const acabar = (v) => { if (!fim) { fim = true; r(v); } }; setTimeout(() => acabar(false), 10000); const olhar = async () => { if (fim) return; try { const lista = await Promise.race([indexedDB.databases(), new Promise((_, rej) => setTimeout(() => rej(new Error('sem resposta')), 2000))]); if (lista.some((d) => d.name === 'bm-gravacoes')) return acabar(true); } catch {} if (Date.now() - ini > 10000) return acabar(false); setTimeout(olhar, 200); }; olhar(); })`);
  let sessao = null;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    sessao = await abrirChrome();
    await sessao.enviar("Page.enable");
    await sessao.enviar("Runtime.enable");
    await sessao.enviar("Page.addScriptToEvaluateOnNewDocument", { source: GANCHO_CONSOLE });
    await sessao.enviar("Page.navigate", { url: `http://127.0.0.1:${PORTA_VITE}/` });
    await esperarUrl(`http://127.0.0.1:${PORTA_VITE}/`, 30000);
    await dormir(1500);
    const idbOk = await sondaDoBanco(sessao.av);
    // BM_E2E_FORCAR_REINICIO=1 finge uma sonda sem resposta na 1ª tentativa: serve para conferir, na máquina, que o reinício do Chrome funciona.
    const simulado = process.env.BM_E2E_FORCAR_REINICIO === "1" && tentativa === 1;
    if (idbOk && !simulado) {
      if (tentativa > 1) console.log(`Chrome com o banco do app funcionando na tentativa ${tentativa}`);
      break;
    }
    const rastroDaSonda = await sessao.av(`(window.__avisos ?? []).slice(-12)`).catch(() => null);
    console.log(`AVISO: o banco do app não abriu neste Chrome (tentativa ${tentativa} de 3): descartando-o e subindo outro. Rastro: ${JSON.stringify(rastroDaSonda)}`);
    sessao.ws.close();
    encerrar(sessao.chrome, "SIGTERM");
    await aguardarGrupo(sessao.chrome, 4000);
    if (grupoVivo(sessao.chrome)) encerrar(sessao.chrome, "SIGKILL");
    await aguardarGrupo(sessao.chrome, 2000);
    try {
      rmSync(sessao.perfilDele, { recursive: true, force: true });
    } catch {
      /* o perfil é temporário: se não der para apagar agora, a limpeza final tenta */
    }
  }
  const { ws, enviar, av } = sessao;

  await enviar("Page.enable");
  await enviar("Runtime.enable");
  await enviar("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 1, mobile: true });
  await enviar("Page.addScriptToEvaluateOnNewDocument", { source: STUB });
  await enviar("Page.navigate", { url: `http://127.0.0.1:${PORTA_VITE}/hino/999` });
  await esperarUrl(`http://127.0.0.1:${PORTA_VITE}/hino/999`, 30000);
  await dormir(7000); // primeira compilação das telas pelo Vite

  const falhas = [];
  const confere = (ok, msg) => {
    if (!ok) falhas.push(msg);
    console.log(`${ok ? "ok    " : "FALHOU"} ${msg}`);
  };

  // 4. A aba Letra tem de existir e mostrar o botão do karaokê antes de a música começar.
  await av("document.getElementById('aba-letra').click(); 1");
  await dormir(300);
  confere(await av("!!document.querySelector('.chave-karaoke')"), "botão Karaokê aparece (hino com sincronia)");
  // O andamento no topo da Letra: o botão mostra o valor, abre o painel com o controle da aba Ouvir, mexer nele muda o valor, e a aba Ouvir mostra o mesmo.
  const andamentoDoTopo = () => av(`(() => { const v = document.querySelector('.andamento .valor'); const o = document.querySelector('#painel-ouvir .passo output'); return { valor: v ? Number(v.textContent) : null, ouvir: o ? o.textContent : null }; })()`);
  const a0 = await andamentoDoTopo();
  confere(a0.valor !== null && a0.valor > 0, `o botão do andamento aparece no topo da Letra: ${JSON.stringify(a0)}`);
  await av("document.querySelector('.andamento').click(); 1"); // abre o painel
  await dormir(300);
  const aberto = await av(`document.getElementById('painel-andamento-topo')?.matches(':popover-open') ?? false`);
  confere(aberto, "tocar no botão abre o painel do andamento");
  await av(`[...document.querySelectorAll('#painel-andamento-topo .passo button')].find((b) => b.textContent.trim() === '+5')?.click(); 1`);
  await dormir(300);
  const a1 = await andamentoDoTopo();
  confere(a1.valor === a0.valor + 5, `+5 no painel muda o andamento do botão: ${a0.valor} -> ${a1.valor}`);
  await av(`document.getElementById('painel-andamento-topo')?.hidePopover(); 1`);
  await av("document.getElementById('aba-ouvir').click(); 1");
  await dormir(300);
  const a2 = await andamentoDoTopo();
  confere(a2.ouvir !== null && a2.ouvir.includes(String(a1.valor)), `a aba Ouvir mostra o mesmo andamento: ${JSON.stringify(a2)}`);
  await av(`[...document.querySelectorAll('#painel-ouvir .passo button')].find((b) => b.textContent.trim() === '−5')?.click(); 1`); // volta ao que era
  await dormir(300);
  await av("document.getElementById('aba-letra').click(); 1");
  await dormir(300);
  confere((await andamentoDoTopo()).valor === a0.valor, "voltando −5 na aba Ouvir, o botão do topo (na Letra) volta ao valor original");
  await av("document.getElementById('aba-ouvir').click(); 1");
  await dormir(300);

  // 5. Amostra o destaque a cada 25 ms ANTES de a música começar, e só então toca e abre a aba Letra, no mesmo instante. Assim a 1ª sílaba ("do",
  // que dura 1 s) é vista por inteiro mesmo num servidor lento: antes, o teste tocava, esperava 0,8 s e só depois começava a amostrar, e com
  // mais de ~0,3 s de atraso (CI carregado) perdia o "do" e falhava a ordem das sílabas, sem nada ter quebrado no app.
  await av(`window.__am = []; window.__t0 = performance.now();
    window.__iv = setInterval(() => {
      const tr = document.querySelector('.trecho');
      const e = document.querySelector('.estrofe.da-vez h2');
      window.__am.push([Math.round(performance.now() - window.__t0), tr ? tr.textContent : null, e ? e.textContent : null]);
    }, 25); 1`);
  const clicou = await av(`(() => {
    const b = [...document.querySelectorAll('#painel-ouvir button')].find(x => /hino todo|whole|todo/i.test(x.textContent));
    if (!b) return false; b.click(); document.getElementById('aba-letra').click(); return true; })()`);
  confere(clicou, 'botão "tocar o hino todo" encontrado e clicado (e a aba Letra aberta no mesmo instante)');
  // A pausa é ancorada no que o teste OBSERVA, e não num tempo fixo (que dependeria de atrasos de início que ninguém mede):
  // espera a sílaba "re" da 2ª estrofe aparecer na amostragem e pede a pausa meia batida depois, no meio dela. Essa sílaba dura
  // 2 batidas (1 s); a "mi" só acende 1 s depois do início da "re". (Antes esperava 15 s, depois do fim da música, que dura 12 s:
  // a pausa nem era testada, pois já não havia nada aceso.)
  const estado = (x) => `${x[1]}|${x[2]}`;
  const eRe2 = (x) => x && x[1] === "re" && (x[2] ?? "").includes("2");
  let achouRe2 = false;
  for (let fim = Date.now() + 25000; Date.now() < fim && !achouRe2; ) {
    achouRe2 = eRe2(await av("window.__am.at(-1)"));
    if (!achouRe2) await dormir(25);
  }
  confere(achouRe2, 'a sílaba "re" da 2ª estrofe acendeu (a pausa é pedida no meio da música)');
  await dormir(MS_POR_BATIDA / 2);
  // Lê o instante, o último estado amostrado e clica na MESMA expressão: é o estado exato do momento da pausa.
  const pausa = await av(`(() => {
    const b = document.querySelector('.mini .acao');
    const antes = window.__am.at(-1);
    const ms = Math.round(performance.now() - window.__t0);
    if (b) b.click();
    return { botao: !!b, ms, antes };
  })()`); // pausa pelo miniplayer
  confere(pausa.botao, "botão de pausa do miniplayer encontrado e clicado");
  const msPausa = pausa.ms;
  confere(eRe2(pausa.antes), `o destaque no instante da pausa era a "re" da 2ª estrofe: ${JSON.stringify(pausa.antes?.slice(1))}`);
  await dormir(1500); // a "mi" acenderia 0,5 s depois do clique, se a pausa não congelasse
  const todas = await av("window.__am");
  // Tudo o que foi amostrado depois do clique (com 150 ms de acomodação) tem de ser exatamente o estado do instante da pausa.
  const depois = todas.filter((x) => x[0] >= msPausa + 150);
  const estados = [...new Set(depois.map(estado))];
  confere(depois.length >= 40, `amostras depois da pausa: ${depois.length} (esperado pelo menos 40, ~1 s)`);
  confere(
    estados.length === 1 && estados[0] === estado(pausa.antes),
    `a pausa congela o destaque no estado em que foi pedida (depois dela: ${JSON.stringify(estados)}; antes: ${JSON.stringify(estado(pausa.antes))})`,
  );
  // 5b. Slider de busca (avançar e retroceder). Usa o <input type="range"> como a pessoa usaria: muda o valor e solta (input + change).
  // Cada sílaba dura 1 s (2 batidas a 120 bpm), então o segundo inteiro escolhido cai no começo de uma sílaba, e o teste confere a
  // sílaba e a estrofe 0,7 s depois de continuar, no meio dela.
  const buscar = (seletor, s) =>
    av(`(() => {
      const i = document.querySelector(${JSON.stringify(seletor)});
      if (!i || i.disabled) return false;
      i.value = ${s};
      i.dispatchEvent(new Event("input", { bubbles: true }));
      i.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
  const lido = () =>
    av(`({
      tr: document.querySelector('.trecho')?.textContent ?? null,
      est: document.querySelector('.estrofe.da-vez h2')?.textContent ?? null,
      tocando: /pause|pausar/i.test(document.querySelector('.mini .acao')?.getAttribute('aria-label') ?? ''),
      valor: document.querySelector('.mini .busca-entrada')?.getAttribute('aria-valuetext') ?? null,
    })`);
  // A área de toque do slider do miniplayer tem de ficar DENTRO do miniplayer e livre dos outros controles: se invadisse a linha
  // dos botões e do link do hino ou a barra de abas, roubaria toques deles. Ele fica EM CIMA da linha dos botões (I-21): embaixo, o
  // dourado dele ficava a ~0,5rem do traço dourado da aba ativa e se confundia com a barra de abas. Com abas embaixo, ele tem de
  // ficar bem longe delas (pelo menos 2,5rem; no teste são ~3,5rem).
  const geo = await av(`(() => {
    const m = document.querySelector('.mini').getBoundingClientRect();
    const i = document.querySelector('.mini .busca-entrada').getBoundingClientRect();
    const cruza = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const outros = [...document.querySelectorAll('.mini .acao, .mini .info, [role="tablist"] [role="tab"]')].map((e) => e.getBoundingClientRect());
    const linha = document.querySelector('.mini .linha').getBoundingClientRect();
    const abas = document.querySelector('[role="tablist"]')?.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize); // as medidas do app são em rem; o navegador devolve px
    return {
      dentro: i.top >= m.top - 0.5 && i.bottom <= m.bottom + 0.5,
      livre: outros.every((r) => !cruza(i, r)),
      altura: Math.round(i.height),
      emCima: i.bottom <= linha.top + 0.5,
      distanciaDasAbas: abas && abas.top >= i.bottom ? Math.round(((abas.top - i.bottom) / rem) * 100) / 100 : null, // em rem; null: sem abas embaixo (barra lateral)
    };
  })()`);
  confere(geo.dentro && geo.livre && geo.altura >= 20, `a área de toque do slider do miniplayer fica dentro dele e não cobre outros controles: ${JSON.stringify(geo)}`);
  confere(geo.emCima, `o slider do miniplayer fica EM CIMA da linha dos botões: ${JSON.stringify(geo)}`);
  confere(geo.distanciaDasAbas === null || geo.distanciaDasAbas >= 2.5, `o slider fica longe da barra de abas (>= 2,5rem) para não se confundir com ela: ${geo.distanciaDasAbas}rem`);
  // Sem linha separando o miniplayer do resto do app: a divisa é a trilha do slider, no topo dele (pedido do responsável: mais elegante).
  const semLinha = await av(`(() => {
    const m = document.querySelector('.mini');
    const c = getComputedStyle(m);
    const trilho = m.querySelector('.trilho').getBoundingClientRect();
    return { bordaTopo: c.borderTopWidth, bordas: [c.borderRightWidth, c.borderBottomWidth, c.borderLeftWidth], topoDaTrilha: Math.round(((trilho.top - m.getBoundingClientRect().top) / parseFloat(getComputedStyle(document.documentElement).fontSize)) * 100) / 100, // em rem
      larguraDaTrilha: Math.round(trilho.width), larguraDoMini: Math.round(m.getBoundingClientRect().width) };
  })()`);
  confere(semLinha.bordaTopo === "0px" && semLinha.bordas.every((b) => b === "0px"), `o miniplayer não tem borda (sem linha de separação): ${JSON.stringify(semLinha)}`);
  confere(semLinha.larguraDaTrilha === semLinha.larguraDoMini && semLinha.topoDaTrilha <= 0.55, `a trilha do slider faz a divisa: largura toda do miniplayer e logo no topo (${semLinha.topoDaTrilha}rem do topo): ${JSON.stringify(semLinha)}`);
  // Voltar com a música PAUSADA (estava na 2ª estrofe): vai para 0:03 e continua pausada.
  confere(await buscar(".mini .busca-entrada", 3), "slider do miniplayer encontrado e usado (voltar para 0:03 com a música pausada)");
  await dormir(600);
  let e = await lido();
  confere(!e.tocando, "voltar pelo slider com a música pausada mantém a pausa");
  confere((e.valor ?? "").startsWith("0:03"), `o slider mostra o ponto escolhido: ${JSON.stringify(e.valor)} (esperado 0:03 ...)`);
  await av("document.querySelector('.mini .acao')?.click(); 1"); // continua
  await dormir(700);
  e = await lido();
  confere(e.tocando, "continuar depois de voltar toca de novo");
  confere(e.tr === "fa" && (e.est ?? "").includes("1"), `a letra acompanha o ponto escolhido: ${e.tr} / ${e.est} (esperado fa / estrofe 1)`);
  // Avançar com a música TOCANDO: vai para 0:08 (a "si" da 2ª estrofe) e segue tocando.
  confere(await buscar(".mini .busca-entrada", 8), "slider do miniplayer: avançar para 0:08 com a música tocando");
  await dormir(700);
  e = await lido();
  confere(e.tocando, "avançar pelo slider com a música tocando segue tocando");
  confere(e.tr === "si" && (e.est ?? "").includes("2"), `a letra acompanha o ponto escolhido: ${e.tr} / ${e.est} (esperado si / estrofe 2)`);
  // O slider da aba Ouvir (o miniplayer some lá, porque os controles completos já estão visíveis).
  await av("document.getElementById('aba-ouvir').click(); 1");
  await dormir(400);
  confere(await buscar("#painel-ouvir .busca-entrada", 2), "slider da aba Ouvir encontrado e usado (voltar para 0:02)");
  await dormir(600);
  const tempoOuvir = await av("document.querySelector('#painel-ouvir .tempos span')?.textContent ?? null");
  confere(tempoOuvir === "0:02", `o tempo da aba Ouvir acompanha o slider: ${JSON.stringify(tempoOuvir)} (esperado "0:02")`);
  // O polegar NATIVO (transparente) tem de ter o mesmo tamanho do ponto desenhado: o toque e o arraste são mapeados por ele, e se
  // fosse menor o valor escolhido e o ponto divergiriam alguns pixels nas pontas. (O Chrome não informa o tamanho de um polegar
  // nativo pelo estilo, então a medida é de COMPORTAMENTO: com o passo livre, um toque exatamente no ponto que o desenho indicaria
  // para 10% da barra tem de escolher 10% do tempo.)
  const caixa = await av(`(() => {
    const e = document.querySelector('#painel-ouvir .busca-entrada');
    e.step = 'any';
    const r = e.getBoundingClientRect();
    const ponto = parseFloat(getComputedStyle(document.querySelector('#painel-ouvir .busca .ponto')).width);
    return { x: r.left + ponto / 2 + (r.width - ponto) * 0.1, y: r.top + r.height / 2, max: Number(e.max) };
  })()`);
  await enviar("Input.dispatchMouseEvent", { type: "mousePressed", x: caixa.x, y: caixa.y, button: "left", clickCount: 1 });
  const escolhido = Number(await av("document.querySelector('#painel-ouvir .busca-entrada').value"));
  await av("document.querySelector('#painel-ouvir .busca-entrada').step = '1'; 1");
  await enviar("Input.dispatchMouseEvent", { type: "mouseReleased", x: caixa.x, y: caixa.y, button: "left", clickCount: 1 });
  const fracaoEscolhida = escolhido / caixa.max;
  confere(Math.abs(fracaoEscolhida - 0.1) < 0.003, `o toque escolhe o ponto que o desenho indica (esperado 10%, escolheu ${(fracaoEscolhida * 100).toFixed(2)}%)`);
  // A barra tem de usar as cores do TEMA (`--ouro-linha` no preenchimento e no ponto, `--borda` na trilha), e não o azul do controle
  // nativo do sistema: as cores mudam em cada tema, então a conferência é contra as variáveis, não contra um valor fixo.
  const cores = await av(`(() => {
    const cor = (v) => { const d = document.createElement('i'); d.style.color = v; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; };
    const fundo = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).backgroundColor : null; };
    return { ouro: cor('var(--ouro-linha)'), borda: cor('var(--borda)'), preenchimento: fundo('#painel-ouvir .busca .preenchido'),
             ponto: fundo('#painel-ouvir .busca .ponto'), trilha: fundo('#painel-ouvir .busca .trilho') };
  })()`);
  confere(
    cores.preenchimento === cores.ouro && cores.ponto === cores.ouro && cores.trilha === cores.borda,
    `a barra de progresso usa as cores do tema (preenchimento e ponto = ouro-linha, trilha = borda): ${JSON.stringify(cores)}`,
  );
  await av("document.getElementById('aba-letra').click(); 1");
  await dormir(400);
  confere(
    (await av(`(() => { const e = document.querySelector('.mini .busca .preenchido'); return e ? getComputedStyle(e).backgroundColor : null; })()`)) === cores.ouro,
    "o fio do miniplayer usa o ouro-linha do tema",
  );
  await av("document.querySelector('.chave-karaoke')?.click(); 1"); // desliga
  await dormir(400);
  confere((await av("document.querySelectorAll('.trecho').length")) === 0, "com o botão desligado nada fica aceso");
  // Duas soltas seguidas (é o que a seta do teclado segurada faz): vale a ÚLTIMA. A segunda chega com o reagendamento da primeira
  // ainda em curso e não pode ser descartada em silêncio (a barra voltaria ao ponto antigo e a pessoa acharia que não funcionou).
  await av(`(() => {
    const i = document.querySelector('.mini .busca-entrada');
    for (const v of [2, 6]) {
      i.value = v;
      i.dispatchEvent(new Event("input", { bubbles: true }));
      i.dispatchEvent(new Event("change", { bubbles: true }));
    }
  })()`);
  await dormir(900);
  const aposDuas = await av("document.querySelector('.mini .busca-entrada')?.getAttribute('aria-valuetext') ?? null");
  confere((aposDuas ?? "").startsWith("0:06"), `duas soltas seguidas: vale a última (0:06): ${JSON.stringify(aposDuas)}`);
  // Corrida: soltar o slider e tocar em Parar logo em seguida, com o áudio ainda reagendando, tem de parar tudo e SEM aviso de
  // erro falso (antes, o reagendamento lia o hino que o Parar já tinha esquecido e mostrava uma falha de áudio que não existiu).
  const corrida = await av(`(() => {
    const i = document.querySelector('.mini .busca-entrada');
    const parar = [...document.querySelectorAll('.mini .acao')].at(-1);
    if (!i || !parar) return false;
    i.value = 5;
    i.dispatchEvent(new Event("input", { bubbles: true }));
    i.dispatchEvent(new Event("change", { bubbles: true }));
    parar.click();
    return true;
  })()`);
  confere(corrida, "slider solto e Parar tocado logo em seguida");
  await dormir(1200);
  confere(!(await av("!!document.querySelector('.mini')")), "Parar logo depois de soltar o slider para tudo (o miniplayer some)");
  confere(!(await av("!!document.querySelector('.aviso.erro')")), "Parar durante o reagendamento não mostra erro falso");
  // Aparência da letra (I-04): aumentar o tamanho e justificar mudam a letra na hora e ficam salvos no aparelho.
  const fonteAntes = await av("parseFloat(getComputedStyle(document.querySelector('.estrofe p')).fontSize)");
  const clicouAparencia = await av(`(() => {
    const botoes = [...document.querySelectorAll('#painel-letra .barra-letra button')];
    const por = (re) => botoes.find((b) => re.test(b.getAttribute('aria-label') ?? ''));
    const mais = por(/increase/i), justificar = por(/justify/i);
    if (!mais || !justificar) return false;
    mais.click();
    justificar.click();
    return true;
  })()`);
  confere(clicouAparencia, "controles de tamanho e alinhamento da letra encontrados e usados");
  await dormir(200);
  const aparencia = await av(`({
    fonte: parseFloat(getComputedStyle(document.querySelector('.estrofe p')).fontSize),
    alinha: getComputedStyle(document.querySelector('.letra')).textAlign,
    salvo: localStorage.getItem('prefs.letra'),
  })`);
  confere(aparencia.fonte > fonteAntes, `aumentar o tamanho cresce a letra: ${fonteAntes} → ${aparencia.fonte} px`);
  confere(aparencia.alinha === "justify", `justificar muda o alinhamento da letra: ${aparencia.alinha}`);
  confere(aparencia.salvo === '{"passo":2,"alinhamento":"justificado"}', `a escolha fica salva no aparelho: ${aparencia.salvo}`);
  // Alto contraste (I-06) com o aparelho no ESCURO: o escuro "do sistema" de cada estilo tem seletor mais específico (0,3,0) que o bloco
  // do modo (0,2,0) e o venceria se o :not(...) não o excluísse. Só um navegador de verdade confere isso (a cascata não é texto).
  await enviar("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  const cascata = await av(`(() => {
    const r = document.documentElement;
    const v = (nome) => getComputedStyle(r).getPropertyValue(nome).trim();
    const saida = {};
    delete r.dataset.tema; delete r.dataset.estilo;
    saida.controleEscuro = v('--fundo'); // sem o modo, o aparelho no escuro tem de dar o escuro (prova que a emulação vale)
    for (const estilo of ['normal', 'pergaminho', 'marinho']) {
      if (estilo === 'normal') delete r.dataset.estilo; else r.dataset.estilo = estilo;
      r.dataset.tema = 'alto-contraste';
      saida[estilo] = [v('--fundo'), v('--texto'), v('--ouro')].join(' ');
    }
    delete r.dataset.tema; delete r.dataset.estilo;
    return saida;
  })()`);
  await enviar("Emulation.setEmulatedMedia", { features: [] });
  confere(cascata.controleEscuro === "#10151d", `controle: com o aparelho no escuro e sem o modo, vale o escuro normal: ${cascata.controleEscuro}`);
  for (const estilo of ["normal", "pergaminho", "marinho"]) {
    confere(cascata[estilo] === "#000000 #ffff00 #ffff00", `alto contraste vence o escuro do sistema no estilo ${estilo}: ${cascata[estilo]}`);
  }
  await av("clearInterval(window.__iv); 1");
  const am = await av("window.__am");

  // 5c. Aba Partitura (I-08), no hino 999 (que tem áudio e partitura): as abas são Ouvir, Letra e Partitura.
  const abas = await av("[...document.querySelectorAll('[role=\"tab\"]')].map((t) => t.id)");
  confere(JSON.stringify(abas) === '["aba-ouvir","aba-letra","aba-partitura"]', `hino com áudio e partitura: abas ${JSON.stringify(abas)}`);
  await av("document.getElementById('aba-partitura').click(); 1");
  await dormir(800);
  const p1 = await av(`(() => {
    const svg = document.querySelector('#painel-partitura .folha svg');
    const cor = (e, p) => getComputedStyle(e)[p];
    return {
      painelVisivel: !document.getElementById('painel-partitura').hidden,
      svg: !!svg,
      overflow: svg?.getAttribute('overflow') ?? null,
      id: svg?.querySelector('g')?.id ?? null,
      regiao: document.querySelector('#painel-partitura .rolagem')?.getAttribute('role') ?? null,
      foco: document.querySelector('#painel-partitura .rolagem')?.tabIndex ?? null,
      rotulo: document.querySelector('#painel-partitura .folha')?.getAttribute('aria-label') ?? null,
      larguraDaFolha: Math.round(document.querySelector('#painel-partitura .folha').getBoundingClientRect().width),
      larguraDaRegiao: Math.round(document.querySelector('#painel-partitura .rolagem').getBoundingClientRect().width),
      paginaLargaDemais: document.documentElement.scrollWidth > window.innerWidth,
      zoomSalvo: localStorage.getItem('prefs.partitura'),
    };
  })()`);
  confere(p1.painelVisivel && p1.svg, `a partitura aparece no painel da aba: ${JSON.stringify({ painelVisivel: p1.painelVisivel, svg: p1.svg })}`);
  confere(p1.overflow === "hidden" && (p1.id ?? "").startsWith("bm-p-"), `o SVG entregue tem overflow hidden e id com o prefixo do app: ${p1.overflow} / ${p1.id}`);
  confere(p1.regiao === "region" && p1.foco === 0 && (p1.rotulo ?? "").includes("999"), `a região que rola é focável pelo teclado e tem nome: ${p1.regiao} / tabIndex ${p1.foco} / ${p1.rotulo}`);
  confere(p1.larguraDaFolha <= p1.larguraDaRegiao + 1 && !p1.paginaLargaDemais, `a 100% a partitura cabe na tela, sem rolar de lado (folha ${p1.larguraDaFolha}, região ${p1.larguraDaRegiao})`);
  // A fonte Leipzig (embarcada no app) é carregada quando o SVG pede o texto nela.
  const fonte = await av(`(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.family.includes('Leipzig')).map((f) => f.status); })()`);
  confere(fonte.length === 1 && fonte[0] === "loaded", `a fonte Leipzig do app foi carregada: ${JSON.stringify(fonte)}`);

  // Cor pelo tema: cada tema dá a cor do texto aos traços e ao preenchimento (o SVG vem com color="black" no arquivo).
  const corDoTema = (tema, estilo = "normal") => av(`(() => {
    const r = document.documentElement;
    ${tema === null ? "delete r.dataset.tema;" : `r.dataset.tema = '${tema}';`}
    ${estilo === "normal" ? "delete r.dataset.estilo;" : `r.dataset.estilo = '${estilo}';`}
    const svg = document.querySelector('#painel-partitura .folha svg');
    const alvo = getComputedStyle(document.querySelector('#painel-partitura .folha')).color; // = var(--texto) do tema
    const traco = getComputedStyle(svg.querySelector('path')).stroke;
    const preench = getComputedStyle(svg.querySelector('rect')).fill;
    const texto = getComputedStyle(svg.querySelector('text')).fill;
    const fundo = getComputedStyle(document.querySelector('#painel-partitura .rolagem')).backgroundColor;
    delete r.dataset.tema; delete r.dataset.estilo;
    return { alvo, traco, preench, texto, fundo };
  })()`);
  for (const [tema, esperado] of [["claro", null], ["escuro", null], ["alto-contraste", "rgb(255, 255, 0)"]]) {
    const c = await corDoTema(tema);
    confere(
      c.traco === c.alvo && c.preench === c.alvo && c.texto === c.alvo && (esperado === null || c.alvo === esperado) && c.alvo !== c.fundo,
      `tema ${tema}: traço, preenchimento e texto da partitura têm a cor do texto do tema (${JSON.stringify(c)})`,
    );
  }
  const claro = await corDoTema("claro");
  const escuro = await corDoTema("escuro");
  confere(claro.alvo !== escuro.alvo && claro.fundo !== escuro.fundo, `claro e escuro dão cores diferentes à partitura: ${claro.alvo} no ${claro.fundo} / ${escuro.alvo} no ${escuro.fundo}`);

  // Zoom: 125% passa da largura da tela e rola de lado; o passo fica salvo; "restaurar" volta a 100%.
  const botoesZoom = await av(`[...document.querySelectorAll('#painel-partitura .controle-tamanho button')].map((b) => b.getAttribute('aria-label'))`);
  confere(botoesZoom.length === 3, `a barra de zoom tem 3 botões: ${JSON.stringify(botoesZoom)}`);
  const ordemTamanho = await av(`[...document.querySelectorAll('#painel-letra .controle-tamanho button, #painel-partitura .controle-tamanho button')].map((b) => b.closest('[role="tabpanel"]').id.replace('painel-', '') + ':' + b.dataset.acao)`);
  confere(JSON.stringify(ordemTamanho) === '["letra:mais","letra:padrao","letra:menos","partitura:mais","partitura:padrao","partitura:menos"]', `o controle de tamanho é "+ ⟲ −" (mais, restaurar, menos) na letra e na partitura: ${JSON.stringify(ordemTamanho)}`);
  await av("document.querySelector('#painel-partitura .controle-tamanho [data-acao=mais]').click(); 1");
  await dormir(200);
  const z1 = await av(`(() => {
    const r = document.querySelector('#painel-partitura .rolagem');
    return { rola: r.scrollWidth > r.clientWidth + 1, folha: document.querySelector('#painel-partitura .folha').getBoundingClientRect().width, regiao: r.clientWidth,
      salvo: localStorage.getItem('prefs.partitura'), dica: !!document.querySelector('#painel-partitura .dica'), pagina: document.documentElement.scrollWidth > window.innerWidth };
  })()`);
  confere(z1.rola && Math.abs(z1.folha / z1.regiao - 1.25) < 0.02, `125%: a folha fica ${(z1.folha / z1.regiao).toFixed(2)}x a região e rola de lado`);
  confere(z1.salvo === '{"escala":1.25}' && z1.dica && !z1.pagina, `o zoom fica salvo, aparece a dica de arrastar e só a região rola (a página não): ${JSON.stringify({ salvo: z1.salvo, dica: z1.dica, pagina: z1.pagina })}`);
  await av("document.querySelector('#painel-partitura .controle-tamanho [data-acao=padrao]').click(); 1");
  await dormir(200);
  const z0 = await av(`(() => { const r = document.querySelector('#painel-partitura .rolagem'); return { rola: r.scrollWidth > r.clientWidth + 1, salvo: localStorage.getItem('prefs.partitura') }; })()`);
  confere(!z0.rola && z0.salvo === '{"escala":1}', `restaurar volta a 100% sem rolar de lado: ${JSON.stringify(z0)}`);

  // Diminuir: o padrão (100%) não é o menor tamanho. "−" dá 80%: a folha fica mais estreita que a região, CENTRALIZADA, sem rolar de lado.
  await av("document.querySelector('#painel-partitura .controle-tamanho [data-acao=menos]').click(); 1");
  await dormir(200);
  const zm = await av(`(() => {
    const reg = document.querySelector('#painel-partitura .rolagem');
    const r = reg.getBoundingClientRect();
    const f = document.querySelector('#painel-partitura .folha').getBoundingClientRect();
    return { razao: f.width / r.width, esquerda: f.left - r.left, direita: r.right - f.right, rola: reg.scrollWidth > reg.clientWidth + 1,
      salvo: localStorage.getItem('prefs.partitura'), dica: !!document.querySelector('#painel-partitura .dica') };
  })()`);
  confere(Math.abs(zm.razao - 0.8) < 0.02 && !zm.rola && zm.salvo === '{"escala":0.8}' && !zm.dica, `"−" diminui para 80% (a folha é ${(zm.razao * 100).toFixed(0)}% da região), sem rolar de lado e sem a dica de arrastar: ${JSON.stringify({ salvo: zm.salvo, rola: zm.rola })}`);
  confere(zm.esquerda > 5 && Math.abs(zm.esquerda - zm.direita) < 2, `a partitura menor fica centralizada (sobra ${zm.esquerda.toFixed(0)} px de cada lado)`);
  // chega ao menor (50%) e o "−" desliga; depois volta ao padrão para não afetar o resto
  for (let i = 0; i < 4; i++) await av("document.querySelector('#painel-partitura .controle-tamanho [data-acao=menos]').click(); 1");
  await dormir(200);
  const min = await av(`({ salvo: localStorage.getItem('prefs.partitura'), menosDesligado: document.querySelector('#painel-partitura .controle-tamanho [data-acao=menos]').disabled })`);
  confere(min.salvo === '{"escala":0.5}' && min.menosDesligado, `o menor tamanho é 50% e o "−" desliga: ${JSON.stringify(min)}`);
  await av("document.querySelector('#painel-partitura .controle-tamanho [data-acao=padrao]').click(); 1");
  await dormir(200);

  // Versões: em pé (412 px) é o desenho de retrato; deitado (915 px) o de paisagem, e a coluna deixa de ser limitada a 40rem (640 px).
  const estadoVersao = () => av(`(() => ({
    variante: document.querySelector('#painel-partitura .folha')?.dataset.variante ?? null,
    largo: !!document.querySelector('#painel-partitura .folha svg [data-largo]'),
    leituras: JSON.stringify(window.__leituras ?? []),
    colunaPx: Math.round(document.querySelector('main').getBoundingClientRect().width),
    folhaPx: Math.round(document.querySelector('#painel-partitura .folha').getBoundingClientRect().width),
  }))()`);
  const v0 = await estadoVersao();
  confere(v0.variante === "retrato" && !v0.largo && v0.leituras === "[false]", `em pé: versão de retrato, uma leitura pedindo o retrato: ${JSON.stringify(v0)}`);
  confere(v0.colunaPx <= 412, `em pé a coluna cabe na tela: ${v0.colunaPx} px`);
  await enviar("Emulation.setDeviceMetricsOverride", { width: 915, height: 412, deviceScaleFactor: 1, mobile: true });
  await dormir(900);
  const v1 = await estadoVersao();
  confere(v1.variante === "paisagem" && v1.largo && v1.leituras === "[false,true]", `deitado: a versão de paisagem entra e é lida uma vez: ${JSON.stringify(v1)}`);
  confere(v1.folhaPx > 640, `deitado, a partitura passa dos 40rem de antes (coluna ${v1.colunaPx} px, folha ${v1.folhaPx} px)`);
  // a coluna só é larga na aba Partitura: na Letra o limite de 40rem continua
  await av("document.getElementById('aba-letra').click(); 1");
  await dormir(400);
  const colLetra = await av("Math.round(document.querySelector('main').getBoundingClientRect().width)");
  confere(colLetra <= 640, `na aba Letra a coluna continua limitada a 40rem: ${colLetra} px`);
  await av("document.getElementById('aba-partitura').click(); 1");
  await dormir(400);
  await enviar("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 1, mobile: true });
  await dormir(900);
  const v2 = await estadoVersao();
  confere(v2.variante === "retrato" && !v2.largo && v2.leituras === "[false,true]", `de volta em pé: o retrato volta SEM ler de novo: ${JSON.stringify(v2)}`);

  // Karaokê da partitura (I-12, fase B): o compasso que toca fica destacado (um retângulo atrás dele). O hino 999 tem 3 compassos na vez (de 0 a 10
  // batidas: 0-4, 4-8, 8-10), a 120 bpm (2 batidas por segundo), e a vez 2 começa na batida 14 (7 s). Pausado, o slider leva a música a um ponto conhecido.
  const destaque = () => av(`(() => {
    const medidas = [...document.querySelectorAll('#painel-partitura g.measure')];
    const barra = document.querySelector('#painel-partitura line.barra-compasso');
    const m = medidas.find((g) => g.querySelector('line.barra-compasso'));
    const bb = barra?.getBoundingClientRect(), mc = m?.getBoundingClientRect();
    return { indice: medidas.findIndex((g) => g.querySelector('line.barra-compasso')), retangulos: document.querySelectorAll('line.barra-compasso').length, medidas: medidas.length,
      semFundo: document.querySelectorAll('#painel-partitura rect.destaque-compasso').length === 0,
      cobre: !!bb && !!mc && bb.left <= mc.left + 0.5 && bb.left >= mc.left - 8 && bb.top <= mc.top + 0.5 && bb.bottom >= mc.bottom - 0.5,
      atras: !!barra && barra === m?.firstElementChild };
  })()`);
  // Passos anteriores pararam a música (e um deles desligou o karaokê): começa de novo, como a pessoa faria, e vai para a aba Partitura.
  await av("document.getElementById('aba-ouvir').click(); 1");
  await dormir(300);
  confere(await av(`(() => { const b = [...document.querySelectorAll('#painel-ouvir button')].find((x) => /hino todo|whole|todo/i.test(x.textContent)); if (!b) return false; b.click(); return true; })()`), 'botão "tocar o hino todo" clicado, para o karaokê da partitura');
  await dormir(700);
  await av("document.getElementById('aba-partitura').click(); 1");
  await dormir(600);
  const antesDoBotao = await av(`document.querySelector('.chave-karaoke')?.getAttribute('aria-pressed') ?? null`);
  if (antesDoBotao === "false") {
    await av("document.querySelector('.chave-karaoke').click(); 1"); // o passo da letra deixou o karaokê desligado: liga
    await dormir(300);
  }
  if ((await lido()).tocando) {
    await av("document.querySelector('.mini .acao').click(); 1"); // pausa pelo miniplayer
    await dormir(500);
  }
  const kd = await av(`(() => { const b = document.querySelector('.chave-karaoke'); return { achou: !!b, ligado: b?.getAttribute('aria-pressed') ?? null }; })()`);
  confere(kd.achou && kd.ligado === "true", `o botão do karaokê aparece na aba Partitura (hino com compassos) e está ligado: ${JSON.stringify(kd)}`);
  const ponto = [[1, 0, "vez 1, batida 2"], [2.5, 1, "vez 1, batida 5"], [4.6, 2, "vez 1, batida 9,2"], [6, 2, "na pausa entre as partes o último continua aceso"], [8, 0, "vez 2, batida local 2: volta ao 1º compasso"], [9.5, 1, "vez 2, batida local 5"], [11, 2, "vez 2, batida local 8"]];
  for (const [s, esperado, quando] of ponto) {
    await buscar(".mini .busca-entrada", s);
    await dormir(500);
    const d = await destaque();
    confere(d.indice === esperado && d.retangulos === 1 && d.medidas === 3, `aos ${s} s (${quando}) o compasso ${esperado + 1} está destacado: ${JSON.stringify(d)}`);
  }
  const d1 = await destaque();
  confere(d1.cobre && d1.atras && d1.semFundo, `a barra dourada acompanha a altura do compasso na esquerda, fica ATRÁS das notas (primeiro filho do compasso) e não há retângulo de fundo: ${JSON.stringify(d1)}`);
  // Com o tempo das notas, o compasso é mostrado SÓ pela barra dourada à esquerda: nem fundo nem borda (o retângulo nem é criado).
  const dc = await av(`(() => ({ barras: document.querySelectorAll('#painel-partitura line.barra-compasso').length, retangulos: document.querySelectorAll('#painel-partitura rect.destaque-compasso').length }))()`);
  confere(dc.barras === 1 && dc.retangulos === 0, `com o tempo das notas há uma barra e nenhum retângulo no compasso: ${JSON.stringify(dc)}`);
  // Karaokê por nota (I-26): as notas que soam ganham um halo ATRÁS (primeiro filho da nota) e a nota não muda de cor. Todas as vozes que soam
  // acendem, a pausa também, e na pausa entre as partes nenhuma nota fica acesa (só o compasso).
  const halos = () => av(`(() => {
    const hs = [...document.querySelectorAll('#painel-partitura ellipse.destaque-nota')];
    return { ids: hs.map((h) => h.parentElement.id.replace('bm-p-', '')).sort(), atras: hs.every((h) => h === h.parentElement.firstElementChild),
      semFundoDoCompasso: document.querySelectorAll('#painel-partitura rect.destaque-compasso').length === 0,
      semCor: hs.every((h) => !h.parentElement.getAttribute('fill') && !h.parentElement.getAttribute('style')) };
  })()`);
  // Os instantes caem no MEIO de cada nota: o slider tem ~1 batida de antecedência em relação ao que o compasso lê (conferido: o mesmo vale para o destaque do compasso).
  const porNota = [[0.25, ["m0n0"], "1ª nota do compasso 1"], [1, ["m0n1"], "2ª nota do compasso 1"], [2, ["m1n0", "m1n1"], "as duas vozes do compasso 2"], [3, ["m1n0"], "só a voz longa do compasso 2"], [4, ["m2p0"], "a pausa acende"], [6, [], "na pausa entre as partes nenhuma nota acesa"], [8, ["m0n1"], "vez 2: a 2ª nota do compasso 1, de novo"]];
  for (const [s, esperado, quando] of porNota) {
    await buscar(".mini .busca-entrada", s);
    await dormir(500);
    const h = await halos();
    confere(JSON.stringify(h.ids) === JSON.stringify(esperado) && h.atras && h.semFundoDoCompasso && h.semCor, `aos ${s} s (${quando}) acendem ${JSON.stringify(esperado)}: ${JSON.stringify(h)}`);
  }
  // Ligadura: enquanto a 1ª nota do compasso 1 soa (0 a 2 batidas), a luz corre pela curva (a cópia dourada, recortada) e cresce; quando a 2ª nota começa, a
  // curva sai e só o halo da 2ª fica.
  const curva = () => av(`(() => {
    const c = document.querySelector('#painel-partitura path.destaque-ligadura');
    const r = c ? document.querySelector('#painel-partitura clipPath rect') : null;
    const f = document.querySelector('#painel-partitura path.faixa-ligadura');
    const pt = document.querySelector('#painel-partitura circle.ponto-ligadura');
    return { faixaAtras: !!f && !!f.nextElementSibling && f.nextElementSibling.tagName.toLowerCase() === 'path' && !f.nextElementSibling.getAttribute('class'),
      pontoX: pt ? Number(pt.getAttribute('cx')) : -1, tem: !!c, largura: r ? Number(r.getAttribute('width')) : -1, noRecorte: !!c && c.getAttribute('clip-path').startsWith('url(#recorte-ligadura-') };
  })()`);
  // A ligadura de EXPRESSÃO (g.slur, a curva inclinada entre notas de alturas diferentes) anima como a de prolongamento: também ganha a luz e o ponto, e o ponto SOBE junto da curva.
  const expressao = () => av(`(() => {
    const cs = [...document.querySelectorAll('#painel-partitura path.destaque-ligadura')];
    const rs = [...document.querySelectorAll('#painel-partitura clipPath rect')];
    const ps = [...document.querySelectorAll('#painel-partitura circle.ponto-ligadura')];
    return { curvas: cs.length, larguraDaSegunda: rs[1] ? Number(rs[1].getAttribute('width')) : -1, pontoDaSegunda: ps[1] ? [Number(ps[1].getAttribute('cx')), Number(ps[1].getAttribute('cy'))] : null };
  })()`);
  const sobre = [];
  // Tocando do começo, a luz corre: a largura do recorte da curva cresce de um quadro para o outro enquanto a 1ª nota soa.
  await buscar(".mini .busca-entrada", 0);
  await dormir(300);
  await av("document.querySelector('.mini .acao').click(); 1"); // toca
  const larguras = [];
  const pontos = [];
  let faixasAtras = true;
  for (let i = 0; i < 25; i++) {
    const c = await curva();
    sobre.push(await expressao());
    if (c.tem) {
      larguras.push(c.largura);
      pontos.push(c.pontoX);
      faixasAtras = faixasAtras && c.faixaAtras;
    }
    await dormir(30);
  }
  await av("document.querySelector('.mini .acao').click(); 1"); // pausa
  const cresce = larguras.length >= 3 && larguras.every((w, i) => i === 0 || w >= larguras[i - 1]) && larguras[larguras.length - 1] > larguras[0];
  confere(cresce, `a luz corre pela ligadura enquanto a 1ª nota soa (larguras do recorte): ${JSON.stringify(larguras)}`);
  confere(faixasAtras, "a faixa larga da ligadura fica ATRÁS da curva (logo antes dela)");
  const comExpressao = sobre.filter((x) => x.curvas === 2 && x.pontoDaSegunda);
  const largurasExp = comExpressao.map((x) => x.larguraDaSegunda);
  confere(comExpressao.length >= 3 && largurasExp.every((w, i) => i === 0 || w >= largurasExp[i - 1]) && largurasExp[largurasExp.length - 1] > largurasExp[0], `a ligadura de expressão (g.slur) anima junto da de prolongamento: a luz dela cresce (larguras): ${JSON.stringify(largurasExp)}`);
  const ys = comExpressao.map((x) => x.pontoDaSegunda[1]);
  confere(ys.length >= 3 && ys[ys.length - 1] < ys[0] - 3, `o ponto da ligadura de expressão sobe junto da curva inclinada (y de ${ys[0]?.toFixed(1)} a ${ys[ys.length - 1]?.toFixed(1)})`);
  confere(pontos.length >= 3 && pontos.every((x, i) => i === 0 || x >= pontos[i - 1]) && pontos[pontos.length - 1] > pontos[0], `o ponto brilhante anda junto da luz, da esquerda para a direita: ${JSON.stringify(pontos.map((x) => Math.round(x)))}`);
  await buscar(".mini .busca-entrada", 1.6);
  await dormir(500);
  const depoisDaCurva = await curva();
  confere(!depoisDaCurva.tem, `quando a 2ª nota começa a curva sai: ${JSON.stringify(depoisDaCurva)}`);
  // pausado, o halo não anda
  await buscar(".mini .busca-entrada", 2);
  await dormir(500);
  const h1 = await halos();
  await dormir(1200);
  confere(JSON.stringify((await halos()).ids) === JSON.stringify(h1.ids) && h1.ids.length === 2, `pausado, os halos congelam: ${JSON.stringify(h1.ids)}`);
  // pausado, o destaque não anda
  await buscar(".mini .busca-entrada", 2.5);
  await dormir(500);
  const antes = (await destaque()).indice;
  await dormir(1500);
  confere((await destaque()).indice === antes && antes === 1, `na pausa o destaque congela (compasso ${antes + 1})`);
  // tocando, o destaque anda sozinho: de 1 s (compasso 1) até passar de 4 s (compasso 2) em ~3,3 s
  await buscar(".mini .busca-entrada", 1);
  await dormir(400);
  await av("document.querySelector('.mini .acao').click(); 1"); // continua
  const vistos = [];
  for (let i = 0; i < 9; i++) {
    await dormir(400);
    vistos.push((await destaque()).indice);
  }
  await av("document.querySelector('.mini .acao').click(); 1"); // pausa de novo
  await dormir(400);
  const sobe = vistos.every((v, k) => k === 0 || v >= vistos[k - 1]);
  confere(sobe && vistos.includes(0) && vistos.includes(1) && vistos[vistos.length - 1] >= 1, `tocando, o destaque avança sozinho e só para a frente: ${JSON.stringify(vistos)}`);
  // o liga/desliga é o do karaokê: desligado, o destaque some; ligado, volta
  await av("document.querySelector('.chave-karaoke').click(); 1");
  await dormir(300);
  const off = await av(`({ ligado: document.querySelector('.chave-karaoke').getAttribute('aria-pressed'), retangulos: document.querySelectorAll('line.barra-compasso').length })`);
  confere(off.ligado === "false" && off.retangulos === 0, `com o karaokê desligado não há destaque: ${JSON.stringify(off)}`);
  confere((await av("document.querySelectorAll('ellipse.destaque-nota').length")) === 0, "com o karaokê desligado também não há halo de nota");
  confere((await av("document.querySelectorAll('line.barra-compasso').length")) === 0, "com o karaokê desligado também não há barra de compasso");
  await av("document.querySelector('.chave-karaoke').click(); 1");
  await dormir(300);
  const on = await destaque();
  confere(on.retangulos === 1 && on.indice >= 0, `ligando de novo o destaque volta: ${JSON.stringify(on)}`);
  // fora da aba Partitura não gasta nada e não deixa destaque
  await av("document.getElementById('aba-letra').click(); 1");
  await dormir(300);
  confere((await av("document.querySelectorAll('line.barra-compasso, rect.destaque-compasso').length")) === 0, "fora da aba Partitura o destaque some");
  confere((await av("document.querySelectorAll('ellipse.destaque-nota').length")) === 0, "fora da aba Partitura o halo das notas some");
  await av("document.getElementById('aba-partitura').click(); 1");
  await dormir(400);
  confere((await destaque()).retangulos === 1, "voltando à aba Partitura o destaque volta");

  const abrirHino = async (numero) => {
    await enviar("Page.navigate", { url: `http://127.0.0.1:${PORTA_VITE}/hino/${numero}` });
    for (let fim = Date.now() + 20000; Date.now() < fim; ) {
      await dormir(250);
      if (await av(`!!document.querySelector('#painel-letra .estrofe p')`)) return true;
    }
    return false;
  };

  // Hino sem partitura num pacote que tem partituras: não há aba Partitura (e, sem áudio, nenhuma barra de abas).
  confere(await abrirHino(998), "hino 998 carregado (a letra apareceu)");
  const h998 = await av(`({ abas: [...document.querySelectorAll('[role="tab"]')].map((t) => t.id), painel: !!document.getElementById('painel-partitura'), barra: !!document.querySelector('[role="tablist"]') })`);
  confere(!h998.painel && h998.abas.length === 0 && !h998.barra, `hino sem partitura, num pacote com partituras: sem aba Partitura: ${JSON.stringify(h998)}`);

  // Partitura de um pacote ANTIGO (sem data-t e data-f): sem halo, e o compasso continua com o fundo (o único destaque que ela tem) mais a barra.
  await av("sessionStorage.setItem('e2e-sem-tempo-nas-notas', '1'); 1");
  confere(await abrirHino(999), "hino 999 carregado com a partitura de pacote antigo (sem o tempo das notas)");
  await av("document.getElementById('aba-ouvir').click(); 1");
  await dormir(300);
  await av(`(() => { const b = [...document.querySelectorAll('#painel-ouvir button')].find((x) => /hino todo|whole|todo/i.test(x.textContent)); b?.click(); return !!b; })()`);
  await dormir(700);
  await av("document.getElementById('aba-partitura').click(); 1");
  await dormir(600);
  if ((await av(`document.querySelector('.chave-karaoke')?.getAttribute('aria-pressed') ?? null`)) === "false") {
    await av("document.querySelector('.chave-karaoke').click(); 1");
    await dormir(300);
  }
  if ((await lido()).tocando) {
    await av("document.querySelector('.mini .acao').click(); 1");
    await dormir(500);
  }
  await buscar(".mini .busca-entrada", 2);
  await dormir(600);
  const antigo = await av(`(() => ({ retangulos: document.querySelectorAll('#painel-partitura rect.destaque-compasso').length, barras: document.querySelectorAll('#painel-partitura line.barra-compasso').length,
    halos: document.querySelectorAll('#painel-partitura ellipse.destaque-nota').length, notasComTempo: document.querySelectorAll('#painel-partitura [data-t]').length }))()`);
  confere(antigo.notasComTempo === 0 && antigo.retangulos === 1 && antigo.barras === 1 && antigo.halos === 0, `pacote antigo (sem tempo nas notas): compasso com fundo e barra, e nenhum halo: ${JSON.stringify(antigo)}`);
  await av("sessionStorage.removeItem('e2e-sem-tempo-nas-notas'); 1");

  // Nenhum pacote com partituras importado (partituras = []): a aba aparece com o aviso e o botão para Ajustes.
  await av("sessionStorage.setItem('e2e-sem-partituras', '1'); 1");
  confere(await abrirHino(998), "hino 998 carregado de novo, sem partituras importadas");
  await av("document.getElementById('aba-partitura')?.click(); 1");
  await dormir(400); // o Svelte atualiza o DOM depois do clique
  const aviso = await av(`(() => {
    const aba = document.getElementById('aba-partitura');
    if (!aba) return { aba: false };
    const a = document.querySelector('#painel-partitura .sem-pacote a');
    return { aba: true, abas: [...document.querySelectorAll('[role="tab"]')].map((t) => t.id), href: a?.getAttribute('href') ?? null, botao: a?.classList.contains('botao') ?? false,
      svg: !!document.querySelector('#painel-partitura .folha svg'), visivel: !document.getElementById('painel-partitura').hidden };
  })()`);
  confere(aviso.aba && aviso.href === "/ajustes?abrir=partituras" && aviso.botao && !aviso.svg && aviso.visivel, `sem pacote com partituras: a aba aparece com o aviso e o botão para Ajustes: ${JSON.stringify(aviso)}`);
  await av("sessionStorage.removeItem('e2e-sem-partituras'); sessionStorage.setItem('e2e-falha-partitura', '1'); 1");

  // Falha na leitura da partitura: o aviso de erro traz "Tentar de novo", e ele lê outra vez (não fica preso para sempre).
  confere(await abrirHino(999), "hino 999 carregado para o teste de falha da partitura");
  await av("document.getElementById('aba-partitura')?.click(); 1");
  await dormir(600);
  const falhou = await av(`({ alerta: !!document.querySelector('#painel-partitura [role="alert"]'), botao: !!document.querySelector('#painel-partitura .tentar'), svg: !!document.querySelector('#painel-partitura .folha svg') })`);
  confere(falhou.alerta && falhou.botao && !falhou.svg, `leitura que falha: aviso de erro com o botão de tentar de novo: ${JSON.stringify(falhou)}`);
  // trocar de aba e voltar NÃO repete sozinho (o erro continua à vista)
  await av("document.getElementById('aba-letra').click(); 1");
  await dormir(200);
  await av("document.getElementById('aba-partitura').click(); 1");
  await dormir(400);
  confere(await av(`!!document.querySelector('#painel-partitura [role="alert"]') && !document.querySelector('#painel-partitura .folha svg')`), "trocar de aba e voltar não esconde o erro nem repete sozinho");
  await av("document.querySelector('#painel-partitura .tentar')?.click(); 1");
  await dormir(700);
  const refeito = await av(`({ alerta: !!document.querySelector('#painel-partitura [role="alert"]'), svg: !!document.querySelector('#painel-partitura .folha svg'), botao: !!document.querySelector('#painel-partitura .tentar') })`);
  confere(!refeito.alerta && refeito.svg && !refeito.botao, `"Tentar de novo" lê a partitura outra vez e ela aparece: ${JSON.stringify(refeito)}`);

  // Tela inicial: a logo do app tem o tamanho do botão de Ajustes (o hambúrguer/engrenagem), e a barra não cresce por causa dela.
  await enviar("Page.navigate", { url: `http://127.0.0.1:${PORTA_VITE}/` });
  for (let fim = Date.now() + 20000; Date.now() < fim && !(await av(`!!document.querySelector('.barra .logo') && !!document.querySelector('.barra .acao a')`)); ) await dormir(250);
  const marca = await av(`(() => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.width * 100) / 100, a: Math.round(b.height * 100) / 100 }; };
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return { logo: r(document.querySelector('.barra .logo')), botao: r(document.querySelector('.barra .acao a')), barraRem: Math.round((document.querySelector('.barra').getBoundingClientRect().height / rem) * 100) / 100,
      carregou: document.querySelector('.barra .logo').naturalWidth > 0 };
  })()`);
  confere(marca.logo.l === marca.botao.l && marca.logo.a === marca.botao.a, `a logo tem o tamanho do botão de Ajustes: ${JSON.stringify(marca)}`);
  confere(marca.carregou && marca.barraRem <= 3.6, `a imagem da logo carrega e a barra continua com ~3,5rem (${marca.barraRem}rem)`);

  // Ajustes: o hinário não se importa mais de arquivo (baixa-se do servidor, como as partituras): não há seletor de arquivo na tela.
  await enviar("Page.navigate", { url: `http://127.0.0.1:${PORTA_VITE}/ajustes` });
  for (let fim = Date.now() + 20000; Date.now() < fim && !(await av(`!!document.getElementById('conteudo')`)); ) await dormir(250);
  // Os blocos de Ajustes são cartões fechados de saída, com o estado na linha de cima (I-24): o Conteúdo mostra o hinário, as partituras e os sons.
  const resumoFechado = await av(`(() => { const d = document.getElementById('conteudo'); return { aberto: d.open, resumo: d.querySelector('summary').innerText.replace(/\\s+/g, ' ') }; })()`);
  confere(!resumoFechado.aberto && /\d+\s+(scores?|partituras?)/i.test(resumoFechado.resumo), `Ajustes: o cartão Conteúdo começa fechado e mostra o estado na linha de cima: ${JSON.stringify(resumoFechado)}`);
  // O texto de um cartão fechado não é renderizado: abre o Conteúdo antes de ler o que há dentro (hinário, partituras, sons).
  await av("document.getElementById('conteudo').open = true; 1");
  await dormir(400);
  const semArquivo = await av(`document.querySelectorAll('input[type="file"]').length`);
  confere(semArquivo === 0, `Ajustes não tem mais o botão de importar hinário de arquivo: ${semArquivo} seletores`);

  // O card Partituras (no molde dos sons gravados): com partituras instaladas mostra "Instaladas" e Remover; remover chama só o comando
  // de remover partituras; depois, sem pacote publicado (manifesto vazio), não há botão Baixar nem importação manual.
  const card1 = await av(`(() => { const c = document.querySelector('#partituras'); return { achou: !!c, texto: c?.innerText ?? '', botoes: [...(c?.querySelectorAll('button') ?? [])].map((b) => b.textContent.trim()) }; })()`);
  confere(card1.achou && /installed|instaladas|instaladas/i.test(card1.texto) && card1.botoes.length === 1, `card Partituras com partituras instaladas: estado e um só botão (Remover): ${JSON.stringify({ botoes: card1.botoes })}`);
  await av(`document.querySelector('#partituras button').click(); 1`);
  await dormir(600);
  const card2 = await av(`(() => { const c = document.querySelector('#partituras'); return { removeu: window.__removeu ?? 0, texto: c.innerText, botoes: c.querySelectorAll('button').length, entradaArquivo: c.querySelectorAll('input[type="file"]').length }; })()`);
  confere(card2.removeu === 1, `Remover chama o comando que apaga só as partituras (1 vez): ${card2.removeu}`);
  // O que o card mostra depois de remover depende de haver pacote publicado no manifesto do app (src/lib/partituras/manifesto.json):
  //  - sem pacote (`null`): "ainda não disponíveis" e nenhum botão; com pacote: "Não instaladas" e o botão Baixar. Em nenhum dos dois há importação de arquivo.
  const publicado = JSON.parse(readFileSync(join(RAIZ, "src/lib/partituras/manifesto.json"), "utf-8")).pacote !== null;
  const esperado = publicado
    ? /not installed|não instaladas|no instaladas/i.test(card2.texto) && card2.botoes === 1
    : /not yet available|ainda não|aún no/i.test(card2.texto) && card2.botoes === 0;
  confere(esperado && card2.entradaArquivo === 0, `sem partituras (${publicado ? "com pacote publicado: Não instaladas e o botão Baixar" : "sem pacote publicado: ainda não disponíveis e nenhum botão"}), sem importar arquivo: ${JSON.stringify({ botoes: card2.botoes, arquivo: card2.entradaArquivo, texto: card2.texto.slice(-60) })}`);

  // ---- Tela inicial com abas (I-28) e o afinador (I-13, etapa 1: dar o tom) ----
  await enviar("Page.navigate", { url: `http://127.0.0.1:${PORTA_VITE}/` });
  for (let fim = Date.now() + 20000; Date.now() < fim && !(await av(`!!document.getElementById('aba-afinador')`)); ) await dormir(250);
  await dormir(500);
  const abasInicio = await av(`({ abas: [...document.querySelectorAll('[role="tab"]')].map((a) => a.id), hinos: !document.getElementById('painel-hinos').hidden, afinador: !document.getElementById('painel-afinador').hidden })`);
  confere(abasInicio.abas.join() === "aba-hinos,aba-afinador,aba-gravador,aba-metronomo" && abasInicio.hinos && !abasInicio.afinador, `a tela inicial tem as abas Hinos, Afinador, Gravador e Metrônomo e abre em Hinos: ${JSON.stringify(abasInicio)}`);

  // O Metrônomo (I-20): espia o `start()` dos osciladores (quando cada clique foi agendado e com que frequência) e o número de AudioContext criados. A 240 bpm (0,25 s por clique) conferimos
  // o agendamento no relógio de áudio, o acento do 1º tempo, que o clique CONTINUA com a página escondida (a tela bloqueada) e que para ao tocar em Parar.
  await av(`document.getElementById('aba-metronomo').click(); 1`);
  await dormir(300);
  await av(`(() => {
    window.__cliques = []; window.__ctxs = 0;
    const O = window.AudioContext;
    window.AudioContext = class extends O { constructor(...a) { super(...a); window.__ctxs++; } };
    const start = AudioScheduledSourceNode.prototype.start;
    AudioScheduledSourceNode.prototype.start = function (when) { window.__cliques.push({ when, agora: this.context.currentTime, hz: this.frequency ? this.frequency.value : 0 }); return start.apply(this, arguments); };
    return 1; })()`);
  await av(`(() => { const b = [...document.querySelectorAll('#painel-metronomo .passo button')].find((x) => x.textContent.trim() === '+5'); for (let i = 0; i < 36; i++) b.click(); return 1; })()`);
  await dormir(200);
  const antesMet = await av(`({ painel: !document.getElementById('painel-metronomo').hidden, bpm: document.querySelector('#painel-metronomo .passo output').textContent.trim(), ctxs: window.__ctxs, cliques: window.__cliques.length, botoes: [...document.querySelectorAll('#painel-metronomo .compasso button')].length })`);
  confere(antesMet.painel && /240/.test(antesMet.bpm) && antesMet.ctxs === 0 && antesMet.cliques === 0 && antesMet.botoes === 6, `Metrônomo: a aba abre, o andamento chega a 240 e NENHUM áudio nasce antes do toque em Iniciar: ${JSON.stringify(antesMet)}`);
  await av(`document.getElementById('metronomo-iniciar').click(); 1`);
  await dormir(3000);
  const m1 = await av(`window.__cliques.map((c) => ({ w: c.when, a: c.agora, hz: c.hz }))`);
  const dif = m1.slice(1).map((c, i) => c.w - m1[i].w);
  confere(m1.length >= 10 && m1.every((c) => c.w - c.a > 0) && dif.every((d) => Math.abs(d - 0.25) < 0.001) && new Set(m1.map((c) => c.w)).size === m1.length, `Metrônomo: a 240 bpm os cliques são agendados à frente, a cada 0,25 s (±1 ms) e sem repetição: ${m1.length} cliques, desvio máx ${Math.max(...dif.map((d) => Math.abs(d - 0.25))).toFixed(6)}`);
  confere(m1.every((c, i) => (i % 4 === 0 ? c.hz > 1200 : c.hz < 1200)), `Metrônomo: o 1º tempo de cada compasso de 4 é o forte (mais agudo): ${m1.slice(0, 8).map((c) => Math.round(c.hz)).join(',')}`);
  const estado1 = await av(`({ pressionado: document.getElementById('metronomo-iniciar').getAttribute('aria-pressed'), recente: [...document.querySelectorAll('#painel-metronomo .recentes button')].map((b) => b.textContent.trim()), pos: document.querySelector('#painel-metronomo .pendulo').dataset.posicao, aceso: document.querySelector('#painel-metronomo .pendulo').dataset.aceso })`);
  confere(estado1.pressionado === 'true' && estado1.recente.length === 1 && /240/.test(estado1.recente[0]) && estado1.aceso !== '', `Metrônomo: ligado, a lista dos últimos tem o 240 · 4 tempos e a bolinha anda na trilha: ${JSON.stringify(estado1)}`);
  // O pêndulo VAI E VOLTA: cada clique é uma ponta. Amostra a posição a cada 40 ms durante ~2 s (8 cliques a 240 bpm): ela fica entre 0 e 1, encosta nas duas pontas, muda de
  // sentido várias vezes e nunca dá um salto grande (um deslizar sempre para a direita voltaria de 1 a 0 de uma vez).
  const amostras = [];
  for (let i = 0; i < 50; i++) {
    amostras.push(await av(`parseFloat(document.querySelector('#painel-metronomo .pendulo').dataset.posicao)`));
    await dormir(40);
  }
  const saltos = amostras.slice(1).map((v, i) => Math.abs(v - amostras[i]));
  let viradas = 0;
  for (let i = 2; i < amostras.length; i++) if ((amostras[i] - amostras[i - 1]) * (amostras[i - 1] - amostras[i - 2]) < -1e-6) viradas++;
  confere(amostras.every((v) => v >= 0 && v <= 1) && Math.min(...amostras) < 0.12 && Math.max(...amostras) > 0.88 && viradas >= 4 && Math.max(...saltos) < 0.6, `Metrônomo: o pêndulo vai e volta (pontas ${Math.min(...amostras).toFixed(2)} e ${Math.max(...amostras).toFixed(2)}, ${viradas} viradas, maior salto ${Math.max(...saltos).toFixed(2)})`);
  // Escondido (tela bloqueada): o clique continua, e a grade segue em 0,25 s.
  const antesEsc = (await av(`window.__cliques.length`));
  await av(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); 1`);
  await dormir(2500);
  const m2 = await av(`window.__cliques.map((c) => c.when)`);
  const dif2 = m2.slice(1).map((w, i) => w - m2[i]);
  confere(m2.length > antesEsc + 6 && dif2.every((d) => Math.abs(d - 0.25) < 0.001), `Metrônomo: com a página escondida o clique CONTINUA (antes ${antesEsc}, depois ${m2.length}) e a grade segue em 0,25 s (maior desvio ${Math.max(...dif2.map((d) => Math.abs(d - 0.25))).toFixed(4)}; intervalos fora: ${JSON.stringify(dif2.map((d, i) => [i, +d.toFixed(4)]).filter(([, d]) => Math.abs(d - 0.25) >= 0.001).slice(0, 5))})`);
  await av(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); 1`);
  await av(`document.getElementById('metronomo-iniciar').click(); 1`);
  await dormir(400);
  const aoParar = await av(`window.__cliques.length`);
  await dormir(1200);
  const depoisParar = await av(`({ n: window.__cliques.length, pressionado: document.getElementById('metronomo-iniciar').getAttribute('aria-pressed') })`);
  confere(depoisParar.pressionado === 'false' && depoisParar.n === aoParar, `Metrônomo: ao tocar em Parar nenhum clique novo é agendado (${aoParar} → ${depoisParar.n})`);
  await av(`document.getElementById('aba-hinos').click(); 1`);
  await dormir(300);

  // A busca da lista sobrevive à troca de aba (os painéis ficam montados).
  await av(`(() => { const i = document.querySelector('#painel-hinos input[type="search"]'); i.value = '998'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await dormir(200);
  await av(`document.getElementById('aba-afinador').click(); 1`);
  await dormir(500);
  const noAfinador = await av(`({ hinos: document.getElementById('painel-hinos').hidden, afinador: !document.getElementById('painel-afinador').hidden, selecionada: document.getElementById('aba-afinador').getAttribute('aria-selected') })`);
  confere(noAfinador.hinos && noAfinador.afinador && noAfinador.selecionada === "true", `trocar para o Afinador mostra o painel dele e esconde a lista: ${JSON.stringify(noAfinador)}`);

  // Mede o SOM que o app gera, com o analisador que o app expõe só no servidor de desenvolvimento: autocorrelação com interpolação parabólica.
  const hzDoTom = `(() => {
    const t = window.__bmTom;
    if (!t) return { erro: 'sem sonda' };
    const an = t.analisador, buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    const sr = an.context.sampleRate, n = buf.length, lagMax = Math.floor(sr / 60), lagMin = Math.floor(sr / 1500);
    let energia = 0; for (let i = 0; i < n; i++) energia += buf[i] * buf[i];
    if (energia / n < 1e-6) return { erro: 'silêncio', rms: Math.sqrt(energia / n) };
    const r = new Float64Array(lagMax + 2);
    for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) { let a = 0; for (let i = 0; i + lag < n; i++) a += buf[i] * buf[i + lag]; r[lag] = a; }
    let max = 0; for (let lag = lagMin; lag <= lagMax; lag++) if (r[lag] > max) max = r[lag];
    let melhor = -1;
    for (let lag = lagMin; lag <= lagMax; lag++) if (r[lag] > 0.97 * max && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) { melhor = lag; break; }
    if (melhor < 0) return { erro: 'sem pico' };
    const a = r[melhor - 1], b = r[melhor], c = r[melhor + 1], d = a - 2 * b + c;
    const lagFino = d === 0 ? melhor : melhor + (a - c) / (2 * d);
    return { hz: sr / lagFino, tocando: t.tocando, pedida: t.frequencia, rms: Math.sqrt(energia / n) };
  })()`;
  const clicarGrande = (indice) => av(`document.querySelectorAll('#painel-afinador :is(.grande, .tocar-pilula)')[${indice}].click(); 1`);

  // "Outra nota" é um cartão FECHADO de saída (com a nota e a frequência na linha de cima) e o volume não está na tela (é o do celular).
  const fechado = await av(`(() => { const d = document.querySelector('#painel-afinador details'); return { aberto: d.open, resumo: d.querySelector('summary').textContent.replace(/\\s+/g, ' ').trim(), controleDeVolume: document.querySelectorAll('#painel-afinador input[type="range"]').length }; })()`);
  confere(fechado.aberto === false && /C4.*262|Dó4.*262|Do4.*262/.test(fechado.resumo) && fechado.controleDeVolume === 0, `Afinador: "Outra nota" começa fechado, mostra a nota e a frequência, e não há controle de volume na tela: ${JSON.stringify(fechado)}`);
  await clicarGrande(0); // Lá 440 Hz
  await dormir(900);
  const la = await av(hzDoTom);
  confere(la.hz && Math.abs(la.hz - 440) <= 1 && la.tocando, `o Lá toca a 440 Hz (medido no som gerado, com folga de 1 Hz): ${JSON.stringify(la)}`);
  const pressionado = await av(`document.querySelectorAll('#painel-afinador :is(.grande, .tocar-pilula)')[0].getAttribute('aria-pressed')`);
  confere(pressionado === "true", `o botão do Lá fica pressionado enquanto toca: aria-pressed=${pressionado}`);

  // Outra nota: Mi♭4 (311,13 Hz). Ligar a outra nota com o Lá soando TROCA de nota; mudar a oitava com ela soando a afina na hora (Mi♭5, 622,25 Hz).
  await av(`document.querySelector('#painel-afinador details summary').click(); 1`); // abre o cartão, como a pessoa faria
  await dormir(300);
  await av(`document.querySelector('#painel-afinador input[type="radio"][value="3"]').click(); 1`);
  await clicarGrande(1);
  await dormir(900);
  const mib4 = await av(hzDoTom);
  confere(mib4.hz && Math.abs(mib4.hz - 311.127) <= 1, `o Mi♭4 toca a 311,13 Hz, trocando o Lá: ${JSON.stringify(mib4)}`);
  await av(`[...document.querySelectorAll('#painel-afinador .botao-barra')].find((b) => /up|acima|arriba/i.test(b.getAttribute('aria-label'))).click(); 1`);
  await dormir(900);
  const mib5 = await av(hzDoTom);
  confere(mib5.hz && Math.abs(mib5.hz - 622.254) <= 2, `subir a oitava com a nota soando a afina na hora (Mi♭5, 622,25 Hz): ${JSON.stringify(mib5)}`);
  const lista = await av(`document.querySelector('#painel-afinador .freq').textContent.replace(/\\s+/g, ' ').trim()`);
  confere(/E♭5/.test(lista) && /622/.test(lista), `a tela mostra o nome e a frequência da nota: ${lista}`);

  // A pílula: o Play fica na linha do cartão, e fechar o cartão com a nota soando NÃO a para (o botão de parar está fora dele).
  await av(`document.querySelector('#painel-afinador details summary').click(); 1`);
  await dormir(900);
  const aposFechar = await av(`({ tocando: window.__bmTom.tocando, aberto: document.querySelector('#painel-afinador details').open, pressionado: document.querySelector('#painel-afinador .tocar-pilula').getAttribute('aria-pressed') })`);
  confere(aposFechar.tocando !== false && aposFechar.aberto === false && aposFechar.pressionado === "true", `fechar o cartão "Outra nota" com a nota soando não para o som (o Play da pílula segue à vista): ${JSON.stringify(aposFechar)}`);
  await av(`document.querySelector('#painel-afinador details summary').click(); 1`); // reabre para o resto do teste
  await dormir(300);
  await clicarGrande(1);
  await dormir(900);

  // Sair da aba para o som (e o áudio é devolvido).
  await av(`document.getElementById('aba-hinos').click(); 1`);
  await dormir(900); // a soltura da nota (0,1 s) e o fechamento do contexto
  const aposSair = await av(`({ tocando: window.__bmTom.tocando, pressionado: document.querySelectorAll('#painel-afinador :is(.grande, .tocar-pilula)')[1].getAttribute('aria-pressed'), contexto: window.__bmTom.analisador.context.state })`);
  confere(aposSair.tocando === false && aposSair.pressionado === "false" && aposSair.contexto === "closed", `sair da aba Afinador para o som e devolve o áudio (contexto fechado): ${JSON.stringify(aposSair)}`);
  const buscaFicou = await av(`document.querySelector('#painel-hinos input[type="search"]').value`);
  confere(buscaFicou === "998", `a busca da lista sobrevive à troca de aba: "${buscaFicou}"`);

  // Gravador (I-03): grava o microfone (o do teste é falso, do Chrome), ouve de volta e descarta; sair da aba com a gravação em curso para e devolve o microfone.
  await av(`document.getElementById('aba-gravador').click(); 1`);
  await dormir(400);
  const estadoGravador = () => av(`({ pressionado: document.getElementById('gravar').getAttribute('aria-pressed'), audio: document.querySelectorAll('.gravacao-item').length > 0, itens: document.querySelectorAll('.gravacao-item').length, info: document.querySelector('.gravacao-item .info')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, erro: !!document.querySelector('#painel-gravador .aviso.erro'), ativos: window.__microfones.filter((t) => t.readyState === 'live').length })`);
  // Depois de parar, a gravação leva um tempo para chegar à lista (o áudio é fechado, guardado no IndexedDB e a lista relida). Esperar um tempo fixo (900 ms)
  // falhava no runner lento do GitHub; aqui se espera ela APARECER (até 10 s), conferindo a cada 200 ms.
  const esperarGravacao = async (quantas = 1) => {
    let apareceu = false;
    for (let fim = Date.now() + 10000; Date.now() < fim; ) {
      if ((await av(`document.querySelectorAll('.gravacao-item').length`)) >= quantas) {
        apareceu = true;
        break;
      }
      await dormir(200);
    }
    // O estouro da espera aparece como falha própria, para não ficar escondido atrás do "audio: false, itens: 0" da conferência seguinte.
    const motivo = apareceu ? null : await av(`(async () => ({ avisos: (window.__avisos ?? []).slice(-30), texto: (document.getElementById('painel-gravador')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 300), alertas: [...document.querySelectorAll('#painel-gravador [role="alert"], #painel-gravador .aviso')].map((e) => e.textContent.trim().slice(0, 120)), audios: document.querySelectorAll('#painel-gravador audio').length, bancos: await Promise.race([indexedDB.databases().then((l) => l.map((d) => d.name + '@' + d.version), (e) => 'databases() falhou: ' + e), new Promise((r) => setTimeout(() => r('databases() sem resposta em 2 s'), 2000))]) }))()`);
    confere(apareceu, `Gravador: a gravação apareceu na lista em até 10 s (esperava ${quantas})${motivo ? ` — a tela mostrava: ${JSON.stringify(motivo)}` : ""}`);
    await dormir(150); // deixa o resto da linha (tempo, tamanho, formato) terminar de ser desenhado
  };
  // Apagar pede confirmação (dois toques): `apagarPrimeira` apaga a gravação do topo da lista; `limparLista` apaga todas.
  const apagarPrimeira = async () => {
    await av(`document.querySelector('.gravacao-item .apagar')?.click(); 1`);
    await dormir(150);
    await av(`document.querySelector('.gravacao-item .apagar')?.click(); 1`);
    await dormir(400);
  };
  const limparLista = async () => {
    await av(`document.getElementById('apagar-todas')?.click(); 1`);
    await dormir(150);
    await av(`document.getElementById('apagar-todas')?.click(); 1`);
    await dormir(500);
  };
  await limparLista(); // começa sem gravações de execuções anteriores (o armazenamento do Chrome do teste é novo, mas assim vale também em outra ordem)
  // O gancho que conta os microfones abertos e permite atrasar ou mudar o microfone do teste; recarregar a página o perde, então é reinstalado a cada recarga.
  const instalarGanchoDoMicrofone = () => av(`window.__microfones = []; const pedir = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = async (c) => { window.__pedido = c; await new Promise((r) => setTimeout(r, window.__atrasoMic ?? 0)); let f = await pedir(c); if (window.__micMudo) { f.getTracks().forEach((t) => t.stop()); const ctx = new AudioContext(); f = ctx.createMediaStreamDestination().stream; } f.getTracks().forEach((t) => window.__microfones.push(t)); return f; }; 1`);
  await instalarGanchoDoMicrofone();
  const g0 = await estadoGravador();
  confere(g0.pressionado === "false" && g0.audio === false && g0.erro === false, `Gravador: começa parado, sem gravação e sem erro: ${JSON.stringify(g0)}`);
  await av(`document.getElementById('gravar').click(); 1`);
  await dormir(2300);
  const g1 = await estadoGravador();
  const pedido = await av(`window.__pedido`);
  confere(g1.pressionado === "true" && g1.ativos === 1 && pedido?.audio?.echoCancellation === false && pedido?.audio?.autoGainControl === false, `Gravador: ao gravar o microfone está ligado, sem os efeitos de voz: ${JSON.stringify({ g1, pedido })}`);
  await av(`document.getElementById('gravar').click(); 1`);
  await esperarGravacao();
  const g2 = await estadoGravador();
  confere(g2.pressionado === "false" && g2.audio === true && g2.ativos === 0 && /^0:0[1-3] · .+ · (webm|ogg|mp4)/.test(g2.info ?? ""), `Gravador: ao parar entrega a gravação (tempo, tamanho e formato) e devolve o microfone: ${JSON.stringify(g2)}`);
  await av(`document.querySelector('.gravacao-item .ouvir')?.click(); 1`);
  await dormir(500);
  const tocavel = await av(`new Promise((ok) => { const a = document.querySelector('.gravacao-item audio'); if (!a) return ok(null); const fim = setTimeout(() => ok(null), 4000); a.addEventListener('durationchange', () => { if (Number.isFinite(a.duration)) { clearTimeout(fim); ok({ duracao: a.duration, erro: !!a.error }); } }); a.load(); })`);
  confere(tocavel && tocavel.erro === false && Number.isFinite(tocavel.duracao) && tocavel.duracao > 1 && tocavel.duracao < 4, `Gravador: o arquivo gravado carrega no player, com a duração certa (~2 s, e não infinita): ${JSON.stringify(tocavel)}`);
  await apagarPrimeira();
  const g3 = await estadoGravador();
  confere(g3.audio === false, `Gravador: apagar (com confirmação) tira a gravação da lista: ${JSON.stringify(g3)}`);
  // Medidor de som: o microfone falso do Chrome apita; a barra do botão sobe com o som, o leitor de tela é avisado de que o som chegou e a barra
  // volta a zero ao parar. Com um microfone MUDO, depois de 3 s aparece o aviso "não estou ouvindo nenhum som".
  await av(`document.getElementById('gravar').click(); 1`);
  const niveis = [];
  for (let k = 0; k < 28; k++) {
    await dormir(100);
    niveis.push(await av(`Number(document.getElementById('gravar').dataset.nivel)`));
  }
  const barraLarga = await av(`(() => { const b = document.querySelector('#gravar .nivel'); return b ? b.getBoundingClientRect().width / document.getElementById('gravar').getBoundingClientRect().width : null; })()`);
  const picoNivel = Math.max(...niveis);
  const statusMedidor = await av(`document.querySelector('#painel-gravador [role="status"].so-leitor').textContent.trim()`);
  confere(picoNivel > 0.3 && barraLarga !== null && /receiving sound|recebendo som|recibiendo sonido/i.test(statusMedidor), `Gravador: a barra do botão sobe com o som do microfone (pico ${picoNivel.toFixed(2)}) e o leitor de tela é avisado de que o som chegou: ${JSON.stringify({ barraLarga, statusMedidor })}`);
  const avisoComSom = await av(`!!document.getElementById('sem-som')`);
  confere(avisoComSom === false, `Gravador: com som entrando não aparece o aviso de "sem som"`);
  await av(`document.getElementById('gravar').click(); 1`);
  await dormir(800);
  const nivelParado = await av(`({ nivel: Number(document.getElementById('gravar').dataset.nivel), barra: !!document.querySelector('#gravar .nivel') })`);
  confere(nivelParado.nivel === 0 && nivelParado.barra === false, `Gravador: ao parar a barra do medidor some: ${JSON.stringify(nivelParado)}`);
  await av(`1`); await apagarPrimeira(); await av(`window.__micMudo = true; 1`);
  await dormir(300);
  await av(`document.getElementById('gravar').click(); 1`);
  await dormir(1500);
  const semAvisoCedo = await av(`!!document.getElementById('sem-som')`);
  await dormir(2500);
  const avisoMudo = await av(`document.getElementById('sem-som')?.textContent.trim() ?? null`);
  confere(semAvisoCedo === false && /can't hear any sound|não estou ouvindo|no oigo/i.test(avisoMudo ?? ""), `Gravador: com o microfone mudo o aviso "sem som" só aparece depois de uns 3 s: ${JSON.stringify({ semAvisoCedo, avisoMudo })}`);
  await av(`document.getElementById('gravar').click(); window.__micMudo = false; 1`);
  await dormir(900);
  await apagarPrimeira();
  await dormir(300);
  // Sem medidor (sem AudioContext) a gravação segue igual e NÃO aparece o aviso de "sem som" (o nível seria sempre 0, o que não prova que não há som).
  await av(`window.__acOriginal = window.AudioContext; window.AudioContext = undefined; 1`);
  await av(`document.getElementById('gravar').click(); 1`);
  await dormir(3800);
  const semMedidor = await av(`({ gravando: document.getElementById('gravar').getAttribute('aria-pressed'), aviso: !!document.getElementById('sem-som'), barra: !!document.querySelector('#gravar .nivel') })`);
  confere(semMedidor.gravando === "true" && semMedidor.aviso === false, `Gravador: sem AudioContext grava igual e não mostra o aviso de "sem som": ${JSON.stringify(semMedidor)}`);
  await av(`document.getElementById('gravar').click(); window.AudioContext = window.__acOriginal; 1`);
  await dormir(900);
  await apagarPrimeira();
  await dormir(300);
  // Toque duplo em "Gravar" enquanto o microfone é pedido: o segundo toque é ignorado (dois pedidos juntos deixavam um microfone órfão aceso).
  await av(`window.__atrasoMic = 800; window.__microfones.length = 0; 1`);
  await av(`document.getElementById('gravar').click(); 1`);
  await dormir(100);
  await av(`document.getElementById('gravar').click(); 1`);
  await dormir(1500);
  const gd = await av(`({ pressionado: document.getElementById('gravar').getAttribute('aria-pressed'), pedidos: window.__microfones.length, ativos: window.__microfones.filter((t) => t.readyState === 'live').length })`);
  confere(gd.pressionado === "true" && gd.pedidos === 1 && gd.ativos === 1, `Gravador: dois toques seguidos em Gravar pedem o microfone UMA vez e não deixam um órfão: ${JSON.stringify(gd)}`);
  await av(`document.getElementById('gravar').click(); 1`);
  await dormir(900);
  const gd2 = await estadoGravador();
  confere(gd2.pressionado === "false" && gd2.ativos === 0 && gd2.audio === true, `Gravador: parar depois do toque duplo entrega a gravação e devolve o microfone: ${JSON.stringify(gd2)}`);
  await av(`window.__atrasoMic = 0; 1`);
  await apagarPrimeira();
  await dormir(300);
  // O diálogo de permissão do Android esconde a página enquanto o microfone ainda é pedido: isso NÃO pode cancelar o pedido (o bug do emulador, em que o
  // microfone permitido era jogado fora). Simula o pedido demorado (1 s) e a página escondida no meio dele.
  const esconder = (v) => av(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${v} }); document.dispatchEvent(new Event('visibilitychange')); 1`);
  await av(`window.__atrasoMic = 1000; 1`);
  await av(`document.getElementById('gravar').click(); 1`);
  await dormir(300);
  await esconder(true);
  await dormir(200);
  await esconder(false);
  await dormir(1300);
  const g5 = await estadoGravador();
  confere(g5.pressionado === "true" && g5.ativos === 1, `Gravador: esconder a página enquanto o microfone é pedido não cancela o pedido (a gravação começa): ${JSON.stringify(g5)}`);
  await esconder(true); // agora com a gravação em curso: o app em segundo plano a para
  await dormir(1200);
  await esconder(false);
  const g6 = await estadoGravador();
  confere(g6.pressionado === "false" && g6.ativos === 0 && g6.audio === true, `Gravador: o app em segundo plano para a gravação em curso, devolve o microfone e guarda o gravado: ${JSON.stringify(g6)}`);
  await av(`window.__atrasoMic = 0; 1`);
  await apagarPrimeira();
  await dormir(300);
  // No Android o serviço em primeiro plano (microfone) assume a gravação: com a tela bloqueada (página escondida) ela SEGUE, e para pelo botão da
  // notificação. A ponte falsa registra as chamadas.
  await av(`window.__ponte = []; window.BmServico = { iniciar() {}, parar() {}, iniciarGravacao() { window.__ponte.push('ligar'); }, pararGravacao() { window.__ponte.push('desligar'); } }; 1`);
  await av(`document.getElementById('gravar').click(); 1`);
  await dormir(600);
  await esconder(true);
  await dormir(1500);
  const g7 = await estadoGravador();
  confere(g7.pressionado === "true" && g7.ativos === 1, `Gravador: com o serviço do Android, a página escondida NÃO para a gravação: ${JSON.stringify(g7)}`);
  await av(`window.__bmGravacaoParadaPelaNotificacao && window.__bmGravacaoParadaPelaNotificacao(); 1`);
  await dormir(1200);
  await esconder(false);
  const g8 = await estadoGravador();
  const ponte8 = await av(`window.__ponte.join(',')`);
  confere(g8.pressionado === "false" && g8.ativos === 0 && g8.audio === true && ponte8 === "ligar,desligar", `Gravador: o botão Parar da notificação para, guarda e solta o serviço: ${JSON.stringify(g8)} / ${ponte8}`);
  // Parte 4 (I-20): COM o serviço do Android assumindo a gravação ela SEGUE ao trocar de aba, e o aviso "Gravando · Parar" aparece nas outras abas. Com fone, o metrônomo e a gravação
  // andam juntos; sem fone, ligar o metrônomo para a gravação (o clique do alto-falante entraria nela), que é guardada.
  await av(`window.__fone = true; window.BmServico.temFone = () => window.__fone; 1`);
  await av(`document.getElementById('gravar').click(); 1`);
  await dormir(700);
  await av(`document.getElementById('aba-metronomo').click(); 1`);
  await dormir(500);
  const gA = await av(`({ pressionado: document.getElementById('gravar').getAttribute('aria-pressed'), ativos: window.__microfones.filter((t) => t.readyState === 'live').length, aviso: !!document.getElementById('gravando-aviso'), texto: document.getElementById('gravando-aviso')?.textContent.replace(/\\s+/g, ' ').trim() ?? null })`);
  confere(gA.pressionado === 'true' && gA.ativos === 1 && gA.aviso, `Gravador: trocar para outra aba NÃO para a gravação protegida pelo serviço, e o aviso "Gravando · Parar" aparece: ${JSON.stringify(gA)}`);
  await av(`document.getElementById('metronomo-iniciar').click(); 1`);
  await dormir(900);
  const gB = await av(`({ pressionado: document.getElementById('gravar').getAttribute('aria-pressed'), ativos: window.__microfones.filter((t) => t.readyState === 'live').length, metro: document.getElementById('metronomo-iniciar').getAttribute('aria-pressed') })`);
  confere(gB.pressionado === 'true' && gB.ativos === 1 && gB.metro === 'true', `Com fone: o metrônomo e a gravação andam juntos: ${JSON.stringify(gB)}`);
  await av(`document.querySelector('#gravando-aviso button').click(); 1`);
  await dormir(1500);
  await av(`document.getElementById('metronomo-iniciar').click(); 1`); // para o metrônomo
  await dormir(200);
  await av(`document.getElementById('aba-gravador').click(); 1`);
  await dormir(500);
  const gC = await estadoGravador();
  const avisoSumiu = await av(`!document.getElementById('gravando-aviso')`);
  confere(gC.pressionado === 'false' && gC.ativos === 0 && gC.audio === true && avisoSumiu, `O Parar do aviso para a gravação, guarda o gravado, devolve o microfone e o aviso some: ${JSON.stringify(gC)}`);
  await apagarPrimeira();
  await dormir(300);
  // Sem fone: ligar o metrônomo para a gravação, que é guardada.
  await av(`window.__fone = false; document.getElementById('gravar').click(); 1`);
  await dormir(700);
  await av(`document.getElementById('aba-metronomo').click(); 1`);
  await dormir(400);
  await av(`document.getElementById('metronomo-iniciar').click(); 1`);
  await dormir(1500);
  await av(`document.getElementById('aba-gravador').click(); 1`);
  await dormir(500);
  const gD = await estadoGravador();
  const metroD = await av(`document.getElementById('metronomo-iniciar').getAttribute('aria-pressed')`);
  confere(gD.pressionado === 'false' && gD.ativos === 0 && gD.audio === true && metroD === 'true', `Sem fone: ligar o metrônomo para a gravação (guardada) e o clique segue: ${JSON.stringify(gD)} metrônomo=${metroD}`);
  await av(`document.getElementById('aba-metronomo').click(); 1`);
  await dormir(200);
  await av(`document.getElementById('metronomo-iniciar').click(); 1`);
  await dormir(200);
  await av(`document.getElementById('aba-gravador').click(); 1`);
  await dormir(300);
  await apagarPrimeira();
  await dormir(300);
  await av(`delete window.BmServico; 1`);
  // O serviço do Android recusa DEPOIS de a ponte ter dito que assumiu: a proteção cai e, com a página escondida, a gravação para e é guardada.
  await av(`document.getElementById('gravar').click(); 1`);
  await dormir(600);
  await esconder(true);
  await dormir(500);
  await av(`window.__bmServicoDeGravacaoFalhou && window.__bmServicoDeGravacaoFalhou(); 1`);
  await dormir(1200);
  await esconder(false);
  const g9 = await estadoGravador();
  confere(g9.pressionado === "false" && g9.ativos === 0 && g9.audio === true, `Gravador: se o serviço do Android falha com a página escondida, a gravação para e é guardada: ${JSON.stringify(g9)}`);
  await av(`window.__atrasoMic = 0; 1`);
  await apagarPrimeira();
  await dormir(300);
  await av(`window.__atrasoMic = 0; 1`);
  await apagarPrimeira();
  await dormir(300);
  // Sair da aba com a gravação em curso: para, devolve o microfone e a gravação feita até ali fica.
  await av(`document.getElementById('gravar').click(); 1`);
  await dormir(1500);
  await av(`document.getElementById('aba-hinos').click(); 1`);
  await dormir(1200);
  await av(`document.getElementById('aba-gravador').click(); 1`);
  await dormir(400);
  const g4 = await estadoGravador();
  confere(g4.pressionado === "false" && g4.ativos === 0 && g4.audio === true, `Gravador: sair da aba com a gravação em curso a para, devolve o microfone e guarda o que foi gravado: ${JSON.stringify(g4)}`);
  await apagarPrimeira();
  await av(`document.getElementById('aba-hinos').click(); 1`);
  await dormir(300);

  // Lista de gravações guardadas: a gravação é guardada sozinha ao parar, aparece no topo com o resumo (quantidade e espaço), sobrevive a recarregar o app,
  // apagar pede confirmação, e a lista pagina (10 por vez) quando o fim chega perto da tela.
  const abrirGravador = async () => {
    await enviar("Page.navigate", { url: `http://127.0.0.1:${PORTA_VITE}/` });
    for (let fim = Date.now() + 20000; Date.now() < fim && !(await av(`!!document.getElementById('aba-gravador')`)); ) await dormir(250);
    await dormir(500);
    await av(`document.getElementById('aba-gravador').click(); 1`);
    await dormir(700);
    await instalarGanchoDoMicrofone();
  };
  await av(`document.getElementById('aba-gravador').click(); 1`);
  await dormir(400);
  await av(`document.getElementById('gravar').click(); 1`);
  await dormir(1800);
  await av(`document.getElementById('gravar').click(); 1`);
  await esperarGravacao();
  const guardada = await av(`({ itens: document.querySelectorAll('.gravacao-item').length, nome: document.querySelector('.gravacao-item .nome')?.textContent.trim(), resumo: document.getElementById('resumo-gravacoes')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, vazio: !!document.getElementById('lista-vazia') })`);
  confere(guardada.itens === 1 && /^(Recording|Gravação|Grabación) \d\d\/\d\d.*\d\d:\d\d$/.test(guardada.nome ?? "") && /^1 (recording|gravação|grabación) · .*KB/.test(guardada.resumo ?? "") && guardada.vazio === false, `Gravador: ao parar a gravação é guardada no topo da lista, com nome de data e hora e o resumo (quantidade e espaço): ${JSON.stringify(guardada)}`);
  await abrirGravador(); // recarrega o app
  const depoisDeRecarregar = await av(`({ itens: document.querySelectorAll('.gravacao-item').length, resumo: document.getElementById('resumo-gravacoes')?.textContent.replace(/\\s+/g, ' ').trim() ?? null })`);
  confere(depoisDeRecarregar.itens === 1 && /^1 /.test(depoisDeRecarregar.resumo ?? ""), `Gravador: a gravação guardada sobrevive a recarregar o app: ${JSON.stringify(depoisDeRecarregar)}`);
  await av(`document.querySelector('.gravacao-item .apagar')?.click(); 1`);
  await dormir(200);
  const pedeConfirmar = await av(`({ itens: document.querySelectorAll('.gravacao-item').length, texto: (document.querySelector('.gravacao-item .apagar')?.textContent.trim() ?? null) })`);
  confere(pedeConfirmar.itens === 1 && /Really delete|Apagar mesmo|Borrar de verdad/.test(pedeConfirmar.texto), `Gravador: o primeiro toque em Apagar só pede confirmação (nada some): ${JSON.stringify(pedeConfirmar)}`);
  await dormir(4300); // sem o segundo toque o botão volta
  const voltou = await av(`({ itens: document.querySelectorAll('.gravacao-item').length, texto: (document.querySelector('.gravacao-item .apagar')?.textContent.trim() ?? null) })`);
  confere(voltou.itens === 1 && /^(Delete|Apagar|Borrar)$/.test(voltou.texto), `Gravador: sem o segundo toque a confirmação some e a gravação fica: ${JSON.stringify(voltou)}`);
  await apagarPrimeira();
  const apagou = await av(`({ itens: document.querySelectorAll('.gravacao-item').length, resumo: !!document.getElementById('resumo-gravacoes'), vazio: !!document.getElementById('lista-vazia') })`);
  confere(apagou.itens === 0 && apagou.resumo === false && apagou.vazio === true, `Gravador: confirmando, a gravação é apagada e a lista volta ao estado vazio: ${JSON.stringify(apagou)}`);

  // Ouvir uma gravação de verdade: o primeiro "Ouvir" toca e NÃO se pausa sozinho (o aviso à lista vem antes do play); tocar um item com uma gravação em andamento a
  // PARA (o alto-falante entraria nela); gravar para o item que tocava.
  await av(`document.getElementById('gravar').click(); 1`);
  await dormir(1800);
  const antesDeParar = await av(`document.querySelectorAll('.gravacao-item').length`);
  await av(`document.getElementById('gravar').click(); 1`);
  await esperarGravacao(antesDeParar + 1);
  await av(`document.querySelector('.gravacao-item .ouvir')?.click(); 1`);
  await dormir(900);
  const tocaDeVerdade = await av(`(() => { const a = document.querySelector('.gravacao-item audio'); return a ? { pausado: a.paused, tempo: a.currentTime, erro: !!a.error } : null; })()`);
  confere(tocaDeVerdade && tocaDeVerdade.pausado === false && tocaDeVerdade.tempo > 0 && tocaDeVerdade.erro === false, `Gravador: o primeiro "Ouvir" toca e não se pausa sozinho: ${JSON.stringify(tocaDeVerdade)}`);
  await av(`document.getElementById('gravar').click(); 1`); // grava de novo: a gravação que tocava para
  await dormir(500);
  const gravaParaOItem = await av(`({ gravando: document.getElementById('gravar').getAttribute('aria-pressed'), pausado: document.querySelector('.gravacao-item audio')?.paused ?? null })`);
  confere(gravaParaOItem.gravando === "true" && gravaParaOItem.pausado === true, `Gravador: gravar para a gravação da lista que estava tocando: ${JSON.stringify(gravaParaOItem)}`);
  await av(`document.querySelectorAll('.gravacao-item audio')[0]?.play(); 1`); // tocar um item com a gravação em andamento
  await dormir(1500);
  const itemParaAGravacao = await estadoGravador();
  confere(itemParaAGravacao.pressionado === "false" && itemParaAGravacao.itens === 2 && itemParaAGravacao.ativos === 0, `Gravador: tocar uma gravação da lista com outra em andamento a para, guarda o gravado e devolve o microfone: ${JSON.stringify(itemParaAGravacao)}`);
  await limparLista();

  // Paginação: 25 gravações semeadas direto no armazenamento (o mesmo formato do app); a lista mostra 10, e mais 10 a cada vez que o fim chega perto da tela.
  await av(`new Promise((ok, falha) => {
    const r = indexedDB.open('bm-gravacoes', 1);
    r.onupgradeneeded = () => { const b = r.result; b.createObjectStore('meta', { keyPath: 'id' }).createIndex('porData', ['criadaEm', 'id']); b.createObjectStore('blobs'); };
    r.onerror = () => falha(r.error);
    r.onsuccess = () => {
      const b = r.result; const t = b.transaction(['meta', 'blobs'], 'readwrite'); const agora = Date.now();
      for (let i = 0; i < 25; i++) { const id = 'semente-' + String(i).padStart(2, '0'); t.objectStore('meta').put({ id, criadaEm: agora - i * 60000, segundos: 5 + i, tipo: 'audio/webm;codecs=opus', bytes: 1000 }); t.objectStore('blobs').put(new Blob([new Uint8Array(1000)], { type: 'audio/webm' }), id); }
      t.oncomplete = () => { b.close(); ok(1); }; t.onerror = () => falha(t.error);
    };
  })`);
  // A paginação carrega mais quando o fim da lista chega a 600 px da tela. Numa tela baixa essa zona é pequena e o resultado não depende de quanto a aba tem de texto
  // em cima (o CI, com outras fontes, chegou a carregar a 2ª página sozinho numa tela alta).
  await enviar("Emulation.setDeviceMetricsOverride", { width: 412, height: 420, deviceScaleFactor: 1, mobile: true });
  await abrirGravador();
  const contar = () => av(`({ itens: document.querySelectorAll('.gravacao-item').length, fim: !!document.getElementById('fim-lista'), resumo: document.getElementById('resumo-gravacoes')?.textContent.replace(/\\s+/g, ' ').trim() ?? null })`);
  const pag1 = await contar();
  confere(pag1.itens === 10 && pag1.fim === true && /^25 /.test(pag1.resumo ?? ""), `Gravador: a lista começa com 10 de 25 gravações e o resumo diz 25: ${JSON.stringify(pag1)}`);
  // O interruptor ".webm | .weba" do Enviar: só aparece com a folha de compartilhar (a ponte do Android) e para áudio em WebM; o escolhido é lembrado e vale para todas as gravações.
  // A ponte do Android é simulada em TODA página nova deste trecho (o app é recarregado em `abrirGravador`) e retirada no fim.
  const ponteFalsa = (await enviar("Page.addScriptToEvaluateOnNewDocument", { source: "window.BmCompartilhar = { comecar: () => true, parte: () => true, enviar: () => true, cancelar() {} };" })).result.identifier;
  await av(`localStorage.removeItem('prefs.compartilhar'); 1`);
  await abrirGravador();
  const fmt0 = await av(`(() => { const g = [...document.querySelectorAll('.gravacao-item .formato')]; return { n: g.length, padrao: g[0]?.querySelector('[aria-pressed="true"]')?.textContent.trim() ?? null }; })()`);
  confere(fmt0.n >= 1 && fmt0.padrao === '.webm', `Gravador: cada gravação em WebM tem o interruptor .webm | .weba, com .webm de padrão: ${JSON.stringify(fmt0)}`);
  await av(`[...document.querySelectorAll('.gravacao-item .formato button')].find((b) => b.textContent.trim() === '.weba').click(); 1`);
  await dormir(300);
  const fmt1 = await av(`({ salvo: localStorage.getItem('prefs.compartilhar'), escolhidas: [...document.querySelectorAll('.gravacao-item .formato [aria-pressed="true"]')].map((b) => b.textContent.trim()) })`);
  confere(fmt1.salvo === '{"webm":"weba"}' && fmt1.escolhidas.length >= 1 && fmt1.escolhidas.every((x) => x === '.weba'), `Gravador: escolher .weba é lembrado e vale para todas as gravações: ${JSON.stringify(fmt1)}`);
  await abrirGravador();
  const fmt2 = await av(`[...document.querySelectorAll('.gravacao-item .formato [aria-pressed="true"]')].map((b) => b.textContent.trim())`);
  confere(fmt2.length >= 1 && fmt2.every((x) => x === '.weba'), `Gravador: depois de reabrir o app a escolha continua .weba: ${JSON.stringify(fmt2.slice(0, 3))}`);
  await av(`localStorage.removeItem('prefs.compartilhar'); 1`);
  await enviar("Page.removeScriptToEvaluateOnNewDocument", { identifier: ponteFalsa });
  await abrirGravador();

  const ordem = await av(`[...document.querySelectorAll('.gravacao-item')].map((e) => e.dataset.id).slice(0, 3)`);
  confere(JSON.stringify(ordem) === JSON.stringify(["semente-00", "semente-01", "semente-02"]), `Gravador: da mais nova para a mais antiga: ${JSON.stringify(ordem)}`);
  const rolarAteOFim = () => av(`window.scrollTo(0, document.documentElement.scrollHeight); 1`);
  await rolarAteOFim();
  await dormir(900);
  const pag2 = await contar();
  confere(pag2.itens === 20 && pag2.fim === true, `Gravador: rolar até perto do fim carrega mais 10 (20): ${JSON.stringify(pag2)}`);
  await rolarAteOFim();
  await dormir(900);
  const pag3 = await contar();
  confere(pag3.itens === 25 && pag3.fim === false, `Gravador: a última página traz as 5 que faltam (25) e o fim da lista some: ${JSON.stringify(pag3)}`);
  const unicas = await av(`new Set([...document.querySelectorAll('.gravacao-item')].map((e) => e.dataset.id)).size`);
  confere(unicas === 25, `Gravador: nenhuma gravação repetida nem pulada (25 únicas): ${unicas}`);
  await enviar("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 1, mobile: true });
  // Um arquivo que não toca (os zeros semeados não decodificam): a tela explica e devolve o botão "Ouvir" para tentar de novo, em vez de deixar um player cinza.
  await av(`document.querySelectorAll('.gravacao-item .ouvir')[0].click(); 1`);
  await dormir(1200);
  const naoToca = await av(`(() => { const i = document.querySelectorAll('.gravacao-item')[0]; return { audio: !!i.querySelector('audio'), erro: i.querySelector('.erro-item')?.textContent.trim() ?? null, ouvir: !!i.querySelector('.ouvir') }; })()`);
  confere(naoToca.audio === false && naoToca.ouvir === true && /Could not open|Não foi possível abrir|No se pudo abrir/.test(naoToca.erro ?? ""), `Gravador: um arquivo que não toca mostra o erro e devolve o botão Ouvir: ${JSON.stringify(naoToca)}`);
  // Apagar todas: o primeiro toque só pede confirmação; o segundo esvazia a lista e o resumo.
  await av(`document.getElementById('apagar-todas').click(); 1`);
  await dormir(200);
  const todasPede = await av(`({ itens: document.querySelectorAll('.gravacao-item').length, texto: document.getElementById('apagar-todas').textContent.replace(/\\s+/g, ' ').trim() })`);
  confere(todasPede.itens === 25 && /25/.test(todasPede.texto), `Gravador: "Apagar todas" pede confirmação dizendo quantas (25) e nada some: ${JSON.stringify(todasPede)}`);
  await av(`document.getElementById('apagar-todas').click(); 1`);
  await dormir(600);
  const tudoApagado = await av(`({ itens: document.querySelectorAll('.gravacao-item').length, vazio: !!document.getElementById('lista-vazia'), resumo: !!document.getElementById('resumo-gravacoes') })`);
  confere(tudoApagado.itens === 0 && tudoApagado.vazio === true && tudoApagado.resumo === false, `Gravador: confirmando, "Apagar todas" esvazia a lista e o resumo: ${JSON.stringify(tudoApagado)}`);
  await av(`document.getElementById('aba-hinos').click(); 1`);
  await dormir(300);

  // Um som de cada vez: dar o tom PARA o hino que estava tocando. Abre o hino, toca, volta à lista (client-side) e liga o Lá.
  await enviar("Page.navigate", { url: `http://127.0.0.1:${PORTA_VITE}/` });
  for (let fim = Date.now() + 20000; Date.now() < fim && !(await av(`!!document.querySelector('a[href="/hino/999"]')`)); ) await dormir(250);
  await av(`document.querySelector('a[href="/hino/999"]').click(); 1`);
  for (let fim = Date.now() + 20000; Date.now() < fim && !(await av(`!!document.querySelector('#painel-ouvir button')`)); ) await dormir(250);
  await dormir(500);
  await av(`[...document.querySelectorAll('#painel-ouvir button')].find((x) => /hino todo|whole|todo/i.test(x.textContent)).click(); 1`);
  await dormir(700);
  await av(`document.querySelector('button.voltar').click(); 1`);
  for (let fim = Date.now() + 20000; Date.now() < fim && !(await av(`!!document.getElementById('aba-afinador')`)); ) await dormir(250);
  const miniAntes = await av(`!!document.querySelector('.mini')`);
  await av(`document.getElementById('aba-afinador').click(); 1`);
  await dormir(500);
  await clicarGrande(0);
  await dormir(900);
  const depoisDoTom = await av(`({ mini: !!document.querySelector('.mini'), tom: window.__bmTom?.tocando })`);
  confere(miniAntes === true && depoisDoTom.mini === false && depoisDoTom.tom === true, `dar o tom para o hino que tocava (o miniplayer some e o tom soa): antes=${miniAntes}, depois=${JSON.stringify(depoisDoTom)}`);
  await clicarGrande(0); // desliga o tom

  // Falha do áudio (Web Audio bloqueado ou indisponível): o aviso aparece, o botão volta ao normal, nada fica "tocando" e nenhuma promessa
  // rejeitada fica solta. Vale para ligar uma nota e também para a TROCA de nota/oitava com uma nota soando (a antiga tem de parar).
  await enviar("Page.navigate", { url: `http://127.0.0.1:${PORTA_VITE}/` });
  for (let fim = Date.now() + 20000; Date.now() < fim && !(await av(`!!document.getElementById('aba-afinador')`)); ) await dormir(250);
  await dormir(500);
  await av(`window.__rejeicoes = []; addEventListener('unhandledrejection', (e) => window.__rejeicoes.push(String(e.reason))); 1`);
  await av(`document.getElementById('aba-afinador').click(); 1`);
  await dormir(400);
  await av(`window.__ACOriginal = window.AudioContext; window.AudioContext = class { constructor() { throw new Error('sem áudio'); } }; 1`);
  await clicarGrande(0);
  await dormir(600);
  const audioFalhou = await av(`({ aviso: !!document.querySelector('#painel-afinador .aviso.erro'), pressionado: document.querySelectorAll('#painel-afinador :is(.grande, .tocar-pilula)')[0].getAttribute('aria-pressed'), rejeicoes: window.__rejeicoes.length })`);
  confere(audioFalhou.aviso && audioFalhou.pressionado === "false" && audioFalhou.rejeicoes === 0, `áudio indisponível: aviso na tela, botão normal e nenhuma promessa rejeitada solta: ${JSON.stringify(audioFalhou)}`);
  await av(`window.AudioContext = window.__ACOriginal; 1`);
  await clicarGrande(0);
  await dormir(900);
  const recuperou = await av(`({ aviso: !!document.querySelector('#painel-afinador .aviso.erro'), tocando: window.__bmTom?.tocando })`);
  confere(!recuperou.aviso && recuperou.tocando === true, `tentar de novo funciona e o aviso some: ${JSON.stringify(recuperou)}`);
  await clicarGrande(0); // desliga o Lá
  await av(`document.querySelector('#painel-afinador details summary').click(); 1`); // abre o cartão (a tela foi recarregada: volta fechado)
  await dormir(300);
  await clicarGrande(1); // liga a nota escolhida
  await dormir(900);
  await av(`window.__resumeOriginal = AudioContext.prototype.resume; AudioContext.prototype.resume = () => Promise.reject(new Error('resume falhou')); 1`);
  await av(`[...document.querySelectorAll('#painel-afinador .botao-barra')].find((b) => /up|acima|arriba/i.test(b.getAttribute('aria-label'))).click(); 1`);
  await dormir(700);
  const trocaFalhou = await av(`({ aviso: !!document.querySelector('#painel-afinador .aviso.erro'), pressionado: document.querySelectorAll('#painel-afinador :is(.grande, .tocar-pilula)')[1].getAttribute('aria-pressed'), soando: window.__bmTom.tocando, rejeicoes: window.__rejeicoes.length })`);
  confere(trocaFalhou.aviso && trocaFalhou.pressionado === "false" && trocaFalhou.soando === false && trocaFalhou.rejeicoes === 0, `a troca de nota que falha para a nota antiga, avisa e não deixa rejeição solta: ${JSON.stringify(trocaFalhou)}`);
  await av(`AudioContext.prototype.resume = window.__resumeOriginal; 1`);

  // ---- Temporizador do afinador (I-13): o padrão é "até parar" (como sempre); com 10 s o tom para sozinho; trocar de nota recomeça a contagem ----
  await enviar("Page.navigate", { url: `http://127.0.0.1:${PORTA_VITE}/` });
  for (let fim = Date.now() + 20000; Date.now() < fim && !(await av(`!!document.getElementById('aba-afinador')`)); ) await dormir(250);
  await dormir(500);
  await av(`document.getElementById('aba-afinador').click(); 1`);
  await dormir(600);
  const estadoTemporizador = () => av(`(() => { const d = document.getElementById('cartao-temporizador'); return { aberto: d.open, resumo: d.querySelector('summary').textContent.replace(/\\s+/g, ' ').trim() }; })()`);
  const faltam = () => av(`(() => { const s = document.querySelector('#painel-afinador :is(.grande, .tocar-pilula)[aria-pressed="true"] span[aria-hidden="true"]'); const m = s?.textContent.match(/\\d+/); return m ? Number(m[0]) : null; })()`);
  const soando = () => av(`window.__bmTom?.tocando === true`);
  const tmp0 = await estadoTemporizador();
  confere(tmp0.aberto === false && /Until stopped|Até parar|Hasta parar/.test(tmp0.resumo), `Temporizador: o cartão começa fechado e em "até parar": ${JSON.stringify(tmp0)}`);

  // Padrão ("até parar"): o tom NÃO para sozinho, nem depois de mais que o maior tempo oferecido.
  await clicarGrande(0);
  await dormir(11500);
  const semLimite = { soando: await soando(), faltam: await faltam() };
  semLimite.barra = await av(`!!document.querySelector('#painel-afinador .barra')`);
  confere(semLimite.soando === true && semLimite.faltam === null && semLimite.barra === false, `Temporizador em "até parar": depois de 11 s o tom segue soando, sem contagem e sem barra de progresso: ${JSON.stringify(semLimite)}`);
  await clicarGrande(0); // para
  await dormir(300);

  // 10 s: o botão mostra o que falta e o tom para sozinho.
  await av(`document.querySelector('#cartao-temporizador summary').click(); 1`);
  await dormir(300);
  await av(`document.querySelector('#painel-afinador input[name="limite"][value="10"]').click(); 1`);
  await dormir(300);
  const tmp1 = await estadoTemporizador();
  confere(tmp1.aberto === true && /10 s/.test(tmp1.resumo), `Temporizador: escolher 10 s aparece no resumo do cartão: ${JSON.stringify(tmp1)}`);
  await clicarGrande(0);
  await dormir(1500);
  const barra = () => av(`(() => { const b = document.querySelector('#painel-afinador :is(.grande, .tocar-pilula)[aria-pressed="true"]'); const r = b?.querySelector('.barra'); return r ? r.getBoundingClientRect().width / b.getBoundingClientRect().width : null; })()`);
  const b1 = await barra();
  confere(b1 !== null && b1 >= 0.05 && b1 <= 0.25, `Temporizador de 10 s: a barra de progresso começa pequena (~10% aos 1,5 s): ${b1 === null ? "sem barra" : Math.round(b1 * 100) + "%"}`);
  const f1 = await faltam();
  confere(f1 !== null && f1 >= 8 && f1 <= 10 && (await soando()), `Temporizador de 10 s: o botão mostra o que falta (8 a 10 s após 1,5 s) e o tom soa: faltam ${f1}`);
  const rotuloAcessivel = await av(`document.querySelector('#painel-afinador :is(.grande, .tocar-pilula)[aria-pressed="true"]').textContent.replace(/\\s+/g, ' ').trim()`);
  confere(/^(Stop|Parar|Detener) · (\d+ s left|faltam \d+ s|faltan \d+ s)$/.test(rotuloAcessivel), `Temporizador: o botão segue sendo o de parar, com a contagem junto e o separador com espaços: "${rotuloAcessivel}"`);

  // Trocar de nota recomeça a contagem: aos ~7 s faltam ~3; ao tocar a outra nota, voltam a faltar ~10.
  await dormir(5500);
  const b2 = await barra();
  confere(b2 !== null && b2 >= 0.5 && b2 <= 0.85, `Temporizador de 10 s: aos ~7 s a barra de progresso está em ~70%: ${b2 === null ? "sem barra" : Math.round(b2 * 100) + "%"}`);
  const f2 = await faltam();
  confere(f2 !== null && f2 >= 2 && f2 <= 4, `Temporizador de 10 s: aos ~7 s faltam ~3: faltam ${f2}`);
  await av(`document.querySelector('#painel-afinador details summary').click(); 1`); // abre "Outra nota"
  await dormir(300);
  await clicarGrande(1);
  await dormir(1300);
  const f3 = await faltam();
  confere(f3 !== null && f3 >= 8 && (await soando()), `Temporizador: tocar outra nota recomeça a contagem (faltam ${f3}, e sem recomeçar seriam ~1)`);

  // Passados os 10 s, o tom para sozinho: o botão volta a "tocar" e o leitor de tela é avisado.
  await dormir(10500);
  const fim10 = await av(`({ soando: window.__bmTom.tocando, pressionados: document.querySelectorAll('#painel-afinador :is(.grande, .tocar-pilula)[aria-pressed="true"]').length, aviso: document.querySelector('#painel-afinador [role="status"]').textContent.trim() })`);
  confere(fim10.soando === false && fim10.pressionados === 0 && /timer|temporizador/i.test(fim10.aviso), `Temporizador: passado o tempo o tom para sozinho, os botões voltam a "tocar" e o leitor de tela é avisado: ${JSON.stringify(fim10)}`);

  // Mudar o tempo com o tom soando vale a partir de agora: 30 s recomeça a contagem de 30; "até parar" cancela a contagem.
  await clicarGrande(0);
  await dormir(1200);
  await av(`document.querySelector('#painel-afinador input[name="limite"][value="30"]').click(); 1`);
  await dormir(1200);
  const f4 = await faltam();
  confere(f4 !== null && f4 >= 27 && f4 <= 30, `Temporizador: mudar para 30 s com o tom soando recomeça a contagem (faltam ${f4})`);
  await av(`document.querySelector('#painel-afinador input[name="limite"][value="0"]').click(); 1`);
  await dormir(700);
  const f5 = { faltam: await faltam(), soando: await soando() };
  confere(f5.faltam === null && f5.soando === true, `Temporizador: voltar a "até parar" com o tom soando cancela a contagem e o tom segue: ${JSON.stringify(f5)}`);
  await clicarGrande(0); // para
  await dormir(300);

  // A corrida da troca de nota: se a contagem ANTIGA zera enquanto o áudio da nota nova ainda está iniciando, ela não pode parar a nota nova.
  // Atrasa o início do áudio em 4 s (o `resume` do AudioContext) e troca de nota aos ~7,5 s de uma contagem de 10 s: a antiga zeraria 2,5 s depois
  // do clique, DENTRO da espera. Com a contagem antiga cancelada no começo da troca, a nota nova toca depois do atraso e a contagem recomeça.
  const aberta = await av(`document.querySelector('#painel-afinador details').open`);
  if (!aberta) await av(`document.querySelector('#painel-afinador details summary').click(); 1`);
  await dormir(300);
  await av(`document.querySelector('#painel-afinador input[name="limite"][value="10"]').click(); 1`);
  await clicarGrande(0);
  await dormir(7500);
  await av(`window.__resumeLento = AudioContext.prototype.resume; AudioContext.prototype.resume = function () { return new Promise((ok) => setTimeout(() => ok(window.__resumeLento.call(this)), 4000)); }; 1`);
  await clicarGrande(1); // troca para a outra nota (o áudio dela demora 4 s para iniciar)
  await dormir(5800);
  const corridaDaTroca = { soando: await soando(), faltam: await faltam() };
  confere(corridaDaTroca.soando === true && corridaDaTroca.faltam !== null && corridaDaTroca.faltam >= 7 && corridaDaTroca.faltam <= 10, `Temporizador: a contagem antiga zerar durante o início da nota nova não a para; a contagem recomeça com ela (faltam ${corridaDaTroca.faltam}): ${JSON.stringify(corridaDaTroca)}`);
  await av(`AudioContext.prototype.resume = window.__resumeLento; 1`);
  await clicarGrande(1); // para
  await dormir(300);

  // ---- O aviso do primeiro acesso: com só o pacote de exemplo, oferece baixar o hinário; "Agora não" o dispensa e a escolha é lembrada; o mesmo botão segue em Ajustes ----
  const RAIZ_URL = `http://127.0.0.1:${PORTA_VITE}/`;
  const irParaInicio = async () => {
    await enviar("Page.navigate", { url: RAIZ_URL });
    for (let fim = Date.now() + 20000; Date.now() < fim && !(await av(`!!document.getElementById('aba-afinador')`)); ) await dormir(250);
    await dormir(700);
  };
  const estadoAviso = () => av(`({ aberto: !!document.querySelector('dialog.aviso-hinario[open]'), titulo: document.querySelector('dialog.aviso-hinario h2')?.textContent ?? null, baixar: document.getElementById('hinario-baixar')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, agoraNao: !!document.getElementById('hinario-agora-nao'), lembrado: localStorage.getItem('prefs.hinario_aviso') })`);
  await av(`localStorage.removeItem('prefs.hinario_aviso'); sessionStorage.setItem('e2e-exemplo', '1'); 1`);
  await irParaInicio();
  const av0 = await estadoAviso();
  confere(av0.aberto && av0.agoraNao && /\d/.test(av0.baixar ?? "") && av0.lembrado === null, `Primeiro acesso: com só o pacote de exemplo, o aviso para baixar o hinário abre, com Baixar (e o tamanho) e Agora não: ${JSON.stringify(av0)}`);
  await av(`document.getElementById('hinario-agora-nao').click(); 1`);
  await dormir(400);
  const av1 = await estadoAviso();
  confere(!av1.aberto && av1.lembrado === 'dispensado', `"Agora não" fecha o aviso e a escolha é lembrada: ${JSON.stringify(av1)}`);
  await irParaInicio();
  const av2 = await estadoAviso();
  confere(!av2.aberto, `depois de dispensar, o aviso não volta ao reabrir o app: ${JSON.stringify(av2)}`);
  await av(`sessionStorage.removeItem('e2e-exemplo'); localStorage.removeItem('prefs.hinario_aviso'); 1`);
  await irParaInicio();
  const av3 = await estadoAviso();
  confere(!av3.aberto, `com o hinário de verdade instalado o aviso não aparece: ${JSON.stringify(av3)}`);

  // ---- As abas Afinador, Gravador e Metrônomo: sem texto explicativo, com o botão principal no topo; as listas de recentes mostram só quantos itens CABEM na tela ----
  const topoDaAba = (id) => av(`(() => { const p = document.getElementById('painel-${id}'); const b = p.querySelector('button.primario.grande'); const r = b.getBoundingClientRect(); const pr = p.getBoundingClientRect();
    return { explica: [...p.querySelectorAll('p')].filter((e) => !e.classList.contains('so-leitor') && (e.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)).length, botaoNoTopo: Math.round(r.top - pr.top) <= 4, antes: [...p.querySelectorAll('button, input, select, summary')].indexOf(b) }; })()`);
  await irParaInicio();
  for (const id of ['afinador', 'gravador', 'metronomo']) {
    await av(`document.getElementById('aba-${id}').click(); 1`);
    await dormir(500);
    const topo = await topoDaAba(id);
    confere(topo.explica === 0 && topo.botaoNoTopo && topo.antes === 0, `aba ${id}: sem texto explicativo e o botão principal é o primeiro da aba, no topo: ${JSON.stringify(topo)}`);
  }
  const dezMetronomo = Array.from({ length: 10 }, (_, i) => ({ bpm: 60 + i * 10, compasso: 4 }));
  await av(`localStorage.setItem('prefs.metronomo', JSON.stringify({ bpm: 120, compasso: 4, recentes: ${JSON.stringify(dezMetronomo)} })); localStorage.setItem('prefs.afinador', JSON.stringify({ recentes: ${JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ classe: i, oitava: 4 })))} })); 1`);
  await irParaInicio();
  const cabem = async (id) => {
    await av(`document.getElementById('aba-${id}').click(); 1`);
    await dormir(700);
    return av(`(() => { const bs = [...document.querySelectorAll('#painel-${id} .recentes button')]; const ult = bs.at(-1)?.getBoundingClientRect(); return { n: bs.length, fimUltimo: ult ? Math.round(ult.bottom + window.scrollY) : null, tela: Math.round(window.innerHeight - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--altura-navegacao')) || 0) - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--altura-miniplayer')) || 0)), rolagemMax: document.documentElement.scrollHeight - window.innerHeight }; })()`);
  };
  const metEmPe = await cabem('metronomo');
  confere(metEmPe.n >= 1 && metEmPe.n <= 10 && metEmPe.fimUltimo <= metEmPe.tela, `Metrônomo (celular em pé): a lista dos últimos mostra só os ${metEmPe.n} que cabem na tela, sem cortar nenhum: ${JSON.stringify(metEmPe)}`);
  const afiEmPe = await cabem('afinador');
  confere(afiEmPe.n >= 1 && afiEmPe.n <= 10 && afiEmPe.fimUltimo <= afiEmPe.tela, `Afinador (celular em pé): a lista das notas recentes mostra só as ${afiEmPe.n} que cabem na tela: ${JSON.stringify(afiEmPe)}`);
  await enviar("Emulation.setDeviceMetricsOverride", { width: 915, height: 412, deviceScaleFactor: 1, mobile: true });
  await dormir(700);
  const metDeitado = await cabem('metronomo');
  confere(metDeitado.n >= 1 && metDeitado.n <= metEmPe.n, `Metrônomo (deitado, tela mais baixa): a lista nunca cresce (${metDeitado.n} contra ${metEmPe.n} em pé): ${JSON.stringify(metDeitado)}`);
  await enviar("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 1, mobile: true });
  await dormir(700);
  const metVoltou = await cabem('metronomo');
  confere(metVoltou.n === metEmPe.n, `girar de volta devolve a mesma quantidade (${metVoltou.n}): ${JSON.stringify(metVoltou)}`);
  // Dar uma nota em "Outra nota" a põe no topo da lista do afinador (sem repetir) e a lista a mostra.
  await av(`localStorage.removeItem('prefs.afinador'); 1`);
  await irParaInicio();
  await av(`document.getElementById('aba-afinador').click(); 1`);
  await dormir(500);
  await av(`document.querySelector('#painel-afinador .tocar-pilula').click(); 1`);
  await dormir(800);
  await av(`const b = document.querySelectorAll('#painel-afinador .oitava button')[1]; b.click(); b.click(); 1`); // sobe duas oitavas COM o tom soando: não registra
  await dormir(300);
  await av(`document.querySelector('#painel-afinador .tocar-pilula').click(); 1`); // para
  await dormir(300);
  const afi1 = await av(`({ salvo: localStorage.getItem('prefs.afinador'), lista: [...document.querySelectorAll('#painel-afinador .recentes button')].map((b) => b.textContent.trim()) })`);
  confere(/"recentes":\[\{"classe":0,"oitava":4\}\]/.test(afi1.salvo ?? '') && afi1.lista.length === 1 && /Hz/.test(afi1.lista[0]), `Afinador: a nota dada em Outra nota entra na lista dos recentes e é lembrada: ${JSON.stringify(afi1)}`);
  await av(`localStorage.removeItem('prefs.afinador'); localStorage.removeItem('prefs.metronomo'); 1`);

  // ---- Ajustes: o que ficou aberto é lembrado, o valor ruim volta ao padrão e o link da aba Partitura abre o Conteúdo sem gravar (I-24, fatias 3 e 4) ----
  const AJ = `http://127.0.0.1:${PORTA_VITE}/ajustes`;
  const irParaAjustes = async (url) => {
    await enviar("Page.navigate", { url });
    for (let fim = Date.now() + 20000; Date.now() < fim && !(await av(`!!document.getElementById('cartao-aparencia')`)); ) await dormir(250);
    await dormir(500);
  };
  const estadoCartoes = () => av(`(() => { const a = (id) => document.getElementById(id)?.open; return { aparencia: a('cartao-aparencia'), idioma: a('cartao-idioma'), conteudo: a('conteudo'), salvo: localStorage.getItem('prefs.ajustes') }; })()`);
  // "Em nome do Senhor Jesus" fica na barra de cima, ao lado do título Ajustes, numa linha só (e não numa caixa de aviso), em telas largas e estreitas.
  await irParaAjustes(AJ);
  for (const largura of [412, 360, 320]) {
    await enviar("Emulation.setDeviceMetricsOverride", { width: largura, height: 915, deviceScaleFactor: 1, mobile: true });
    await dormir(400);
    const nome = await av(`(() => {
      const n = document.querySelector('header .nome-senhor'); const h = document.querySelector('header h1'); if (!n || !h || n.offsetParent === null) return { semFrase: true };
      const r = n.getBoundingClientRect(); const rh = h.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(h).lineHeight);
      return { texto: n.textContent.trim(), ao_lado: r.top < rh.bottom, tituloUmaLinha: rh.height <= lh * 1.2, tituloInteiro: h.scrollWidth <= h.clientWidth + 1 && rh.right <= window.innerWidth,
        fraseCabe: n.scrollWidth <= n.clientWidth + 1 && r.right <= window.innerWidth && r.left >= 0, naCaixa: [...document.querySelectorAll('main .aviso')].some((e) => e.textContent.includes(n.textContent.trim())) };
    })()`);
    confere(nome && /Lord Jesus|Senhor Jesus|Señor Jesús/.test(nome.texto) && nome.tituloUmaLinha && nome.tituloInteiro && nome.fraseCabe && !nome.naCaixa, `Ajustes (${largura} px): "Em nome do Senhor Jesus" na barra de cima (${nome?.ao_lado ? "ao lado do título" : "na linha de baixo, em tela estreita"}), o título Ajustes numa linha só e a frase inteira na tela: ${JSON.stringify(nome)}`);
  }
  await enviar("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 1, mobile: true });
  await dormir(300);
  // ---- Nomes das notas (Ajustes) e o hino que toca na lista ----
  await irParaAjustes(AJ);
  await av(`document.querySelector('#cartao-idioma summary').click(); 1`);
  await dormir(300);
  await av(`localStorage.removeItem('notacao'); 1`);
  await av(`document.querySelector('input[name="notacao"][value="silabas"]').click(); 1`);
  await dormir(300);
  const not1 = await av(`({ salvo: localStorage.getItem('notacao'), marcada: document.querySelector('input[name="notacao"]:checked')?.value })`);
  confere(not1.salvo === 'silabas' && not1.marcada === 'silabas', `Ajustes: a opção dos nomes das notas (sílabas) é lembrada: ${JSON.stringify(not1)}`);
  await irParaInicio();
  const lista1 = await av(`document.querySelector('li > a small')?.textContent.trim()`);
  confere(lista1 === 'Si♭ major', `a tonalidade na lista segue a escolha (sílabas, mesmo com a interface em inglês): "${lista1}"`);
  await av(`document.getElementById('aba-afinador').click(); 1`);
  await dormir(500);
  const rotulos = await av(`[...document.querySelectorAll('#painel-afinador .grande, #painel-afinador summary')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`);
  confere(rotulos.some((x) => /^Lá 440 Hz/.test(x)) && rotulos.some((x) => /Dó4/.test(x)), `Afinador com os nomes em sílabas: ${JSON.stringify(rotulos)}`);
  await av(`localStorage.setItem('notacao', 'letras'); 1`);
  await irParaInicio();
  const lista2 = await av(`document.querySelector('li > a small')?.textContent.trim()`);
  confere(lista2 === 'B♭ major', `com letras, a tonalidade vira B♭ major: "${lista2}"`);
  await av(`localStorage.removeItem('notacao'); 1`);
  await irParaInicio();
  const lista3 = await av(`document.querySelector('li > a small')?.textContent.trim()`);
  confere(lista3 === 'B♭ major', `automático com a interface em inglês usa letras: "${lista3}"`);

  // O hino que toca (ou está pausado) leva a borda de destaque e um ícone na lista; os outros não.
  const semMarca = await av(`({ tocando: document.querySelectorAll('li > a.tocando').length, pausado: document.querySelectorAll('li > a.pausado').length })`);
  confere(semMarca.tocando === 0 && semMarca.pausado === 0, `sem nada tocando, nenhum hino da lista tem a borda de destaque: ${JSON.stringify(semMarca)}`);
  await av(`document.querySelector('li > a').click(); 1`); // navegação do próprio app: a música não para ao voltar
  for (let fim = Date.now() + 15000; Date.now() < fim && !(await av(`!!document.querySelector('#painel-ouvir')`)); ) await dormir(250);
  await av(`[...document.querySelectorAll('#painel-ouvir button')].find((x) => /hino todo|whole|todo/i.test(x.textContent)).click(); 1`);
  await dormir(1200);
  await av(`history.back(); 1`);
  for (let fim = Date.now() + 15000; Date.now() < fim && !(await av(`!!document.querySelector('li > a')`)); ) await dormir(250);
  await dormir(500);
  const toc = await av(`(() => { const a = document.querySelector('li > a.tocando'); if (!a) return null; return { icone: !!a.querySelector('.estado svg'), leitor: a.querySelector('.estado .so-leitor')?.textContent.trim(), borda: getComputedStyle(a).borderColor, acento: getComputedStyle(document.documentElement).getPropertyValue('--acento').trim() }; })()`);
  confere(toc && toc.icone && /Playing/.test(toc.leitor ?? '') && toc.borda !== 'rgba(0, 0, 0, 0)', `o hino que toca leva a borda de destaque, o ícone e o aviso para o leitor de tela: ${JSON.stringify(toc)}`);
  await av(`document.querySelector('.mini .acao')?.click(); 1`); // pausa pelo miniplayer
  await dormir(500);
  const paus = await av(`(() => { const a = document.querySelector('li > a.pausado'); return a ? { leitor: a.querySelector('.estado .so-leitor')?.textContent.trim(), tocando: !!document.querySelector('li > a.tocando') } : null; })()`);
  confere(paus && /Paused/.test(paus.leitor ?? '') && !paus.tocando, `pausado, a lista mostra o hino com a marca de pausa (e não mais a de tocando): ${JSON.stringify(paus)}`);
  await irParaInicio();

  await irParaAjustes(AJ);
  await av(`document.querySelector('#conteudo summary').click(); 1`);
  await dormir(300);
  const linhaHinario = await av(`(() => { const l = [...document.querySelectorAll('#conteudo .pacote')].find((e) => e.querySelector('strong')?.textContent.trim() === 'Full hymnal'); return { achou: !!l, detalhe: l?.querySelector('.meta')?.textContent.trim() ?? null, remover: l?.querySelector('button')?.textContent.trim() ?? null }; })()`);
  confere(linhaHinario.achou && /Installed/.test(linhaHinario.detalhe ?? "") && linhaHinario.remover === 'Remove', `Ajustes → Conteúdo: o hinário aparece como uma linha de pacote (instalado, com Remover): ${JSON.stringify(linhaHinario)}`);
  await av(`document.querySelector('#conteudo summary').click(); 1`);
  await dormir(200);
  await irParaAjustes(AJ);
  await av(`localStorage.removeItem('prefs.ajustes'); 1`);
  await irParaAjustes(AJ);
  const aj0 = await estadoCartoes();
  confere(aj0.aparencia === false && aj0.idioma === false && aj0.conteudo === false && aj0.salvo === null, `Ajustes: sem nada salvo, todos os cartões começam fechados: ${JSON.stringify(aj0)}`);
  await av(`document.querySelector('#cartao-aparencia summary').click(); 1`); // a pessoa abre a Aparência
  await dormir(300);
  await irParaAjustes(AJ); // fecha e abre a tela
  const aj1 = await estadoCartoes();
  confere(aj1.aparencia === true && aj1.idioma === false && aj1.conteudo === false && aj1.salvo === '{"aparencia":true,"idioma":false,"conteudo":false}', `Ajustes: o cartão que a pessoa abriu continua aberto ao voltar: ${JSON.stringify(aj1)}`);
  await av(`document.querySelector('#cartao-aparencia summary').click(); 1`); // fecha de novo
  await dormir(300);
  await irParaAjustes(AJ);
  const aj2 = await estadoCartoes();
  confere(aj2.aparencia === false && aj2.salvo === '{"aparencia":false,"idioma":false,"conteudo":false}', `Ajustes: fechar também é lembrado: ${JSON.stringify(aj2)}`);
  await av(`localStorage.setItem('prefs.ajustes', '{"aparencia":"sim","idioma":7,"conteudo":null}'); 1`);
  await irParaAjustes(AJ);
  const aj3 = await estadoCartoes();
  confere(aj3.aparencia === false && aj3.idioma === false && aj3.conteudo === false, `Ajustes: valor ruim guardado volta ao padrão (tudo fechado): ${JSON.stringify(aj3)}`);

  // O link da aba Partitura: abre o Conteúdo, rola até as partituras e NÃO grava essa abertura.
  await av(`localStorage.removeItem('prefs.ajustes'); 1`);
  await irParaAjustes(`${AJ}?abrir=partituras`);
  const viaLink = await av(`(() => { const c = document.getElementById('partituras'); const r = c.getBoundingClientRect(); return { conteudo: document.getElementById('conteudo').open, visivel: r.top >= 0 && r.top < window.innerHeight && r.height > 0, salvo: localStorage.getItem('prefs.ajustes') }; })()`);
  confere(viaLink.conteudo === true && viaLink.visivel === true && viaLink.salvo === null, `Ajustes pelo link da aba Partitura: o Conteúdo abre, as partituras ficam à vista e nada é gravado: ${JSON.stringify(viaLink)}`);
  await irParaAjustes(AJ);
  const semLink = await estadoCartoes();
  confere(semLink.conteudo === false, `Ajustes sem o parâmetro: o Conteúdo volta a abrir fechado (a abertura pelo link não ficou): ${JSON.stringify(semLink)}`);
  // Se a pessoa fecha o Conteúdo depois de chegar pelo link, aí sim é uma escolha dela e é lembrada.
  await irParaAjustes(`${AJ}?abrir=partituras`);
  await av(`document.querySelector('#conteudo summary').click(); 1`);
  await dormir(300);
  const fechouDepois = await estadoCartoes();
  confere(fechouDepois.conteudo === false && fechouDepois.salvo === '{"aparencia":false,"idioma":false,"conteudo":false}', `Ajustes: fechar o Conteúdo depois de chegar pelo link é lembrado: ${JSON.stringify(fechouDepois)}`);
  await av(`localStorage.removeItem('prefs.ajustes'); 1`);
  // ---- Acessibilidade: o título de cada cartão é um título (heading) na ÁRVORE DE ACESSIBILIDADE, e o summary segue sendo o botão que abre e fecha ----
  const titulosNaArvore = async () => {
    await enviar("Accessibility.enable");
    const r = await enviar("Accessibility.getFullAXTree");
    const nos = r.result.nodes.filter((x) => !x.ignored);
    return {
      titulos: nos.filter((x) => x.role?.value === "heading").map((x) => `${x.name?.value}:${x.properties?.find((p) => p.name === "level")?.value?.value}`),
      botoes: nos.filter((x) => x.role?.value === "DisclosureTriangle").map((x) => x.name?.value),
    };
  };
  await enviar("Page.navigate", { url: `http://127.0.0.1:${PORTA_VITE}/` });
  for (let fim = Date.now() + 20000; Date.now() < fim && !(await av(`!!document.getElementById('aba-afinador')`)); ) await dormir(250);
  await av(`document.getElementById('aba-afinador').click(); 1`);
  await dormir(600);
  const axAfinador = await titulosNaArvore();
  confere(axAfinador.titulos.some((t) => /^(Another note|Outra nota|Otra nota):2$/.test(t)) && axAfinador.botoes.some((b) => /Another note|Outra nota|Otra nota/.test(b)), `Afinador: "Outra nota" é um título de nível 2 e também o botão que abre o cartão (árvore de acessibilidade): ${JSON.stringify(axAfinador)}`);
  await enviar("Page.navigate", { url: `http://127.0.0.1:${PORTA_VITE}/ajustes` });
  for (let fim = Date.now() + 20000; Date.now() < fim && !(await av(`!!document.getElementById('conteudo')`)); ) await dormir(250);
  await dormir(500);
  const axAjustes = await titulosNaArvore();
  const titulosCartoes = axAjustes.titulos.filter((t) => /:2$/.test(t));
  confere(titulosCartoes.length >= 5 && axAjustes.botoes.length >= 5, `Ajustes: os 5 cartões (Aparência, Idioma, Conteúdo, Sobre e Créditos) são títulos de nível 2 e botões na árvore: ${JSON.stringify(axAjustes)}`);
  ws.close();

  // 6. análise: trocas de sílaba antes da pausa
  const trocas = [];
  let ant = null;
  for (const [ms, tr, est] of am) {
    if (ms >= msPausa - 50) break;
    if (tr !== null && tr !== ant) trocas.push({ ms, tr, est });
    ant = tr ?? ant;
  }
  const alvo = [...ESPERADO_VEZ1.map(([tr, b]) => ({ tr, b, est: "1" })), ...ESPERADO_VEZ2.map(([tr, b]) => ({ tr, b: INICIO_VEZ2 + b, est: "2" }))];
  const obs = trocas.slice(0, alvo.length);
  console.log("trocas (ms desde o início da amostragem):", obs.map((o) => `${o.ms} ${o.tr}`).join(" | "));
  console.log("esperado (batidas):", alvo.map((a) => `${a.b} ${a.tr}`).join(" | "));
  confere(obs.length >= 8, `trocas de sílaba observadas até a pausa: ${obs.length} (esperado pelo menos 8)`);
  confere(obs.every((o, i) => o.tr === alvo[i].tr), `sílabas na ordem certa: ${obs.map((o) => o.tr).join(" ")}`);
  confere(obs.every((o, i) => (o.est ?? "").includes(alvo[i].est)), "a estrofe acesa é a 1 na 1ª vez e a 2 na 2ª");
  // O instante da 1ª sílaba inclui o atraso para a música começar a soar (não é o início exato dela), então a referência dos
  // intervalos continua sendo a 2ª troca. O que importa da 1ª é que seja VISTA: a amostragem já estava rodando quando a música começou.
  let maior = 0;
  for (let i = 2; i < obs.length; i++) maior = Math.max(maior, Math.abs(obs[i].ms - obs[i - 1].ms - (alvo[i].b - alvo[i - 1].b) * MS_POR_BATIDA));
  confere(maior <= 120, `maior desvio entre trocas: ${Math.round(maior)} ms (limite 120 ms)`);
  const k = obs.length - 1;
  const deriva = obs[k].ms - obs[1].ms - (alvo[k].b - alvo[1].b) * MS_POR_BATIDA;
  confere(Math.abs(deriva) <= 200, `deriva acumulada em ${k - 1} trocas: ${Math.round(deriva)} ms (limite 200 ms)`);

  console.log(falhas.length === 0 ? "\nE2E do karaokê: OK" : `\nE2E do karaokê: ${falhas.length} falha(s)`);
  return falhas.length === 0 ? 0 : 1;
}

let codigo = 1;
try {
  codigo = await principal();
} catch (e) {
  console.error("erro no teste:", e.message ?? e);
} finally {
  await limpar();
}
process.exit(codigo);
