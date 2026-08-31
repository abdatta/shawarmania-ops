param(
  [Parameter(Mandatory = $true)]
  [string]$SnapshotRoot,

  [Parameter(Mandatory = $true)]
  [string]$Database,

  [string]$Container = 'supabase_db_shawarmania-ops'
)

$ErrorActionPreference = 'Stop'

# This is a disaster-recovery proof, not a routine application migration. It is
# intentionally fenced to disposable rehearsal databases: restoring the dump
# replaces the complete public schema.
if ($Database -notmatch '^retire_ledger_[a-z0-9_]+$') {
  throw "Refusing to replace '$Database'. The database name must start with retire_ledger_."
}

$resolvedSnapshot = (Resolve-Path -LiteralPath $SnapshotRoot).Path
$schemaDump = Join-Path $resolvedSnapshot 'schema-public.sql'
$dataDump = Join-Path $resolvedSnapshot 'data-public.sql'

foreach ($required in @($schemaDump, $dataDump)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Missing rollback input: $required"
  }
}

function Invoke-PsqlText {
  param([Parameter(Mandatory = $true)][string]$Sql)

  $Sql | & docker exec -i $Container psql --username postgres --dbname $Database --set ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed while restoring $Database."
  }
}

function Invoke-PsqlFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  $sql = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  Invoke-PsqlText -Sql $sql
}

# Preserve Supabase's auth/storage plumbing in the scratch database. Only the
# public estate is returned to the exact pre-retirement snapshot.
Invoke-PsqlText -Sql 'drop schema public cascade; create schema public authorization pg_database_owner;'
Invoke-PsqlFile -Path $schemaDump
Invoke-PsqlFile -Path $dataDump

# A manual psql rehearsal does not create this row, while a migration runner
# does. Removing it when present keeps the restored scratch internally honest.
Invoke-PsqlText -Sql @'
delete from supabase_migrations.schema_migrations
where version = '20260831020000';
'@

Invoke-PsqlText -Sql @'
do $rollback_check$
begin
  if to_regclass('public.manual_ledger_days') is null
     or to_regclass('public.manual_ledger_expenses') is null
     or to_regclass('public.daily_cash_records') is null
     or to_regclass('public.cash_withdrawals') is null
     or to_regclass('public.expenses') is null then
    raise exception 'rollback did not restore the pre-retirement tables';
  end if;

  if to_regclass('public.archived_manual_ledger_days') is not null then
    raise exception 'rollback left the retirement archive in place';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'close_business_day'
  ) then
    raise exception 'rollback did not restore close_business_day()';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'outlets'
      and column_name = 'billing_live_from'
  ) then
    raise exception 'rollback did not restore outlets.billing_live_from';
  end if;
end
$rollback_check$;
'@

Write-Output "Restored the pre-retirement public estate in scratch database $Database. This rollback is tested but is not expected to be used."
