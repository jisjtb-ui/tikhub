#!/usr/bin/env node
/**
 * tikhub とゲームを、その場で最新版に更新する。
 *
 *   npm run update
 *   npm run update -- --branch=claude/xxx     ブランチを指定する
 *   npm run update -- --game="ゲームのフォルダ"  ゲームを 1 つだけ指定する
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

import { findGameDirs, GAME_CONTAINERS } from '../src/bridge.js';

const OWNER = 'jisjtb-ui';

/**
 * どのブランチから取ってくるか。
 *
 * `main` を決め打ちにしていたのが原因で、次の 2 つが起きていました:
 *
 *   - circlebattle には main がまだ無いので 404 になり、
 *     「非公開のようです」という的外れな案内が出ていた
 *   - tikhub の main が古いままだと、**新しい方を古い方で上書き**してしまう
 *
 * そこで、リポジトリごとに既定ブランチを GitHub に聞いてから取ります。
 * 順に試して、最初に取れたものを使います:
 *
 *   1. --branch= / .env の GITHUB_BRANCH (指定があれば最優先)
 *   2. そのリポジトリの既定ブランチ (GitHub に聞く)
 *   3. main
 *   4. master
 */
function branchCandidates(override, fallback) {
  return [...new Set([override, fallback, 'main', 'master'].filter(Boolean))];
}

/** 書庫の URL。ブランチ名に / が入っていても GitHub はそのまま受け付けます。 */
function archiveUrl(repo, branch, kind) {
  const ext = kind === 'tar' ? 'tar.gz' : 'zip';
  return `https://github.com/${OWNER}/${repo}/archive/refs/heads/${branch}.${ext}`;
}

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

/**
 * 上書き対象から外すもの。利用者が置いたファイルを消さないため。
 * games/ はゲーム本体を入れる場所なので、tikhub の更新では触りません。
 */
const KEEP = new Set(['.env', 'node_modules', '.git', 'bgm', ...GAME_CONTAINERS]);

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
 * そのリポジトリの既定ブランチを GitHub に聞く。
 * 聞けなければ null を返し、呼ぶ側は main / master を試します。
 */
async function defaultBranch(repo, token) {
  const base = { ...UA, Accept: 'application/vnd.github+json' };
  // 認証なしを先に試します。公開リポジトリならこれで足りますし、
  // .env に古いトークンが残っていても巻き込まれません
  // (無効なトークンを付けると、公開リポジトリでも 401 で弾かれます)。
  const attempts = token ? [base, { ...base, Authorization: `Bearer ${token}` }] : [base];

  for (const headers of attempts) {
    try {
      const res = await fetch(`https://api.github.com/repos/${OWNER}/${repo}`, { headers });
      if (!res.ok) continue;
      const info = await res.json();
      if (info.default_branch) return info.default_branch;
    } catch {
      /* ネットワークが不調でも、下の候補で続けます */
    }
  }
  return null;
}

/**
 * 1 つのブランチから書庫を落とす。無ければ null を返します。
 *
 * まず**認証なし**で公開用の URL を叩きます。公開リポジトリならこれで取れますし、
 * .env に古いトークンが残っていても巻き込まれません
 * (無効なトークンを付けると、公開リポジトリでも 401 で弾かれます)。
 *
 * これが 404 になるのは非公開かブランチ違いのときなので、
 * そのときだけトークンを付けて API から取り直します。
 */
async function downloadBranch(repo, branch, token, kind, notes) {
  let res = await fetch(archiveUrl(repo, branch, kind), { headers: UA, redirect: 'follow' });

  if (!res.ok && token) {
    const kindPath = kind === 'tar' ? 'tarball' : 'zipball';
    res = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/${kindPath}/${branch}`, {
      headers: { ...UA, Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
      redirect: 'follow',
    });
    // トークンが駄目でも、ここでは止めません。別のブランチなら認証なしで
    // 取れることがあるためです。全部だめだったときに download() が伝えます。
    if (res.status === 401 || res.status === 403) {
      notes.badToken = true;
      return null;
    }
  }

  if (res.status === 404) return null;                 // このブランチは無い
  if (!res.ok) throw new Error(`${repo}: ダウンロードに失敗しました (HTTP ${res.status})`);

  const ext = kind === 'tar' ? 'tar.gz' : 'zip';
  const file = path.join(os.tmpdir(), `${repo}-${Date.now()}.${ext}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** 候補を順に試して、最初に取れたものを使う。 */
async function download(repo, token, kind, override) {
  // ブランチを指定されたときは、それ以外を試しません。
  // 指定したのに別のものが入ってしまうのが一番困るためです。
  const found = override ? null : await defaultBranch(repo, token);
  const branches = override ? [override] : branchCandidates(null, found);
  const notes = { badToken: false };

  for (const branch of branches) {
    const file = await downloadBranch(repo, branch, token, kind, notes);
    if (file) return { file, branch };
  }

  // どの候補でも取れなかった。原因を切り分けて伝えます
  if (found || override) {
    throw new Error(`${repo}: ブランチが見つかりません (試したもの: ${branches.join(', ')})。`
      + '\n      npm run update -- --branch="ブランチ名" で指定できます。');
  }
  if (notes.badToken) {
    throw new Error(`${repo}: トークンが受け付けられませんでした。.env の GITHUB_TOKEN を確認するか、行ごと消してください。`);
  }
  throw new Error(token
    ? `${repo} を取得できません。トークンにこのリポジトリの権限があるか確認してください。`
    : `${repo} が非公開のようです。GITHUB_TOKEN が必要です。`);
}

/**
 * GitHub が実際に返したブランチ名を、展開されたフォルダ名から読む。
 *
 * 頼んだブランチ名をそのまま表示すると嘘になることがあります。GitHub は
 * `master` を**既定ブランチへ黙って読み替える**ので、master が無いリポジトリでも
 * 200 が返り、中身は既定ブランチのものになります。
 * どこから入れたのかが分からないと、古いブランチで上書きしても気づけません。
 *
 * フォルダ名は `<repo>-<ref>` で、ref の / は - になっています。
 */
function servedRef(childDir, repo) {
  const name = path.basename(childDir);
  return name.startsWith(`${repo}-`) ? name.slice(repo.length + 1) : name;
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

async function updateOne(label, repo, targetDir, token, kind, override) {
  process.stdout.write(`  ${label}  `);
  const { file: archive } = await download(repo, token, kind, override);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tikhub-update-'));
  try {
    extract(archive, tmp, kind);
    const child = singleChild(tmp);
    // 頼んだ名前ではなく、**実際に返ってきたもの**を出します
    const branch = servedRef(child, repo);
    const stats = overlay(child, targetDir, { changed: [], root: targetDir });
    console.log(stats.changed.length === 0
      ? `最新でした  (${branch})`
      : `${stats.changed.length} ファイルを更新  (${branch})`);
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

  // ブランチの指定。開発中のブランチから入れたいときに使います。
  const branchArg = process.argv.find((a) => a.startsWith('--branch='));
  const override = branchArg
    ? branchArg.slice('--branch='.length)
    : (process.env.GITHUB_BRANCH || '').trim() || null;

  const kind = hasTar() ? 'tar' : 'zip';
  console.log(override ? `最新版に更新します (ブランチ: ${override})\n` : '最新版に更新します\n');

  let changed = 0;
  try {
    changed += await updateOne(REPOS[0].label, REPOS[0].repo, here, token, kind, override);
    if (gameDirs.length) {
      for (const gameDir of gameDirs) {
        // どのゲームのフォルダかは中身で判断する。取り違えると
        // 別のゲームのファイルで上書きしてしまうため。
        const repo = gameRepoFor(gameDir);
        // 複数あるときは、どのゲームを更新しているのか分かるように名前を出す
        const label = gameDirs.length > 1 ? repo.padEnd(6).slice(0, 18) : REPOS[1].label;
        changed += await updateOne(label, repo, gameDir, token, kind, override);
      }
    } else {
      // 「見つからない」だけだと、まだ 1 つも持っていない人が次に何をすれば
      // よいのか分かりません。**置き場所を実際に作って**、取得先も出します。
      const box = path.join(here, GAME_CONTAINERS[0]);
      fs.mkdirSync(box, { recursive: true });

      console.log('  ゲーム   フォルダが見つかりませんでした');
      console.log(`      ここに展開して入れてください: ${box}`);
      for (const repo of GAME_REPOS) {
        console.log(`        https://github.com/${OWNER}/${repo}/archive/refs/heads/main.zip`);
      }
      console.log('      次からは自動で見つけて更新します');
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

export { branchCandidates, archiveUrl, gameRepoFor, servedRef };

// 直接実行されたときだけ動かす (テストから読み込んでも更新は走りません)
const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (!invokedDirectly) {
  // 読み込まれただけ。何もしません。
} else main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
