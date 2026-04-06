const modules = import.meta.glob("./locales/*.json", {
  eager: true,
  import: "default",
});

const locales: Record<string, any> = {};

export const setupLocales = () => {
  for (const filePath in modules) {
    const fileName = filePath.split("/").pop()!;
    const key = fileName.replace(".json", "");

    locales[key] = modules[filePath];
  }
};

setupLocales();

export const getLocalisedText = (locale = "en_gb", ...path: string[]) =>
  path?.reduce(
    (currentLevel, key) => currentLevel?.[key],
    locales?.[locale]?.text,
  );
