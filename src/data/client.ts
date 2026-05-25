import type { AppDataClient } from "./AppDataClient";
import { createDexieDataClient } from "../local-dexie/dexieDataClient";

export const dataClient: AppDataClient = createDexieDataClient();
