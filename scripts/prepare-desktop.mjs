import { copyFile } from "node:fs/promises";
await copyFile("apps/desktop/src/preload.cjs", "dist/desktop/preload.cjs");
