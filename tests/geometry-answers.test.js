// Тести для двох виправлень у генерації тестів:
//   1) ілюстрації многогранників (стереометрія) + посилання на малюнок у тексті;
//   2) розподіл позицій правильних відповідей (щоб не все було "варіант 1").
//
// background.js завантажується в ізольований контекст через new Function,
// мережа не потрібна.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const BACKGROUND_PATH = path.join(PROJECT_ROOT, "background.js");
const Images = require(path.join(PROJECT_ROOT, "lib", "educational-images.js"));
const Material = require(path.join(PROJECT_ROOT, "lib", "material.js"));

function loadBackground() {
  const source = fs.readFileSync(BACKGROUND_PATH, "utf8");

  const sandbox = {
    importScripts: () => {},
    self: { QuizGenImages: Images, QuizGenMaterial: Material },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        onInstalled: { addListener() {} }
      },
      storage: {
        local: {
          get() {
            return Promise.resolve({});
          },
          set() {
            return Promise.resolve();
          }
        }
      }
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
  const body = `${source}\n;return globalThis.__QuizGenTestHooks;`;

  const hooks = new Function(...names, body)(
    ...names.map((name) => sandbox[name])
  );

  if (!hooks?.distributeCorrectPositions) {
    throw new Error(
      "Не вдалося завантажити тестові хуки з background.js (__QuizGenTestHooks)."
    );
  }

  hooks.setImageDebugEnabled(false);

  return hooks;
}

const Hooks = loadBackground();

// ─── 1. Многогранники ──────────────────────────────────────────────────────

test("фігура з тексту: паралелепіпед розпізнається як parallelepiped", () => {
  assert.equal(
    Images.inferFigureFromText("Знайдіть обʼєм прямокутного паралелепіпеда"),
    "parallelepiped"
  );
  assert.equal(
    Images.inferFigureFromText("Діагональним перерізом паралелепіпеда є..."),
    "parallelepiped"
  );
});

test("фігура з тексту: куб, призма, піраміда, тетраедр", () => {
  assert.equal(Images.inferFigureFromText("Ребро куба дорівнює 5"), "cube");
  assert.equal(
    Images.inferFigureFromText("Знайдіть обʼєм правильної трикутної призми"),
    "prism"
  );
  assert.equal(Images.inferFigureFromText("Висота піраміди дорівнює 6"), "pyramid");
  assert.equal(Images.inferFigureFromText("У правильному тетраедрі..."), "pyramid");
});

test("фігура з тексту: англійські назви", () => {
  assert.equal(Images.inferFigureFromText("Volume of a rectangular parallelepiped"), "parallelepiped");
  assert.equal(Images.inferFigureFromText("Surface area of a regular pyramid"), "pyramid");
  assert.equal(Images.inferFigureFromText("The edge of a cube is 5"), "cube");
});

test("фігура з тексту: пласкі задачі не отримують многогранник", () => {
  assert.equal(Images.inferFigureFromText("Знайдіть площу трикутника зі сторонами 3 і 4"), "");
  assert.equal(Images.inferFigureFromText("Обчисліть довжину кола радіуса 5"), "");
});

test("питання про паралелепіпед отримує обʼємну фігуру, а не трикутник", () => {
  const illustration = Images.renderQuestionIllustration({
    question: "Знайдіть обʼєм прямокутного паралелепіпеда, якщо його ребра 3, 4 і 5.",
    answers: ["60", "12", "24", "30"],
    correct: [0]
  });

  assert.ok(illustration, "ілюстрація має бути створена");
  const svg = decodeURIComponent(String(illustration.dataUrl));

  // Паралелепіпед малюється двома чотирикутниками (8 точок, 8 підписів).
  const circles = svg.match(/<circle /g) || [];
  assert.equal(circles.length, 8, "очікується 8 вершин паралелепіпеда");
});

test("питання про плоску фігуру не отримує зайвих вершин", () => {
  const illustration = Images.renderQuestionIllustration({
    question: "Знайдіть площу трикутника зі сторонами 3 см, 4 см і 5 см.",
    answers: ["6", "12", "10", "7"],
    correct: [0]
  });

  assert.ok(illustration, "ілюстрація має бути створена");
  const svg = decodeURIComponent(String(illustration.dataUrl));
  const circles = (svg.match(/<circle /g) || []).length;

  assert.ok(circles <= 4, `пласка фігура не має мати 8 вершин (отримано ${circles})`);
});

// ─── 2. Посилання на малюнок у тексті ──────────────────────────────────────

test("questionReferencesImage бачить типові українські звороти", () => {
  assert.equal(Images.questionReferencesImage({ question: "На рисунку зображено куб. Знайдіть..." }), true);
  assert.equal(Images.questionReferencesImage({ question: "Скористайтеся графіком функції" }), true);
  assert.equal(Images.questionReferencesImage({ question: "За таблицею визначте..." }), true);
  assert.equal(Images.questionReferencesImage({ question: "Розгляньте схему будови клітини" }), true);
});

test("questionReferencesImage не спрацьовує на питання без посилання", () => {
  assert.equal(Images.questionReferencesImage({ question: "Скільки буде 2 + 2?" }), false);
  assert.equal(Images.questionReferencesImage({ question: "Хто написав «Кобзар»?" }), false);
});

test("ensureImageReference додає посилання лише коли його немає", () => {
  const without = Images.ensureImageReference(
    { question: "Знайдіть обʼєм паралелепіпеда з ребрами 3, 4, 5." },
    "geometry",
    "uk"
  );

  assert.match(without, /^Скористайтеся рисунком\. /);
  assert.ok(without.endsWith("Знайдіть обʼєм паралелепіпеда з ребрами 3, 4, 5."));

  const already = "На рисунку зображено куб. Знайдіть його обʼєм.";
  assert.equal(
    Images.ensureImageReference({ question: already }, "geometry", "uk"),
    already
  );
});

test("ensureImageReference не псує великі літери й не дублює префікс", () => {
  const result = Images.ensureImageReference(
    { question: "ABC — рівносторонній трикутник." },
    "geometry",
    "uk"
  );

  assert.ok(result.includes("ABC — рівносторонній трикутник."));
  assert.equal(result.indexOf("ABC"), result.lastIndexOf("ABC"));
});

test("ensureImageReference має англійський варіант", () => {
  const result = Images.ensureImageReference(
    { question: "Find the volume of the cube." },
    "geometry",
    "en"
  );

  assert.match(result, /^Look at the diagram\. /);
});

test("різні типи ілюстрацій мають різні префікси", () => {
  const table = Images.ensureImageReference(
    { question: "Визначте густину речовини." },
    "table",
    "uk"
  );
  const equation = Images.ensureImageReference(
    { question: "Розвʼяжіть рівняння." },
    "equation",
    "uk"
  );

  assert.match(table, /таблицею/);
  assert.match(equation, /формулою/);
});

// ─── 3. Розподіл позицій правильних відповідей ─────────────────────────────

function makeQuestions(count, correctIndex) {
  return Array.from({ length: count }, (_, index) => ({
    question: `Питання ${index + 1}`,
    type: "quiz",
    answers: ["A", "B", "C", "D"],
    correct: [correctIndex]
  }));
}

test("усі правильні на позиції 0 — позиції розподіляються", () => {
  const balanced = Hooks.distributeCorrectPositions(makeQuestions(10, 0));
  const positions = balanced.map((question) => question.correct[0]);
  const distinct = new Set(positions);

  assert.ok(distinct.size >= 3, `мало різних позицій: ${[...distinct].join(",")}`);
  assert.ok(
    Math.max(...positions) <= 3,
    "індекс правильної відповіді вийшов за межі масиву"
  );
});

test("після розподілу текст правильної відповіді не змінюється", () => {
  const questions = [
    { question: "Q1", type: "quiz", answers: ["Правильна", "Хибна1", "Хибна2", "Хибна3"], correct: [0] },
    { question: "Q2", type: "quiz", answers: ["Правильна", "Хибна1", "Хибна2", "Хибна3"], correct: [0] },
    { question: "Q3", type: "quiz", answers: ["Правильна", "Хибна1", "Хибна2", "Хибна3"], correct: [0] }
  ];
  const balanced = Hooks.distributeCorrectPositions(questions);

  balanced.forEach((question, index) => {
    const position = question.correct[0];

    assert.equal(
      question.answers[position],
      "Правильна",
      `питання ${index + 1}: правильна відповідь переїхала разом із текстом`
    );
  });
});

test("набір варіантів зберігається повністю (без дублів і втрат)", () => {
  const balanced = Hooks.distributeCorrectPositions(makeQuestions(8, 0));

  balanced.forEach((question, index) => {
    assert.equal(question.answers.length, 4, `питання ${index + 1}: змінилась кількість варіантів`);
    assert.equal(
      new Set(question.answers).size,
      4,
      `питання ${index + 1}: у варіантах зʼявився дубль`
    );
  });
});

test("якщо позиції вже розподілені — список не змінюється", () => {
  const questions = [
    { question: "Q1", type: "quiz", answers: ["A", "B", "C", "D"], correct: [1] },
    { question: "Q2", type: "quiz", answers: ["A", "B", "C", "D"], correct: [2] },
    { question: "Q3", type: "quiz", answers: ["A", "B", "C", "D"], correct: [3] },
    { question: "Q4", type: "quiz", answers: ["A", "B", "C", "D"], correct: [0] }
  ];
  const result = Hooks.distributeCorrectPositions(questions);

  assert.deepEqual(
    result.map((question) => question.correct[0]),
    [1, 2, 3, 0]
  );
  assert.deepEqual(result[1].answers, ["A", "B", "C", "D"]);
});

test("multiquiz: усі індекси правильних відповідей зсуваються разом", () => {
  const questions = [
    { question: "Q1", type: "multiquiz", answers: ["A", "B", "C", "D"], correct: [0, 2] },
    { question: "Q2", type: "multiquiz", answers: ["A", "B", "C", "D"], correct: [0, 2] },
    { question: "Q3", type: "multiquiz", answers: ["A", "B", "C", "D"], correct: [0, 2] }
  ];
  const balanced = Hooks.distributeCorrectPositions(questions);

  balanced.forEach((question, index) => {
    assert.equal(question.correct.length, 2, `питання ${index + 1}: втрачено правильну відповідь`);
    assert.equal(
      new Set(question.correct).size,
      2,
      `питання ${index + 1}: індекси злилися`
    );
    assert.deepEqual(
      question.correct,
      [...question.correct].sort((left, right) => left - right),
      `питання ${index + 1}: індекси не відсортовані`
    );
    assert.equal(question.type, "multiquiz", `питання ${index + 1}: змінився тип`);
  });
});

test("короткий список (1–2 питання) не чіпаємо", () => {
  const short = makeQuestions(2, 0);

  assert.deepEqual(Hooks.distributeCorrectPositions(short), short);
});

test("порожнє або некоректне значення не ламає функцію", () => {
  assert.deepEqual(Hooks.distributeCorrectPositions(null), null);
  assert.deepEqual(Hooks.distributeCorrectPositions([]), []);

  const weird = [
    { question: "Q1", answers: [], correct: [] },
    { question: "Q2", answers: ["A"], correct: [0] },
    { question: "Q3", answers: ["A", "B"], correct: [0] }
  ];

  assert.doesNotThrow(() => Hooks.distributeCorrectPositions(weird));
});

test("старе імʼя balanceCorrectPositions працює як аліас", () => {
  const questions = makeQuestions(6, 0);
  const viaLegacy = Hooks.balanceCorrectPositions(questions);
  const viaNew = Hooks.distributeCorrectPositions(makeQuestions(6, 0));

  assert.deepEqual(
    viaLegacy.map((question) => question.correct[0]),
    viaNew.map((question) => question.correct[0])
  );
});

// ─── 4. Вибір теми: зміст книги не має бути джерелом питань ────────────────
//
// Реальний випадок: Geometrija-10-klas-Ister-2018.pdf, запит
// «Зроби 10 запитань відповідно тему 2.4». §4 існує в книзі ЛИШЕ у «ЗМІСТІ»
// (с. 364), тому фазі-фолбек «2.4 → §4» вибирав сторінки 358–368 — зміст
// і відповіді замість теми.

function page(number, text) {
  return {
    number,
    sourcePage: number,
    text,
    fileName: "geometrija-10.pdf",
    fileIndex: 0
  };
}

// Спрощена книга з §-нумерацією: змістовні параграфи §1–§3 і «ЗМІСТ» у кінці.
// Сторінки навмисно великі (як у справжньому підручнику), щоб матеріал
// ділився на кілька частин і перевірка «яку частину обрано» була осмисленою.
const FILLER =
  "Тут викладено означення, теореми та приклади розв'язування задач. ".repeat(260);

const GEOMETRY_PAGES = [
  page(22, `Розділ 1. ВСТУП ДО СТЕРЕОМЕТРІЇ. § 1. ОСНОВНІ ПОНЯТТЯ СТЕРЕОМЕТРІЇ. На малюнку 2.4 маємо тетраедр. ${FILLER}`),
  page(29, `§ 2. ПОЧАТКОВІ УЯВЛЕННЯ ПРО МНОГОГРАННИКИ. 2.4. Побудуйте діагональний переріз куба. 2.5. Дано паралелепіпед. ${FILLER}`),
  page(34, `2.40. Тетраедр, усі ребра якого по 4 см. Точки М і К — середини ребер. ${FILLER}`),
  page(40, `До § 2. На малюнку 2.44 зображено прямокутний паралелепіпед. Назвіть його грані. ${FILLER}`),
  page(70, `§ 3. ПЕРПЕНДИКУЛЯРНІСТЬ ПРЯМИХ І ПЛОЩИН. Ознака перпендикулярності прямої і площини. ${FILLER}`),
  page(107, `§ 4. КООРДИНАТИ У ПРОСТОРІ. Прямокутна система координат у просторі. ${FILLER}`),
  page(
    364,
    "ЗМІСТ Шановні десятикласниці та десятикласники! ......... 3 " +
      "Розділ 1. ВСТУП ДО СТЕРЕОМЕТРІЇ § 1. Основні поняття стереометрії " +
      "............................... 6 " +
      "§ 2. Початкові уявлення про многогранники ....................... 21 " +
      "§ 3. Перпендикулярність прямих і площин ......................... 49 " +
      "§ 4. Координати у просторі ..................................... 107 " +
      "§ 5. Вектори у просторі ........................................ 124 " +
      "§ 6. Геометричні перетворення .................................. 131"
  ),
  page(
    365,
    "Розділ 4. КООРДИНАТИ, ВЕКТОРИ, ГЕОМЕТРИЧНІ ПЕРЕТВОРЕННЯ " +
      "§ 13. Прямокутні координати у просторі ......................... 237 " +
      "§ 14. Вектори у просторі ....................................... 251 " +
      "§ 15. Координати вектора ....................................... 269 " +
      "§ 16. Скалярний добуток векторів ............................... 283"
  )
];

const GEOMETRY_CHUNKS = Material.buildChunks(GEOMETRY_PAGES, { maxChars: 12000 });

test("зміст книги розпізнається як довідкова частина", () => {
  const toc = GEOMETRY_CHUNKS.find((chunk) => chunk.pageFrom >= 364);

  assert.ok(toc, "частина зі змістом має існувати");
  assert.equal(Material.isReferenceChunk(toc), true);
});

test("звичайний параграф не вважається довідковим", () => {
  // Довідкові частини в цьому фікстурі — тільки ті, де є крапки-виноски
  // (зміст), тобто сторінки 364–365.
  const contentPages = [22, 29, 34, 40, 70, 107];

  GEOMETRY_CHUNKS
    .filter((chunk) => contentPages.includes(chunk.pageFrom))
    .forEach((chunk) => {
      assert.equal(
        Material.isReferenceChunk(chunk),
        false,
        `сторінка ${chunk.pageFrom} помилково позначена як довідкова`
      );
    });

  assert.equal(contentPages.length, 6, "перевіряємо всі змістовні сторінки");
});

test("запит «тему 2.4» не тягне сторінки зі змісту книги", () => {
  const selection = Material.selectChunksForPrompt(
    GEOMETRY_CHUNKS,
    "Зроби 10 запитань відповідно тему 2.4",
    { maxChunks: 3, maxChars: 30000 }
  );

  assert.ok(selection.selected.length, "має бути обрана хоч одна частина");

  const fromToc = selection.selected.filter((chunk) => chunk.pageFrom >= 360);

  assert.deepEqual(
    fromToc,
    [],
    `у вибір потрапив зміст: сторінки ${fromToc.map((chunk) => chunk.pageFrom).join(",")}`
  );
});

test("запит «тему 2.4» бере частину, де цей номер справді є в тексті", () => {
  const selection = Material.selectChunksForPrompt(
    GEOMETRY_CHUNKS,
    "Зроби 10 запитань відповідно тему 2.4",
    { maxChunks: 3, maxChars: 120000 }
  );

  const withNumber = selection.selected.filter((chunk) => chunk.text.includes("2.4."));

  assert.ok(
    withNumber.length,
    `жодна з обраних частин не містить «2.4.»: ${selection.selected
      .map((chunk) => `${chunk.pageFrom}-${chunk.pageTo}`)
      .join(", ")}`
  );

  // І це має бути сторінка 29 (матеріал §2), а не хвіст книги.
  assert.ok(
    withNumber.some((chunk) => chunk.pageFrom <= 29 && chunk.pageTo >= 29),
    `«2.4.» знайдено не на сторінці 29, а на ${withNumber.map((chunk) => chunk.pageFrom).join(", ")}`
  );
});

test("книга з §-нумерацією не отримує вигаданого підрозділу «2.4»", () => {
  const sections = Material.extractRequestedSections("тема 2.4").sections;

  assert.deepEqual(sections, ["2.4"]);

  // Книга НЕ має нумерації вигляду «§ 2.4» — отже підрозділ вигаданий.
  assert.equal(Material.bookUsesDottedSections(GEOMETRY_CHUNKS), false);
});

test("книга з §-нумерацією: «розділ 2» знаходить параграфи цього розділу", () => {
  // Книга, де розділи справді підписані в тексті.
  const pages = [
    page(10, `Розділ 1. ВСТУП ДО СТЕРЕОМЕТРІЇ. § 1. ОСНОВНІ ПОНЯТТЯ. ${FILLER}`),
    page(40, `§ 2. МНОГОГРАННИКИ. Тетраедр і паралелепіпед. ${FILLER}`),
    page(60, `§ 3. ПЕРЕРІЗИ. Побудова перерізів методом слідів. ${FILLER}`),
    page(90, `Розділ 2. ПЕРПЕНДИКУЛЯРНІСТЬ. § 4. ПЕРПЕНДИКУЛЯРНІ ПРЯМІ. ${FILLER}`),
    page(120, `§ 5. ПЕРПЕНДИКУЛЯР І ПОХИЛА. Теорема про три перпендикуляри. ${FILLER}`)
  ];
  const chunks = Material.buildChunks(pages, { maxChars: 12000 });

  const chapterSections = Material.sectionsOfChapter(chunks, 2);

  assert.ok(
    chapterSections.includes("4"),
    `розділ 2 має містити § 4, а містить ${chapterSections.join(",")}`
  );

  const selection = Material.selectChunksForPrompt(
    chunks,
    "Зроби питання за розділом 2",
    { maxChunks: 2, maxChars: 30000 }
  );

  assert.equal(selection.strategy, "chapter", `стратегія ${selection.strategy}`);
  assert.ok(
    selection.selected.some((chunk) => chunk.text.includes("§ 4.")),
    `обрано сторінки ${selection.selected.map((chunk) => `${chunk.pageFrom}-${chunk.pageTo}`).join(", ")}`
  );
});

// ─── 5. Розпізнавання теми в будь-якому відмінку ───────────────────────────
//
// Реальні запити: «за темою 14», «з теми 12», «за параграфом 13».
// Старий регекс знав лише називний відмінок («тема 14», «параграф 13»),
// тому такі запити не розпізнавались узагалі — тест складався з початку книги.

test("«за темою 14» розпізнає параграф 14", () => {
  assert.deepEqual(
    Material.extractRequestedSections("Зроби 10 запитань за темою 14").sections,
    ["14"]
  );
});

test("«за параграфом 13» розпізнає параграф 13", () => {
  assert.deepEqual(
    Material.extractRequestedSections("Зроби питання за параграфом 13").sections,
    ["13"]
  );
});

test("«з теми 12» і «темах 5» розпізнаються", () => {
  assert.deepEqual(
    Material.extractRequestedSections("Зроби 10 питань з теми 12").sections,
    ["12"]
  );
  assert.deepEqual(
    Material.extractRequestedSections("Питання з темах 5").sections,
    ["5"]
  );
});

test("підрозділ у відмінку не втрачає другу частину", () => {
  assert.deepEqual(
    Material.extractRequestedSections("Зроби 5 запитань за темою 2.4").sections,
    ["2.4"]
  );
  assert.deepEqual(
    Material.extractRequestedSections("питання за параграфом 1.4").sections,
    ["1.4"]
  );
});

test("кількість питань не стає темою", () => {
  assert.deepEqual(Material.extractRequestedSections("Зроби 10 питань").sections, []);
  assert.deepEqual(
    Material.extractRequestedSections("Створи 25 тестових завдань").sections,
    []
  );
});

test("«за розділом 2» лишається розділом, а не параграфом", () => {
  const requested = Material.extractRequestedSections("Зроби питання за розділом 2");

  assert.deepEqual(requested.sections, []);
  assert.deepEqual(requested.chapters, [2]);
});

test("§-книга: «тема 14» веде до параграфа 14, а не до початку книги", () => {
  const pages = [
    page(10, `§ 12. МНОЖЕННЯ МНОГОЧЛЕНІВ. Правило множення. ${FILLER}`),
    page(109, `§ 13. РОЗКЛАДАННЯ НА МНОЖНИКИ. Винесення спільного множника. ${FILLER}`),
    page(114, `§ 14. МНОЖЕННЯ МНОГОЧЛЕНА НА МНОГОЧЛЕН. Правило множення. ${FILLER}`),
    page(121, `§ 15. ФОРМУЛИ СКОРОЧЕНОГО МНОЖЕННЯ. Різниця квадратів. ${FILLER}`)
  ];
  const chunks = Material.buildChunks(pages, { maxChars: 12000 });

  const selection = Material.selectChunksForPrompt(
    chunks,
    "Зроби 10 запитань за темою 14",
    { maxChunks: 2, maxChars: 30000 }
  );

  assert.equal(selection.strategy, "paragraph", `стратегія ${selection.strategy}`);
  assert.ok(
    selection.selected.some((chunk) => chunk.text.includes("§ 14.")),
    `обрано сторінки ${selection.selected.map((chunk) => `${chunk.pageFrom}-${chunk.pageTo}`).join(", ")}`
  );
  assert.ok(
    selection.selected.every((chunk) => chunk.pageFrom >= 100),
    "вибір не має повертатися до початку книги"
  );
});

test("книга з нумерацією N.M: запит «тема 1.2» працює як раніше", () => {
  const pages = [
    page(
      8,
      "1.1. ПОШУК ВІДОМОСТЕЙ В ІНТЕРНЕТІ. Пошукова система має фільтри. ".repeat(10)
    ),
    page(
      15,
      "1.2. ЗБИРАННЯ ДАНИХ. Перевірка достовірності зібраних даних. ".repeat(10)
    ),
    page(
      25,
      "1.3. ПОШУК АУДІО- ТА ВІДЕОМАТЕРІАЛІВ. Розпізнавання фактів і фейків. ".repeat(10)
    )
  ];
  const chunks = Material.buildChunks(pages, { maxChars: 12000 });

  assert.equal(Material.bookUsesDottedSections(chunks), true);

  const selection = Material.selectChunksForPrompt(chunks, "Зроби питання за темою 1.2", {
    maxChunks: 2,
    maxChars: 30000
  });

  assert.ok(
    selection.selected.some((chunk) => chunk.text.includes("1.2.")),
    "має бути обрана частина з темою 1.2"
  );
});
