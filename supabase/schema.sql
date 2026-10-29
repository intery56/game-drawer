-- 게임 서랍: 회원번호 + 게임 저장 테이블
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요. (한 번만)

create extension if not exists pgcrypto with schema extensions;

-- 회원: 회원번호는 100001부터 차례로 발급
create table if not exists public.members (
  member_no  bigint generated always as identity (start with 100001) primary key,
  code_hash  text not null,                -- 이어하기 코드(암호화 저장)
  created_at timestamptz not null default now()
);

-- 기기(브라우저) ↔ 회원번호 연결. 한 회원이 여러 기기에서 이어할 수 있음
create table if not exists public.member_devices (
  uid        uuid primary key references auth.users(id) on delete cascade,
  member_no  bigint not null references public.members(member_no) on delete cascade,
  linked_at  timestamptz not null default now()
);

-- 게임별 저장 데이터
create table if not exists public.game_saves (
  member_no  bigint not null references public.members(member_no) on delete cascade,
  game       text   not null check (game ~ '^[a-z0-9-]{1,40}$'),
  data       jsonb  not null,
  updated_at timestamptz not null default now(),
  primary key (member_no, game),
  constraint save_size check (pg_column_size(data) < 3000000)
);

-- 이어하기 코드 틀린 시도 기록 (무차별 대입 방지)
create table if not exists public.link_attempts (
  uid uuid not null,
  at  timestamptz not null default now()
);
create index if not exists link_attempts_uid_at on public.link_attempts(uid, at);

alter table public.members        enable row level security;
alter table public.member_devices enable row level security;
alter table public.game_saves     enable row level security;
alter table public.link_attempts  enable row level security;
-- members / member_devices / link_attempts 는 정책이 없으므로 아래 함수로만 접근 가능

-- 저장 시각은 서버가 정함
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists game_saves_touch on public.game_saves;
create trigger game_saves_touch before insert or update on public.game_saves
  for each row execute function public.touch_updated_at();

-- 지금 접속한 기기의 회원번호
create or replace function public.my_member_no() returns bigint
language sql stable security definer set search_path = public as $$
  select member_no from public.member_devices where uid = auth.uid()
$$;

-- 자기 회원번호의 저장 데이터만 읽고 쓸 수 있음
drop policy if exists saves_select on public.game_saves;
drop policy if exists saves_insert on public.game_saves;
drop policy if exists saves_update on public.game_saves;
drop policy if exists saves_delete on public.game_saves;
create policy saves_select on public.game_saves for select to authenticated
  using (member_no = public.my_member_no());
create policy saves_insert on public.game_saves for insert to authenticated
  with check (member_no = public.my_member_no());
create policy saves_update on public.game_saves for update to authenticated
  using (member_no = public.my_member_no()) with check (member_no = public.my_member_no());
create policy saves_delete on public.game_saves for delete to authenticated
  using (member_no = public.my_member_no());

-- 첫 방문: 회원번호와 이어하기 코드 발급 (이미 있으면 기존 번호 반환)
create or replace function public.register_member() returns json
language plpgsql security definer set search_path = public, extensions as $$
declare v_no bigint; v_code text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select member_no into v_no from public.member_devices where uid = auth.uid();
  if v_no is not null then
    return json_build_object('member_no', v_no, 'code', null);
  end if;
  v_code := upper(encode(gen_random_bytes(4), 'hex'));   -- 예: 3F9A1C0B
  insert into public.members(code_hash) values (crypt(v_code, gen_salt('bf'))) returning member_no into v_no;
  insert into public.member_devices(uid, member_no) values (auth.uid(), v_no);
  return json_build_object('member_no', v_no, 'code', v_code);
end $$;

-- 다른 기기에서 이어하기: 회원번호 + 이어하기 코드 확인 후 이 기기를 연결
create or replace function public.link_member(p_no bigint, p_code text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text; v_fails int;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select count(*) into v_fails from public.link_attempts
    where uid = auth.uid() and at > now() - interval '1 hour';
  if v_fails >= 10 then raise exception 'too_many_attempts'; end if;
  select code_hash into v_hash from public.members where member_no = p_no;
  if v_hash is null or crypt(upper(trim(p_code)), v_hash) <> v_hash then
    insert into public.link_attempts(uid) values (auth.uid());
    raise exception 'invalid_code';
  end if;
  insert into public.member_devices(uid, member_no) values (auth.uid(), p_no)
    on conflict (uid) do update set member_no = excluded.member_no, linked_at = now();
  return json_build_object('member_no', p_no);
end $$;

revoke all on function public.register_member()          from public, anon;
revoke all on function public.link_member(bigint, text)  from public, anon;
revoke all on function public.my_member_no()             from public, anon;
grant execute on function public.register_member()         to authenticated;
grant execute on function public.link_member(bigint, text) to authenticated;
grant execute on function public.my_member_no()            to authenticated;
grant select, insert, update, delete on public.game_saves  to authenticated;
