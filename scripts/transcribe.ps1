# transcribe.ps1 - faster-whisper transcription bootstrap (plugin-internal, self-bootstrapping)
# Usage: pwsh transcribe.ps1 -Audio <file> -Out <txt> [-Model small] [-Language zh]
# Deterministic per-user cache so behavior is identical on dev & user machines.
param(
  [Parameter(Mandatory=$true)][string]$Audio,
  [Parameter(Mandatory=$true)][string]$Out,
  [string]$Model = 'small',
  [string]$Language = 'zh'
)
$ErrorActionPreference = 'Stop'

$cacheRoot = Join-Path $env:LOCALAPPDATA 'deep-read-summarize'
$venvDir   = Join-Path $cacheRoot 'venv'
$venvPy    = Join-Path $venvDir 'Scripts/python.exe'
$hfHome    = Join-Path $cacheRoot 'hf'
$pyScript  = Join-Path $cacheRoot 'transcribe_run.py'

New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null

$uv = $null
$uvCmd = Get-Command uv -ErrorAction SilentlyContinue
if ($uvCmd) { $uv = $uvCmd.Source }
else { $alt = Join-Path $HOME '.local/bin/uv.exe'; if (Test-Path $alt) { $uv = $alt } }
if (-not $uv) { throw 'uv not found. Please install uv (winget install astral-sh.uv) or ensure it is on PATH.' }

# Use a China mirror for CPython download (uv pulls python-build-standalone from GitHub, slow in CN),
# and prefer an already-installed 3.12 (avoids the download entirely on many machines).
$env:UV_PYTHON_INSTALL_MIRROR = 'https://ghproxy.com/https://github.com/astral-sh/python-build-standalone/releases/download'

if (-not (Test-Path $venvPy)) {
  # reuse an existing python 3.12 if present; else uv installs 3.12 (via mirror)
  $usePy = (py -0p 2>$null | Select-String '3.12' | Select-Object -First 1)
  if ($usePy) { $pyArg = '3.12' } else { $pyArg = '3.12' }
  & $uv venv --python $pyArg $venvDir
  if ($LASTEXITCODE -ne 0) { throw 'uv venv creation failed.' }
}

& $venvPy -c 'import faster_whisper' 2>$null
if ($LASTEXITCODE -ne 0) {
  & $uv pip install --python $venvPy faster-whisper -i https://pypi.tuna.tsinghua.edu.cn/simple
  if ($LASTEXITCODE -ne 0) { throw 'faster-whisper install failed (mirror unreachable?).' }
}

$env:HF_ENDPOINT = 'https://hf-mirror.com'
$env:HF_HOME = $hfHome
# Disable the hf-xet backend: it bypasses the mirror (cas-server.xethub.hf.co) and 401s; the mirror works over plain HTTP.
$env:HF_HUB_DISABLE_XET = '1'
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'
$env:DRS_AUDIO = $Audio
$env:DRS_OUT = $Out
$env:DRS_MODEL = $Model
$env:DRS_LANG = $Language

$py = @'
import os
from faster_whisper import WhisperModel
m = WhisperModel(os.environ['DRS_MODEL'], device='auto', compute_type='int8')
segs, info = m.transcribe(os.environ['DRS_AUDIO'], vad_filter=True, language=(os.environ.get('DRS_LANG') or None))
with open(os.environ['DRS_OUT'], 'w', encoding='utf-8') as f:
    for s in segs:
        f.write(s.text.strip() + ' ')
print('DONE', info.language, round(info.duration, 1))
'@
[System.IO.File]::WriteAllText($pyScript, $py, (New-Object System.Text.UTF8Encoding($false)))

& $venvPy $pyScript
if ($LASTEXITCODE -ne 0) { throw 'transcription failed.' }
Write-Output ('TRANSCRIBED ' + (Get-Item $Out).Length + ' bytes to ' + $Out)