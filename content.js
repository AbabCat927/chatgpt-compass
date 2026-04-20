(() => {
  if (window.__chatgptCompassLoaded) {
    return;
  }
  window.__chatgptCompassLoaded = true;

  const EXTENSION_NS = "chatgpt-compass";
  const DEFAULT_SETTINGS = {
    enableRoundNavigator: true,
    autoRefreshOnRouteChange: true
  };
  const SELECTORS = {
    main: "main",
    roleMessage: "[data-message-author-role]",
    conversationTurn: "article[data-testid^='conversation-turn-']"
  };
  const MATH_SELECTORS = [
    ".katex",
    ".katex-display",
    "math",
    "mjx-container"
  ].join(", ");

  const state = {
    url: location.href,
    settings: { ...DEFAULT_SETTINGS },
    navRoot: null,
    rounds: [],
    activeRoundId: null,
    hoverRoundId: null,
    hoverClearTimer: 0,
    formulaClickTimer: 0,
    pendingFormulaNode: null,
    markedRounds: {},
    mutationObserver: null,
    scrollHandler: null,
    bootTimer: 0,
    storageListener: null
  };

  function debounce(fn, wait) {
    let timer = 0;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), wait);
    };
  }

  function formatTimestamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join("-") + "_" + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("-");
  }

  function sanitizeFileSegment(value) {
    return (value || "chatgpt-conversation")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "chatgpt-conversation";
  }

  function getConversationKey() {
    const path = location.pathname || "/";
    return `conversation:${path}`;
  }

  function detectConversationTitle() {
    const explicit = document.querySelector("h1");
    const title = explicit?.textContent?.trim() || document.title || "ChatGPT Conversation";
    return title.replace(/\s*[|·-]\s*ChatGPT\s*$/i, "").trim() || "ChatGPT Conversation";
  }

  function buildFilename(ext) {
    return `${sanitizeFileSegment(detectConversationTitle())}_${formatTimestamp()}.${ext}`;
  }

  function getMainContainer() {
    return document.querySelector(SELECTORS.main);
  }

  function getRoleNodes() {
    const main = getMainContainer();
    if (!main) {
      return [];
    }

    const direct = [...main.querySelectorAll(SELECTORS.roleMessage)];
    if (direct.length) {
      return direct;
    }

    const turns = [...main.querySelectorAll(SELECTORS.conversationTurn)];
    return turns.flatMap((turn) => {
      const role = turn.querySelector(SELECTORS.roleMessage);
      if (role) {
        return [role];
      }
      return [];
    });
  }

  function getRoleFromNode(node) {
    const value = node.getAttribute("data-message-author-role");
    if (value === "assistant" || value === "user" || value === "system") {
      return value;
    }
    return "assistant";
  }

  function isLikelyControlNode(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    const text = node.textContent?.trim() || "";
    const aria = node.getAttribute("aria-label") || "";
    const title = node.getAttribute("title") || "";
    const role = node.getAttribute("role") || "";
    const joined = `${text} ${aria} ${title}`.toLowerCase();
    return (
      role === "button" ||
      node.tagName === "BUTTON" ||
      node.tagName === "TEXTAREA" ||
      node.tagName === "INPUT" ||
      node.tagName === "FORM" ||
      joined.includes("copy") ||
      joined.includes("regenerate") ||
      joined.includes("good response") ||
      joined.includes("bad response") ||
      joined.includes("share") ||
      joined.includes("edit message") ||
      joined.includes("read aloud")
    );
  }

  function cloneMessageContent(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll("button, textarea, input, form, nav, aside, footer, [contenteditable='true']").forEach((el) => el.remove());
    clone.querySelectorAll("*").forEach((el) => {
      if (!(el instanceof HTMLElement)) {
        return;
      }
      if (el.hidden || el.getAttribute("aria-hidden") === "true" || isLikelyControlNode(el)) {
        el.remove();
      }
    });
    return clone;
  }

  function messageNodeToHtml(node) {
    const clone = cloneMessageContent(node);
    return clone.innerHTML.trim();
  }

  function normalizeFormulaSource(value) {
    return (value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findFormulaContainer(target) {
    if (!(target instanceof Element)) {
      return null;
    }
    return target.closest(MATH_SELECTORS);
  }

  function extractFormulaSource(formulaNode) {
    if (!(formulaNode instanceof Element)) {
      return "";
    }

    const annotation = formulaNode.querySelector("annotation[encoding='application/x-tex'], annotation");
    const annotationText = normalizeFormulaSource(annotation?.textContent || "");
    if (annotationText) {
      return annotationText;
    }

    const katexMathml = formulaNode.querySelector(".katex-mathml annotation");
    const katexMathmlText = normalizeFormulaSource(katexMathml?.textContent || "");
    if (katexMathmlText) {
      return katexMathmlText;
    }

    const labelled = formulaNode.matches("[aria-label]") ? formulaNode : formulaNode.querySelector("[aria-label]");
    const ariaLabel = normalizeFormulaSource(labelled?.getAttribute("aria-label") || "");
    if (ariaLabel) {
      return ariaLabel;
    }

    for (const attr of ["data-tex", "data-latex", "data-formula", "data-equation"]) {
      const value = normalizeFormulaSource(formulaNode.getAttribute(attr) || "");
      if (value) {
        return value;
      }
    }

    return "";
  }

  function isDisplayFormula(formulaNode) {
    if (!(formulaNode instanceof Element)) {
      return false;
    }
    return (
      formulaNode.classList.contains("katex-display") ||
      formulaNode.closest(".katex-display") !== null ||
      formulaNode.getAttribute("display") === "block" ||
      formulaNode.getAttribute("mode") === "display" ||
      formulaNode.tagName === "MJX-CONTAINER" && formulaNode.getAttribute("display") === "true"
    );
  }

  function formatFormulaForMarkdown(source, displayMode) {
    const trimmed = normalizeFormulaSource(source);
    if (!trimmed) {
      return "";
    }
    return displayMode ? `$$\n${trimmed}\n$$` : `$${trimmed}$`;
  }

  function normalizeText(value) {
    return value.replace(/\u00a0/g, " ").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  }

  function escapeMarkdownText(text) {
    return text.replace(/\\/g, "\\\\");
  }

  function escapeXml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function escapeInlineMarkdown(text) {
    return text.replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
  }

  function indentMultiline(text, prefix) {
    return text
      .split("\n")
      .map((line) => `${prefix}${line}`)
      .join("\n");
  }

  function tableToMarkdown(table) {
    const rows = [...table.querySelectorAll("tr")].map((row) =>
      [...row.children].map((cell) => normalizeText(cell.innerText || "").replace(/\n+/g, "<br>").trim())
    );
    if (!rows.length) {
      return "";
    }
    const header = rows[0];
    const divider = header.map(() => "---");
    const body = rows.slice(1);
    return [
      `| ${header.join(" | ")} |`,
      `| ${divider.join(" | ")} |`,
      ...body.map((row) => `| ${row.join(" | ")} |`)
    ].join("\n");
  }

  function inlineToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeMarkdownText(node.textContent || "");
    }
    if (!(node instanceof HTMLElement)) {
      return "";
    }

    if (node.tagName === "BR") {
      return "  \n";
    }
    if (node.tagName === "CODE" && node.parentElement?.tagName !== "PRE") {
      return `\`${normalizeText(node.innerText || node.textContent || "")}\``;
    }
    if (node.tagName === "STRONG" || node.tagName === "B") {
      return `**${[...node.childNodes].map(inlineToMarkdown).join("")}**`;
    }
    if (node.tagName === "EM" || node.tagName === "I") {
      return `*${[...node.childNodes].map(inlineToMarkdown).join("")}*`;
    }
    if (node.tagName === "A") {
      const text = normalizeText(node.innerText || node.textContent || "").trim() || node.href;
      const href = node.getAttribute("href") || "";
      if (!href) {
        return text;
      }
      return `[${text}](${href})`;
    }
    if (node.tagName === "IMG") {
      const alt = node.getAttribute("alt") || "image";
      const src = node.getAttribute("src") || "";
      return src ? `![${alt}](${src})` : `[Image: ${alt}]`;
    }

    return [...node.childNodes].map(inlineToMarkdown).join("");
  }

  function blockToMarkdown(node, depth = 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeText(node.textContent || "").trim();
      return text ? `${escapeInlineMarkdown(text)}\n\n` : "";
    }
    if (!(node instanceof HTMLElement)) {
      return "";
    }

    const tag = node.tagName;

    if (tag === "PRE") {
      const codeNode = node.querySelector("code");
      const code = normalizeText(codeNode?.innerText || node.innerText || "");
      const className = codeNode?.className || "";
      const langMatch = className.match(/language-([a-z0-9+-]+)/i);
      const lang = langMatch?.[1] || "";
      return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    }

    if (tag === "TABLE") {
      return `${tableToMarkdown(node)}\n\n`;
    }

    if (/^H[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      return `${"#".repeat(level)} ${normalizeText(node.innerText || "").trim()}\n\n`;
    }

    if (tag === "P") {
      const text = [...node.childNodes].map(inlineToMarkdown).join("").trim();
      return text ? `${text}\n\n` : "";
    }

    if (tag === "BLOCKQUOTE") {
      const text = normalizeText(node.innerText || "").trim();
      return text ? `${indentMultiline(text, "> ")}\n\n` : "";
    }

    if (tag === "UL" || tag === "OL") {
      const items = [...node.children]
        .filter((child) => child.tagName === "LI")
        .map((child, index) => listItemToMarkdown(child, depth, tag === "OL" ? index + 1 : null))
        .join("");
      return `${items}\n`;
    }

    if (tag === "HR") {
      return `---\n\n`;
    }

    if (tag === "DETAILS") {
      const text = normalizeText(node.innerText || "").trim();
      return text ? `${text}\n\n` : "";
    }

    const hasBlockChildren = [...node.children].some((child) =>
      ["P", "PRE", "UL", "OL", "BLOCKQUOTE", "TABLE", "H1", "H2", "H3", "H4", "H5", "H6"].includes(child.tagName)
    );

    if (!hasBlockChildren) {
      const text = [...node.childNodes].map(inlineToMarkdown).join("").trim();
      return text ? `${text}\n\n` : "";
    }

    return [...node.childNodes].map((child) => blockToMarkdown(child, depth)).join("");
  }

  function listItemToMarkdown(node, depth, orderedIndex) {
    const prefix = orderedIndex ? `${orderedIndex}. ` : "- ";
    const inlineFragments = [];
    let nested = "";

    [...node.childNodes].forEach((child) => {
      if (child instanceof HTMLElement && (child.tagName === "UL" || child.tagName === "OL")) {
        nested += blockToMarkdown(child, depth + 1);
      } else {
        inlineFragments.push(inlineToMarkdown(child));
      }
    });

    const line = inlineFragments.join("").trim();
    const indent = "  ".repeat(depth);
    const nestedText = nested ? `\n${nested.trimEnd().split("\n").map((item) => `${indent}  ${item}`).join("\n")}` : "";
    return `${indent}${prefix}${line}${nestedText}\n`;
  }

  function messageNodeToMarkdown(node) {
    const clone = cloneMessageContent(node);
    const markdown = [...clone.childNodes].map((child) => blockToMarkdown(child)).join("").trim();
    if (markdown) {
      return markdown;
    }
    return normalizeText(clone.innerText || "").trim();
  }

  function extractMessages() {
    const nodes = getRoleNodes();
    return nodes
      .map((node, index) => {
        const role = getRoleFromNode(node);
        const text = normalizeText(node.innerText || "").trim();
        if (!text) {
          return null;
        }
        return {
          id: `${role}-${index}`,
          role,
          node,
          preview: text.slice(0, 80),
          text,
          markdown: messageNodeToMarkdown(node),
          html: messageNodeToHtml(node)
        };
      })
      .filter(Boolean);
  }

  function buildMarkdownDocument(messages) {
    const title = detectConversationTitle();
    const generatedAt = new Date().toLocaleString();
    const lines = [
      `# ${title}`,
      "",
      `- Source: ${location.href}`,
      `- Exported: ${generatedAt}`,
      ""
    ];

    messages.forEach((message, index) => {
      lines.push(`## ${index + 1}. ${message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "System"}`);
      lines.push("");
      lines.push(message.markdown || message.text || "_(empty)_");
      lines.push("");
    });

    return lines.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  function showToast(text) {
    const existing = document.getElementById(`${EXTENSION_NS}-toast`);
    existing?.remove();
    const toast = document.createElement("div");
    toast.id = `${EXTENSION_NS}-toast`;
    toast.className = `${EXTENSION_NS}-toast`;
    toast.textContent = text;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.classList.add("is-visible"), 10);
    window.setTimeout(() => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => toast.remove(), 250);
    }, 1800);
  }

  async function copyFormulaSource(source) {
    await navigator.clipboard.writeText(source);
    showToast("Copied as LaTeX");
  }

  async function copyFormulaMarkdown(source, displayMode) {
    const wrapped = formatFormulaForMarkdown(source, displayMode);
    await navigator.clipboard.writeText(wrapped);
    showToast(displayMode ? "Copied as Markdown block" : "Copied as Markdown inline");
  }

  async function loadMarkedRounds() {
    const key = getConversationKey();
    const result = await chrome.storage.local.get(key);
    state.markedRounds = result[key] || {};
  }

  async function saveMarkedRounds() {
    const key = getConversationKey();
    await chrome.storage.local.set({ [key]: state.markedRounds });
  }

  function computeRounds(messages) {
    const rounds = [];
    let current = null;

    messages.forEach((message) => {
      if (message.role === "user") {
        current = {
          id: `round-${rounds.length + 1}`,
          index: rounds.length + 1,
          anchorNode: message.node,
          userMessage: message,
          assistantMessages: []
        };
        rounds.push(current);
        return;
      }
      if (!current) {
        current = {
          id: `round-${rounds.length + 1}`,
          index: rounds.length + 1,
          anchorNode: message.node,
          userMessage: null,
          assistantMessages: [message]
        };
        rounds.push(current);
        return;
      }
      current.assistantMessages.push(message);
    });

    return rounds.map((round) => ({
      ...round,
      preview: (round.userMessage?.preview || round.assistantMessages[0]?.preview || "Untitled round").trim(),
      totalChars: [
        round.userMessage?.text || "",
        ...round.assistantMessages.map((message) => message.text || "")
      ].join("\n").length
    }));
  }

  function createRoundNavigator(rounds) {
    let root = document.getElementById(`${EXTENSION_NS}-nav`);
    if (!root) {
      root = document.createElement("aside");
      root.id = `${EXTENSION_NS}-nav`;
      root.className = `${EXTENSION_NS}-nav`;
      root.innerHTML = `
        <div class="${EXTENSION_NS}-info"></div>
        <div class="${EXTENSION_NS}-rail">
          <div class="${EXTENSION_NS}-track"></div>
          <div class="${EXTENSION_NS}-dot-layer"></div>
        </div>
      `;
      document.body.appendChild(root);
      state.navRoot = root;
    }

    const info = root.querySelector(`.${EXTENSION_NS}-info`);
    const dots = root.querySelector(`.${EXTENSION_NS}-dot-layer`);
    dots.replaceChildren();
    root.classList.remove("is-hovering");

    const positions = computeRoundDotPositions(rounds, root);

    rounds.forEach((round) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `${EXTENSION_NS}-dot`;
      button.dataset.roundId = round.id;
      button.dataset.roundIndex = String(round.index);
      button.setAttribute("aria-label", `Jump to round ${round.index}`);
      button.style.top = `${positions.get(round.id) ?? 0}px`;
      button.classList.toggle("is-marked", Boolean(state.markedRounds[String(round.index)]));

      button.addEventListener("click", () => {
        round.anchorNode.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      button.addEventListener("mouseenter", () => {
        if (state.hoverClearTimer) {
          window.clearTimeout(state.hoverClearTimer);
          state.hoverClearTimer = 0;
        }
        state.hoverRoundId = round.id;
        root.classList.add("is-hovering");
        updateRoundInfoBubble();
      });
      button.addEventListener("mouseleave", () => {
        scheduleHoverPreviewClear();
      });
      button.addEventListener("dblclick", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const roundKey = String(round.index);
        if (state.markedRounds[roundKey]) {
          delete state.markedRounds[roundKey];
        } else {
          state.markedRounds[roundKey] = true;
        }
        button.classList.toggle("is-marked", Boolean(state.markedRounds[roundKey]));
        await saveMarkedRounds();
        showToast(state.markedRounds[roundKey] ? `Marked round ${round.index}` : `Unmarked round ${round.index}`);
      });
      dots.appendChild(button);
    });
    updateRoundInfoBubble(info);
  }

  function destroyRoundNavigator() {
    state.navRoot?.remove();
    state.navRoot = null;
    if (state.scrollHandler) {
      window.removeEventListener("scroll", state.scrollHandler);
      state.scrollHandler = null;
    }
  }

  function updateActiveRoundByScroll() {
    if (!state.rounds.length) {
      return;
    }
    const viewportMarker = window.innerHeight * 0.35;
    let winner = state.rounds[0];
    let bestDistance = Number.POSITIVE_INFINITY;

    state.rounds.forEach((round) => {
      const rect = round.anchorNode.getBoundingClientRect();
      const distance = Math.abs(rect.top - viewportMarker);
      if (distance < bestDistance) {
        bestDistance = distance;
        winner = round;
      }
    });

    if (!winner || state.activeRoundId === winner.id) {
      return;
    }

    state.activeRoundId = winner.id;
    document.querySelectorAll(`.${EXTENSION_NS}-dot`).forEach((dot) => {
      dot.classList.toggle("is-active", dot.dataset.roundId === winner.id);
    });
  }

  function getRoundById(roundId) {
    return state.rounds.find((round) => round.id === roundId) || null;
  }

  function updateRoundInfoBubble(infoNode = state.navRoot?.querySelector?.(`.${EXTENSION_NS}-info`)) {
    if (!infoNode) {
      return;
    }
    const round = getRoundById(state.hoverRoundId);
    if (!round) {
      infoNode.textContent = "";
      return;
    }
    const summary = round.preview || "Untitled round";
    infoNode.textContent = `#${round.index} ${summary}`;
  }

  function clearHoverPreview() {
    if (state.hoverClearTimer) {
      window.clearTimeout(state.hoverClearTimer);
      state.hoverClearTimer = 0;
    }
    state.hoverRoundId = null;
    state.navRoot?.classList.remove("is-hovering");
    updateRoundInfoBubble();
  }

  function scheduleHoverPreviewClear() {
    if (state.hoverClearTimer) {
      window.clearTimeout(state.hoverClearTimer);
    }
    state.hoverClearTimer = window.setTimeout(() => {
      clearHoverPreview();
    }, 90);
  }

  function computeRoundDotPositions(rounds, root) {
    const layer = root.querySelector(`.${EXTENSION_NS}-dot-layer`);
    const rail = root.querySelector(`.${EXTENSION_NS}-rail`);
    const railHeight = Math.max(rail?.clientHeight || 0, 320);
    const padding = 8;
    const usableHeight = Math.max(railHeight - padding * 2, 40);
    const positions = new Map();

    if (rounds.length === 1) {
      positions.set(rounds[0].id, padding + usableHeight / 2);
      return positions;
    }

    const main = getMainContainer();
    const mainRect = main?.getBoundingClientRect();
    const mainTop = (mainRect?.top || 0) + window.scrollY;
    const mainBottom = (mainRect?.bottom || 0) + window.scrollY;
    const anchors = rounds.map((round) => round.anchorNode.getBoundingClientRect().top + window.scrollY);
    const segments = rounds.map((round, index) => {
      const currentTop = anchors[index];
      const nextTop = anchors[index + 1] ?? mainBottom;
      const heightByDom = Math.max(nextTop - currentTop, 120);
      const contentWeight = 100 + Math.sqrt(Math.max(round.totalChars, 1)) * 12;
      return Math.max(heightByDom, contentWeight, currentTop - mainTop >= 0 ? 0 : heightByDom);
    });

    const total = segments.reduce((sum, value) => sum + value, 0) || rounds.length;
    const rawPositions = [];
    let consumed = 0;
    segments.forEach((segment, index) => {
      const midpointRatio = (consumed + segment / 2) / total;
      rawPositions[index] = padding + midpointRatio * usableHeight;
      consumed += segment;
    });

    const minGap = Math.max(5, Math.min(24, usableHeight / Math.max(rounds.length - 1, 1) * 0.72));
    const adjusted = [...rawPositions];
    for (let i = 1; i < adjusted.length; i += 1) {
      adjusted[i] = Math.max(adjusted[i], adjusted[i - 1] + minGap);
    }
    const maxBottom = padding + usableHeight;
    if (adjusted[adjusted.length - 1] > maxBottom) {
      adjusted[adjusted.length - 1] = maxBottom;
      for (let i = adjusted.length - 2; i >= 0; i -= 1) {
        adjusted[i] = Math.min(adjusted[i], adjusted[i + 1] - minGap);
      }
      if (adjusted[0] < padding) {
        const delta = padding - adjusted[0];
        for (let i = 0; i < adjusted.length; i += 1) {
          adjusted[i] += delta;
        }
      }
    }

    rounds.forEach((round, index) => {
      positions.set(round.id, adjusted[index]);
    });
    layer.style.minHeight = `${railHeight}px`;
    return positions;
  }

  function bindScrollTracking() {
    if (state.scrollHandler) {
      window.removeEventListener("scroll", state.scrollHandler, { passive: true });
    }
    state.scrollHandler = debounce(updateActiveRoundByScroll, 40);
    window.addEventListener("scroll", state.scrollHandler, { passive: true });
    updateActiveRoundByScroll();
  }

  function render() {
    const messages = extractMessages();
    state.rounds = computeRounds(messages);

    if (state.settings.enableRoundNavigator && state.rounds.length > 1) {
      createRoundNavigator(state.rounds);
      bindScrollTracking();
    } else {
      destroyRoundNavigator();
    }
  }

  const refresh = debounce(() => {
    render();
  }, 120);

  async function handleUrlChange() {
    if (location.href === state.url) {
      return;
    }
    state.url = location.href;
    await loadMarkedRounds();
    window.clearTimeout(state.bootTimer);
    state.bootTimer = window.setTimeout(render, 350);
  }

  function observeDom() {
    state.mutationObserver?.disconnect();
    state.mutationObserver = new MutationObserver(() => {
      void handleUrlChange();
      refresh();
    });
    state.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  async function loadSettings() {
    const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    state.settings = { ...DEFAULT_SETTINGS, ...result };
  }

  function watchSettings() {
    if (state.storageListener) {
      chrome.storage.onChanged.removeListener(state.storageListener);
    }
    state.storageListener = (changes, areaName) => {
      if (areaName !== "sync") {
        return;
      }
      let shouldRender = false;
      Object.keys(DEFAULT_SETTINGS).forEach((key) => {
        if (changes[key]) {
          state.settings[key] = changes[key].newValue;
          shouldRender = true;
        }
      });
      if (shouldRender) {
        render();
      }
    };
    chrome.storage.onChanged.addListener(state.storageListener);
  }

  function handleRuntimeMessage(message, _sender, sendResponse) {
    if (message?.type === "compass:get-stats") {
      const messages = extractMessages();
      sendResponse({
        ok: true,
        rounds: computeRounds(messages).length,
        messages: messages.length,
        title: detectConversationTitle()
      });
      return false;
    }
    return false;
  }

  function handleDocumentClick(event) {
    const formulaNode = findFormulaContainer(event.target);
    if (!formulaNode) {
      return;
    }

    const source = extractFormulaSource(formulaNode);
    if (!source) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const displayMode = isDisplayFormula(formulaNode);
    const sameFormula = state.pendingFormulaNode === formulaNode;

    if (state.formulaClickTimer && sameFormula) {
      window.clearTimeout(state.formulaClickTimer);
      state.formulaClickTimer = 0;
      state.pendingFormulaNode = null;
      copyFormulaSource(source).catch(() => {
        showToast("Unable to copy formula");
      });
      return;
    }

    if (state.formulaClickTimer) {
      window.clearTimeout(state.formulaClickTimer);
      state.formulaClickTimer = 0;
      state.pendingFormulaNode = null;
    }

    state.pendingFormulaNode = formulaNode;
    state.formulaClickTimer = window.setTimeout(() => {
      state.formulaClickTimer = 0;
      state.pendingFormulaNode = null;
      copyFormulaMarkdown(source, displayMode).catch(() => {
        showToast("Unable to copy formula");
      });
    }, 220);
  }

  async function boot() {
    await loadMarkedRounds();
    await loadSettings();
    render();
    observeDom();
    watchSettings();
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    document.addEventListener("click", handleDocumentClick, true);

    const historyPushState = history.pushState.bind(history);
    history.pushState = function pushStatePatched(...args) {
      historyPushState(...args);
      void handleUrlChange();
      refresh();
    };
    window.addEventListener("popstate", () => {
      void handleUrlChange();
      refresh();
    });
  }

  boot();
})();
