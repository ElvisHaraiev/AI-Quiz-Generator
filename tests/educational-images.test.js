const test = require("node:test");
const assert = require("node:assert/strict");
const Images = require("../lib/educational-images.js");

test("detects Ukrainian and English", () => {
  assert.equal(
    Images.detectQuestionLanguage("Яка органела зображена на схемі клітини?"),
    "uk"
  );
  assert.equal(
    Images.detectQuestionLanguage("Which organelle is shown in the plant cell?"),
    "en"
  );
});

test("translates Ukrainian biology queries to English", () => {
  const english = Images.translateEducationalQuery(
    "рослинна клітина хлоропласт",
    "uk"
  );

  assert.match(english, /plant/i);
  assert.match(english, /cell/i);
  assert.match(english, /chloroplast/i);
  assert.equal(/[а-яіїєґ]/i.test(english), false);
});

test("keeps English search queries unchanged", () => {
  assert.equal(
    Images.translateEducationalQuery("mitochondrion electron microscope", "en"),
    "mitochondrion electron microscope"
  );
});

test("infers geometry instead of photo for triangles and angles", () => {
  assert.equal(
    Images.inferImageKind({
      question: "У прямокутному трикутнику ABC кут C = 90°. Чому дорівнює кут A, якщо кут B = 40°?"
    }),
    "geometry"
  );
  assert.equal(
    Images.inferImageKind({
      question: "Find the measure of angle AOB in the diagram."
    }),
    "geometry"
  );
});

test("infers photo for biology and history topics", () => {
  assert.equal(
    Images.inferImageKind({
      question: "Яка органела рослинної клітини відповідає за фотосинтез?",
      needsImage: true,
      imageSearchQuery: "хлоропласт"
    }),
    "photo"
  );
  assert.equal(
    Images.inferImageKind({
      question: "Which historical castle is shown in the photograph?",
      imageSearchQueryEn: "kamianets podilskyi castle"
    }),
    "photo"
  );
});

test("renders a right triangle SVG with matching labels", () => {
  const svg = Images.renderQuestionIllustration({
    question: "У прямокутному трикутнику ABC кут C = 90°, AB = c, AC = b.",
    imageKind: "geometry",
    geometrySpec: JSON.stringify({
      figure: "right_triangle",
      rightAngle: "C",
      sideLabels: [
        { side: "AB", text: "c" },
        { side: "AC", text: "b" }
      ],
      angleLabels: [{ vertex: "B", text: "40°" }]
    })
  });

  assert.ok(svg);
  assert.match(svg.svg, /<svg /);
  assert.match(svg.svg, />A</);
  assert.match(svg.svg, />B</);
  assert.match(svg.svg, />C</);
  assert.match(svg.svg, />c</);
  assert.match(svg.svg, />40°</);
  assert.match(svg.svg, /rect /);
  assert.equal(svg.kind, "geometry");
});

test("renders English equation as text, not a photo search", () => {
  const svg = Images.renderQuestionIllustration({
    question: "Solve the equation 2x + 3 = 11.",
    imageKind: "equation",
    geometrySpec: JSON.stringify({
      figure: "equation",
      equation: "2x + 3 = 11"
    })
  });

  assert.match(svg.svg, /2x \+ 3 = 11/);
  assert.equal(svg.kind, "equation");
});

test("labeling diagrams leave blanks instead of answers", () => {
  const svg = Images.renderQuestionIllustration({
    question: "Підпишіть частини рослинної клітини. Що позначено цифрою 1?",
    imageKind: "labeling",
    answers: ["ядро", "мембрана", "хлоропласт", "вакуоля"],
    correct: [0]
  });

  assert.match(svg.svg, />1</);
  assert.equal(svg.svg.includes("ядро"), false);
  assert.equal(svg.svg.includes("хлоропласт"), false);
});

test("English table blanks stay empty", () => {
  const svg = Images.renderQuestionIllustration({
    question: "Fill in the missing formulas in the table.",
    imageKind: "table",
    diagramSpec: JSON.stringify({
      type: "table",
      title: "Substances",
      headers: ["Substance", "Formula"],
      rows: [
        ["water", "___"],
        ["carbon dioxide", "___"]
      ]
    })
  });

  assert.match(svg.svg, /Substance/);
  assert.match(svg.svg, /water/);
  assert.equal(svg.svg.includes("H2O"), false);
});

test("rejects unrelated Wikimedia titles", () => {
  const question = {
    question: "Яка органела відповідає за фотосинтез?",
    imageSearchQuery: "хлоропласт",
    imageSearchQueryEn: "chloroplast diagram",
    imageKind: "photo"
  };
  const queries = Images.buildSearchQueries(question);
  const good = Images.scoreCandidateRelevance({
    question,
    queries,
    title: "Chloroplast diagram of a plant cell",
    description: "Educational diagram of chloroplast",
    tags: ["chloroplast", "plant"]
  });
  const bad = Images.scoreCandidateRelevance({
    question,
    queries,
    title: "Flag of Ukraine",
    description: "National flag",
    tags: ["flag"]
  });

  assert.ok(good >= Images.MIN_RELEVANCE_SCORE);
  assert.equal(Images.isRelevantCandidate(bad, "Flag of Ukraine", "National flag", question), false);
});

test("does not treat geometry questions as photo candidates", () => {
  const question = {
    question: "У трикутнику ABC кут C = 90°.",
    imageKind: "geometry"
  };

  assert.equal(
    Images.isRelevantCandidate(
      1,
      "Right triangle photo",
      "A photograph of a triangular road sign",
      question
    ),
    false
  );
});

test("selects a relevant Openverse/Wikimedia candidate via mocked fetch", async () => {
  const question = {
    question: "Which organelle is shown?",
    imageKind: "photo",
    imageSearchQuery: "chloroplast",
    imageSearchQueryEn: "chloroplast diagram"
  };

  async function fetchImpl(url) {
    const href = String(url);

    if (href.includes("commons.wikimedia.org") && href.includes("list=search")) {
      return {
        ok: true,
        json: async () => ({
          query: {
            search: [{ title: "File:Chloroplast-new.jpg" }]
          }
        })
      };
    }

    if (href.includes("commons.wikimedia.org") && href.includes("prop=imageinfo")) {
      return {
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "1": {
                title: "File:Chloroplast-new.jpg",
                imageinfo: [{
                  mime: "image/jpeg",
                  thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/chloroplast.jpg",
                  extmetadata: {
                    ImageDescription: { value: "Diagram of a chloroplast" },
                    Categories: { value: "Chloroplasts|Plant cells" }
                  }
                }]
              }
            }
          }
        })
      };
    }

    if (href.includes("api.openverse.org")) {
      return {
        ok: true,
        json: async () => ({
          results: [{
            title: "Random cat",
            description: "A cat",
            url: "https://live.staticflickr.com/cat.jpg",
            tags: [{ name: "cat" }]
          }]
        })
      };
    }

    throw new Error("unexpected url " + href);
  }

  const found = await Images.findRelevantPhoto(question, fetchImpl);

  assert.ok(found);
  assert.match(found.title, /Chloroplast/i);
  assert.match(found.downloadUrl, /upload\.wikimedia\.org/);
});

test("returns no photo when candidates are irrelevant", async () => {
  const question = {
    question: "Which organelle is shown?",
    imageKind: "photo",
    imageSearchQueryEn: "mitochondrion"
  };

  async function fetchImpl(url) {
    const href = String(url);

    if (href.includes("list=search")) {
      return {
        ok: true,
        json: async () => ({
          query: { search: [{ title: "File:Logo.png" }] }
        })
      };
    }

    if (href.includes("prop=imageinfo")) {
      return {
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "1": {
                title: "File:Logo.png",
                imageinfo: [{
                  mime: "image/png",
                  thumburl: "https://upload.wikimedia.org/wikipedia/commons/logo.png",
                  extmetadata: {
                    ImageDescription: { value: "Company logo" }
                  }
                }]
              }
            }
          }
        })
      };
    }

    return {
      ok: true,
      json: async () => ({ results: [] })
    };
  }

  const found = await Images.findRelevantPhoto(question, fetchImpl);
  assert.equal(found, null);
});

// Карти: \b у JS не працює після кирилиці, тому «карт[аиіу]\b» ніколи не
// спрацьовував — питання «Що позначено на карті?» не отримувало карту.
test("карта розпізнається в усіх відмінках", () => {
  ["Що позначено на карті?", "На карті показано межі областей",
   "Покажіть контурну карту", "Що таке карта?"].forEach((question) => {
    assert.equal(
      Images.hasMapIntent({ question }),
      true,
      `не розпізнано карту в «${question}»`
    );
  });
});

test("карта розпізнається англійською", () => {
  assert.equal(Images.hasMapIntent({ question: "What is shown on the map?" }), true);
  assert.equal(Images.hasMapIntent({ question: "Find the atlas page" }), true);
});

test("«картопля» і «картина» не вважаються картою", () => {
  ["Картопля — це овоч", "Знайдіть площу картини", "Хто написав цю картину?"]
    .forEach((question) => {
      assert.equal(
        Images.hasMapIntent({ question }),
        false,
        `хибне спрацювання на «${question}»`
      );
    });
});
