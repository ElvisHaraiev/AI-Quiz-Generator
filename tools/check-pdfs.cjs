// Масовий прогін: КОЖЕН PDF у теці перевіряється повним конвеєром.
//
// Мета — не «показати три книжки», а знайти всі випадки, де система
// не працює. Модель підмінюється, тож мережа й API-ключ не потрібні.
//
// Запуск:  node tools/check-pdfs.cjs [тека] [обмеження]
// Приклад: node tools/check-pdfs.cjs "D:\\Підручники"

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIR = process.argv[2] || path.join(PROJECT_ROOT, "samples");
const LIMIT = Number(process.argv[3] || 0);

function loadPdfLib() {
  const moduleShim = { exports: {} };
  const file = path.join(PROJECT_ROOT, "lib", "pdf.min.js");
  vm.runInThisContext(
    `(function (module, exports, require, __filename, __dirname) {${fs.readFileSync(file, "utf8")}\n})`,
    { filename: file }
  )(moduleShim, moduleShim.exports, require, file, path.dirname(file));
  const workerShim = { exports: {} };
  const wfile = path.join(PROJECT_ROOT, "lib", "pdf.worker.min.js");
  vm.runInThisContext(
    `(function (module, exports, require, __filename, __dirname) {${fs.readFileSync(wfile, "utf8")}\n})`,
    { filename: wfile }
  )(workerShim, workerShim.exports, require, wfile, path.dirname(wfile));
  globalThis.pdfjsWorker = workerShim.exports;
  return moduleShim.exports;
}

async function readPdf(pdfLib, file) {
  const doc = await pdfLib.getDocument({
    data: new Uint8Array(fs.readFileSync(file)),
    disableFontFace: true
  }).promise;
  const pages = [];

  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    let text = "";
    content.items.forEach((item) => { text += item.str; if (item.hasEOL) text += "\n"; });
    pages.push({
      number,
      sourcePage: number,
      text,
      fileName: path.basename(file),
      fileIndex: 0
    });
  }

  return pages;
}

function loadHooks(M, I) {
  const source = fs.readFileSync(path.join(PROJECT_ROOT, "background.js"), "utf8");
  const sandbox = {
    importScripts: () => {},
    self: { QuizGenImages: I, QuizGenMaterial: M },
    chrome: {
      runtime: { onMessage: { addListener() {} }, onInstalled: { addListener() {} } },
      storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } }
    },
    console,
    URL,
    URLSearchParams,
    Blob,
    atob,
    btoa,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    globalThis
  };
  const names = Object.keys(sandbox);
  const hooks = new Function(...names, `${source}\n;return globalThis.__QuizGenTestHooks;`)(
    ...names.map((name) => sandbox[name])
  );
  hooks.setImageDebugEnabled(false);
  return hooks;
}

// Модель: спершу віддає вибір розділів з карти, потім — питання.
function installModelStub(state) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    state.calls++;
    const body = JSON.parse(init?.body || "{}");
    const userMessage = body.messages?.find((m) => m.role === "user");
    const userText = Array.isArray(userMessage?.content)
      ? userMessage.content.map((p) => p.text || "").join(" ")
      : String(userMessage?.content || "");
    const isOutline = userText.includes("ЗМІСТ:");
    let payload;

    if (isOutline) {
      state.outlineCalls++;
      // Модель обирає 1–2 розділи з карти.
      const numbers = [...userText.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));
      const chosen = numbers.slice(0, 2);
      state.chosen = chosen;
      payload = { choices: [{ message: { content: JSON.stringify({ sections: chosen }) } }] };
    } else {
      state.generateCalls++;
      payload = {
        choices: [{
          message: {
            content: JSON.stringify({
              chat_reply: "",
              title: "Тест",
              questions: Array.from({ length: 4 }, (_, i) => ({
                type: "quiz",
                question: `Питання ${i + 1}?`,
                answers: ["A", "B", "C", "D"],
                correct: [0],
                difficulty: "medium",
                imageKind: "none",
                language: "uk"
              }))
            })
          }
        }]
      };
    }

    return {
      ok: true,
      status: 200,
      url: String(url),
      headers: { get: () => "application/json" },
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    };
  };
  return () => { globalThis.fetch = original; };
}

(async () => {
  const pdfLib = loadPdfLib();
  const M = require(path.join(PROJECT_ROOT, "lib", "material.js"));
  const I = require(path.join(PROJECT_ROOT, "lib", "educational-images.js"));
  const Hooks = loadHooks(M, I);

  let files = fs.readdirSync(DIR)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .map((name) => path.join(DIR, name));

  if (LIMIT > 0) {
    files = files.slice(0, LIMIT);
  }

  const rows = [];

  for (const file of files) {
    const name = path.basename(file);
    const row = { name, ok: false, note: "", pages: 0, chars: 0, outline: 0, quality: "", strategy: "", selected: 0, warnings: [], questions: 0 };

    try {
      const pages = await readPdf(pdfLib, file);
      row.pages = pages.length;
      row.chars = pages.reduce((sum, page) => sum + page.text.length, 0);

      const quality = Hooks.assessMaterialQuality(pages);
      row.quality = quality.level;

      const outline = M.buildDocumentOutline(pages, { maxHeadings: 400 });
      row.outline = outline.length;

      if (quality.level === "none") {
        row.note = "немає тексту (скан)";
        rows.push(row);
        continue;
      }

      const state = { calls: 0, outlineCalls: 0, generateCalls: 0, chosen: [] };
      const restore = installModelStub(state);

      let result;
      try {
        result = await Hooks.generateQuestions({
          providerConfig: {
            provider: "openai",
            apiKey: "test-key-not-real",
            model: "gpt-4o-mini",
            baseUrl: "https://api.openai.com/v1"
          },
          materialPages: pages,
          material: "",
          prompt: "Зроби 10 запитань",
          questionCount: 10,
          questionTypes: "all",
          currentQuestions: [],
          sourceImages: [],
          useImageInputs: false,
          allowImages: true
        });
      } finally {
        restore();
      }

      row.strategy = result.materialPlan.strategy;
      row.selected = result.materialPlan.selectedChunks;
      row.questions = result.questions.length;
      row.warnings = result.imageWarnings.map((w) => w.slice(0, 80));
      row.ok = result.questions.length > 0;
      row.calls = state.calls;
    } catch (error) {
      row.note = `ПОМИЛКА: ${error.message}`.slice(0, 90);
    }

    rows.push(row);
    const mark = row.ok ? "OK  " : (row.quality === "none" ? "СКАН" : "ЗБІЙ");
    console.log(
      `${mark} ${name.slice(0, 52).padEnd(54)} ` +
      `стор=${String(row.pages).padStart(4)} ` +
      `карта=${String(row.outline).padStart(4)} ` +
      `стратегія=${(row.strategy || "—").padEnd(14)} ` +
      `обрано=${String(row.selected).padStart(2)} ` +
      (row.note || "")
    );
  }

  console.log(`\n${"=".repeat(100)}`);
  const ok = rows.filter((r) => r.ok).length;
  const scans = rows.filter((r) => r.quality === "none").length;
  const failed = rows.filter((r) => !r.ok && r.quality !== "none").length;
  console.log(`усього PDF: ${rows.length}`);
  console.log(`працює: ${ok}`);
  console.log(`скан без тексту: ${scans}`);
  console.log(`ЗБОЇ: ${failed}`);

  if (failed) {
    console.log("\nПровали, які треба розібрати:");
    rows.filter((r) => !r.ok && r.quality !== "none").forEach((r) => {
      console.log(`  ${r.name}`);
      console.log(`     стор=${r.pages} симв=${r.chars} карта=${r.outline} якість=${r.quality} стратегія=${r.strategy} ${r.note}`);
    });
  }

  const withMap = rows.filter((r) => r.outline > 0).length;
  console.log(`\nкарта документа побудована: ${withMap} з ${rows.length}`);
})().catch((error) => { console.error("ПОМИЛКА:", error); process.exitCode = 1; });
