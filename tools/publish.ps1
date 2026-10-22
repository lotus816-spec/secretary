# ============================================================
#  سكرتاري | Secretary — نشر المشروع على GitHub + GitHub Pages
#  الاستخدام:  powershell -ExecutionPolicy Bypass -File tools\publish.ps1
#  - ينسخ مجلد secretary إلى مجلد مؤقت كجذر المستودع
#  - ينشئ/يحدّث المستودع ويرفع الملفات
#  - يفعّل GitHub Pages من الفرع main
# ============================================================
param(
  [string]$Repo = 'secretary',
  [string]$Description = 'سكرتاري | Secretary — منظّم شخصي لليوم والأسبوع والشهر مع تذكيرات صوتية ومخطط للخطط المتجددة',
  [string]$TokenDocx = "$env:USERPROFILE\Desktop\.env.txt.1\.env.txt.docx",
  [switch]$SkipPages
)

$ErrorActionPreference = 'Stop'
$GhUser = 'lotus816-spec'

# ---------- 1) تحميل الرمز ----------
function Get-GhToken {
  param([string]$DocxPath)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($DocxPath)
  try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }
    $sr = New-Object System.IO.StreamReader($entry.Open())
    $xml = $sr.ReadToEnd(); $sr.Close()
  } finally { $zip.Dispose() }
  $plain = ($xml -replace '<[^>]+>', ' ')
  $m = [regex]::Match($plain, 'gh[pousr]_[A-Za-z0-9]{20,}')
  if (-not $m.Success) { throw "لم يُعثر على رمز GitHub في: $DocxPath" }
  return $m.Value
}

if (Test-Path -LiteralPath $TokenDocx) { $env:GH_TOKEN = Get-GhToken -DocxPath $TokenDocx }
if (-not $env:GH_TOKEN) { throw 'GH_TOKEN غير موجود' }

# ---------- 2) تجهيز مجلد النشر ----------
$src = Split-Path -Parent $PSScriptRoot          # مجلد secretary
$stage = Join-Path $env:TEMP ('secretary-publish-' + $Repo)
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

Get-ChildItem -LiteralPath $src -Force | Where-Object { $_.Name -ne '.git' } | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $stage -Recurse -Force
}

# رفع إصدار الأصول (?v=N) لكسر كاش المتصفح بعد كل نشر
$idx = Join-Path $stage 'index.html'
if (Test-Path -LiteralPath $idx) {
  $html = Get-Content -LiteralPath $idx -Raw -Encoding UTF8
  $m = [regex]::Match($html, '\?v=(\d+)')
  $newV = if ($m.Success) { [int]$m.Groups[1].Value + 1 } else { 2 }
  $html = [regex]::Replace($html, '\?v=\d+', "?v=$newV")
  [System.IO.File]::WriteAllText($idx, $html, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "✔ bumped asset version -> ?v=$newV"
}
Write-Host "✔ تم تجهيز مجلد النشر: $stage"

# ---------- 3) إنشاء المستودع (إن لم يكن موجوداً) ----------
$exists = $false
$prevPref = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
& gh repo view "$GhUser/$Repo" --json name 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { $exists = $true }
$ErrorActionPreference = $prevPref

if ($exists) {
  Write-Host "✔ المستودع $GhUser/$Repo موجود — سيتم التحديث"
} else {
  $ErrorActionPreference = 'Continue'
  & gh repo create "$GhUser/$Repo" --public --description $Description 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { throw 'فشل إنشاء المستودع' }
  Start-Sleep -Seconds 2
}

# ---------- 4) git: commit + push ----------
Push-Location $stage
try {
  & git init -q -b main 2>&1 | Out-Null
  & git config user.name 'Secretary Bot'
  & git config user.email 'secretary@users.noreply.github.com'
  & git config core.autocrlf false

  # مصادقة عبر askpass حتى لا يظهر الرمز في العنوان أو المخرجات
  $ask = Join-Path $env:TEMP ('gh-askpass-' + $Repo + '.cmd')
  @'
@echo off
echo %~1 | findstr /i "Username" >nul
if not errorlevel 1 (echo x-access-token) else (echo %GH_TOKEN%)
'@ | Set-Content -LiteralPath $ask -Encoding ASCII
  $env:GIT_ASKPASS = $ask
  $env:GIT_TERMINAL_PROMPT = '0'

  $prevPref2 = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  & git remote remove origin 2>&1 | Out-Null
  $ErrorActionPreference = 'Continue'   # git يكتب التقدّم على stderr
  & git remote add origin "https://github.com/$GhUser/$Repo.git"

  # مزامنة مع الفرع الموجود في المستودع (بدون إفساد السجل)
  & git fetch origin main 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    & git reset --mixed origin/main 2>&1 | Out-Null
    & git branch -f main origin/main 2>&1 | Out-Null
    & git checkout -q main 2>&1 | Out-Null
  }

  & git add -A
  $staged = (& git diff --cached --name-only | Measure-Object).Count
  & git commit -q -m "سكرتاري: منظّم اليوم والأسبوع والشهر مع تذكيرات صوتية ومخطط الخطط المتجددة"
  if ($LASTEXITCODE -ne 0) { Write-Host '... لا توجد تغييرات جديدة' }

  & git push -u origin main 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { throw 'فشل الرفع' }
  Write-Host ("✔ تم رفع " + $staged + " ملفاً إلى " + $GhUser + "/" + $Repo)
} finally {
  $ErrorActionPreference = $prevPref2
  Pop-Location
}

# ---------- 5) تفعيل GitHub Pages ----------
if (-not $SkipPages) {
  # إزالة إعداد قديم إن وجد
  & gh api "repos/$GhUser/$Repo/pages" --method DELETE 2>$null | Out-Null
  Start-Sleep -Seconds 2
  $bodyFile = Join-Path $env:TEMP ('gh-pages-' + $Repo + '.json')
  $body = '{"source":{"branch":"main","path":"/"},"build_type":"legacy"}'
  [System.IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding($false)))
  $out = & gh api "repos/$GhUser/$Repo/pages" --method POST --input $bodyFile 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    Write-Host '... creating Pages via branch fallback'
    & gh api "repos/$GhUser/$Repo/pages" --method POST -f "source[branch]=main" -f "source[path]=/" 2>&1 | ForEach-Object { Write-Host $_ }
  } else {
    Write-Host $out
  }
  Start-Sleep -Seconds 3
  $pages = & gh api "repos/$GhUser/$Repo/pages" 2>&1 | Out-String
  Write-Host '--- Pages status ---'
  Write-Host $pages
}
