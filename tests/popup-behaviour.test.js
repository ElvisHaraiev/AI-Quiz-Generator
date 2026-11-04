// Тести поведінки popup.js: чисті функції, які визначають параметри запиту
// до моделі (кількість і тип питань, форматування розміру файлу).
//
// popup.js виконується в ізольованому контексті через new Function з
// підставним document, бо на верхньому рівні він реєструє DOMContentLoaded.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const POPUP_PATH = path.join(PROJECT_ROOT, "popup.js");

function loadPopup() {
  const source = fs.readFileSync(POPUP_PATH, "utf8");

  const sandbox = {
    document: {
      addEventListener() {},
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      createElement() {
        return { style: {}, classList: { add() {}, remove() {} }, append() {} };
      }
    },
    window: {},
    chrome: {
      runtime: { sendMessage: async () => ({}), getURL: (value) => value },
      storage: { local: { get: async () => ({}), set: async () => {} } }
    },
    console,
    URL,
    URLSearchParams,
    Blob,
    FileReader: class {},
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    globalThis
  };

  const names = Object.keys(sandbox);
  const body = `${source}\n;return globalThis.__QuizGenPopupHooks;`;

  const hooks = new Function(...names, body)(...names.map((name) => sandbox[name]));

  if (!hooks?.detectQuestionTypes) {
    throw new Error(
      "Не вдалося завантажити тестові хуки з popup.js (__QuizGenPopupHooks)."
    );
  }

  return hooks;
}

const Hooks = loadPopup();

// ─── Кількість питань ──────────────────────────────────────────────────────

test("detectQuestionCount розуміє типові формулювання", () => {
  assert.equal(Hooks.detectQuestionCount("Зроби 10 запитань"), 10);
  assert.equal(Hooks.detectQuestionCount("створи 5 питань за темою 1.2"), 5);
  assert.equal(Hooks.detectQuestionCount("Create 7 questions"), 7);
});

test("detectQuestionCount не плутає номер теми з кількістю питань", () => {
  // «тема 2.4» не має стати двома питаннями.
  assert.equal(Hooks.detectQuestionCount("Зроби питання за темою 2.4"), null);
  assert.equal(Hooks.detectQuestionCount("питання за розділом 3"), null);
});

// ─── Тип питань ────────────────────────────────────────────────────────────

test("detectQuestionTypes: без уточнень — змішаний тип", () => {
  assert.equal(Hooks.detectQuestionTypes("Зроби 10 запитань"), "all");
  assert.equal(Hooks.detectQuestionTypes(""), "all");
});

test("detectQuestionTypes: прохання кількох правильних → multiquiz", () => {
  const prompts = [
    "Зроби 2 питання з кількома правильними відповідями",
    "додай питання з декількома правильними відповідями",
    "зроби 3 питання multiquiz",
    "зроби завдання, де треба вибрати всі правильні варіанти",
    "зроби 4 питання з двома правильними відповідями"
  ];

  prompts.forEach((prompt) => {
    assert.equal(
      Hooks.detectQuestionTypes(prompt),
      "multiquiz",
      `запит «${prompt}» має давати multiquiz`
    );
  });
});

test("detectQuestionTypes: прохання однієї правильної → quiz", () => {
  const prompts = [
    "зроби питання з однією правильною відповіддю",
    "тільки одна правильна відповідь",
    "зроби тільки quiz"
  ];

  prompts.forEach((prompt) => {
    assert.equal(
      Hooks.detectQuestionTypes(prompt),
      "quiz",
      `запит «${prompt}» має давати quiz`
    );
  });
});

test("detectQuestionTypes не спрацьовує на звичайну згадку відповідей", () => {
  // «правильні відповіді» без «кілька» — це не про multiquiz.
  assert.equal(Hooks.detectQuestionTypes("Зроби 10 запитань з відповідями"), "all");
  assert.equal(Hooks.detectQuestionTypes("додай правильні відповіді"), "all");
});

// ─── Форматування розміру ──────────────────────────────────────────────────

test("formatBytes рахує кілобайти за 1024", () => {
  assert.equal(Hooks.formatBytes(512), "512 B");
  assert.equal(Hooks.formatBytes(1024), "1.0 KB");
  assert.equal(Hooks.formatBytes(1536), "1.5 KB");
  assert.equal(Hooks.formatBytes(2048), "2.0 KB");
  assert.equal(Hooks.formatBytes(1024 * 1024 * 5), "5.0 MB");
});

test("formatBytes не ділить на 1000", () => {
  // 50 000 000 байт — це 47.7 MB, а не 50 MB.
  assert.equal(Hooks.formatBytes(50 * 1000 * 1000), "47.7 MB");
});
