// scripts/coverage.js — 覆盖率门槛（零依赖，用 Node 自带 lcov reporter）
//
// 为什么要有这个文件：tests/ 里已经有四千多行测试、282 个 case，但没有任何东西
// 阻止「新代码零测试地进来」——总量被历史存量撑着，缺口只在新增文件上显形。
// 2026-11 复核项目成熟度时，这一条被点名为测试维度最大的盲区：case 数是厚度，
// 不是覆盖比例。
//
// 为什么不用 c8 / nyc：本项目运行时依赖只有 acorn 一个、且精确锁定版本，
// 为了一行阈值再拉一条依赖链，等于给发布链（OIDC Trusted Publishing）多开一个口子。
// Node 自带 `--test-reporter=lcov`，机器可读，够用了。
//
// 为什么自己算阈值而不用 --test-coverage-lines 这类参数：那几个参数还在实验期，
// 且只给全局数；自己解析 lcov 才能同时约束单文件，失败时也能指出是哪个文件、
// 差多少。门槛报错必须可操作，否则下一个人只会把它删掉。
//
// 单文件下限为什么是 40：抓的是「新文件根本没测试」，不是要求每个 CLI 脚本测满。
// scripts/release.js 的交互路径由 tests/release-identity.test.js 用桩覆盖，
// 真实交互只有发布那一刻才走到，它天然在 50% 上下——把下限抬到 70 只会逼人写假测试。
//
// 为什么门槛只在 ubuntu 上卡：平台分支（转写、路径、bash）在不同 OS 上执行到的代码
// 不同，同一份源码在 windows 上天然低几个点。用同一阈值去卡三个平台，
// 结果不会是「更严格」，而是「windows 永远红」。
//
// 用法：
//   node scripts/coverage.js                 跑测试并检查门槛（CI 用这个）
//   node scripts/coverage.js --check-only    不跑测试，只检查已有 coverage/lcov.info
//   其余参数原样透传给 `node --test`，例如 --test-skip-pattern 只跑部分用例：
//   node scripts/coverage.js --test-skip-pattern="B10 actual"

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const LCOV = path.join(ROOT, 'coverage', 'lcov.info');

// 门槛是地板，不是目标。0.6.6 实测（Windows / Node 24）行 89.2% / 分支 85.4% / 函数 90.6%，
// 地板取在下方约 3 个点：跨平台与正常重构都不会误伤，又不会让这行数字变成装饰。
// 每次 CI 都会打印实测值；等它在几个平台上稳定下来，再把地板往上抬——
// 抬门槛是维护者的决定，这里只负责让它一开始就能立住、而不是第一次跑就红。
// 调高要写明理由并同步 CONTRIBUTING.md；调低等于删掉门槛。
const LIMITS = { lines: 86, branches: 83, functions: 88, fileLines: 40 };

// 少于这个行数的文件不参与单文件下限：百分比在小分母上抖动太大，
// 一个 6 行文件的 66% 说明不了任何事。总量门槛仍然覆盖它们。
const MIN_FILE_LINES = 10;

function pct(hit, total) {
  return total ? (hit / total) * 100 : 100;
}

/** 解析 lcov。缺 LF/LH 这类汇总行时退回 DA/BRDA/FNDA 自己数，不信「规范说一定有」。 */
function parseLcov(text) {
  const records = [];
  let cur = null;
  function close() {
    if (cur) {
      cur.file = cur.file.replace(/\\/g, '/');
      records.push(cur);
      cur = null;
    }
  }
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('SF:')) {
      close();
      cur = { file: line.slice(3), lf: 0, lh: 0, brf: 0, brh: 0, fnf: 0, fnh: 0, da: 0, dahit: 0 };
      continue;
    }
    if (line === 'end_of_record') {
      close();
      continue;
    }
    if (!cur) continue;
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const key = line.slice(0, sep);
    const value = line.slice(sep + 1);
    if (key === 'LF') cur.lf = Number(value) || 0;
    else if (key === 'LH') cur.lh = Number(value) || 0;
    else if (key === 'BRF') cur.brf = Number(value) || 0;
    else if (key === 'BRH') cur.brh = Number(value) || 0;
    else if (key === 'FNF') cur.fnf = Number(value) || 0;
    else if (key === 'FNH') cur.fnh = Number(value) || 0;
    else if (key === 'DA') {
      const parts = value.split(',');
      cur.da += 1;
      if (Number(parts[1]) > 0) cur.dahit += 1;
    }
  }
  close();
  for (const r of records) {
    if (!r.lf) {
      r.lf = r.da;
      r.lh = r.dahit;
    }
  }
  return records;
}

/** 逐条比对门槛。返回结构化结果，CLI 与测试共用同一份判定，避免两处逻辑漂移。 */
function evaluate(records, limits) {
  const agg = { lf: 0, lh: 0, brf: 0, brh: 0, fnf: 0, fnh: 0 };
  const files = [];
  for (const r of records) {
    agg.lf += r.lf;
    agg.lh += r.lh;
    agg.brf += r.brf;
    agg.brh += r.brh;
    agg.fnf += r.fnf;
    agg.fnh += r.fnh;
    files.push({
      file: r.file,
      lines: pct(r.lh, r.lf),
      branches: r.brf ? pct(r.brh, r.brf) : null,
      total: r.lf
    });
  }
  const aggregate = {
    lines: pct(agg.lh, agg.lf),
    branches: pct(agg.brh, agg.brf),
    functions: pct(agg.fnh, agg.fnf)
  };
  const failures = [];
  if (aggregate.lines < limits.lines) {
    failures.push('总行覆盖 ' + aggregate.lines.toFixed(2) + '% < 门槛 ' + limits.lines + '%');
  }
  if (aggregate.branches < limits.branches) {
    failures.push('总分支覆盖 ' + aggregate.branches.toFixed(2) + '% < 门槛 ' + limits.branches + '%');
  }
  if (aggregate.functions < limits.functions) {
    failures.push('总函数覆盖 ' + aggregate.functions.toFixed(2) + '% < 门槛 ' + limits.functions + '%');
  }
  for (const f of files) {
    if (f.total >= MIN_FILE_LINES && f.lines < limits.fileLines) {
      failures.push(f.file + ' 行覆盖 ' + f.lines.toFixed(1) + '% < 单文件下限 ' + limits.fileLines + '%');
    }
  }
  files.sort(function (a, b) { return a.lines - b.lines; });
  return { ok: failures.length === 0, aggregate, files, failures, aggregate_raw: agg };
}

function die(message) {
  console.error('COVERAGE: ' + message);
  process.exit(1);
}

function runSuite(extraArgs) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) {
    die('需要 Node >= 22（`--test-reporter=lcov` 从 22.x 起提供），当前 ' + process.version +
      '\n         CI 在 ubuntu / Node 22 上跑这个门槛；本机请用 nvm 或直接跳过这一步。');
  }
  fs.mkdirSync(path.dirname(LCOV), { recursive: true });
  const args = [
    '--test',
    '--experimental-test-coverage',
    // 两个 reporter 必须都显式声明：只写 lcov 的话 spec 输出会被替换掉，
    // CI 上看不到是哪个用例红了，只剩一个退出码。
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=lcov', '--test-reporter-destination=' + LCOV
  ].concat(extraArgs);
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) die('无法启动测试进程：' + result.error.message);
  if (result.status !== 0) {
    die('测试未通过（退出码 ' + result.status + '），覆盖率不评估 —— ' +
      '红的测试面前谈百分比没有意义，先修测试。');
  }
}

function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.indexOf('--check-only') >= 0;
  const passthrough = argv.filter(function (a) { return a !== '--check-only'; });
  if (!checkOnly) runSuite(passthrough);
  if (!fs.existsSync(LCOV)) {
    die('找不到 ' + path.relative(ROOT, LCOV) + '，先跑一次 `node scripts/coverage.js`。');
  }
  const records = parseLcov(fs.readFileSync(LCOV, 'utf8'));
  if (!records.length) die('lcov 里没有任何记录，测试可能一个源文件都没加载。');
  const report = evaluate(records, LIMITS);
  const a = report.aggregate;
  console.log('');
  console.log('覆盖率（' + records.length + ' 个文件）：行 ' + a.lines.toFixed(2) + '%' +
    ' / 分支 ' + a.branches.toFixed(2) + '%' +
    ' / 函数 ' + a.functions.toFixed(2) + '%');
  console.log('门槛：行 ' + LIMITS.lines + '% / 分支 ' + LIMITS.branches + '% / 函数 ' +
    LIMITS.functions + '% / 单文件行 ' + LIMITS.fileLines + '%');
  // 只把最低的 5 个列出来：这是债务可见性，不是失败判据。
  const lowest = report.files.slice(0, 5);
  if (lowest.length) {
    console.log('最低的 5 个（债务提示，不判失败）：');
    for (const f of lowest) {
      console.log('  ' + f.lines.toFixed(1).padStart(6) + '%  ' + f.file);
    }
  }
  if (!report.ok) {
    for (const failure of report.failures) console.error('COVERAGE: ' + failure);
    console.error('覆盖率门槛未通过（' + report.failures.length + ' 项）。' +
      '新增代码请补测试；确属 CLI 交互路径的，在 CONTRIBUTING.md 说明原因后调低单文件下限。');
    process.exit(1);
  }
  console.log('Coverage OK: 门槛内（行 ' + a.lines.toFixed(2) + '%）');
}

module.exports = { parseLcov, evaluate, LIMITS, MIN_FILE_LINES };

if (require.main === module) main();
