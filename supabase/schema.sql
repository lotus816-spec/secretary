-- ============================================================
--  سكرتاري | Secretary — Supabase Schema
--  شغّل هذا الملف في: Supabase Dashboard → SQL Editor → New query
--  ينشئ جدولاً موحّداً + سياسات RLS التي تحصر كل مستخدم في بياناته.
-- ============================================================

-- 1) جدول العناصر (مهام / خطط / ملاحظات / إعدادات)
create table if not exists public.secretary_items (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null default 'task',   -- task | plan | note | settings
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists secretary_items_user_idx on public.secretary_items (user_id);
create index if not exists secretary_items_kind_idx on public.secretary_items (user_id, kind);

-- 2) تفعيل سياسات الصفوف
alter table public.secretary_items enable row level security;

-- 3) سياسة: كل مستخدم يرى ويعدّل عناصره فقط
drop policy if exists "secretary own rows" on public.secretary_items;
create policy "secretary own rows"
  on public.secretary_items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 4) (اختياري) ملف تعريف المستخدم
create table if not exists public.secretary_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  email       text,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.secretary_profiles enable row level security;

drop policy if exists "secretary own profile" on public.secretary_profiles;
create policy "secretary own profile"
  on public.secretary_profiles
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 5) دالة مساعدة لتحديث updated_at تلقائياً
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists secretary_items_touch on public.secretary_items;
create trigger secretary_items_touch
  before update on public.secretary_items
  for each row execute function public.touch_updated_at();

-- ============================================================
--  إعداد العميل في التطبيق:
--    Settings ← الربط بقاعدة بيانات Supabase
--    Project URL  : https://<project>.supabase.co
--    anon key     : من Settings ← API
--  ثم سجّل خروج وأعد الدخول لتفعيل المزامنة.
-- ============================================================
