#!/usr/bin/env node
/**
 * tikhub とゲームを、その場で最新版に更新する。
 *
 *   npm run update
 *
 * ZIP を落とし直してフォルダを置き換える必要がなくなります。git も要りません。
 *
 * やっていること:
 *   GitHub から最新の ZIP を取得 -> 一時フォルダへ展開 -> 既存フォルダへ上書き
 *
 * 上書きするのはリポジトリに入っているファイルだけです。あなたが置いた
 * ファイル (.env、bgm の mp3、node_modules など) は消しません。
 * また、リポジトリから消えたファイルをこちらから削除することもしません。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

import { findGameDirs } from '../src/bridge.js';

const OWNER = 'jisjtb-ui';
const REPOS = [
  { label: 'tikhub', repo: 'tikhub' },
  { label: 'ゲーム ', repo: 'kawaiivsbeautiful' },
];

/** tikhub から配信できるゲーム。フォルダの中身を見てどれかを判断する。 */
const GAME_REPOS = ['kawaiivsbeautiful', 'circlebattle'];

/**
 * このフォルダに入っているのはどのゲームか。
 *
 * package.json の name で見ます。フォルダ名は自由に変えられるうえ、
 * 取り違えると別のゲームのファイルで上書きしてしまうためです。
 * 判断できなければ既定 (kawaiivsbeautiful) を返します。
 */
function gameRepoFor(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (GAME_REPOS.includes(pkg.name)) return pkg.name;
  } catch {
    /* 読めなければ既定へ */
  }
  return REPOS[1].repo;
}

/** 上書き対象から外すもの。利用者が置いたファイルを消さないため。 */
const KEEP = new Set(['.env', 'node_modules', '.git', 'bgm']);

function hash(file) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

/** tar コマンドが使えるか。Windows 10 以降 / macOS / Linux には標準で入っている。 */
function hasTar() {
  try {
    execFileSync('tar', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 書庫を展開する。
 *
 * tar があれば tar.gz を使います。zip は展開できる tar とできない tar があり
 * (Windows/macOS の bsdtar は可、Linux の GNU tar は不可)、環境で挙動が
 * 変わるためです。tar が無い Windows のときだけ zip + Expand-Archive にします。
 */
function extract(archivePath, intoDir, kind) {
  fs.mkdirSync(intoDir, { recursive: true });
  if (kind === 'tar') {
    execFileSync('tar', ['-xzf', archivePath, '-C', intoDir], { stdio: 'pipe' });
    return;
  }
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${intoDir}' -Force`,
  ], { stdio: 'pipe' });
}

const UA = { 'User-Agent': 'tikhub-update' };

/**
 * 最新のアーカイブを落とす。
 *
 * まず**認証なし**で公開用の URL を叩きます。公開リポジトリならこれで取れますし、
 * .env に古いトークンが残っていても巻き込まれません
 * (無効なトークンを付けると、公開リポジトリでも 401 で弾かれます)。
 *
 * これが 404 になるのは非公開のときなので、そのときだけトークンを付けて
 * API から取り直します。
 */
async function download(repo, token, kind) {
  const ext = kind === 'tar' ? 'tar.gz' : 'zip';
  const publicUrl = `https://github.com/${OWNER}/${repo}/archive/refs/heads/main.${ext}`;

  let res = await fetch(publicUrl, { headers: UA, redirect: 'follow' });

  if (!res.ok && token) {
    const apiUrl = `https://api.github.com/repos/${OWNER}/${repo}/${kind === 'tar' ? 'tarball' : 'zipball'}/main`;
    res = await fetch(apiUrl, {
      headers: { ...UA, Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
      redirect: 'follow',
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(`${repo}: トークンが受け付けられませんでした。.env の GITHUB_TOKEN を確認するか、行ごと消してください。`);
    }
  }

  if (res.status === 404) {
    throw new Error(token
      ? `${repo} を取得できません。トークンにこのリポジトリの権限があるか確認してください。`
      : `${repo} が非公開のようです。GITHUB_TOKEN が必要です。`);
  }
  if (!res.ok) throw new Error(`${repo}: ダウンロードに失敗しました (HTTP ${res.status})`);

  const file = path.join(os.tmpdir(), `${repo}-${Date.now()}.${ext}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** GitHub の zipball は 1 階層挟むので、その中へ降りる。 */
function singleChild(dir) {
  const kids = fs.readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((p) => fs.statSync(p).isDirectory());
  return kids.length === 1 ? kids[0] : dir;
}

/** from の中身を to へ上書きコピーする。 */
function overlay(from, to, stats) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (KEEP.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      overlay(src, dst, stats);
      continue;
    }
    if (hash(src) !== hash(dst)) {
      fs.copyFileSync(src, dst);
      stats.changed.push(path.relative(stats.root, dst));
    }
  }
  return stats;
}

async function updateOne(label, repo, targetDir, token, kind) {
  process.stdout.write(`  ${label}  `);
  const archive = await download(repo, token, kind);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tikhub-update-'));
  try {
    extract(archive, tmp, kind);
    const stats = overlay(singleChild(tmp), targetDir, { changed: [], root: targetDir });
    console.log(stats.changed.length === 0
      ? '最新でした'
      : `${stats.changed.length} ファイルを更新`);
    stats.changed.slice(0, 10).forEach((f) => console.log(`      ${f}`));
    if (stats.changed.length > 10) console.log(`      … ほか ${stats.changed.length - 10} 件`);
    return stats.changed.length;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(archive, { force: true });
  }
}

function tokenHelp() {
  console.error('\n非公開リポジトリなので、読み取り用のトークンが要ります:');
  console.error('  1. https://github.com/settings/tokens?type=beta を開く');
  console.error('  2. Generate new token → 対象のリポジトリを選ぶ');
  console.error('     Repository permissions → Contents を Read-only にする');
  console.error('  3. tikhub のフォルダの .env に 1 行足す');
  console.error('       GITHUB_TOKEN=github_pat_xxxxxxxx');
  console.error('\n（リポジトリを公開に変えれば、トークン無しで更新できます）');
}

async function main() {
  // .env の GITHUB_TOKEN を読む (非公開リポジトリのとき必要)
  if (typeof process.loadEnvFile === 'function' && fs.existsSync('.env')) {
    try { process.loadEnvFile('.env'); } catch { /* 壊れていても続行 */ }
  }
  const token = (process.env.GITHUB_TOKEN || '').trim() || null;

  const here = process.cwd();
  if (!fs.existsSync(path.join(here, 'src', 'index.js'))) {
    console.error('tikhub のフォルダで実行してください (src/index.js が見つかりません)。');
    process.exitCode = 1;
    return;
  }

  // --game= があればそれだけ。無ければ近くにあるゲームを全部更新する。
  // 1 つしか更新しないと、2 つ目のゲームだけ古いまま取り残されるため。
  const arg = process.argv.find((a) => a.startsWith('--game='));
  const gameDirs = arg ? [arg.slice('--game='.length)] : findGameDirs(here);

  const kind = hasTar() ? 'tar' : 'zip';
  console.log('最新版に更新します\n');

  let changed = 0;
  try {
    changed += await updateOne(REPOS[0].label, REPOS[0].repo, here, token, kind);
    if (gameDirs.length) {
      for (const gameDir of gameDirs) {
        // どのゲームのフォルダかは中身で判断する。取り違えると
        // 別のゲームのファイルで上書きしてしまうため。
        const repo = gameRepoFor(gameDir);
        // 複数あるときは、どのゲームを更新しているのか分かるように名前を出す
        const label = gameDirs.length > 1 ? repo.padEnd(6).slice(0, 18) : REPOS[1].label;
        changed += await updateOne(label, repo, gameDir, token, kind);
      }
    } else {
      console.log('  ゲーム   フォルダが見つからないので飛ばしました');
      console.log('      npm run update -- --game="ゲームのフォルダ" で指定できます');
    }
  } catch (err) {
    console.error(`\n更新できませんでした: ${err.message}`);
    if (!token) tokenHelp();
    process.exitCode = 1;
    return;
  }

  console.log('');
  if (changed === 0) {
    console.log('すべて最新です。');
  } else {
    console.log('更新しました。tikhub を起動し直してください (Ctrl+C → npm start)。');
    console.log('ゲーム画面はブラウザの再読み込み (F5) で反映されます。');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
