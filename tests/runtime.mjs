import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(process.env.QUIZRUN_TEST_DEPS || import.meta.url);
const { Miniflare } = require('miniflare');

export function runtime(options = {}) {
  return new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL('../server/worker.mjs', import.meta.url)),
    compatibilityDate: '2026-07-30',
    host: '127.0.0.1',
    durableObjects: {ROOMS: {className: 'Room', useSQLite: true}},
    assets: {directory: fileURLToPath(new URL('../public', import.meta.url)), binding: 'ASSETS', routerConfig: {has_user_worker: true, invoke_user_worker_ahead_of_assets: true}},
    bindings: {ALLOWED_ORIGINS: 'https://quizrun.example.test'},
    ratelimits: {
      ROOM_CREATES: {namespace_id: '411801', simple: {limit: 8, period: 60}},
      ROOM_REQUESTS: {namespace_id: '411802', simple: {limit: 240, period: 60}},
    },
    ...options,
  });
}
