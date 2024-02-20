interface ImportMetaEnv extends Readonly<Record<string, string>> {
  // more env variables...
  PUPPETEER_EXECUTABLE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  readonly path: string;
}
