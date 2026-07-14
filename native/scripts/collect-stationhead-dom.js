/*
 * Stationhead visible-DOM collector
 *
 * Paste this entire file into the DevTools Console while logged in at
 * stationhead.com. It does not call fetch/XHR, read cookies or storage, or
 * inspect form values. The result is downloaded as a JSON file and returned
 * from the IIFE for easy inspection in the console.
 */
(() => {
  const MAX_NODES = 2500;
  const MAX_TEXT = 320;
  const MAX_VISIBLE_TEXT = 20000;
  const ATTRIBUTES = [
    "id", "role", "title", "aria-label", "aria-describedby", "aria-valuenow",
    "aria-valuemin", "aria-valuemax", "data-testid", "data-test-id", "data-label",
    "data-value", "data-count", "data-date", "data-day", "data-type", "name",
  ];

  const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const shorten = (value, limit = MAX_TEXT) => {
    const text = clean(value);
    return text.length <= limit ? text : `${text.slice(0, limit)}…`;
  };
  const isVisible = element => {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const directText = element => Array.from(element.childNodes)
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.nodeValue)
    .join(" ");
  const safeAttributes = element => {
    const result = {};
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value !== null && value !== "") result[name] = shorten(value, 180);
    }
    const className = typeof element.className === "string" ? clean(element.className) : "";
    if (className) result.class = shorten(className, 240);
    return result;
  };
  const selectorPart = element => {
    const tag = element.tagName.toLowerCase();
    const testId = element.getAttribute("data-testid") || element.getAttribute("data-test-id");
    if (testId) return `${tag}[data-testid="${testId}"]`;
    if (element.id) return `${tag}#${element.id}`;
    const classes = typeof element.className === "string"
      ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
    return tag + classes.map(value => `.${value}`).join("");
  };
  const ancestorPath = element => {
    const path = [];
    let current = element.parentElement;
    while (current && path.length < 6) {
      path.unshift(selectorPart(current));
      current = current.parentElement;
    }
    return path;
  };
  const numberFrom = value => {
    const matches = clean(value).match(/\d[\d,]*(?:\.\d+)?\s*[kmb]?/ig) || [];
    if (!matches.length) return null;
    const token = matches[matches.length - 1].replace(/\s+/g, "").toLowerCase();
    const suffix = token.slice(-1);
    const number = Number(token.replace(/[kmb]$/, "").replace(/,/g, ""));
    if (!Number.isFinite(number)) return null;
    return Math.round(number * (suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : suffix === "b" ? 1e9 : 1));
  };
  const relevance = text => {
    const value = text.toLowerCase();
    let score = 0;
    if (/\b(today|today's|today’s|昨日|本日|今日)\b|本日|今日/.test(value)) score += 5;
    if (/\b(play|plays|listen|listening|minutes|streak|activity|count)\b|再生|視聴|リスニング|アクティビティ/.test(value)) score += 4;
    if (numberFrom(value) !== null) score += 2;
    return score;
  };

  const nodes = [];
  const visit = (element, parent = null) => {
    if (nodes.length >= MAX_NODES || !isVisible(element)) return;
    const rect = element.getBoundingClientRect();
    const text = shorten(element.innerText || element.textContent || "");
    const direct = shorten(directText(element));
    const record = {
      index: nodes.length,
      parent,
      tag: element.tagName.toLowerCase(),
      path: ancestorPath(element),
      attributes: safeAttributes(element),
      text,
      directText: direct,
      childCount: element.children.length,
      rect: {
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height),
      },
    };
    nodes.push(record);
    const index = record.index;
    for (const child of element.children) visit(child, index);
  };
  visit(document.body);

  const relevant = nodes
    .map(node => ({
      index: node.index,
      score: relevance(`${node.text} ${Object.values(node.attributes).join(" ")}`),
      text: node.text,
      attributes: node.attributes,
      path: node.path,
    }))
    .filter(node => node.score > 0 && (node.text || Object.keys(node.attributes).length))
    .sort((left, right) => right.score - left.score || left.text.length - right.text.length)
    .slice(0, 100);

  const svgAttribute = (element, name, limit = 500) => {
    const value = element.getAttribute(name);
    return value === null || value === "" ? undefined : shorten(value, limit);
  };
  const svgBox = element => {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.round(rect.width), height: Math.round(rect.height),
    };
  };
  const svgCharts = Array.from(document.querySelectorAll("svg"))
    .filter(isVisible)
    .map((svg, chartIndex) => {
      const textNodes = Array.from(svg.querySelectorAll("text, tspan"))
        .filter(isVisible)
        .map(element => ({
          tag: element.tagName.toLowerCase(),
          text: shorten(element.textContent, 120),
          x: svgAttribute(element, "x", 40),
          y: svgAttribute(element, "y", 40),
          box: svgBox(element),
        }))
        .filter(item => item.text);
      const marks = Array.from(svg.querySelectorAll("g[role='img'], rect, path"))
        .filter(isVisible)
        .map((element, markIndex) => {
          const item = {
            index: markIndex,
            tag: element.tagName.toLowerCase(),
            role: svgAttribute(element, "role", 40),
            class: svgAttribute(element, "class", 180),
            x: svgAttribute(element, "x", 40),
            y: svgAttribute(element, "y", 40),
            width: svgAttribute(element, "width", 40),
            height: svgAttribute(element, "height", 40),
            d: svgAttribute(element, "d"),
            fill: svgAttribute(element, "fill", 80),
            stroke: svgAttribute(element, "stroke", 80),
            box: svgBox(element),
          };
          return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined));
        });
      const container = svg.closest("section, article, main, [role='region']");
      return {
        chartIndex,
        box: svgBox(svg),
        class: svgAttribute(svg, "class", 180),
        viewBox: svgAttribute(svg, "viewBox", 120),
        containerText: shorten(container?.innerText || "", 500),
        textNodes,
        marks,
      };
    });

  const result = {
    schema: "homepanel.stationhead.visible-dom.v2",
    capturedAt: new Date().toISOString(),
    page: {
      origin: location.origin,
      pathname: location.pathname,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    },
    notes: [
      "Only elements visible in the current viewport/layout were included.",
      "Input values, cookies, storage, Authorization headers, href, and src attributes were excluded.",
      "Text may include account or station labels that are visible on the page.",
      "svgCharts contains visible SVG axis labels and geometry for chart marks; values may require the chart scale.",
    ],
    visibleText: shorten(document.body.innerText || "", MAX_VISIBLE_TEXT),
    nodeCount: nodes.length,
    truncated: nodes.length >= MAX_NODES,
    nodes,
    relevant,
    svgCharts,
  };

  const json = JSON.stringify(result, null, 2);
  const fileName = `stationhead-dom-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  console.log(`HomePanel DOM capture downloaded: ${fileName}`, result);
  return result;
})();
