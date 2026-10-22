# ============================================================
#  Secretary -> Supabase auto-provision (Management API)
#  Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File tools\supabase-setup.ps1
#  Needs:  a Supabase Personal Access Token (PAT) saved to any of:
#     C:\Users\ACER\Documents\sb_pat.txt     (recommended)
#     C:\Users\ACER\Desktop\sb_pat.txt
#  It will: create table + RLS + indexes (from supabase\schema.sql),
#           disable "Confirm email" (mailer_autoconfirm=true), then verify.
#  The token is NEVER printed anywhere.
# ============================================================
param(
  [string]$ProjectRef = 'eppalhuphlvrwsbjjhzk',
  [string]$PatFile = ''
)
$ErrorActionPreference = 'Stop'
$Api = "https://api.supabase.com"

# ---------- 1) gather the PAT ----------
if (-not $PatFile) {
  $candidates = @(
    "$env:USERPROFILE\Documents\sb_pat.txt",
    "$env:USERPROFILE\Desktop\sb_pat.txt",
    "$env:USERPROFILE\Documents\.env.txt"
  )
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c) {
      $raw = Get-Content -LiteralPath $c -Raw
      $m = [regex]::Match($raw, 'sbp_[A-Za-z0-9_\-]{20,}')
      if ($m.Success) { $PatFile = $c; break }
    }
  }
} else {
  $raw = Get-Content -LiteralPath $PatFile -Raw
  $m = [regex]::Match($raw, 'sbp_[A-Za-z0-9_\-]{20,}')
  if (-not $env:SB_PAT) { $env:SB_PAT = $m.Value }
}
if (-not $env:SB_PAT) {
  if ($PatFile -and (Test-Path -LiteralPath $PatFile)) {
    $raw = Get-Content -LiteralPath $PatFile -Raw
    $m = [regex]::Match($raw, 'sbp_[A-Za-z0-9_\-]{20,}')
    if ($m.Success) { $env:SB_PAT = $m.Value }
  }
}
if (-not $env:SB_PAT) {
  Write-Host "MISSING PAT - not found in Documents/Desktop (sb_pat.txt)"
  Write-Host "Steps:"
  Write-Host "  1) open https://supabase.com/dashboard/account/tokens"
  Write-Host "  2) Generate new token (name it: secretary)"
  Write-Host "  3) copy the token (starts with sbp_) and save it as C:\Users\ACER\Documents\sb_pat.txt"
  Write-Host "  4) then run this script again"
  exit 1
}
$PAT = [regex]::Match($env:SB_PAT, 'sbp_[A-Za-z0-9_\-]{20,}').Value
if (-not $PAT) { $PAT = $env:SB_PAT.Trim() }
Write-Host ("PAT found: " + $PAT.Substring(0, 6) + "...[masked]")

# ---------- helpers ----------
function Invoke-SbApi {
  param([string]$Method, [string]$Path, [object]$Body)
  $headers = @{ Authorization = ('Bearer ' + $PAT); 'Content-Type' = 'application/json' }
  $json = if ($null -ne $Body) { $Body | ConvertTo-Json -Depth 8 } else { $null }
  $resp = Invoke-WebRequest -Uri ($Api + $Path) -Method $Method -Headers $headers -Body $json -UseBasicParsing -TimeoutSec 60
  return $resp
}

# ---------- 2) validate the token ----------
try {
  $proj = Invoke-SbApi -Method GET -Path "/v1/projects/$ProjectRef" | ForEach-Object { $_.Content | ConvertFrom-Json }
  Write-Host ("OK token valid. project: " + $proj.name + " | status: " + $proj.status)
} catch {
  Write-Host ("INVALID PAT or no access to project " + $ProjectRef + ": " + $_.Exception.Message)
  exit 1
}

# ---------- 3) create the schema (table + RLS + policies + indexes) ----------
$ddlPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'supabase\schema.sql'
if (-not (Test-Path -LiteralPath $ddlPath)) { Write-Host ("schema.sql not found: " + $ddlPath); exit 1 }
$sql = (Get-Content -LiteralPath $ddlPath -Raw -Encoding UTF8) -replace '--[^\r\n]*', ' '
$sql = $sql -replace '\$\$[\s\S]*?\$\$', ' ''auto trigger'' '     # keep the parser simple: replace function body (re-added below)
$sql = $sql -replace 'create or replace function[\s\S]*?language plpgsql;', ' '  # handled separately
$sql = $sql -replace '\$\$ language plpgsql;', ' '                # safety
$sql = $sql -replace '\s+', ' '

# the trigger function statement from schema.sql uses $$ ... $$ — run it as one clean statement
$fnSql = @'
create or replace function public.touch_updated_at()
returns trigger as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$ language plpgsql;
'@

$queries = @(
  $fnSql,
  ($sql + ' select to_regclass(' + "'''public.secretary_items'''")
)
# ---- run statements one by one (the API accepts a single SQL string per call) ----
$steps = @(
  @{ name = 'touch_updated_at()'; q = $fnSql },
  @{ name = 'tables + indexes';   q = "create table if not exists public.secretary_items (id text primary key, user_id uuid not null references auth.users (id) on delete cascade, kind text not null default 'task', data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()); create index if not exists secretary_items_user_idx on public.secretary_items (user_id); create index if not exists secretary_items_kind_idx on public.secretary_items (user_id, kind);" },
  @{ name = 'RLS enable';         q = "alter table public.secretary_items enable row level security; alter table public.secretary_items replica identity full;" },
  @{ name = 'RLS policy items';   q = "drop policy if exists 'secretary own rows' on public.secretary_items; create policy 'secretary own rows' on public.secretary_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);" },
  @{ name = 'profiles table';     q = "create table if not exists public.secretary_profiles (id uuid primary key references auth.users (id) on delete cascade, name text, email text, settings jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()); alter table public.secretary_profiles enable row level security; drop policy if exists 'secretary own profile' on public.secretary_profiles; create policy 'secretary own profile' on public.secretary_profiles for all using (auth.uid() = id) with check (auth.uid() = id);" },
  @{ name = 'trigger';            q = "drop trigger if exists secretary_items_touch on public.secretary_items; create trigger secretary_items_touch before update on public.secretary_items for each row execute function public.touch_updated_at();" }
)

foreach ($st in $steps) {
  try {
    $body = @{ query = $st.q }
    Invoke-SbApi -Method POST -Path ("/v1/projects/$ProjectRef/database/query") -Body $body | Out-Null
    Write-Host ("OK  step: " + $st.name)
  } catch {
    $errText = ""
    try { $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream()); $errText = $sr.ReadToEnd() } catch { $errText = $_.Exception.Message }
    if ($errText -match 'already exists') { Write-Host ("OK  step (already existed): " + $st.name) }
    else { Write-Host ("FAIL step: " + $st.name + " -> " + $errText); exit 1 }
  }
}

# ---------- 4) disable "Confirm email" (instant signup session) ----------
try {
  Invoke-SbApi -Method PATCH -Path "/v1/projects/$ProjectRef/config/auth" -Body @{ mailer_autoconfirm = $true } | Out-Null
  Write-Host "OK  mailer_autoconfirm = true (Confirm email disabled)"
} catch {
  Write-Host ("WARN could not PATCH auth config: " + $_.Exception.Message + " | do it manually: Auth -> Providers -> Email -> disable Confirm email")
}

# ---------- 5) verify ----------
try {
  $chk = @{ query = "select to_regclass('public.secretary_items') as tbl, (select count(*) from pg_policies where tablename='secretary_items') as policies;" }
  $r = Invoke-SbApi -Method POST -Path "/v1/projects/$ProjectRef/database/query" -Body $chk
  Write-Host ("VERIFY -> " + $r.Content)
  $auth = Invoke-SbApi -Method GET -Path "/v1/projects/$ProjectRef/config/auth"
  Write-Host ("AUTH   -> mailer_autoconfirm: " + (($auth.Content | ConvertFrom-Json).mailer_autoconfirm))
} catch {
  Write-Host ("verify warn: " + $_.Exception.Message)
}

Write-Host "DONE"
Write-Host "security tip: you can revoke this PAT from supabase.com/dashboard/account/tokens after the setup is confirmed."
