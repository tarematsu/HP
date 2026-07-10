/// <reference path="../node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts" />
import type { Env as HomePanelEnv } from "../src/sources";
declare module "cloudflare:test" {
  interface ProvidedEnv extends HomePanelEnv {}
}
