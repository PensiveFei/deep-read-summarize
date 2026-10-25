// ============================================================================
// Parser plugin: video (Bilibili/Douyin/YouTube → transcript & metadata)
// ============================================================================
// 统一流水线（去掉三档）：目标 = 拿到完整逐字稿再精读。
//   ① 有平台字幕（B站 AI 字幕 / YouTube CC）→ 直接用字幕（=全文，最快、零依赖）
//   ② 无公开字幕 → 用插件自带转写（faster-whisper small/int8/VAD，镜像+缓存）得到全文
//   ③ 都不行 → 降级（提示人工提供转写文本，或退回 desc 作背景）。
// 本机/用户使用一致：只依赖环境变量 + 相对/标准路径，不写死本机绝对路径。
// 跨平台：Windows / macOS / Linux 同等支持。转写脚本是 Node 写的（scripts/transcribe.js），
//   三平台**命令行完全一致**；平台差异只在「脚本定位命令」与「yt-dlp 安装方式」上，
//   两套写法都在提示词里给出，由执行代理按自己的系统选择。
// ⚠️ 本提示词会被内联进 workflow 沙箱脚本执行，沙箱**不提供 process / require**，
//   所以这里不能按平台做分支（写了 process.platform 会直接被回归测试拦下），
//   只能把各平台的写法都列出来。详见 tests/run-tests.js 的沙箱 API 断言。
// 提示词骨架复用 parsers/_prompt.js，此处只提供差异化配置。
// ============================================================================

const prompt = require("./_prompt");

module.exports = {
  name: "video",
  types: ["video"],
  description: "视频解析器（B站/抖音/YouTube → 完整逐字稿，字幕优先，无字幕自动转写；Windows/macOS/Linux）",

  buildPrompt: function (input, opts) {
    const o = opts || {};
    const tempDir = o.tempDir || "./.tmp";
    // 默认 true：无字幕时自动走本地转写。false 时必须真的改变提示词——
    // 此前这里算出来的值从未被使用，transcribe:false 与 true 生成的提示词逐字相同。
    const wantTranscribe = o.transcribe !== false;
    const whisperModel = o.whisperModel || "small";
    const language = o.language || "zh";
    const device = o.device || "cpu";
    const includeTimestamps = o.includeTimestamps === true;
    const degradeMsg = "需要人工提供转写文本或视频文案";
    const sourceUrl = String(input).match(/https?:\/\/[^\s<>"']+/i);
    const source = sourceUrl ? sourceUrl[0] : String(input);
    const isBilibili = /^https?:\/\/(?:[^/?#]*@)?(?:[^/?#:]+\.)?(?:bilibili\.com|b23\.tv)(?=[:/?#]|$)/i.test(source);
    const pageMatch = isBilibili ? source.split('#')[0].match(/[?&]p=([^&#]*)/) : null;
    let pageValue = pageMatch ? pageMatch[1] : '';
    try { pageValue = decodeURIComponent(pageValue); } catch (error) { pageValue = 'invalid'; }
    if (pageMatch && (!/^[1-9]\d*$/.test(pageValue) || !Number.isSafeInteger(Number(pageValue)))) {
      return 'B站输入的 p 分P参数非法，必须是从 1 开始的整数。不要获取字幕或音频，也不要转写。只输出 ' +
        JSON.stringify({ saved: false, message: 'B站 p 分P参数非法，请指定有效的正整数分P编号' });
    }
    const requestedPage = pageMatch ? Number(pageValue) : null;
    const scriptPath = typeof o.transcribeScriptPath === 'string' && o.transcribeScriptPath ? o.transcribeScriptPath : '';
    // JSON encoding preserves arbitrary package paths as data. The executing
    // agent must quote the path for its shell, rather than copying raw text.
    const scriptCommand = scriptPath ? JSON.stringify(scriptPath) : '<脚本路径>';

    const noSubtitleBranch = wantTranscribe
      ? "② 若**无公开字幕**，用插件自带 faster-whisper 转写得到全文；③ 仍不可行才降级（提示人工提供转写文本 或 退回 desc 作背景）。"
      : "② **本次已禁用转写**（options.transcribe=false）：无公开字幕时直接降级（提示人工提供转写文本 或 退回 desc 作背景），不要尝试转写。";
    const biliNoSubtitle = wantTranscribe
      ? "  3) 无公开字幕时（textSource=transcription）：按下方「转写执行」用 faster-whisper 转写整段音频，得到完整全文。"
      : "  3) 无公开字幕时：转写已被禁用（options.transcribe=false），按降级处理，不要取音频、不要转写。";
    const douyinTail = wantTranscribe
      ? "desc 较完整时可直接作为文本（textSource=desc）；若 desc 太短，仍按下方「转写执行」转写（textSource=transcription）。"
      : "desc 较完整时可直接作为文本（textSource=desc）；若 desc 太短，直接降级提示用户补充文案（转写已禁用）。";
    const ytTail = wantTranscribe
      ? "已安装时用 yt-dlp 抓字幕（CC）转文本；无 CC 则转写。"
      : "已安装时用 yt-dlp 抓字幕（CC）转文本；无 CC 则降级（转写已禁用）。";

    const steps = [
      "记录文本来源（metadata.textSource）：subtitle（平台字幕）/ transcription（本地转写）/ desc（仅简介，作为降级/背景）/ manual（用户提供）。",
      includeTimestamps
        ? "保留真实时间定位：B站字幕保留每条 from/to，YouTube CC 保留每条 cue 的 start/end；转成文本时每段独占一行，格式为 [HH:MM:SS.mmm --> HH:MM:SS.mmm] 原文。写入目标文件时保留这些时间，不可把全文压成一行。简介/人工文案若没有真实时间信息，明确注明无法提供时间戳，禁止猜测或编造。"
        : "字幕或转写按原有分段逐段换行写入目标文件，保留内容结构，不要把全文压成一行；本次不要求在正文标时间戳。",
      "统一流程：① 先取视频字幕（B站 AI 字幕 / YouTube yt-dlp CC）；" + noSubtitleBranch,
      "若输入是 B 站链接（bilibili.com / b23.tv）：用 curl（Windows 10+ 与 macOS/Linux 均自带，零安装）调官方公开 API：\n" +
        "  0) 短链用 curl -L 取得完整最终 URL，保留 query。输入明确带 p 时保留该分P选择；否则读取重定向最终 URL 的 p；都没有才默认 p=1。不能只提取 BV 号而丢掉 p。p 必须为正整数，非法则 saved=false，禁止偷偷改读第1P。" + (requestedPage === null ? '' : '本次输入明确指定 p=' + requestedPage + '。') + "\n" +
        "  1) 元数据+简介：curl 'https://api.bilibili.com/x/web-interface/view?bvid=<BV>' → 取 title / desc（简介仅作背景/补充，不满一篇精读）/ owner.name / aid / pages。检查 p <= pages.length，取 selectedPage = pages[p-1]（并核对 selectedPage.page === p）；越界或该项缺失则 saved=false。选用 selectedPage.cid / selectedPage.part / selectedPage.duration；不能取顶层 cid/duration 代替指定分P。metadata 记录 bvid / page / cid / part / duration，标题包含分P名称，来源 URL 保留 p。\n" +
        "  2) 字幕（**优先，最快**）：curl 'https://api.bilibili.com/x/player/v2?aid=<aid>&cid=<selectedPage.cid>' 取 subtitle 列表；若有则下载转文本（textSource=subtitle）——只使用选中分P的字幕\n" +
        biliNoSubtitle,

      "若输入是抖音链接/分享口令（douyin.com / v.douyin.com）：用户分享时复制的文字本身就是该视频的文案（desc）。" + douyinTail,
      "若输入是 YouTube 等其他平台：先探测是否已装 yt-dlp（运行 `yt-dlp --version`）。若未安装：绝对不要去下载 yt-dlp 二进制（GitHub 直连在部分网络下极慢且易中断，会卡死整个流程）；**按系统装**——Windows 先试 `winget install yt-dlp.yt-dlp`，macOS 先试 `brew install yt-dlp`，三平台都可再试 `pip install -U yt-dlp -i https://pypi.tuna.tsinghua.edu.cn/simple`；" +
        (wantTranscribe ? "仍不可用则按下方「转写执行」直接转写或降级。" : "仍不可用则直接降级（转写已禁用）。") + ytTail
    ];

    if (wantTranscribe) {
      steps.push(
        "转写执行（faster-whisper " + whisperModel + " / int8 / " + language + "，镜像+缓存，保证本机与用户一致）：\n" +
        "  ① 先取音频：B站用 playurl（curl 'https://api.bilibili.com/x/player/playurl?avid=<aid>&cid=<selectedPage.cid>&fnval=16&fourk=1' 的 dash.audio[0].baseUrl）或 yt-dlp，下载存到 '" + tempDir + "/audio.m4a'；B站必须使用上面选中的 selectedPage.cid，yt-dlp 也必须保留指定分P，禁止改用第1P；\n" +
          (scriptPath
            ? "  ② 插件已定位本版本转写脚本：" + JSON.stringify(scriptPath) + "。直接使用这个文件；不要递归搜索其他安装目录或选取其他版本。路径是 JSON 字符串数据，执行前按当前 shell 规则正确引用（空格/引号/美元符号等不能作为命令解释）；\n"
            : "  ② 定位插件转写脚本（文件名固定 `transcribe.js`）：Windows 用 `Get-ChildItem -Path $env:USERPROFILE/.dsh -Recurse -Filter transcribe.js`；macOS/Linux 用 `find \"$HOME/.dsh\" -name transcribe.js`（也可直接用 glob 搜 *transcribe.js）；\n") +
          "  ③ 运行（**三平台命令行完全一致**，脚本是 Node 写的，与 pwsh / bash 无关）：`node " + scriptCommand + " --audio '" + tempDir + "/audio.m4a' --out '" + tempDir + "/transcript.txt' --device " + device + " --model " + whisperModel + " --language " + language + (includeTimestamps ? " --timestamps" : "") + "`；\n" +
          "  ④ 转写可能较慢：可用 run_in_background: true 启动，但必须跟踪**本次启动的进程**直到结束；只有确认**本次进程退出码为 0**，且本次目标文件 '" + tempDir + "/transcript.txt' 存在并非空，才算成功。脚本先写本次独有的暂存文件，校验后才原子发布目标文件；**不要仅凭文件非空/稳定或日志出现 DONE 判断完成，不要复用其他任务或上次运行的逐字稿**。设合理超时，超时则终止本次进程；超时/非 0 退出/空产物均按降级处理；\n" +
          "  ⑤ 成功后读取 transcript.txt 作为全文（textSource=transcription）。脚本自举：uv 建 Python 3.12 环境 + 镜像装 faster-whisper + hf-mirror 下模型并缓存；Windows/macOS/Linux 是**同一份实现**。**⚠️ 首次转写会先下载模型（small 约 484MB，hf-mirror，非 GitHub）并较慢——先向用户说明这是正常的一次性下载，勿当成卡死；之后缓存复用、秒开。**\n" +
          "  ⑥ 若 `node` 不在 PATH（macOS 从图形界面启动时常见），先用 `command -v node` 确认；确认不可用就直接降级，不要为了跑转写脚本去安装 Node。"
      );
    } else {
      steps.push(
        "【转写已禁用】options.transcribe=false：只允许使用平台字幕或简介（desc）。不要定位或运行 scripts/transcribe.js，不要下载模型，不要安装任何转写工具；拿不到字幕就按降级处理。"
      );
    }

    steps.push('若以上均不可用或抓取失败：输出 { "saved": false, "message": "' + degradeMsg + '" }。');

    return prompt.buildFetchPrompt({
      input: input,
      opts: o,
      fetchTarget: "视频完整逐字稿（字幕优先，无字幕自动转写）",
      kindLabel: "视频（video）",
      steps: steps,
      chunkRule: "主题脉络（而非时间）",
      jsonExample: '{ "kind": "video", "saved": true, "totalLines": N, "metadata": { "title": "", "author": "", "year": "", "language": "zh|en", "textSource": "subtitle|transcription|desc|manual" }, "chunkPlan": [ { "id": 1, "topic": "主题段", "startLine": 1, "endLine": 200 } ] }'
    });
  }
};
