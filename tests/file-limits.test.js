// Тести обмежень завантаження файлів і форматування розмірів.
//
// Перевіряємо, що ліміт 50 МБ на файл справді діє, що сумарний ліміт
// і кількість файлів контролюються, і що повідомлення коректні.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const POPUP_PATH = path.join(PROJECT_ROOT, "popup.js");

const MB = 1024 * 1024;
const KB = 1024;

// Завантажує popup.js в ізольований контекст і повертає чисті функції.
// Достатньо фейкового DOM, бо перевіряємо лише логіку відбору файлів.
function loadPopup() {
  const source = fs.readFileSync(POPUP_PATH, "utf8");

  const fakeElement = () => ({
    value: "",
    checked: false,
    textContent: "",
    className: "",
    innerHTML: "",
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {},
    appendChild() {},
    querySelectorAll: () => [],
    contains: () => false
  });

  const sandbox = {
    document: {
      addEventListener() {},
      getElementById: () => fakeElement(),
      querySelectorAll: () => [],
      createElement: () => fakeElement()
    },
    chrome: {
      runtime: { getURL: (value) => value, sendMessage: () => Promise.resolve({}) },
      storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
      tabs: { query: () => Promise.resolve([]), sendMessage() {} }
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Promise,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    RegExp,
    DOMParser: undefined,
    FileReader: undefined,
    Image: undefined,
    globalThis
  };

  const names = Object.keys(sandbox);
  const hooks = new Function(
    ...names,
    `${source}\n;return { selectFilesWithinLimits, formatBytes, describeExtractionResult, MAX_FILE_SIZE, MAX_TOTAL_FILE_SIZE, MAX_FILES };`
  )(...names.map((name) => sandbox[name]));

  return hooks;
}

const Popup = loadPopup();

function makeFile(name, size) {
  return { name, size, type: "application/pdf" };
}

test("ліміт на один файл — 50 МБ", () => {
  assert.equal(Popup.MAX_FILE_SIZE, 50 * MB);
});

test("файл рівно 50 МБ приймається", () => {
  const result = Popup.selectFilesWithinLimits([makeFile("book.pdf", 50 * MB)], []);

  assert.equal(result.selected.length, 1);
  assert.equal(result.rejected.length, 0);
});

test("файл 51 МБ відхиляється з повідомленням про 50 MB", () => {
  const result = Popup.selectFilesWithinLimits([makeFile("big.pdf", 51 * MB)], []);

  assert.equal(result.selected.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /занадто великий/);
  assert.match(result.rejected[0].reason, /50\.0 MB/);
});

test("два файли по 50 МБ приймаються (межа)", () => {
  const result = Popup.selectFilesWithinLimits(
    [makeFile("a.pdf", 50 * MB), makeFile("b.pdf", 50 * MB)],
    []
  );

  assert.equal(result.selected.length, 2);
  assert.equal(result.rejected.length, 0);
});

test("третій файл не додається — максимум 2", () => {
  const result = Popup.selectFilesWithinLimits(
    [makeFile("a.pdf", 1 * MB), makeFile("b.pdf", 1 * MB), makeFile("c.pdf", 1 * MB)],
    []
  );

  assert.equal(result.selected.length, 2);
  assert.ok(result.warnings.some((text) => /Максимум — 2/.test(text)));
});

test("якщо вже додано 2 файли, нові не приймаються", () => {
  const pending = [{ size: 1 * MB }, { size: 1 * MB }];
  const result = Popup.selectFilesWithinLimits([makeFile("c.pdf", 1 * MB)], pending);

  assert.equal(result.selected.length, 0);
  assert.ok(result.warnings.some((text) => /максимум 2 файли/.test(text)));
});

test("сумарний ліміт 100 МБ враховує вже додані файли", () => {
  const pending = [{ size: 60 * MB }];
  const result = Popup.selectFilesWithinLimits([makeFile("b.pdf", 50 * MB)], pending);

  assert.equal(result.selected.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /100\.0 MB/);
});

test("у межах сумарного ліміту файл приймається", () => {
  const pending = [{ size: 40 * MB }];
  const result = Popup.selectFilesWithinLimits([makeFile("b.pdf", 40 * MB)], pending);

  assert.equal(result.selected.length, 1);
  assert.equal(result.rejected.length, 0);
});

test("змішаний набір: завеликий відхилено, решта прийнято", () => {
  const result = Popup.selectFilesWithinLimits(
    [makeFile("huge.pdf", 80 * MB), makeFile("ok.pdf", 10 * MB)],
    []
  );

  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].name, "ok.pdf");
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].file.name, "huge.pdf");
});

test("порожній вибір не дає ні помилок, ні вибраних файлів", () => {
  const result = Popup.selectFilesWithinLimits([], []);

  assert.deepEqual(result.selected, []);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.warnings, []);
});

test("formatBytes показує розміри у звичних одиницях", () => {
  assert.equal(Popup.formatBytes(0), "0 B");
  assert.equal(Popup.formatBytes(512), "512 B");
  assert.equal(Popup.formatBytes(1 * KB), "1.0 KB");
  assert.equal(Popup.formatBytes(50 * KB), "50 KB");
  assert.equal(Popup.formatBytes(1 * MB), "1.0 MB");
  assert.equal(Popup.formatBytes(15 * MB), "15.0 MB");
  assert.equal(Popup.formatBytes(50 * MB), "50.0 MB");
});

test("formatBytes(50 МБ) дорівнює рівно '50.0 MB', а не 48.8", () => {
  // Раніше функція ділила на 2048, тому реальний ліміт показувався як 48.8 MB.
  assert.equal(Popup.formatBytes(50 * 1024 * 1024), "50.0 MB");
  assert.equal(Popup.formatBytes(50 * 1000 * 1000), "47.7 MB");
});

// Розпізнавання непридатних файлів (скановані PDF без текстового шару).
function extraction(overrides) {
  return Object.assign(
    { name: "book.pdf", pages: [], textLength: 0, charsPerPage: 0 },
    overrides
  );
}

test("нормальний підручник не дає попереджень", () => {
  const note = Popup.describeExtractionResult(
    extraction({
      pages: Array(259).fill({ text: "x" }),
      textLength: 259 * 1800,
      charsPerPage: 1800
    })
  );

  assert.equal(note, null);
});

test("скан без текстового шару розпізнається як непридатний", () => {
  const note = Popup.describeExtractionResult(
    extraction({
      pages: Array(200).fill({ text: "" }),
      textLength: 0,
      charsPerPage: 0
    })
  );

  assert.ok(note);
  assert.equal(note.type, "error");
  assert.match(note.message, /майже немає тексту|не знайдено тексту/);
  assert.match(note.message, /OCR|docx/);
});

test("частково розпізнаний PDF дає попередження, а не помилку", () => {
  const note = Popup.describeExtractionResult(
    extraction({
      pages: Array(50).fill({ text: "x" }),
      textLength: 50 * 80,
      charsPerPage: 80
    })
  );

  assert.ok(note);
  assert.equal(note.type, "warning");
  assert.match(note.message, /тексту мало/);
});

test("порожній файл без сторінок теж розпізнається", () => {
  const note = Popup.describeExtractionResult(
    extraction({ name: "empty.txt", pages: [], textLength: 0 })
  );

  assert.ok(note);
  assert.equal(note.type, "error");
  assert.match(note.message, /не знайдено тексту/);
});

test("маленький .txt без сторінок не вважається сканом", () => {
  const note = Popup.describeExtractionResult(
    extraction({ name: "notes.txt", pages: [], textLength: 500, charsPerPage: 500 })
  );

  assert.equal(note, null);
});
