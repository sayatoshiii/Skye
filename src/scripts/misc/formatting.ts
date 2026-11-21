import DOMPurify from "dompurify";
import { Marked, type Tokens } from "marked";
import { escapeHTML, renderEmoji } from "./emoji";

export const HTML_FORMAT = "org.matrix.custom.html";

const ALLOWED_TAGS = [
  "font", "del", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "p", "a", "ul", "ol",
  "sup", "sub", "li", "b", "i", "u", "strong", "em", "s", "code", "hr", "br", "div",
  "table", "thead", "tbody", "tr", "th", "td", "caption", "pre", "span", "img",
  "details", "summary",
];

const ALLOWED_ATTR = ["href", "src", "alt", "title", "width", "height", "start", "class", "colspan", "rowspan"];

const LINK_SCHEMES = ["http:", "https:", "mailto:", "matrix:"];
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/gi;
const MXC_PATTERN = /\bmxc:\/\/[\w.:[\]-]+\/[\w-]+/g;
const LINKISH = new RegExp(`${URL_PATTERN.source}|${MXC_PATTERN.source}`, "gi");
const COLOUR_PATTERN = /^#[0-9a-f]{6}$/i;
const MENTION_PATTERN = /^https:\/\/matrix\.to\/#\/(@[^/?]+)/;
const ROOM_PATTERN = /^https:\/\/matrix\.to\/#\/((?:[#!]|%23|%21)[^/?]+)\/?(?:\?.*)?$/;

const SPOILER = {
  name: "spoiler",
  level: "inline" as const,
  start: (src: string) => src.indexOf("||"),
  tokenizer(this: any, src: string) {
    const match = /^\|\|(?!\|)([\s\S]+?)\|\|/.exec(src);
    if (!match) return;
    return { type: "spoiler", raw: match[0], tokens: this.lexer.inlineTokens(match[1]) };
  },
  renderer(this: any, token: any) {
    return `<span data-mx-spoiler>${this.parser.parseInline(token.tokens)}</span>`;
  },
};

const UNDERLINE = {
  name: "underline",
  level: "inline" as const,
  start: (src: string) => src.indexOf("__"),
  tokenizer(this: any, src: string) {
    const match = /^(_{2,3})(?!_)(?=\S)([\s\S]*?\S)\1(?![_\p{L}\p{N}])/u.exec(src);
    if (!match) return;
    return { type: "underline", raw: match[0], italic: match[1].length === 3, tokens: this.lexer.inlineTokens(match[2]) };
  },
  renderer(this: any, token: any) {
    const html = `<u>${this.parser.parseInline(token.tokens)}</u>`;
    return token.italic ? `<em>${html}</em>` : html;
  },
};

const mxcHTML = (raw: string) => `<span data-mx-mxc>${escapeHTML(raw)}</span>`;

const MXC = {
  name: "mxc",
  level: "inline" as const,
  start: (src: string) => src.indexOf("mxc://"),
  tokenizer: (src: string) => (([raw]) => raw && { type: "mxc", raw })(/^mxc:\/\/[\w.:[\]-]+\/[\w-]+/.exec(src) ?? [""]),
  renderer: (token: any) => mxcHTML(token.raw),
};

const marked = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    html: ({ text }: Tokens.HTML | Tokens.Tag) => escapeHTML(text),
  },
  extensions: [SPOILER, UNDERLINE, MXC],
});

let purifier: ReturnType<typeof DOMPurify> | null = null;

const getPurifier = () => {
  if (purifier) return purifier;
  purifier = DOMPurify(window);
  purifier.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName.startsWith("data-") && !data.attrName.startsWith("data-mx-")) data.keepAttr = false;
    if (data.attrName === "class" && !/^language-[\w+-]+$/.test(data.attrValue)) data.keepAttr = false;
  });
  return purifier;
};

const sanitiseToFragment = (html: string) =>
  getPurifier().sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: true,
    ALLOW_UNKNOWN_PROTOCOLS: true,
    ADD_FORBID_CONTENTS: ["mx-reply"],
    FORBID_TAGS: ["style", "iframe", "form", "input", "script", "svg", "math"],
    RETURN_DOM_FRAGMENT: true,
  });

export const safeHref = (href: string | null | undefined) => {
  if (!href) return null;
  try {
    const url = new URL(href.trim());
    return LINK_SCHEMES.includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

const hardenLink = (anchor: HTMLAnchorElement) => {
  anchor.setAttribute("rel", "noopener noreferrer nofollow");
  anchor.setAttribute("target", "_blank");
};

export type RenderOptions = {
  ownUserId?: string;
  resolveName?: (userId: string) => string | undefined;
  resolveRoom?: (roomIdOrAlias: string) => string | undefined;
  everyone?: boolean;
};

export type RenderedBody = { html: string; mentionsMe: boolean };

const parseEmoji = (root: Node) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node.parentElement?.closest("code, pre"))) nodes.push(node as Text);
  }

  nodes.forEach((node) => {
    const html = renderEmoji(node.data);
    if (html === escapeHTML(node.data)) return;
    const span = document.createElement("span");
    span.innerHTML = html;
    node.replaceWith(...span.childNodes);
  });
};

const EVERYONE = /(^|\s)(@room)\b/g;
const EVERYONE_HTML = '$1<span class="mention everyone">$2</span>';

const markEveryone = (root: Node) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.includes("@room") && !node.parentElement?.closest("code, pre, a")) nodes.push(node as Text);
  }
  nodes.forEach((node) => {
    const span = document.createElement("span");
    span.innerHTML = escapeHTML(node.data).replace(EVERYONE, EVERYONE_HTML);
    node.replaceWith(...span.childNodes);
  });
};

const decorate = (root: DocumentFragment | HTMLElement, options: RenderOptions) => {
  let mentionsMe = false;

  root.querySelectorAll("a").forEach((anchor) => {
    const href = safeHref(anchor.getAttribute("href"));
    if (!href) return anchor.replaceWith(...anchor.childNodes);

    anchor.setAttribute("href", href);
    hardenLink(anchor);

    const room = href.match(ROOM_PATTERN)?.[1];
    if (room) {
      const roomId = decodeURIComponent(room);
      anchor.classList.add("mention", "room");
      anchor.dataset.roomId = roomId;
      anchor.removeAttribute("target");
      anchor.textContent = `#${options.resolveRoom?.(roomId) ?? anchor.textContent?.replace(/^#/, "") ?? roomId}`;
      return;
    }

    const userId = decodeURIComponent(href.match(MENTION_PATTERN)?.[1] ?? "");
    if (!userId) return;

    anchor.classList.add("mention");
    anchor.dataset.userId = userId;
    anchor.textContent = `@${(options.resolveName?.(userId) ?? anchor.textContent ?? userId).replace(/^@+/, "")}`;
    if (userId === options.ownUserId) {
      anchor.classList.add("me");
      mentionsMe = true;
    }
  });

  if (options.everyone) markEveryone(root);

  root.querySelectorAll("img").forEach((image) => {
    const src = image.getAttribute("src") ?? "";
    if (!src.startsWith("mxc://")) return image.replaceWith(document.createTextNode(image.getAttribute("alt") ?? ""));
    image.removeAttribute("src");
    image.dataset.mxc = src;
    image.setAttribute("loading", "lazy");
    image.classList.add("inline-image");
  });

  root.querySelectorAll("font, span").forEach((element) => {
    const el = element as HTMLElement;
    const colour = el.getAttribute("data-mx-color");
    const background = el.getAttribute("data-mx-bg-color");
    if (colour && COLOUR_PATTERN.test(colour)) el.style.color = colour;
    if (background && COLOUR_PATTERN.test(background)) el.style.backgroundColor = background;
    if (el.hasAttribute("data-mx-spoiler")) {
      el.classList.add("spoiler");
      el.setAttribute("tabindex", "0");
      el.setAttribute("role", "button");
    }
  });

  root.querySelectorAll("pre code, code").forEach((code) => {
    const language = [...code.classList].find((name) => name.startsWith("language-"));
    if (language && code.parentElement?.tagName === "PRE") code.parentElement.dataset.language = language.slice(9);
  });

  return mentionsMe;
};

const serialise = (fragment: DocumentFragment) => {
  const container = document.createElement("div");
  container.append(fragment);
  return container.innerHTML;
};

export const renderFormatted = (html: string, options: RenderOptions = {}): RenderedBody => {
  const fragment = sanitiseToFragment(html);
  const mentionsMe = decorate(fragment, options);
  parseEmoji(fragment);
  return { html: serialise(fragment), mentionsMe };
};

export const renderPlain = (text: string, everyone = false): RenderedBody => {
  const result = renderLinks(text);
  return everyone ? { ...result, html: result.html.replace(EVERYONE, EVERYONE_HTML) } : result;
};

const renderLinks = (text: string): RenderedBody => {
  let html = "";
  let index = 0;

  for (const match of text.matchAll(LINKISH)) {
    const raw = match[0];
    const href = safeHref(raw.startsWith("www.") ? `https://${raw}` : raw);
    html += renderEmoji(text.slice(index, match.index));
    html += raw.startsWith("mxc://")
      ? mxcHTML(raw)
      : href
        ? `<a href="${escapeHTML(href)}" rel="noopener noreferrer nofollow" target="_blank">${escapeHTML(raw)}</a>`
        : escapeHTML(raw);
    index = match.index! + raw.length;
  }

  return { html: html + renderEmoji(text.slice(index)), mentionsMe: false };
};

export const findLinks = (text: string) => [
  ...new Set([
    ...[...text.matchAll(URL_PATTERN)].map((match) => safeHref(match[0].startsWith("www.") ? `https://${match[0]}` : match[0])).filter((href): href is string => !!href && href.startsWith("http") && !href.startsWith("https://matrix.to/")),
    ...[...text.matchAll(MXC_PATTERN)].map((match) => match[0]),
  ]),
];

export const stripReplyFallback = (body: string) => {
  const lines = body.split("\n");
  let index = 0;
  while (index < lines.length && lines[index].startsWith(">")) index++;
  if (index && lines[index] === "") index++;
  return index ? lines.slice(index).join("\n") : body;
};

const unwrapParagraph = (html: string) => {
  const trimmed = html.trim();
  const single = /^<p>([\s\S]*)<\/p>$/.exec(trimmed);
  return single && !single[1].includes("<p>") ? single[1] : trimmed;
};

export const markdownToContent = (body: string, source = body): { body: string; format?: string; formatted_body?: string } => {
  const rendered = unwrapParagraph(marked.parse(source) as string);
  const fragment = sanitiseToFragment(rendered);
  fragment.querySelectorAll("a").forEach((anchor) => {
    const href = safeHref(anchor.getAttribute("href"));
    href ? anchor.setAttribute("href", href) : anchor.replaceWith(...anchor.childNodes);
  });
  fragment.querySelectorAll("img").forEach((image) => {
    if (!image.getAttribute("src")?.startsWith("mxc://")) image.replaceWith(image.getAttribute("alt") ?? "");
  });
  const html = serialise(fragment);
  const plain = escapeHTML(body).replace(/\n/g, "<br>");

  return html === plain || html === escapeHTML(body)
    ? { body }
    : { body, format: HTML_FORMAT, formatted_body: html };
};

export const toPreviewLine = (content: Record<string, any> | undefined) => {
  const body = typeof content?.body === "string" ? content.body : "";
  const clean = content?.["m.relates_to"]?.["m.in_reply_to"] ? stripReplyFallback(body) : body;
  return clean.replace(/\s+/g, " ").trim();
};

