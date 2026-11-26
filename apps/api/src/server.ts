import "dotenv/config";
import { createApp } from "./app.js";
import { loadAppConfig } from "./config.js";

const config = loadAppConfig();
createApp().listen(config.port, () =>
  console.log(`FoxCanvas API listening on http://localhost:${config.port}`),
);
