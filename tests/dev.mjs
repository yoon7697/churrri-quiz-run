import {runtime} from './runtime.mjs';

const mf = runtime({port: Number(process.env.PORT || 4175)});
console.log('Quiz Run lobby:', (await mf.ready).href);
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => {
  await mf.dispose();
  process.exit();
});
