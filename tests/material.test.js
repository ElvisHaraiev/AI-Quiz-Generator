// Тести підготовки матеріалу: очищення тексту, розбиття на частини
// та вибір частин за запитом користувача (тема, сторінка, ключові слова).

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const Material = require(path.join(__dirname, "..", "lib", "material.js"));

// Спрощений аналог сторінок, які повертає readPdfFile у popup.js.
const PAGES = [
  {
    number: 2,
    text:
      "1.1. ПОШУК ВІДОМОСТЕЙ В ІНТЕРНЕТІ. РОЗШИРЕНИЙ ПОШУК. " +
      "Пошукова система Google має кнопку Інструменти. " +
      "Фільтри призначено для відбору результатів."
  },
  {
    number: 8,
    text:
      "1.1. ПОШУК ВІДОМОСТЕЙ В ІНТЕРНЕТІ. " +
      "Під час пошуку важливо перевіряти достовірність джерел."
  },
  {
    number: 15,
    text:
      "Збирання даних для проведення досліджень. " +
      "перевірку достовірності зібраних даних; " +
      "1 .2. ÇÁÈÐÀÍÍß ÄÀÍÈÕ. ÏÅÐÅÂ І ÐÊÀ ÄÎÑÒÎÂ І ÐÍÎÑÒ І . " +
      "ÎÇÍÀÊÈ ÌÎÂÈ ÂÎÐÎÆÍÅ× І"
  },
  {
    number: 18,
    text:
      "Методи збирання даних можуть бути різними: спостереження за навколишнім " +
      "світом, опитування груп людей, опрацювання друкованих джерел. " +
      "Зібрані дані використовують для формулювання висновків."
  },
  {
    number: 25,
    text:
      "1.3. ÏÎØÓÊ ÀÓÄ І Î- ÒÀ Â І ÄÅÎÌÀÒÅÐ І ÀË І Â. " +
      "Розпізнавання фактів і фейків потребує перевірки джерел."
  },
  {
    number: 62,
    text:
      "2.1. ÀËÃÎÐÈÒÌÈ ÒÀ ÏÐÎÃÐÀÌÈ. " +
      "Алгоритм — це скінченна послідовність команд для виконавця."
  }
];

function buildPages(extra = []) {
  return [...PAGES, ...extra];
}

test("cleanMaterialText прибирає зайві пробіли навколо розділових знаків", () => {
  const input = "текст   з   зайвими пробілами ,  і   комами";
  const cleaned = Material.cleanMaterialText(input);

  assert.equal(cleaned, "текст з зайвими пробілами, і комами");
  assert.equal(/[ \t]{2,}/.test(cleaned), false, "подвійних пробілів не лишилось");
  assert.equal(cleaned.includes(" ,"), false, "пробіл перед комою прибрано");
});

test("cleanMaterialText склеює слово, розірване переносом", () => {
  assert.equal(
    Material.cleanMaterialText("дослі-\nдження даних"),
    "дослідження даних"
  );
});

test("cleanMaterialText не «дешифрує» символи зіпсованого шрифту", () => {
  // Без CMap вбудованого шрифту будь-яке перекодування лише псує текст,
  // тому символи мають залишитися точно як є.
  const broken = "ÇÁÈÐÀÍÍß ÄÀÍÈÕ";

  assert.equal(Material.cleanMaterialText(broken), broken);
  assert.equal(
    Material.cleanMaterialText("ñïîñòåðåæåííÿ çà íàâêîëèøí і ì ñâ і òîì"),
    "ñïîñòåðåæåííÿ çà íàâêîëèøí і ì ñâ і òîì"
  );
});

test("mojibakeRatio реагує саме на латиницю в кириличному тексті", () => {
  // «ÇÁÈÐÀÍÍß» — це кириличні літери з іншого діапазону, не латиниця,
  // тому це не ознака підстановки.
  assert.equal(Material.mojibakeRatio("ÇÁÈÐÀÍÍß ÄÀÍÈÕ"), 0);

  // «ñïîñòåðåæåííÿ» — латиниця там, де має бути кирилиця.
  const broken =
    "ñïîñòåðåæåííÿ çà íàâêîëèøí і ì ñâ і òîì ³íø³ ðå÷і òàêîæ";
  assert.ok(Material.mojibakeRatio(broken) > 0.8);
});

test("mojibakeRatio близький до нуля для нормального українського тексту", () => {
  const normal =
    "Збирання даних і перевірка достовірності інформації потрібні для висновків.";

  assert.ok(Material.mojibakeRatio(normal) < 0.1);
});

test("buildChunks не розриває сторінку посередині й зберігає номери", () => {
  const pages = buildPages();
  const chunks = Material.buildChunks(pages, { maxChars: 300 });

  assert.ok(chunks.length > 1, "має вийти кілька частин");
  assert.equal(chunks[0].pageFrom, 2);
  assert.equal(chunks[chunks.length - 1].pageTo, 62);

  chunks.forEach((chunk) => {
    assert.ok(chunk.chars <= 300, `частина ${chunk.index} перевищує ліміт`);
    assert.ok(chunk.pages.length >= 1);
    assert.match(chunk.text, /\[Сторінка \d+\]/);
  });

  // Кожна сторінка трапляється рівно один раз.
  const seen = chunks.flatMap((chunk) => chunk.pages);

  assert.equal(new Set(seen).size, seen.length);
});

test("buildChunks пропускає порожні сторінки", () => {
  const chunks = Material.buildChunks(
    [
      { number: 1, text: "" },
      { number: 2, text: "   " },
      { number: 3, text: "Текст" }
    ],
    { maxChars: 1000 }
  );

  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0].pages, [3]);
});

test("extractRequestedSections розпізнає тему, розділ і сторінку", () => {
  const fromTheme = Material.extractRequestedSections("зроби тест з теми 1.2");

  assert.deepEqual(fromTheme.sections, ["1.2"]);

  const fromSeveral = Material.extractRequestedSections(
    "питання за темами 1.1 та 2.3"
  );

  assert.deepEqual(fromSeveral.sections, ["1.1", "2.3"]);

  const fromPage = Material.extractRequestedSections("питання зі сторінки 18");

  assert.deepEqual(fromPage.pages, [18]);

  const fromRange = Material.extractRequestedSections("сторінки 15-18");

  assert.deepEqual(fromRange.pages, [15, 16, 17, 18]);
});

test("extractRequestedSections не плутає номер теми з номером у тексті", () => {
  // «10 питань» не має стати темою «10.…»
  const result = Material.extractRequestedSections("зроби 10 питань про клітину");

  assert.deepEqual(result.sections, []);
  assert.deepEqual(result.chapters, []);
});

test("extractRequestedSections розпізнає рівень розділу", () => {
  assert.deepEqual(
    Material.extractRequestedSections("зроби 10 питань за розділом 1").chapters,
    [1]
  );
  assert.deepEqual(
    Material.extractRequestedSections("питання з розділу 2").chapters,
    [2]
  );
  // «розділ 1.2» — це параграф, а не розділ
  assert.deepEqual(
    Material.extractRequestedSections("зроби тест за розділом 1.2").chapters,
    []
  );
});

test("expandChaptersToSections перетворює розділ на перший параграф", () => {
  const pages = [
    { number: 1, text: "1.1. ВСТУП ДО КУРСУ. Текст вступу.", fileIndex: 0 },
    { number: 2, text: "1.2. ОСНОВИ. Текст основ.", fileIndex: 0 },
    { number: 3, text: "2.1. НОВИЙ РОЗДІЛ. Текст.", fileIndex: 0 }
  ];
  const chunks = Material.buildChunks(pages, { maxChars: 1000 });

  assert.deepEqual(Material.expandChaptersToSections(chunks, [1]), ["1.1"]);
  assert.deepEqual(Material.expandChaptersToSections(chunks, [2]), ["2.1"]);
  assert.deepEqual(Material.expandChaptersToSections(chunks, [9]), []);
});

test("selectChunksForPrompt обирає матеріал за назвою розділу", () => {
  const pages = [
    { number: 1, text: "1.1. ВСТУП ДО КУРСУ. Текст вступу про курс.", fileIndex: 0 },
    { number: 2, text: "1.2. ОСНОВИ АЛГОРИТМІВ. Текст про алгоритми.", fileIndex: 0 },
    { number: 3, text: "2.1. ІНШИЙ РОЗДІЛ. Текст іншого розділу.", fileIndex: 0 }
  ];
  const chunks = Material.buildChunks(pages, { maxChars: 1000 });
  const selection = Material.selectChunksForPrompt(chunks, "зроби тест за розділом 1", {
    maxChunks: 3
  });

  assert.equal(selection.strategy, "chapter");
  assert.ok(selection.selected.length >= 1);
  assert.ok(selection.selected[0].text.includes("ВСТУП"));
});

test("findHeadingOccurrences знаходить заголовок теми за великими літерами", () => {
  const chunks = Material.buildChunks(buildPages(), { maxChars: 300 });
  const occurrences = Material.findHeadingOccurrences(chunks, "1.2");

  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].page, 15);
});

test("findHeadingOccurrences ігнорує підпис рисунка «мал. 1.2»", () => {
  const pages = [
    {
      number: 9,
      text:
        "Після її вибору відображаються списки (мал. 1.2). " +
        "Ма л. 1.2. Списки з інструментами пошуку"
    }
  ];

  const chunks = Material.buildChunks(pages, { maxChars: 1000 });

  assert.equal(Material.findHeadingOccurrences(chunks, "1.2").length, 0);
});

test("looksLikeHeadingTail відрізняє заголовок від продовження речення", () => {
  // Заголовки різних стилів.
  assert.equal(Material.looksLikeHeadingTail("ÇÁÈÐÀÍÍß ÄÀÍÈÕ."), true);
  assert.equal(Material.looksLikeHeadingTail("Квадратні рівняння"), true);
  assert.equal(Material.looksLikeHeadingTail("Списки з інструментами пошуку"), true);
  assert.equal(Material.looksLikeHeadingTail("КИСЛОТИ"), true);

  // Не заголовки.
  assert.equal(Material.looksLikeHeadingTail(""), false);
  assert.equal(Material.looksLikeHeadingTail("аб"), false);
  assert.equal(
    Material.looksLikeHeadingTail("продовження речення з малої літери"),
    false
  );

  // Явний маркер теми робить заголовком навіть короткий текст.
  assert.equal(
    Material.looksLikeHeadingTail("Кислоти", { hasMarker: true }),
    true
  );
});

test("підпис рисунка не вважається заголовком теми", () => {
  // Навіть якщо текст підпису схожий на заголовок, його відсіює
  // перевірка «мал./рис./табл.» у findHeadingOccurrences.
  const pages = [
    {
      number: 9,
      text:
        "Після її вибору відображаються списки (мал. 1.2). " +
        "Ма л. 1.2. Списки з інструментами пошуку " +
        "текст сторінки. ".repeat(50),
      fileIndex: 0
    }
  ];

  const chunks = Material.buildChunks(pages, { maxChars: 12000 });

  assert.equal(Material.findHeadingOccurrences(chunks, "1.2").length, 0);
});

test("selectChunksForPrompt обирає частину із заданою темою", () => {
  const chunks = Material.buildChunks(buildPages(), { maxChars: 300 });
  const selection = Material.selectChunksForPrompt(chunks, "тема 1.2", {
    maxChunks: 1
  });

  assert.equal(selection.strategy, "section");
  assert.equal(selection.selected.length, 1);

  const chunk = selection.selected[0];

  assert.ok(
    chunk.pages.includes(15),
    `частина має містити сторінку 15, а містить ${chunk.pages.join(",")}`
  );
  assert.ok(chunk.text.includes("1.2") || chunk.text.includes("1 .2"));
});

test("selectChunksForPrompt додає наступні частини, доки вистачає бюджету", () => {
  const chunks = Material.buildChunks(buildPages(), { maxChars: 300 });
  const selection = Material.selectChunksForPrompt(chunks, "тема 1.2", {
    maxChunks: 3,
    maxChars: 10000
  });

  assert.equal(selection.strategy, "section");
  assert.ok(
    selection.selected.length > 1,
    "тема має продовжуватися на сусідні частини"
  );

  // Частини йдуть підряд за номерами.
  const indexes = selection.selected.map((chunk) => chunk.index);

  assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
});

test("selectChunksForPrompt поважає бюджет символів", () => {
  const chunks = Material.buildChunks(buildPages(), { maxChars: 300 });
  const selection = Material.selectChunksForPrompt(chunks, "тема 1.2", {
    maxChunks: 10,
    maxChars: 400
  });

  const totalChars = selection.selected.reduce((sum, chunk) => sum + chunk.chars, 0);

  assert.ok(totalChars <= 400, `витрачено ${totalChars} символів`);
});

test("selectChunksForPrompt обирає частину за названою сторінкою", () => {
  const chunks = Material.buildChunks(buildPages(), { maxChars: 300 });
  const selection = Material.selectChunksForPrompt(chunks, "питання зі сторінки 25", {
    maxChunks: 1
  });

  assert.equal(selection.strategy, "page");
  assert.ok(selection.selected[0].pages.includes(25));
});

test("selectChunksForPrompt без теми падає на ключові слова", () => {
  const chunks = Material.buildChunks(buildPages(), { maxChars: 300 });
  const selection = Material.selectChunksForPrompt(
    chunks,
    "зроби тест про достовірність даних",
    { maxChunks: 2 }
  );

  assert.equal(selection.strategy, "keywords");
  assert.ok(selection.selected.length > 0);
});

test("selectChunksForPrompt без матеріалу повертає порожній результат", () => {
  const selection = Material.selectChunksForPrompt([], "тема 1.2", { maxChunks: 1 });

  assert.equal(selection.strategy, "empty");
  assert.deepEqual(selection.selected, []);
});

test("describeCoverage показує, що матеріал опрацьовано частково", () => {
  const chunks = Material.buildChunks(buildPages(), { maxChars: 300 });
  const selection = Material.selectChunksForPrompt(chunks, "тема 1.2", {
    maxChunks: 1
  });
  const coverage = Material.describeCoverage(selection.selected, chunks.length);

  assert.equal(coverage.totalCount, chunks.length);
  assert.equal(coverage.selectedCount, 1);
  assert.equal(coverage.partial, true);
  assert.ok(coverage.selectedPages >= 1);
});

test("formatPageRange форматує одну сторінку й діапазон", () => {
  assert.equal(
    Material.formatPageRange({ pageFrom: 5, pageTo: 5 }),
    "с. 5"
  );
  assert.equal(
    Material.formatPageRange({ pageFrom: 5, pageTo: 9 }),
    "с. 5–9"
  );
  assert.equal(Material.formatPageRange(null), "");
});

// --- Універсальність: підручники різних предметів і форматів ---
//
// Заголовки в українських підручниках оформлюють по-різному, тому
// перевіряємо шість поширених стилів.

const HEADING_FORMATS = {
  // «1.2. ЗБИРАННЯ ДАНИХ» — великі літери (інформатика)
  uppercase: (num, title) => `${num}. ${title.toUpperCase()} `,
  // «2.3. Нерівності» — великі перші літери (математика)
  titleCase: (num, title) => `${num}. ${title} `,
  // «§ 3. Солі» — знак параграфа (хімія)
  paragraphSign: (num, title) => `§ ${num.split(".")[1]}. ${title} `,
  // «Урок 4. Задачі» — уроки (молодші класи)
  lesson: (num, title) => `Урок ${num.split(".")[1]}. ${title} `,
  // «3 . 2 . ЧОТИРИКУТНИКИ» — пробіли навколо крапки
  spacedDots: (num, title) => `${num.replace(".", " . ")}. ${title.toUpperCase()} `,
  // «Тема 1.3. Органи» — тема словами
  themeWord: (num, title) => `Тема ${num}. ${title} `
};

function buildFormattedBook({ format, chapter, titles }) {
  const make = HEADING_FORMATS[format];

  return titles.map((title, index) => ({
    number: index + 1,
    sourcePage: index + 1,
    text: `${make(`${chapter}.${index + 1}`, title)}${"Текст параграфа. ".repeat(300)}`,
    fileName: `${format}.pdf`,
    fileIndex: 0
  }));
}

Object.entries(HEADING_FORMATS).forEach(([format, make]) => {
  test(`тему знайдено у форматі заголовків «${format}»`, () => {
    const titles = ["Перша тема", "Друга тема", "Третя тема", "Четверта тема"];
    const pages = buildFormattedBook({ format, chapter: 1, titles });
    const chunks = Material.buildChunks(pages, { maxChars: 12000 });

    titles.forEach((title, index) => {
      const section = `1.${index + 1}`;
      const selection = Material.selectChunksForPrompt(
        chunks,
        `зроби 5 питань за темою ${section}`,
        { maxChunks: 3, maxChars: 30000 }
      );

      const marker = make(section, title).trim().toLowerCase();

      const found = selection.selected.some((chunk) => {
        const text = chunk.text
          .replace(/\s*([.,])\s*/g, "$1")
          .replace(/\s+/g, " ")
          .toLowerCase();

        return text.includes(marker.replace(/\s*([.,])\s*/g, "$1").replace(/\s+/g, " "));
      });

      assert.ok(
        found,
        `формат ${format}: заголовок «${title}» не потрапив у вибрані частини ` +
        `(стратегія ${selection.strategy})`
      );
    });
  });
});

test("тема, задана простим номером (§ 12), знаходиться в наскрізній нумерації", () => {
  const pages = [];

  for (let number = 1; number <= 5; number++) {
    pages.push({
      number,
      sourcePage: number,
      text: `§ ${number}. Тема ${number} ${"Текст. ".repeat(300)}`,
      fileName: "chemistry.pdf",
      fileIndex: 0
    });
  }

  const chunks = Material.buildChunks(pages, { maxChars: 12000 });
  const selection = Material.selectChunksForPrompt(chunks, "зроби тест за § 3", {
    maxChunks: 3,
    maxChars: 30000
  });

  assert.ok(
    selection.selected.some((chunk) => chunk.text.includes("Тема 3")),
    "має бути обрана тема з номером 3"
  );
});

test("«10 питань» не сприймається як параграф", () => {
  const result = Material.extractRequestedSections("зроби 10 питань про клітину");

  assert.deepEqual(result.sections, []);
  assert.deepEqual(result.chapters, []);
});

// Найважливіший випадок: номер теми трапляється і в підписі рисунка,
// і в назві практичного завдання, і як справжній заголовок. Обрати треба
// саме заголовок.
test("справжній заголовок перемагає підпис рисунка та назву завдання", () => {
  const pages = [
    {
      number: 10,
      sourcePage: 10,
      text:
        "Ç à- êëàäêó äîäàíî (ìàë.1.6). Ùîá ï і äòâåðäèòè ñòâîðåííÿ çàêëàäêè " +
        "òåêñò ñòîð і íêè. ".repeat(60),
      fileName: "book.pdf",
      fileIndex: 0
    },
    {
      number: 12,
      sourcePage: 12,
      text:
        "ó ôàéë і ç і ìåíåì çàâäàííÿ 1.1.6.docx Ñòâîð і òü ïðåçåíòàö і þ " +
        "òåêñò ñòîð і íêè. ".repeat(60),
      fileName: "book.pdf",
      fileIndex: 0
    },
    {
      number: 52,
      sourcePage: 52,
      text:
        " â іä 1.6. ÑÒÂÎÐÅÍÍß ÎÍËÀÉÍ-ÄÎÊÓÌÅÍÒ І Â І ÊÅÐÓÂÀÍÍß ÄÎÑÒÓÏÎÌ " +
        "Ïðèãàäàéòå òà ïîâòîð і òü. ".repeat(60),
      fileName: "book.pdf",
      fileIndex: 0
    }
  ];

  const chunks = Material.buildChunks(pages, { maxChars: 4000 });
  const occurrences = Material.findHeadingOccurrences(chunks, "1.6");

  assert.ok(occurrences.length >= 1, "заголовок має бути знайдений");

  // Справжній заголовок має найвищий бал.
  const best = [...occurrences].sort((a, b) => b.score - a.score)[0];

  assert.equal(best.page, 52, `обрано сторінку ${best.page}, а має бути 52`);
  assert.ok(best.score >= 8, `бал заголовка ${best.score} замало`);

  // І він має потрапити у вибір, а не сторінка з підписом рисунка.
  const selection = Material.selectChunksForPrompt(
    chunks,
    "зроби 5 питань за темою 1.6",
    { maxChunks: 2, maxChars: 30000 }
  );

  assert.ok(
    selection.selected.some((chunk) => chunk.pages.includes(52)),
    "у вибір має потрапити сторінка справжнього заголовка"
  );
});

test("isReferenceNumber-поведінка: номер після «мал.» не є заголовком", () => {
  const pages = [
    {
      number: 5,
      sourcePage: 5,
      text:
        "ìàë. 2.3. Ñïèñêè ç іíñòðóìåíòàìè ïîøóêó " + "òåêñò. ".repeat(200),
      fileName: "book.pdf",
      fileIndex: 0
    }
  ];

  const chunks = Material.buildChunks(pages, { maxChars: 12000 });

  assert.equal(Material.findHeadingOccurrences(chunks, "2.3").length, 0);
});

test("«параграф 1 4» та «тема 1 4» розпізнаються як параграф 1.4", () => {
  ["параграф 1 4", "тема 1 4", "з теми 1 4", "за темою 1 4"].forEach((prompt) => {
    assert.deepEqual(
      Material.extractRequestedSections(prompt).sections,
      ["1.4"],
      `запит: ${prompt}`
    );
  });
});

test("«розділ 1 4 параграф» — це параграф, а не розділ", () => {
  const result = Material.extractRequestedSections("трозділ 1 4 параграф");

  assert.deepEqual(result.sections, ["1.4"]);
  assert.deepEqual(result.chapters, []);
});

test("«розділ 1» без другого числа лишається розділом", () => {
  const result = Material.extractRequestedSections("питання за розділом 1");

  assert.deepEqual(result.sections, []);
  assert.deepEqual(result.chapters, [1]);
});

// --- Алгебра та геометрія: параграфи задано одним числом (§ 3) ---

function buildMathBook(lines, fileName) {
  const body = "Текст параграфа з правилами та прикладами. ".repeat(120);

  return lines.map((line, index) => ({
    number: index + 1,
    sourcePage: index + 1,
    text: `${line} ${body}`,
    fileName,
    fileIndex: 0
  }));
}

const ALGEBRA_LINES = [
  "Розділ 1. ЦІЛІ ВИРАЗИ",
  "§ 1. Одночлени.",
  "§ 2. Многочлени.",
  "§ 3. Формули скороченого множення.",
  "Розділ 2. ДРОБОВІ ВИРАЗИ",
  "§ 4. Раціональні дроби.",
  "§ 5. Додавання дробів."
];

const GEOMETRY_LINES = [
  "Розділ 1. ЕЛЕМЕНТАРНІ ФІГУРИ",
  "§ 1. Точка, пряма, відрізок.",
  "§ 2. Кути. Вимірювання кутів.",
  "§ 3. Суміжні та вертикальні кути.",
  "Розділ 2. ТРИКУТНИКИ",
  "§ 4. Ознаки рівності трикутників.",
  "§ 5. Рівнобедрений трикутник."
];

test("«§ 3» вибирає саме третій параграф", () => {
  const chunks = Material.buildChunks(buildMathBook(ALGEBRA_LINES, "algebra.pdf"), {
    maxChars: 12000
  });

  const selection = Material.selectChunksForPrompt(chunks, "зроби 10 питань за § 3", {
    maxChunks: 2,
    maxChars: 30000
  });

  assert.equal(selection.strategy, "paragraph");
  assert.ok(
    selection.selected.some((chunk) => chunk.text.includes("Формули скороченого множення")),
    "має бути обраний параграф § 3"
  );
});

test("«розділ 2» у книзі з § вибирає перший параграф цього розділу", () => {
  const chunks = Material.buildChunks(buildMathBook(GEOMETRY_LINES, "geometry.pdf"), {
    maxChars: 12000
  });

  const selection = Material.selectChunksForPrompt(chunks, "зроби 10 питань за розділом 2", {
    maxChunks: 3,
    maxChars: 30000
  });

  assert.equal(selection.strategy, "chapter");
  assert.ok(
    selection.selected.some((chunk) => chunk.text.includes("Ознаки рівності трикутників")),
    "розділ 2 починається з § 4"
  );
  assert.ok(
    !selection.selected.some((chunk) => chunk.text.includes("ЦІЛІ ВИРАЗИ")),
    "матеріал першого розділу не має потрапляти"
  );
});

test("індекс параграфів правильно відносить § до розділів", () => {
  const chunks = Material.buildChunks(buildMathBook(ALGEBRA_LINES, "algebra.pdf"), {
    maxChars: 12000
  });

  assert.deepEqual(Material.sectionsOfChapter(chunks, 1), ["1", "2", "3"]);
  assert.deepEqual(Material.sectionsOfChapter(chunks, 2), ["4", "5"]);
  assert.deepEqual(Material.expandChaptersToSections(chunks, [2]), ["4"]);
});

test("«§ 1.2» не дає зайвого параграфа «1»", () => {
  assert.deepEqual(Material.extractRequestedSections("§ 1.2. Дроби").sections, ["1.2"]);
  assert.deepEqual(Material.extractRequestedSections("тема 1.2").sections, ["1.2"]);
  assert.deepEqual(Material.extractRequestedSections("§ 12").sections, ["12"]);
  assert.deepEqual(Material.extractRequestedSections("§ 3").sections, ["3"]);
});

test("«параграф 1 4» не дає зайвого параграфа «1»", () => {
  assert.deepEqual(Material.extractRequestedSections("параграф 1 4").sections, ["1.4"]);
});

test("зображення для алгебри: формула, графік і рівняння — схеми, не фото", () => {
  const Images = require(path.join(__dirname, "..", "lib", "educational-images.js"));

  const formula = Images.detectImageIntent({
    question: "За якою формулою розкладають різницю квадратів?",
    imageKind: "photo", needsImage: true,
    imageSearchQueryEn: "difference of squares formula"
  });

  assert.ok(
    Images.GENERATED_KINDS.has(formula.kind),
    `формула має бути схемою, а не фото (отримано ${formula.kind})`
  );

  const graph = Images.detectImageIntent({
    question: "Побудуйте графік функції y = 2x − 3.",
    imageKind: "photo", needsImage: true,
    imageSearchQueryEn: "linear function graph",
    geometrySpec: JSON.stringify({ figure: "graph" })
  });

  assert.ok(Images.GENERATED_KINDS.has(graph.kind), "графік має бути схемою");
});

test("зображення для геометрії: фігури — схеми, а не фото", () => {
  const Images = require(path.join(__dirname, "..", "lib", "educational-images.js"));

  [
    "У рівнобедреному трикутнику кут при вершині 40°. Знайдіть кут при основі.",
    "Знайдіть суміжний кут, якщо один із суміжних кутів дорівнює 65°.",
    "Прямі a і b паралельні, січна утворює кут 50°. Який відповідний кут?"
  ].forEach((question) => {
    const intent = Images.detectImageIntent({
      question,
      imageKind: "photo",
      needsImage: true,
      imageSearchQueryEn: "geometry figure"
    });

    assert.ok(
      Images.GENERATED_KINDS.has(intent.kind),
      `геометрія має бути схемою, а не фото: «${question}» → ${intent.kind}`
    );
  });
});

// Ізоляція одного параграфа: коли користувач просить «§ 14», модель не має
// бачити § 15, навіть якщо вони в одній частині матеріалу.
test("запит «§ 14» не підмішує сусідній параграф § 15", () => {
  const body = "Текст параграфа з правилами та прикладами розв'язування. ".repeat(90);

  const pages = [
    {
      number: 114,
      sourcePage: 114,
      text:
        `§ 14. Множення многочлена на многочлен ${body}` +
        "Правило множення многочлена на многочлен. Приклади.",
      fileName: "algebra.pdf",
      fileIndex: 0
    },
    {
      number: 118,
      sourcePage: 118,
      text: `§ 15. Розкладання многочлена на множники способом групування ${body}`,
      fileName: "algebra.pdf",
      fileIndex: 0
    }
  ];

  const chunks = Material.buildChunks(pages, { maxChars: 12000 });
  const selection = Material.selectChunksForPrompt(chunks, "зроби 10 питань за § 14", {
    maxChunks: 2,
    maxChars: 30000
  });

  assert.equal(selection.strategy, "paragraph");
  assert.equal(selection.selected.length, 1, "має бути лише одна частина");

  const text = selection.selected[0].text;

  assert.match(text, /Множення многочлена на многочлен/);
  assert.doesNotMatch(
    text,
    /Розкладання многочлена на множники способом групування/,
    "текст не має містити наступний параграф"
  );
});

test("запит «§ 15» не підмішує попередній параграф", () => {
  const body = "Текст параграфа. ".repeat(90);

  const pages = [
    {
      number: 114,
      sourcePage: 114,
      text: `§ 14. Множення многочлена на многочлен ${body}`,
      fileName: "algebra.pdf",
      fileIndex: 0
    },
    {
      number: 118,
      sourcePage: 118,
      text:
        `§ 15. Розкладання многочлена на множники способом групування ${body}` +
        "Спосіб групування. Приклади.",
      fileName: "algebra.pdf",
      fileIndex: 0
    }
  ];

  const chunks = Material.buildChunks(pages, { maxChars: 12000 });
  const selection = Material.selectChunksForPrompt(chunks, "зроби 10 питань за § 15", {
    maxChunks: 2,
    maxChars: 30000
  });

  const text = selection.selected.map((chunk) => chunk.text).join(" ");

  assert.match(text, /Розкладання многочлена на множники способом групування/);
  assert.doesNotMatch(text, /§ 14\./);
});

test("графіки функцій для алгебри: парабола, гіпербола, модуль, пряма", () => {
  const Images = require(path.join(__dirname, "..", "lib", "educational-images.js"));

  const functions = [
    { type: "line", a: 2, b: -3 },
    { type: "parabola", a: 1, b: 0, c: 0 },
    { type: "parabola", a: 1, b: -4, c: 3 },
    { type: "hyperbola", k: 6 },
    { type: "abs", a: 1 },
    { type: "cubic", a: 1 }
  ];

  functions.forEach((fn) => {
    const illustration = Images.renderQuestionIllustration({
      question: `Побудуйте графік функції (${fn.type})`,
      imageKind: "geometry",
      geometrySpec: JSON.stringify({ figure: "graph", grid: true, functions: [fn] }),
      needsImage: true
    });

    assert.ok(illustration, `графік для ${fn.type} не намальовано`);
    assert.match(illustration.svg, /<svg /);
    assert.match(illustration.svg, /<path /, `крива для ${fn.type} відсутня`);
    assert.equal(illustration.kind, "geometry");
  });
});

test("графік малює дві функції одночасно", () => {
  const Images = require(path.join(__dirname, "..", "lib", "educational-images.js"));

  const illustration = Images.renderQuestionIllustration({
    question: "Побудуйте графіки функцій y = x і y = x²",
    imageKind: "geometry",
    geometrySpec: JSON.stringify({
      figure: "graph",
      functions: [
        { type: "line", a: 1, b: 0 },
        { type: "parabola", a: 1, b: 0, c: 0, color: "#c0392b" }
      ]
    }),
    needsImage: true
  });

  const curves = (illustration.svg.match(/<path /g) || []).length;

  assert.equal(curves, 2, "має бути дві криві");
});
