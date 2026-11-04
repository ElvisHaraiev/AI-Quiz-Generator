// content.js — міст між popup і сторінкою конструктора тестів.

(function () {
  "use strict";

  if (
    window.__quizGenContentV7Loaded
  ) {
    return;
  }

  window.__quizGenContentV7Loaded =
    true;

  function injectScript() {
    const existing =
      document.getElementById(
        "quizgen-injected-v7"
      );

    if (existing) {
      return;
    }

    const script =
      document.createElement(
        "script"
      );

    script.id =
      "quizgen-injected-v7";

    script.src =
      chrome.runtime.getURL(
        "injected.js"
      );

    script.onload = () => {
      console.log(
        "[AI Quiz Generator] injected.js loaded"
      );
    };

    script.onerror = () => {
      console.error(
        "[AI Quiz Generator] injected.js load failed"
      );
    };

    (
      document.head ||
      document.documentElement
    ).appendChild(script);
  }

  injectScript();

  chrome.runtime.onMessage.addListener(
    (
      request,
      sender,
      sendResponse
    ) => {
      if (request.action === "ping") {
        sendResponse({
          success: true,
          url: location.href
        });

        return false;
      }

      if (
        request.action ===
        "insertQuestions"
      ) {
        runPageOperation({
          dispatchEventName:
            "quizgen-insert",

          resultEventName:
            "quizgen-insert-result",

          payload: {
            questions:
              request.questions || []
          },

          timeoutMs:
            Math.max(
              60000,
              (
                request.questions
                  ?.length || 1
              ) *
                15000 +
                30000
            )
        })
          .then(sendResponse)
          .catch((error) => {
            sendResponse({
              success: false,

              error:
                error.message ||
                "Не вдалося вставити питання."
            });
          });

        return true;
      }

      if (
        request.action ===
        "cancelInsertedQuestions"
      ) {
        runPageOperation({
          dispatchEventName:
            "quizgen-cancel-insert",

          resultEventName:
            "quizgen-cancel-result",

          payload: {
            undoToken:
              request.undoToken ||
              null
          },

          timeoutMs: 90000
        })
          .then(sendResponse)
          .catch((error) => {
            sendResponse({
              success: false,

              error:
                error.message ||
                "Не вдалося скасувати вставку."
            });
          });

        return true;
      }

      return false;
    }
  );

  function runPageOperation({
    dispatchEventName,
    resultEventName,
    payload,
    timeoutMs
  }) {
    return new Promise(
      (resolve, reject) => {
        if (
          !location.href.includes(
            "naurok.com.ua/test/builder"
          )
        ) {
          reject(
            new Error(
              "Відкрийте сторінку конструктора тестів."
            )
          );

          return;
        }

        injectScript();

        const requestId =
          "quizgen_" +
          Date.now() +
          "_" +
          Math.floor(
            Math.random() *
            100000
          );

        const timeout =
          setTimeout(() => {
            cleanup();

            reject(
              new Error(
                "Час виконання завершився. Оновіть сторінку конструктора і повторіть спробу."
              )
            );
          }, timeoutMs);

        function cleanup() {
          clearTimeout(timeout);

          document.removeEventListener(
            resultEventName,
            handleResult
          );
        }

        function handleResult(
          event
        ) {
          const detail =
            event.detail || {};

          if (
            detail.requestId !==
            requestId
          ) {
            return;
          }

          cleanup();

          if (detail.error) {
            reject(
              new Error(
                detail.error
              )
            );

            return;
          }

          resolve({
            success: true,
            ...detail
          });
        }

        document.addEventListener(
          resultEventName,
          handleResult
        );

        setTimeout(() => {
          document.dispatchEvent(
            new CustomEvent(
              dispatchEventName,
              {
                detail: {
                  requestId,
                  ...payload
                }
              }
            )
          );
        }, 300);
      }
    );
  }
})();