// Тести вибору матеріалу, коли завантажено кілька книг.
//
// Перевіряємо головне: моделі йде ОДНА книга, а не суміш усіх завантажених,
// і що вибір відповідає запиту користувача.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const Images = require(path.join(PROJECT_ROOT, "lib", "educational-images.js"));
const Material = require(path.join(PROJECT_ROOT, "lib", "material.js"));

function loadBackground() {
  const source = fs.readFileSync(path.join(PROJECT_ROOT, "background.js"), "utf8");

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
  const hooks = new Function(...names, `${source}\n;return globalThis.__QuizGenTestHooks;`)(
    ...names.map((name) => sandbox[name])
  );

  hooks.setImageDebugEnabled(false);

  return hooks;
}

const Hooks = loadBackground();

// Формує сторінки так само, як popup.js передає їх у background.
function makeBook({ fileIndex, fileName, pages }) {
  return pages.map((text, index) => ({
    number: fileIndex * 1000 + index + 1,
    sourcePage: index + 1,
    text,
    fileName,
    fileIndex
  }));
}

const INFORMATYKA = makeBook({
  fileIndex: 0,
  fileName: "informatyka.pdf",
  pages: [
    "1.1. ÏÎØÓÊ Â І ÄÎÌÎÑÒÅÉ Â І ÍÒÅÐÍÅÒ І. " +
      "Пошук відомостей в Інтернеті потребує перевірки джерел та матеріалів. ".repeat(40),
    "1 .2. ÇÁÈÐÀÍÍß ÄÀÍÈÕ. ÏÅÐÅÂ І ÐÊÀ ÄÎÑÒÎÂ І ÐÍÎÑÒ І. ÎÇÍÀÊÈ ÌÎÂÈ ÂÎÐÎÆÍÅ× І. " +
      "Збирання даних і перевірка достовірності потрібні для висновків. ".repeat(40)
  ]
});

const MATEMATYKA = makeBook({
  fileIndex: 1,
  fileName: "matematyka.pdf",
  pages: [
    "Тема 1. НАТУРАЛЬНІ ЧИСЛА. 1.1. ДОДАВАННЯ І ВІДНІМАННЯ. " +
      "Натуральні числа використовують для лічби предметів. ".repeat(40),
    "1.2. МНОЖЕННЯ І ДІЛЕННЯ. " +
      "Множення — це додавання однакових доданків. Ділення обернене до множення. ".repeat(40)
  ]
});

const TWO_BOOKS = [...INFORMATYKA, ...MATEMATYKA];

function plan(prompt, pages = TWO_BOOKS, questionCount = 5) {
  return Hooks.planMaterial({
    materialPages: pages,
    material: "",
    prompt,
    questionCount
  });
}

test("без орієнтирів беруться питання з ОСТАННЬОГО завантаженого файлу", () => {
  ["зроби 10 питань", "зроби тест", "створи питання за матеріалом", "зроби 5 питань за матеріалом підручника"].forEach((prompt) => {
    const result = plan(prompt);

    assert.equal(result.fileName, "matematyka.pdf", `запит: ${prompt}`);
    assert.equal(result.fileChoiceReason, "latest");
  });
});

test("частини не змішують сторінки різних книг", () => {
  const result = plan("зроби 10 питань за матеріалом");
  const fileIndexes = new Set(result.selected.map((chunk) => chunk.fileIndex));

  assert.equal(fileIndexes.size, 1, "усі частини мають бути з однієї книги");
  assert.equal(result.selected[0].fileIndex, 1);
});

test("назва теми обирає книгу, у якій цей заголовок справді є", () => {
  const result = plan("зроби 5 питань за темою 1.2 Розділу 1");

  assert.equal(result.fileChoiceReason, "section");
  assert.equal(result.fileName, "informatyka.pdf");
  assert.ok(
    result.headings.every((heading) => heading.index >= 0),
    "заголовок має бути знайдений"
  );
});

test("ключові слова з предмета перемагають найновіший файл", () => {
  const result = plan("зроби 5 питань з математики про множення");

  assert.equal(result.fileChoiceReason, "keywords");
  assert.equal(result.fileName, "matematyka.pdf");
});

test("згадка «з другої книги» обирає другий файл", () => {
  const result = plan("зроби питання з другої книги");

  assert.equal(result.fileChoiceReason, "mentioned");
  assert.equal(result.fileName, "matematyka.pdf");
});

test("згадка «з першої книги» обирає перший файл", () => {
  const result = plan("зроби питання з першої книги");

  assert.equal(result.fileChoiceReason, "mentioned");
  assert.equal(result.fileName, "informatyka.pdf");
});

test("«у файлі 2» також обирає другий файл", () => {
  const result = plan("зроби тест у файлі 2");

  assert.equal(result.fileChoiceReason, "mentioned");
  assert.equal(result.fileName, "matematyka.pdf");
});

test("одна книга працює як і раніше", () => {
  const result = plan("зроби 5 питань", INFORMATYKA);

  assert.equal(result.fileCount, 1);
  assert.equal(result.fileChoiceReason, "single");
  assert.equal(result.fileName, "informatyka.pdf");
  assert.equal(result.selected.length > 0, true);
});

test("план показує, скільки файлів завантажено і який обрано", () => {
  const result = plan("зроби 5 питань");
  const described = Hooks.planMaterial && result;

  assert.equal(result.fileCount, 2);
  assert.equal(result.fileIndex, 1);
  assert.equal(described.fileName, "matematyka.pdf");
});

test("номери сторінок у плані — у межах книги, а не наскрізні", () => {
  const result = plan("зроби питання з другої книги");
  const first = result.selected[0];

  // Друга книга має власну нумерацію з 1, а не продовження першої.
  assert.ok(
    first.pageFrom >= 1 && first.pageTo <= MATEMATYKA.length,
    `сторінки ${first.pageFrom}-${first.pageTo} мають бути в межах книги`
  );
  assert.ok(first.text.includes("[Сторінка 1]"));
});

test("порожній матеріал усе одно дає діалоговий план", () => {
  const result = plan("Привіт", []);

  assert.equal(result.dialogOnly, true);
  assert.equal(result.selected.length, 1);
});

test("Material.groupChunksByFile зберігає порядок файлів", () => {
  const pages = [...INFORMATYKA, ...MATEMATYKA];
  const chunks = Material.buildChunks(pages, { maxChars: 2000 });
  const groups = Material.groupChunksByFile(chunks);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].fileName, "informatyka.pdf");
  assert.equal(groups[1].fileName, "matematyka.pdf");
});

test("Material.scoreFileForPrompt рахує заголовки для потрібного файлу", () => {
  const chunks = Material.buildChunks(MATEMATYKA, { maxChars: 2000 });
  const score = Material.scoreFileForPrompt(chunks, "зроби тест за темою 1.2");

  assert.equal(score.headingPages, 1);
  assert.ok(score.score > 0);
});
