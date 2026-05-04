import { loadConfig } from './config.js';
import { buildServer } from './app.js';

const config = loadConfig();
const server = await buildServer(config);

try {
  await server.listen({ host: config.host, port: config.port });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
