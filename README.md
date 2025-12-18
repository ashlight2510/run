# Dino-ish Runner (HTML)

크롬 공룡게임 느낌의 **간단 오프라인 러너**를 순수 HTML/CSS/JS(Canvas)로 만든 예제입니다.

## 실행 방법

- `index.html`을 더블클릭해서 브라우저(크롬 권장)로 열면 바로 실행됩니다.

## SEO 설정(배포 시)

현재 배포 도메인: `https://run.funnyfunny.cloud/`

- 구글 서치콘솔에 사이트 등록할 거면 **sitemap**으로 `https://run.funnyfunny.cloud/sitemap.xml` 을 제출하면 됩니다.

## 조작

- 시작/점프: `Space` 또는 `↑` (터치/클릭도 점프)
- 빠르게 내려오기: `↓`
- 재시작: `R` (또는 게임 오버 화면에서 `Space/↑`)

## 파일

- `index.html`: UI 뼈대
- `style.css`: 스타일
- `game.js`: 게임 루프/물리/충돌/스폰/점수

## Supabase 랭킹(리더보드) 붙이기 (최고점 upsert + 일일/주간)

이 프로젝트는 **클라이언트(브라우저)에서 anon key로** 점수를 등록/조회합니다. 따라서 **RLS 정책**으로 허용 범위를 꼭 제한해야 합니다.

### 1) 테이블/정책 생성 or 마이그레이션 (SQL Editor에 그대로 실행)

Supabase Dashboard → SQL Editor에서 아래를 실행하세요.

```sql
-- 만약 "column period_type does not exist" 에러가 뜨면,
-- 아래 4개 ALTER TABLE만 먼저 단독으로 실행한 뒤(성공 확인),
-- 다시 전체 SQL을 실행하세요.
alter table public.leaderboard_scores
  add column if not exists period_type text not null default 'all';
alter table public.leaderboard_scores
  add column if not exists period_start date not null default date '1970-01-01';
alter table public.leaderboard_scores
  add column if not exists updated_at timestamptz not null default now();
alter table public.leaderboard_scores
  add column if not exists user_agent text;

-- Leaderboard table
create table if not exists public.leaderboard_scores (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  score integer not null,
  period_type text not null default 'all', -- 'all' | 'daily' | 'weekly'
  period_start date not null default date '1970-01-01',
  user_agent text
);

-- 이미 테이블이 존재하는 경우(구버전 스키마) 컬럼을 추가로 보강
alter table public.leaderboard_scores
  add column if not exists updated_at timestamptz not null default now();

alter table public.leaderboard_scores
  add column if not exists period_type text not null default 'all';

alter table public.leaderboard_scores
  add column if not exists period_start date not null default date '1970-01-01';

alter table public.leaderboard_scores
  add column if not exists user_agent text;

-- 컬럼 생성 확인용(선택): 결과에 period_type/period_start가 보이면 OK
-- select column_name from information_schema.columns
-- where table_schema='public' and table_name='leaderboard_scores'
-- order by ordinal_position;

-- Basic constraints (서버에서 강제)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leaderboard_scores_name_len'
  ) then
    alter table public.leaderboard_scores
      add constraint leaderboard_scores_name_len check (char_length(name) between 1 and 16);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'leaderboard_scores_score_range'
  ) then
    alter table public.leaderboard_scores
      add constraint leaderboard_scores_score_range check (score between 0 and 10000000);
  end if;
end $$;

-- (기간 + 닉네임) 유니크: 같은 기간에는 같은 닉네임 1개 행만 유지
create unique index if not exists leaderboard_scores_period_name_uniq
  on public.leaderboard_scores (period_type, period_start, name);

create index if not exists leaderboard_scores_rank_idx
  on public.leaderboard_scores (period_type, period_start, score desc, created_at asc);

-- updated_at 자동 갱신
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_leaderboard_scores_updated_at on public.leaderboard_scores;
create trigger trg_leaderboard_scores_updated_at
before update on public.leaderboard_scores
for each row execute function public.set_updated_at();

-- upsert 시 "최고점만 유지"를 DB에서 보장하기 위한 처리:
-- on conflict update 에서 score를 greatest로 바꾸는 뷰/함수도 가능하지만,
-- 가장 단순하게는 클라이언트가 upsert하고, DB 트리거로 점수를 보정합니다.
create or replace function public.leaderboard_keep_best()
returns trigger as $$
begin
  -- update일 때만: 기존 점수보다 낮게 들어오면 기존 점수 유지
  if (tg_op = 'UPDATE') then
    new.score = greatest(new.score, old.score);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_leaderboard_keep_best on public.leaderboard_scores;
create trigger trg_leaderboard_keep_best
before update on public.leaderboard_scores
for each row execute function public.leaderboard_keep_best();

-- RLS (anon key로 접근하므로 필수)
alter table public.leaderboard_scores enable row level security;

-- 읽기: 누구나 Top 랭킹 조회 가능
drop policy if exists "leaderboard_select_all" on public.leaderboard_scores;
create policy "leaderboard_select_all"
on public.leaderboard_scores
for select
to anon
using (true);

-- 쓰기: 누구나 insert 가능 (하지만 제약조건으로 name/score 범위는 강제됨)
drop policy if exists "leaderboard_insert_anon" on public.leaderboard_scores;
create policy "leaderboard_insert_anon"
on public.leaderboard_scores
for insert
to anon
with check (true);

-- upsert는 내부적으로 update가 발생할 수 있으므로 update도 허용해야 함
drop policy if exists "leaderboard_update_anon" on public.leaderboard_scores;
create policy "leaderboard_update_anon"
on public.leaderboard_scores
for update
to anon
using (true)
with check (true);

-- delete는 정책을 만들지 않으면 기본적으로 막힘(권장)
```

### 2) 프로젝트 키 설정

`supabase.config.js`에 아래 2개를 넣으면 끝입니다.

- Project URL: `https://xxxx.supabase.co`
- anon key: Dashboard → Project Settings → API → `anon public`

### 3) 사용법

- 게임 시작 후, 오버레이(대기/게임오버) 화면에서 **닉네임 입력 → 점수 등록**
- **전체/일일/주간** 탭으로 기간을 선택할 수 있고, 각 기간 내에서는 **닉네임당 최고점만 유지(upsert)** 됩니다.
- **랭킹(Top 10)** 은 자동 로드되며, 필요 시 “새로고침” 버튼으로 재조회 가능
