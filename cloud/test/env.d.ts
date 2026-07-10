
import type { Env as HomePanelEnv } from "../src/sources";
declare module "cloudflare:test" {
  interface ProvidedEnv extends HomePanelEnv {}
}
