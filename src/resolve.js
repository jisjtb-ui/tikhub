#!/usr/bin/env node
/**
 * 接続先の解決だけを行う。接続検証の第一段階の切り分け用。
 *
 *   npm run resolve -- https://vt.tiktok.com/XXXXXXXX/
 */
import process from 'node:process';

import { loadDotEnv, buildConfig } from './config.js';
import { createLogger, color } from './logger.js';
import { resolveTarget } from './target.js';

async function main() {
  loadDotEnv();
  const config = buildConfig();
  const logger = createLogger(config.logLevel);

  try {
    const { username, resolvedFrom } = await resolveTarget(config.target, { logger });
    console.log('');
    console.log(`${color.green('解決できました')}`);
    console.log(`  ユーザー名 : @${username}`);
    if (resolvedFrom) console.log(`  展開先 URL : ${resolvedFrom}`);
    console.log('');
    console.log(color.dim(`次のコマンドで接続できます:  npm start -- @${username}`));
  } catch (err) {
    console.error(color.red(err.message));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
