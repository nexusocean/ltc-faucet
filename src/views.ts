import nunjucks from 'nunjucks';
import { fileURLToPath } from 'node:url';

const viewsDir = fileURLToPath(new URL('../views', import.meta.url));

export const views = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(viewsDir, { noCache: process.env.NODE_ENV !== 'production' }),
  { autoescape: true, throwOnUndefined: true },
);
