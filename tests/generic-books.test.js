// Тести узагальнення: система має працювати для БУДЬ-ЯКОГО PDF.
//
// 1. Карта документа будується структурно — без прив'язки до конкретної
//    книжки, предмета чи мови.
// 2. Для великого матеріалу модель отримує зміст УСІЄЇ книги й обирає
//    розділи, а не 3% тексту з випадкового місця.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const Material = require(path.join(PROJECT_ROOT, "lib", "material.js"));
const Images = require(path.join(PROJECT_ROOT, "lib", "educational-images.js"));

function loadBackground() {
  const source = fs.readFileSync(path.join(PROJECT_ROOT, "background.js"), "utf8");

  const sandbox = {
    importScripts: () => {},
    self: { QuizGenImages: Images, QuizGenMaterial: Material },
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

const Hooks = loadBackground();

// ─── Книга будь-якого предмета ─────────────────────────────────────────────
//
// Навмисно різні схеми нумерації, різні мови та різні предмети в одному
// документі — щоб перевірити саме узагальнення, а не одну знайому книжку.

function page(number, text, fileName = "any-textbook.pdf") {
  return {
    number,
    sourcePage: number,
    text,
    fileName,
    fileIndex: 0
  };
}

const BODY =
  "Детальний виклад матеріалу цього розділу з означеннями, теоремами, " +
  "прикладами розв'язування задач та ілюстраціями до теми. ".repeat(800);

const UNIVERSAL_BOOK = [
  page(5, `Розділ 1. ЗАГАЛЬНІ ПОЛОЖЕННЯ\n${BODY}`),
  page(40, `Розділ 2. БУДОВА РЕЧОВИНИ\n${BODY}`),
  page(80, `Розділ 3. ХІМІЧНІ РЕАКЦІЇ\n${BODY}`),
  page(120, `Chapter 4. CELL BIOLOGY\n${BODY}`),
  page(160, `Topic 5. Photosynthesis\n${BODY}`),
  page(200, `§ 6. ФОТОСИНТЕЗ РОСЛИН\n${BODY}`),
  page(240, `Unit 7. Genetics and heredity\n${BODY}`),
  page(280, `РОЗДІЛ 8. ЕКОЛОГІЯ\n${BODY}`)
];

// ─── 1. Карта документа ────────────────────────────────────────────────────

test("карта документа знаходить розділи в різних схемах нумерації", () => {
  const outline = Material.buildDocumentOutline(UNIVERSAL_BOOK);

  assert.ok(outline.length >= 6, `знайдено лише ${outline.length} розділів`);

  const titles = outline.map((item) => item.title).join(" | ");

  assert.match(titles, /ЗАГАЛЬНІ ПОЛОЖЕННЯ/);
  assert.match(titles, /БУДОВА РЕЧОВИНИ/);
  assert.match(titles, /ХІМІЧНІ РЕАКЦІЇ/);
  assert.match(titles, /CELL BIOLOGY/);
  assert.match(titles, /ФОТОСИНТЕЗ РОСЛИН/);
  assert.match(titles, /ЕКОЛОГІЯ/);
});

test("карта документа працює для англійської книги", () => {
  const pages = [
    page(3, `Chapter 1. INTRODUCTION\n${BODY}`),
    page(30, `Chapter 2. METHODS\n${BODY}`),
    page(60, `Chapter 3. RESULTS\n${BODY}`)
  ];
  const outline = Material.buildDocumentOutline(pages);

  assert.equal(outline.length, 3);
  assert.match(outline[0].title, /INTRODUCTION/);
  assert.match(outline[2].title, /RESULTS/);
});

test("карта документа не плутає номери задач із розділами", () => {
  // Книга з реальною нумерацією розділів і вправами в тексті.
  const pages = Array.from({ length: 10 }, (_, index) => {
    return page(
      index * 20 + 3,
      `§ ${index + 1}. НАЗВА РОЗДІЛУ ${index + 1}\n` +
        `2.40. Тетраедр, усі ребра якого по 4 см. 19.36. Точка А.\n${BODY}`
    );
  });
  const outline = Material.buildDocumentOutline(pages);
  const titles = outline.map((item) => item.title);

  assert.equal(titles.length, 10, `отримано ${titles.length} пунктів`);

  titles.forEach((title, index) => {
    assert.match(title, new RegExp(`§ ${index + 1}\\.`), `пункт ${index + 1}: ${title}`);
    assert.doesNotMatch(title, /^(?:\d{1,3}\s*)?2\.40\./, "номер вправи не має ставати розділом");
  });
});

test("номер вправи не стає розділом карти", () => {
  // «2.40.» має ту саму форму, що «1.10.», тому розрізняємо їх за величиною
  // другої частини: параграфів у розділі буває кільканадцять, а вправ — сотні.
  const pages = [
    page(3, `§ 1. НАЗВА РОЗДІЛУ\n2.40. Тетраедр, усі ребра якого по 4 см.\n${BODY}`),
    page(30, `§ 2. ДРУГА НАЗВА\n19.36. Точка А.\n${BODY}`),
    page(60, `§ 3. ТРЕТЯ НАЗВА\n2.41. Знайдіть обʼєм.\n${BODY}`),
    page(90, `1.10. БУДОВА РЕЧОВИНИ ТА ЇЇ ВЛАСТИВОСТІ\n${BODY}`),
    page(120, `1.11. ХІМІЧНІ РЕАКЦІЇ ТА ЇХ ТИПИ\n${BODY}`),
    page(150, `1.12. РОЗЧИНИ ТА ЇХ ВЛАСТИВОСТІ\n${BODY}`),
    page(180, `1.13. ОКСИДИ ТА КИСЛОТИ\n${BODY}`),
    page(210, `1.14. СОЛІ ТА ОСНОВИ\n${BODY}`),
    page(240, `1.15. МЕТАЛИ ТА НЕМЕТАЛИ\n${BODY}`)
  ];
  const outline = Material.buildDocumentOutline(pages);
  const titles = outline.map((item) => item.title);

  assert.ok(
    titles.some((title) => /1\.10\./.test(title)),
    `підрозділ «1.10.» має бути в карті: ${titles.join(" | ")}`
  );
  assert.ok(
    !titles.some((title) => /^(?:\d{1,3}\s*)?2\.40\./.test(title)),
    "номер вправи «2.40.» не має ставати розділом"
  );
});

test("усі формати заголовків розпізнаються", () => {
  const cases = [
    ["§ 1. ОСНОВНІ ПОНЯТТЯ", "1"],
    ["§ 14. МНОЖЕННЯ МНОГОЧЛЕНА", "14"],
    ["1.1. ПОШУК ВІДОМОСТЕЙ", "1.1"],
    ["Розділ 1. ВСТУП", "1"],
    ["Тема 5. КИСЛОТИ", "5"],
    ["Chapter 3. Cell Biology", "3"],
    ["Unit 4. Genetics", "4"]
  ];

  cases.forEach(([title, number]) => {
    assert.equal(Material.hasSectionNumber(title), true, `не розпізнано номер у «${title}»`);
    assert.equal(Material.sectionNumberOf(title), number, `невірний номер для «${title}»`);
    assert.equal(Material.hasRealTitleAfterNumber(title), true, `не знайдено назву в «${title}»`);
  });
});

test("рядок без справжньої назви не стає розділом", () => {
  // Одиниці виміру, математика й зіпсований шрифт — не назви розділів.
  assert.equal(Material.hasRealTitleAfterNumber("4,3 ГГц 4,3 ГГц"), false);
  assert.equal(Material.hasRealTitleAfterNumber("1.1. ¬ÐÆÕÄÂÏÏá ÔÂ"), false);
});

test("колонтитул із номером сторінки не потрапляє в карту", () => {
  // У PDF колонтитул зліплюється з номером сторінки: «51РОЗДІЛ».
  assert.equal(Material.looksLikePageFurniture("51РОЗДІЛ"), true);
  assert.equal(Material.looksLikePageFurniture("121РОЗДІЛ"), true);
  assert.equal(Material.looksLikePageFurniture("1.2. КОДУВАННЯ"), false);
  assert.equal(Material.looksLikePageFurniture("Розділ 1. ВСТУП"), false);
});

test("карта документа має діапазони сторінок", () => {
  const outline = Material.buildDocumentOutline(UNIVERSAL_BOOK);

  outline.forEach((item, index) => {
    assert.ok(item.pageFrom > 0, `пункт ${index + 1}: немає початкової сторінки`);
    assert.ok(
      item.pageTo >= item.pageFrom,
      `пункт ${index + 1}: кінець (${item.pageTo}) раніше за початок (${item.pageFrom})`
    );
  });

  assert.equal(outline[0].pageFrom, 5);
  assert.equal(outline[0].pageTo, 40);
});

test("порожній матеріал дає порожню карту, а не помилку", () => {
  assert.deepEqual(Material.buildDocumentOutline([]), []);
  assert.deepEqual(Material.buildDocumentOutline(null), []);
  assert.deepEqual(Material.buildDocumentOutline([page(1, "   ")]), []);
});

test("карта обмежується максимальною кількістю пунктів", () => {
  const pages = Array.from({ length: 200 }, (_, index) => {
    return page(index * 10 + 1, `Розділ ${index + 1}. НАЗВА ${index + 1}\n${BODY}`);
  });

  const capped = Material.buildDocumentOutline(pages, { maxHeadings: 70 });

  assert.equal(capped.length, 70);
  assert.ok(
    Material.buildDocumentOutline(pages).length <= 200,
    "карта не може бути довшою за кількість розділів"
  );
});

test("карта не втрачає розділи через обмеження", () => {
  // Назви в звичайному регістрі — так вони й виглядають у книзі.
  const pages = Array.from({ length: 100 }, (_, index) => {
    return page(index * 5 + 1, `Розділ ${index + 1}. Унікальна назва ${index + 1}\n${BODY}`);
  });
  const outline = Material.buildDocumentOutline(pages, { maxHeadings: 120 });
  const titles = outline.map((item) => item.title);

  // Перший, середній і останній розділи мають бути в карті.
  [1, 50, 100].forEach((number) => {
    assert.ok(
      titles.some((title) => title.startsWith(`Розділ ${number}.`)),
      `розділ ${number} загубився в карті`
    );
  });

  assert.equal(outline.length, 100, "усі 100 розділів мають бути в карті");
});

test("текст карти для моделі містить номери та сторінки", () => {
  const outline = Material.buildDocumentOutline(UNIVERSAL_BOOK);
  const text = Material.formatOutlineForModel(outline, { maxChars: 4000 });

  assert.match(text, /\[1\]/);
  assert.match(text, /с\. 5–40/);
  assert.match(text, /БУДОВА РЕЧОВИНИ/);
});

test("текст карти поважає ліміт символів", () => {
  const pages = Array.from({ length: 60 }, (_, index) => {
    return page(index * 10 + 1, `Розділ ${index + 1}. ДУЖЕ ДОВГА НАЗВА РОЗДІЛУ ${index + 1}\n${BODY}`);
  });
  const outline = Material.buildDocumentOutline(pages, { maxHeadings: 60 });
  const text = Material.formatOutlineForModel(outline, { maxChars: 500 });

  assert.ok(text.length <= 700, `текст задовгий: ${text.length}`);
  assert.match(text, /не показано/);
});

// ─── 2. Вибір розділів моделлю ────────────────────────────────────────────

test("parseOutlineSelection розуміє перелік і діапазони", () => {
  assert.deepEqual(Material.parseOutlineSelection("1, 3, 5", 8), [1, 3, 5]);
  assert.deepEqual(Material.parseOutlineSelection("2-4", 8), [2, 3, 4]);
  assert.deepEqual(Material.parseOutlineSelection("2–4", 8), [2, 3, 4]);
  assert.deepEqual(Material.parseOutlineSelection("1, 3-4, 7", 8), [1, 3, 4, 7]);
  assert.deepEqual(Material.parseOutlineSelection([2, 6], 8), [2, 6]);
});

test("parseOutlineSelection відкидає номери поза межами карти", () => {
  assert.deepEqual(Material.parseOutlineSelection("0, 99", 8), []);
  assert.deepEqual(Material.parseOutlineSelection("8", 8), [8]);
});

test("chunksForOutlineItems бере частини обраних розділів", () => {
  const pages = [
    page(5, `Розділ 1. ЛІТЕРАТУРА\n${BODY}`),
    page(40, `Розділ 2. ХІМІЯ\n${BODY}`),
    page(80, `Розділ 3. ГЕОМЕТРІЯ\n${BODY}`)
  ];
  const chunks = Material.buildChunks(pages, { maxChars: 12000 });
  const outline = Material.buildDocumentOutline(pages);
  const picked = Material.chunksForOutlineItems(chunks, outline, [2]);

  assert.ok(picked.length, "має бути обрана хоч одна частина");
  assert.ok(
    picked.some((chunk) => chunk.text.includes("ХІМІЯ")),
    "обрана частина має містити другий розділ"
  );
  assert.ok(
    !picked.some((chunk) => chunk.text.includes("ГЕОМЕТРІЯ")),
    "третій розділ не мав потрапити у вибір"
  );
});

// ─── 3. Коли вмикається маршрутизація ─────────────────────────────────────

test("маршрутизація вмикається для великого матеріалу", () => {
  const bigPages = [page(5, `Розділ 1. НАЗВА\n${BODY}`)];
  const plan = { dialogOnly: false };

  assert.equal(Hooks.shouldRouteByOutline(bigPages, plan), true);
});

test("маршрутизація не вмикається для маленького матеріалу", () => {
  const smallPages = [page(1, "Короткий текст про клітину.")];

  assert.equal(Hooks.shouldRouteByOutline(smallPages, { dialogOnly: false }), false);
});

test("маршрутизація не вмикається в діалозі", () => {
  const bigPages = [page(5, `Розділ 1. НАЗВА\n${BODY}`)];

  // У діалозі матеріалу немає — карта не потрібна.
  assert.equal(Hooks.shouldRouteByOutline(bigPages, { dialogOnly: true }), false);
  assert.equal(Hooks.shouldRouteByOutline([], { dialogOnly: false }), false);
  assert.equal(Hooks.shouldRouteByOutline(null, { dialogOnly: false }), false);
});

test("маршрутизація не перебиває точний локальний пошук теми", () => {
  const bigPages = [page(5, `Розділ 1. НАЗВА\n${BODY}`)];
  const plan = {
    dialogOnly: false,
    strategy: "paragraph",
    requested: { sections: ["14"], chapters: [], pages: [], keywords: [] },
    selected: [{ index: 0 }]
  };

  assert.equal(
    Hooks.shouldRouteByOutline(bigPages, plan),
    false,
    "коли тему знайдено точно, карта не потрібна"
  );
});

test("маршрутизація працює, коли точного збігу немає", () => {
  const bigPages = [page(5, `Розділ 1. НАЗВА\n${BODY}`)];
  const vaguePlan = {
    dialogOnly: false,
    strategy: "start",
    requested: { sections: [], chapters: [], pages: [], keywords: [] },
    selected: [{ index: 0 }]
  };
  const vagueTopicPlan = {
    dialogOnly: false,
    strategy: "keywords",
    requested: { sections: ["2.4"], chapters: [], pages: [], keywords: [] },
    selected: [{ index: 0 }]
  };

  assert.equal(Hooks.shouldRouteByOutline(bigPages, vaguePlan), true);
  assert.equal(
    Hooks.shouldRouteByOutline(bigPages, vagueTopicPlan),
    true,
    "якщо тему названо, але знайдено неточно — карта допомагає"
  );
});

// ─── 4. Маршрутизація наскрізно ───────────────────────────────────────────

function buildPlanFor(pages, prompt) {
  const chunks = Material.buildChunks(pages, { maxChars: 12000 });
  const selection = Material.selectChunksForPrompt(chunks, prompt, {
    maxChunks: 2,
    maxChars: 30000
  });

  return {
    source: "pages",
    chunks,
    selected: selection.selected,
    totalChunks: chunks.length,
    strategy: selection.strategy,
    headings: [],
    requested: selection.requested,
    fileName: "universal.pdf",
    fileIndex: 0,
    fileCount: 1,
    fileNames: ["universal.pdf"],
    fileChoiceReason: "single",
    suspectFontEncoding: false,
    partial: selection.selected.length < chunks.length,
    previewText: ""
  };
}

test("routeByOutline бере розділи, які обрала модель", async () => {
  const plan = buildPlanFor(UNIVERSAL_BOOK, "Зроби питання");
  const asked = [];

  const config = {
    provider: "openai",
    apiKey: "test-key",
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1"
  };

  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init?.body || "{}");
    asked.push(body);
    const payload = {
      choices: [{ message: { content: JSON.stringify({ sections: [3, 4] }) } }]
    };
    return {
      ok: true,
      status: 200,
      url: String(url),
      headers: { get: () => "application/json" },
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    };
  };

  let result;
  try {
    result = await Hooks.routeByOutline({
      materialPages: UNIVERSAL_BOOK,
      plan,
      prompt: "Зроби 10 питань про хімічні реакції",
      questionCount: 10,
      config
    });
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(result.routed, true, "маршрутизація має застосуватись");
  assert.deepEqual(result.picked, [3, 4]);
  assert.ok(result.outline.length >= 6);

  // Модель отримала карту ВСІЄЇ книги, а не окремий фрагмент.
  const userMessage = asked[0]?.messages?.find((message) => message.role === "user");
  const sent = Array.isArray(userMessage?.content)
    ? userMessage.content.map((part) => part.text || "").join(" ")
    : String(userMessage?.content || "");

  assert.match(sent, /ЗМІСТ/);
  assert.match(sent, /ЕКОЛОГІЯ/, "карта має містити останній розділ книги");

  const pages = result.plan.selected.map((chunk) => `${chunk.pageFrom}-${chunk.pageTo}`);
  assert.ok(pages.length, "мають бути обрані частини");
  assert.equal(result.plan.strategy, "outline");
});

test("routeByOutline мовчки повертає старий план, якщо модель не відповіла", async () => {
  const plan = buildPlanFor(UNIVERSAL_BOOK, "Зроби питання");
  const config = {
    provider: "openai",
    apiKey: "test-key",
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1"
  };
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("мережа недоступна");
  };

  let result;
  try {
    result = await Hooks.routeByOutline({
      materialPages: UNIVERSAL_BOOK,
      plan,
      prompt: "Зроби 10 питань",
      questionCount: 10,
      config
    });
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(result.routed, false, "має лишитись звичайний вибір");
  assert.equal(result.plan, plan, "план не має підмінятися");
});

test("routeByOutline не витрачає виклик, коли структури немає", async () => {
  const flatPages = [page(1, `Суцільний текст без розділів. ${BODY}`)];
  const plan = buildPlanFor(flatPages, "Зроби питання");
  let calls = 0;
  const config = {
    provider: "openai",
    apiKey: "test-key",
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1"
  };
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("не має викликатись");
  };

  let result;
  try {
    result = await Hooks.routeByOutline({
      materialPages: flatPages,
      plan,
      prompt: "Зроби 10 питань",
      questionCount: 10,
      config
    });
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(calls, 0, "жодного виклику моделі");
  assert.equal(result.routed, false);
});

// ─── 5. Запит до моделі та розбір відповіді ───────────────────────────────

test("запит карти просить відповісти лише JSON з номерами", () => {
  const prompt = Hooks.buildOutlinePrompt("[1] с. 5–40 — Розділ 1. ВСТУП", "Зроби 5 питань", {
    fileName: "book.pdf"
  });

  assert.match(prompt, /\[1\] с\. 5–40/);
  assert.match(prompt, /"sections"/);
  assert.match(prompt, /book\.pdf/);
  assert.match(prompt, /Зроби 5 питань/);
});

test("extractOutlineAnswer дістає номери з різних форматів відповіді", () => {
  assert.deepEqual(Hooks.extractOutlineAnswer({ sections: [1, 2] }), [1, 2]);
  assert.deepEqual(
    Hooks.extractOutlineAnswer({ chat_reply: '{"sections": [3, 4]}' }),
    [3, 4]
  );
  assert.equal(Hooks.extractOutlineAnswer({ chat_reply: "1, 3, 5" }), "1, 3, 5");
  assert.equal(Hooks.extractOutlineAnswer({}), "");
});

test("describeOutlineCoverage показує, скільки книги опрацьовано", () => {
  const plan = buildPlanFor(UNIVERSAL_BOOK, "Зроби питання");
  const outline = Material.buildDocumentOutline(UNIVERSAL_BOOK);
  const coverage = Hooks.describeOutlineCoverage(plan, outline);

  assert.ok(coverage, "покриття має бути пораховане");
  assert.equal(coverage.sections, outline.length);
  assert.ok(coverage.totalChars > 0);
  assert.ok(coverage.usedChars > 0);
  assert.ok(coverage.ratio > 0 && coverage.ratio <= 1);
});

test("describeOutlineCoverage без карти повертає null", () => {
  const plan = buildPlanFor(UNIVERSAL_BOOK, "Зроби питання");

  assert.equal(Hooks.describeOutlineCoverage(plan, []), null);
  assert.equal(Hooks.describeOutlineCoverage(null, []), null);
});
