// ============================================================================
// Parser plugin: video (Bilibili/Douyin/YouTube → transcript & metadata)
// ============================================================================
// 统一流水线（去掉三档）：目标 = 拿到完整逐字稿再精读。
//   ① 有平台字幕（B站 AI 字幕 / YouTube CC）→ 直接用字幕（=全文，最快、零依赖）
//   ② 无公开字幕 → 用插件自带转写（faster-whisper small/int8/VAD，镜像+缓存）得到全文
//   ③ 都不行 → 降级（提示人工提供转写文本，或退回 desc 作背景）。
// 本机/用户使用一致：只依赖环境变量 + 相对/标准路径，不写死本机绝对路径。
// 提示词骨架复用 parsers/_prompt.js，此处只提供差异化配置。
// ============================================================================

const prompt = require("./_prompt");

module.exports = {
  name: "video",
  types: ["video"],
  description: "视频解析器（B站/抖音/YouTube → 完整逐字稿，字幕优先，无字幕自动转写）",

  buildPrompt: function (input, opts) {
    const tempDir = (opts && opts.tempDir) || "./.tmp";
    const wantTranscribe = opts.transcribe !== false;   // 默认 true：无字幕时自动走本地转写
    const degradeMsg = "需要人工提供转写文本或视频文案";
    const steps = [
      "记录文本来源（metadata.textSource）：subtitle（平台字幕）/ transcription（本地转写）/ desc（仅简介，作为降级/背景）/ manual（用户提供）。",
      "统一流程：① 先取视频字幕（B站 AI 字幕 / YouTube yt-dlp CC）；② 若**无公开字幕**，用插件自带 faster-whisper 转写得到全文；③ 仍不可行才降级（提示人工提供转写文本 或 退回 desc 作背景）。",
      "若输入是 B 站链接（bilibili.com / b23.tv，短链先用 curl -L 跟随重定向提取 BV 号）：用 curl（Windows 自带，零安装）调官方公开 API：\n" +
        "  1) 元数据+简介：curl 'https://api.bilibili.com/x/web-interface/view?bvid=<BV>' → 取 title / desc（简介仅作背景/补充，不满一篇精读）/ owner.name / duration / aid / cid\n" +
        "  2) 字幕（**优先，最快**）：curl 'https://api.bilibili.com/x/player/v2?aid=<aid>&cid=<cid>' 取 subtitle 列表；若有则下载转文本（textSource=subtitle）——这已是完整逐字稿，直接使用\n" +
        "  3) 无公开字幕时（textSource=transcription）：按下方「转写执行」用 faster-whisper 转写整段音频，得到完整全文。",

      "若输入是抖音链接/分享口令（douyin.com / v.douyin.com）：用户分享时复制的文字本身就是该视频的文案（desc）。desc 较完整时可直接作为文本（textSource=desc）；若 desc 太短，仍按下方「转写执行」转写（textSource=transcription）。",
      "若输入是 YouTube 等其他平台：先探测是否已装 yt-dlp（pwsh 运行 `yt-dlp --version`）。若未安装：绝对不要去下载 yt-dlp 二进制（GitHub 直连在部分网络下极慢且易中断，会卡死整个流程）；先试 `winget install yt-dlp.yt-dlp`，再试 `pip install -U yt-dlp -i https://pypi.tuna.tsinghua.edu.cn/simple`；仍不可用则按下方「转写执行」直接转写或降级。已安装时用 yt-dlp 抓字幕（CC）转文本；无 CC 则转写。",

      "转写执行（faster-whisper small/int8/中文，镜像+缓存，保证本机与用户一致）：",
      "  ① 先取音频：B站用 playurl（curl 'https://api.bilibili.com/x/player/playurl?avid=<aid>&cid=<cid>&fnval=16&fourk=1' 的 dash.audio[0].baseUrl）或 yt-dlp，下载存到 '" + tempDir + "/audio.m4a'；\n" +
        "  ② 定位插件转写脚本：用 Get-ChildItem -Path $env:USERPROFILE/.dsh -Recurse -Filter transcribe.ps1（或 glob 搜 *transcribe.ps1）找到 <脚本路径>；\n" +
        "  ③ 运行：pwsh <脚本路径> -Audio '" + tempDir + "/audio.m4a' -Out '" + tempDir + "/transcript.txt' -Model small -Language zh；\n" +
        "  ④ 转写可能较慢：用 pwsh（run_in_background: true）启动后，轮询输出文件 '" + tempDir + "/transcript.txt' 是否写出内容（非空且稳定），或日志出现 DONE；设合理超时，超时/失败则降级；\n" +
        "  ⑤ 成功后读取 transcript.txt 作为全文（textSource=transcription）。脚本自举：uv 建 Python 3.12 环境 + 镜像装 faster-whisper + hf-mirror 下模型并缓存。**⚠️ 首次转写会先下载 small 模型（约 484MB，hf-mirror）并较慢——先向用户说明这是正常的一次性下载，勿当成卡死；之后缓存复用、秒开。**",

      "若以上均不可用或抓取失败：输出 { \"saved\": false, \"message\": \"" + degradeMsg + "\" }。"
    ];

    return prompt.buildFetchPrompt({
      input: input,
      opts: opts,
      fetchTarget: "视频完整逐字稿（字幕优先，无字幕自动转写）",
      kindLabel: "视频（video）",
      steps: steps,
      chunkRule: "主题脉络（而非时间）",
      jsonExample: '{ "kind": "video", "saved": true, "totalLines": N, "metadata": { "title": "", "author": "", "year": "", "language": "zh|en", "textSource": "subtitle|transcription|desc|manual" }, "chunkPlan": [ { "id": 1, "topic": "主题段", "startLine": 1, "endLine": 200 } ] }'
    });
  }
};