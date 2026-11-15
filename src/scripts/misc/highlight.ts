import type { HLJSApi, LanguageFn } from "highlight.js";

const AUTO_LIMIT = 5000;

const LANGUAGES: Record<string, () => Promise<{ default: LanguageFn }>> = {
  javascript: () => import("highlight.js/lib/languages/javascript"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  json: () => import("highlight.js/lib/languages/json"),
  python: () => import("highlight.js/lib/languages/python"),
  rust: () => import("highlight.js/lib/languages/rust"),
  go: () => import("highlight.js/lib/languages/go"),
  java: () => import("highlight.js/lib/languages/java"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  bash: () => import("highlight.js/lib/languages/bash"),
  shell: () => import("highlight.js/lib/languages/shell"),
  xml: () => import("highlight.js/lib/languages/xml"),
  css: () => import("highlight.js/lib/languages/css"),
  scss: () => import("highlight.js/lib/languages/scss"),
  sql: () => import("highlight.js/lib/languages/sql"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
  ini: () => import("highlight.js/lib/languages/ini"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  diff: () => import("highlight.js/lib/languages/diff"),
  kotlin: () => import("highlight.js/lib/languages/kotlin"),
  swift: () => import("highlight.js/lib/languages/swift"),
  php: () => import("highlight.js/lib/languages/php"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  lua: () => import("highlight.js/lib/languages/lua"),
  dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
};

const ALIASES: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript",
  jsonc: "json", json5: "json",
  py: "python", python3: "python",
  rs: "rust", golang: "go",
  h: "c", "c++": "cpp", hpp: "cpp", cc: "cpp", cxx: "cpp",
  cs: "csharp", "c#": "csharp",
  sh: "bash", zsh: "bash", fish: "bash", console: "shell", shellsession: "shell",
  html: "xml", htm: "xml", svg: "xml", xhtml: "xml", svelte: "xml", vue: "xml", astro: "xml",
  sass: "scss", yml: "yaml", toml: "ini", conf: "ini", cfg: "ini",
  md: "markdown", mkd: "markdown", patch: "diff",
  kt: "kotlin", kts: "kotlin", rb: "ruby", docker: "dockerfile",
  postgres: "sql", postgresql: "sql", mysql: "sql", sqlite: "sql",
};

let core: Promise<HLJSApi> | null = null;
let everything: Promise<HLJSApi> | null = null;
const loading = new Map<string, Promise<void>>();

const loadCore = () =>
  (core ??= import("highlight.js/lib/core").then((module) => {
    const hljs = module.default;
    hljs.configure({ ignoreUnescapedHTML: true });
    return hljs;
  }));

const loadLanguage = async (hljs: HLJSApi, name: string) => {
  if (!loading.has(name)) {
    loading.set(name, LANGUAGES[name]().then((module) => hljs.registerLanguage(name, module.default)));
  }
  await loading.get(name);
};

const loadAll = () =>
  (everything ??= loadCore().then(async (hljs) => {
    await Promise.all(Object.keys(LANGUAGES).map((name) => loadLanguage(hljs, name)));
    return hljs;
  }));

export const resolveLanguage = (language?: string) => {
  const key = language?.trim().toLowerCase() ?? "";
  if (key in LANGUAGES) return key;
  return ALIASES[key];
};

export const highlightCode = async (source: string, language?: string) => {
  const name = resolveLanguage(language);
  if (name) {
    const hljs = await loadCore();
    await loadLanguage(hljs, name);
    return hljs.highlight(source, { language: name, ignoreIllegals: true }).value;
  }
  if (source.length > AUTO_LIMIT) return null;
  const hljs = await loadAll();
  const result = hljs.highlightAuto(source, Object.keys(LANGUAGES));
  return result.relevance > 4 ? result.value : null;
};
