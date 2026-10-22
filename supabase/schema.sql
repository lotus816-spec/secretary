-- ============================================================================
--  سكرتاري | Secretary — Supabase Schema (النسخة الكاملة النهائية)
--  انسخ كامل هذا الملف والصقه في:
--    Supabase Dashboard  ←  SQL Editor  ←  New query  ←  Run
--  الآثار:
--   • جدول موحّد للعناصر (مهام / خطط / ملاحظات / جهات اتصال / إعدادات)
--   • عزل كامل بين المستخدمين عبر RLS: كل مستخدم يرى بياناته فقط
--   • فهارس + تحديث updated_at تلقائياً
--  المفتاح المستخدم في التطبيق: Settings ← API ← anon key (مفتاح عام)
-- ============================================================================

-- 1) جدول العناصر --------------------------------------------------------------
create table if not exists public.secretary_items (
  id         text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null default 'task',  -- task | plan | note | contact | settings
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists secretary_items_user_idx on public.secretary_items (user_id);
create index if not exists secretary_items_kind_idx on public.secretary_items (user_id, kind);

-- 2) تفعيل الحماية على مستوى الصفوف --------------------------------------------
alter table public.secretary_items enable row level security;

-- 3) سياسة العزل: كل مستخدم يقرأ ويضيف ويعدّل ويحذف صفوفه فقط -------------------
drop policy if exists "secretary own rows" on public.secretary_items;
create policy "secretary own rows"
  on public.secretary_items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 4) (اختياري) جدول الملف الشخصي للمستخدم --------------------------------------
create table if not exists public.secretary_profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text,
  email      text,
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.secretary_profiles enable row level security;

drop policy if exists "secretary own profile" on public.secretary_profiles;
create policy "secretary own profile"
  on public.secretary_profiles
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 5) تحديث updated_at تلقائياً ---------------------------------------------------
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

-- 6) الاستكمال من رابط إعادة تعيين كلمة المرور ----------------------------------
-- (اختياري): إذا ظهر خطأ عند تشغيله فالميزة غير مفعلة في مشروعك — تجاهل البند
alter table public.secretary_items replica identity full;

-- ============================================================================
--  خطوات الإعداد في التطبيق:
--   1) سجّل الدخول/أنشئ حساباً من Supabase Auth (Email provider)
--      • يُنصح بتعطيل Confirm email (Auth ← Providers ← Email) حتى لا يلزم
--        حساب بريد مفعّل في كل مرة.
--   2) التطبيق: الإعدادات ← الربط بقاعدة بيانات Supabase ← ضع
--      Project URL + anon key ثم «تأكيد الربط».
--   3) سجّل خروج ثم دخول — ستُسحب بياناتك من السحابة، وكل إضافة/تعديل/حذف
--      يتزامن تلقائياً مع جدول secretary_items الخاص بحسابك.
-- ============================================================================
