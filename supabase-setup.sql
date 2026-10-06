-- JOTA-JOTI Camera / Kalgoorlie Scout Group
-- Supabase SQL setup. Safe to run again.
-- The organiser password is NOT stored here. Create the organiser Auth user separately.

/* ---------- organiser ---------- */
create table if not exists public.admins (email text primary key);
insert into public.admins (email) values (lower('jota.joti.boulder@gmail.com')) on conflict do nothing;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

/* ---------- tables ---------- */
create table if not exists public.settings (key text primary key, value jsonb not null);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(), name text not null,
  description text default '', instructions text default '', latitude double precision not null,
  longitude double precision not null, category text default '', icon text default '', points int default 0,
  photo_required boolean default false, video_allowed boolean default true, active boolean default true,
  created_at timestamptz default now());

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(), number text default '', name text not null,
  kind text default 'photo', description text default '', instructions text default '', points int default 0,
  photos_required int default 0, videos_required int default 0, sound_number int,
  config text default '{}', radius int default 0, location_id uuid references public.locations(id) on delete set null,
  active boolean default true, sort int default 0, created_at timestamptz default now());

create table if not exists public.sounds (
  id uuid primary key default gen_random_uuid(), number int unique, title text not null,
  artist text default '', description text default '', category text default '', attribution text default '',
  licence_info text default '', source text default '', permission_status text default 'unconfirmed',
  duration real default 0, active boolean default true, in_library boolean default true,
  audio_path text, artwork_path text, size bigint default 0, created_at timestamptz default now());

create table if not exists public.participants (
  id uuid primary key, owner uuid not null, name text not null, device_id text default '',
  created_at timestamptz default now(), last_seen_at timestamptz default now());

create table if not exists public.submissions (
  id uuid primary key, participant_id uuid not null, owner uuid not null, participant_name text not null,
  media_type text not null, mime text not null, size bigint not null, duration real default 0,
  media_key text not null, thumb_key text, audio_key text,
  sound_kind text default 'none', sound_id text, sound_label text default '',
  challenge_id uuid references public.challenges(id) on delete set null,
  caption text default '', captured_at timestamptz default now(), created_at timestamptz default now(), uploaded_at timestamptz,
  latitude double precision, longitude double precision, location_accuracy real,
  upload_status text default 'WAITING', review_status text default 'PENDING',
  last_error text default '', last_error_at timestamptz,
  backup_status text default 'PENDING', storage_provider text default 'LOCAL',
  backup_file_id text default '', backup_url text default '', backup_at timestamptz, backup_error text default '');

alter table public.submissions add column if not exists backup_status text default 'PENDING';
alter table public.submissions add column if not exists storage_provider text default 'LOCAL';
alter table public.submissions add column if not exists backup_file_id text default '';
alter table public.submissions add column if not exists backup_url text default '';
alter table public.submissions add column if not exists backup_at timestamptz;
alter table public.submissions add column if not exists backup_error text default '';

create index if not exists submissions_owner on public.submissions (owner);
create index if not exists submissions_captured on public.submissions (captured_at desc);
create index if not exists submissions_backup on public.submissions (upload_status, backup_status, captured_at);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key, created_at timestamptz default now(),
  actor text default '', action text not null, target text default '', detail text default '');

alter table public.admins enable row level security;
alter table public.settings enable row level security;
alter table public.locations enable row level security;
alter table public.challenges enable row level security;
alter table public.sounds enable row level security;
alter table public.participants enable row level security;
alter table public.submissions enable row level security;
alter table public.audit_logs enable row level security;

/* ---------- permissions ---------- */
grant usage on schema public to anon, authenticated;
grant select on public.settings, public.locations, public.challenges, public.sounds to anon, authenticated;
grant insert, update, delete on public.settings, public.locations, public.challenges, public.sounds to authenticated;
grant select, update, delete on public.participants, public.submissions to authenticated;
grant select, insert on public.audit_logs to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select using (true);
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists locations_read on public.locations;
create policy locations_read on public.locations for select using (active or public.is_admin());
drop policy if exists locations_admin on public.locations;
create policy locations_admin on public.locations for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists challenges_read on public.challenges;
create policy challenges_read on public.challenges for select using (active or public.is_admin());
drop policy if exists challenges_admin on public.challenges;
create policy challenges_admin on public.challenges for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists sounds_read on public.sounds;
create policy sounds_read on public.sounds for select using ((active and audio_path is not null) or public.is_admin());
drop policy if exists sounds_admin on public.sounds;
create policy sounds_admin on public.sounds for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists participants_read on public.participants;
create policy participants_read on public.participants for select to authenticated using (owner = auth.uid() or public.is_admin());
drop policy if exists participants_admin on public.participants;
create policy participants_admin on public.participants for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists submissions_read on public.submissions;
create policy submissions_read on public.submissions for select to authenticated using (owner = auth.uid() or public.is_admin());
drop policy if exists submissions_admin on public.submissions;
create policy submissions_admin on public.submissions for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists audit_admin on public.audit_logs;
create policy audit_admin on public.audit_logs for all to authenticated using (public.is_admin()) with check (public.is_admin());

/* ---------- storage buckets ---------- */
insert into storage.buckets (id, name, public, file_size_limit) values
  ('media', 'media', false, 31457280),
  ('sounds', 'sounds', false, 20971520)
on conflict (id) do nothing;
update storage.buckets set public = false, file_size_limit = 31457280 where id = 'media';
update storage.buckets set public = false, file_size_limit = 20971520 where id = 'sounds';

drop policy if exists media_read on storage.objects;
create policy media_read on storage.objects for select to authenticated using (bucket_id = 'media' and (
  public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text
  or exists (select 1 from public.submissions s where s.owner = auth.uid() and name in (s.media_key, s.thumb_key, s.audio_key))));
drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects for insert to authenticated with check (bucket_id = 'media' and (
  (storage.foldername(name))[1] = auth.uid()::text
  or exists (select 1 from public.submissions s where s.owner = auth.uid() and name in (s.media_key, s.thumb_key, s.audio_key))));
drop policy if exists media_update on storage.objects;
create policy media_update on storage.objects for update to authenticated using (bucket_id = 'media' and (
  (storage.foldername(name))[1] = auth.uid()::text
  or exists (select 1 from public.submissions s where s.owner = auth.uid() and name in (s.media_key, s.thumb_key, s.audio_key))));
drop policy if exists media_delete on storage.objects;
create policy media_delete on storage.objects for delete to authenticated using (bucket_id = 'media' and public.is_admin());

drop policy if exists sounds_files_read on storage.objects;
create policy sounds_files_read on storage.objects for select to authenticated using (bucket_id = 'sounds');
drop policy if exists sounds_files_admin on storage.objects;
create policy sounds_files_admin on storage.objects for all to authenticated using (bucket_id = 'sounds' and public.is_admin()) with check (bucket_id = 'sounds' and public.is_admin());

/* ---------- participant + submission functions ---------- */
create or replace function public.register_participant(p_id uuid, p_name text, p_device text default '') returns json
language plpgsql security definer set search_path = public as $$
declare n text := btrim(left(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]<>]', '', 'g'), 40));
begin
  if auth.uid() is null then raise exception 'UNKNOWN_PARTICIPANT'; end if;
  if n = '' then raise exception 'Please enter your name'; end if;
  insert into participants (id, owner, name, device_id) values (p_id, auth.uid(), n, left(coalesce(p_device, ''), 64))
  on conflict (id) do update set owner = auth.uid(), name = excluded.name, device_id = excluded.device_id, last_seen_at = now();
  update submissions set participant_name = n, owner = auth.uid() where participant_id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function public.get_submission_status(p_id uuid) returns json
language plpgsql security definer set search_path = public, storage as $$
declare s submissions;
begin
  select * into s from submissions where id = p_id and (owner = auth.uid() or public.is_admin());
  if not found then raise exception 'UNKNOWN_SUBMISSION'; end if;
  return json_build_object(
    'id', s.id, 'uploadStatus', s.upload_status, 'reviewStatus', s.review_status,
    'backupStatus', s.backup_status, 'storageProvider', s.storage_provider, 'backupUrl', s.backup_url,
    'parts', '[]'::json, 'chunkSize', 104857600,
    'hasThumb', exists (select 1 from storage.objects o where o.bucket_id = 'media' and o.name = s.thumb_key),
    'hasAudio', exists (select 1 from storage.objects o where o.bucket_id = 'media' and o.name = s.audio_key));
end $$;

create or replace function public.create_submission(b json) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_id uuid := (b->>'id')::uuid; v_pid uuid := (b->>'participantId')::uuid;
  v_type text := b->>'mediaType'; v_mime text := lower(btrim(split_part(coalesce(b->>'mime', ''), ';', 1)));
  v_size bigint := coalesce(nullif(b->>'size', '')::bigint, 0); v_ext text; v_name text; v_cap timestamptz;
  v_ch uuid; v_sk text; v_audio text; v_base text; v_exist submissions;
begin
  if v_uid is null then raise exception 'UNKNOWN_PARTICIPANT'; end if;
  select * into v_exist from submissions where id = v_id;
  if found then
    if v_exist.owner <> v_uid then raise exception 'That id belongs to someone else'; end if;
    return public.get_submission_status(v_id);
  end if;
  select name into v_name from participants where id = v_pid and owner = v_uid;
  if v_name is null then raise exception 'UNKNOWN_PARTICIPANT'; end if;
  v_ext := case v_mime
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' when 'video/webm' then 'webm' else null end;
  if v_type not in ('photo', 'video') or v_ext is null or (v_type = 'photo') <> (v_mime like 'image/%') then raise exception 'Unsupported file type'; end if;
  if v_size < 1 or v_size > 31457280 then raise exception 'TOO_BIG'; end if;
  if v_type = 'photo' and exists (select 1 from settings where key = 'photosEnabled' and value = 'false'::jsonb) then raise exception 'Photos are switched off'; end if;
  if v_type = 'video' and exists (select 1 from settings where key = 'videosEnabled' and value = 'false'::jsonb) then raise exception 'Videos are switched off'; end if;
  begin
    v_cap := case when (b->>'capturedAt') ~ '^[0-9]+$' then to_timestamp((b->>'capturedAt')::double precision / 1000.0) else (b->>'capturedAt')::timestamptz end;
  exception when others then v_cap := now(); end;
  v_cap := coalesce(v_cap, now());
  select id into v_ch from challenges where id::text = b->>'challengeId';
  v_sk := case when b->>'soundKind' in ('library', 'custom') then b->>'soundKind' else 'none' end;
  v_base := v_uid::text || '/' || v_id::text;
  v_audio := case when v_sk = 'custom' then v_base || '_a' else null end;
  insert into submissions (
    id, participant_id, owner, participant_name, media_type, mime, size, duration, media_key, thumb_key, audio_key,
    sound_kind, sound_id, sound_label, challenge_id, caption, captured_at, latitude, longitude, location_accuracy,
    backup_status, storage_provider)
  values (
    v_id, v_pid, v_uid, v_name, v_type, v_mime, v_size, coalesce(nullif(b->>'duration', '')::real, 0),
    v_base || '.' || v_ext, v_base || '_t', v_audio,
    v_sk, left(coalesce(b->>'soundId', ''), 80), left(coalesce(b->>'soundLabel', ''), 100),
    v_ch, left(regexp_replace(coalesce(b->>'caption', ''), '[[:cntrl:]<>]', '', 'g'), 280), v_cap,
    nullif(b->>'latitude', '')::double precision, nullif(b->>'longitude', '')::double precision, nullif(b->>'accuracy', '')::real,
    'PENDING', 'LOCAL')
  on conflict (id) do nothing;
  return public.get_submission_status(v_id);
end $$;

create or replace function public.complete_submission(p_id uuid) returns json
language plpgsql security definer set search_path = public, storage as $$
declare s submissions; sz bigint;
begin
  select * into s from submissions where id = p_id and owner = auth.uid();
  if not found then raise exception 'UNKNOWN_SUBMISSION'; end if;
  if s.upload_status <> 'UPLOADED' then
    select nullif(o.metadata->>'size', '')::bigint into sz from storage.objects o where o.bucket_id = 'media' and o.name = s.media_key;
    if sz is null or sz <> s.size then raise exception 'MISSING_PARTS'; end if;
    update submissions set upload_status = 'UPLOADED', uploaded_at = now(), last_error = '', backup_status = 'PENDING',
      storage_provider = 'SUPABASE',
      thumb_key = case when exists (select 1 from storage.objects o where o.bucket_id = 'media' and o.name = s.thumb_key) then s.thumb_key else null end,
      audio_key = case when exists (select 1 from storage.objects o where o.bucket_id = 'media' and o.name = s.audio_key) then s.audio_key else null end
    where id = p_id;
  end if;
  return public.get_submission_status(p_id);
end $$;

create or replace function public.record_backup(
  p_id uuid, p_status text, p_provider text, p_file_id text default '', p_url text default '', p_error text default ''
) returns json
language plpgsql security definer set search_path = public as $$
declare s submissions; v_status text; v_provider text; v_upload text;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into s from submissions where id = p_id for update;
  if not found then raise exception 'UNKNOWN_SUBMISSION'; end if;
  v_status := case when p_status in ('PENDING','DONE','ERROR') then p_status else 'ERROR' end;
  v_provider := case when p_provider in ('SUPABASE','DRIVE','DUAL') then p_provider else s.storage_provider end;
  v_upload := case when v_provider = 'DRIVE' then 'UPLOADED' else s.upload_status end;
  update submissions set backup_status = v_status, storage_provider = v_provider,
    backup_file_id = left(coalesce(p_file_id, ''), 200), backup_url = left(coalesce(p_url, ''), 1000),
    backup_at = case when v_status = 'DONE' then now() else backup_at end,
    backup_error = left(coalesce(p_error, ''), 300), upload_status = v_upload,
    last_error = case when v_status = 'ERROR' then left(coalesce(p_error, ''), 300) else last_error end,
    last_error_at = case when v_status = 'ERROR' then now() else last_error_at end
  where id = p_id;
  return json_build_object('ok', true, 'id', p_id, 'backupStatus', v_status, 'storageProvider', v_provider, 'backupUrl', left(coalesce(p_url, ''), 1000));
end $$;

create or replace function public.report_problem(p_id uuid, p_error text) returns json
language plpgsql security definer set search_path = public as $$
begin
  update submissions set last_error = left(coalesce(p_error, ''), 300), last_error_at = now() where id = p_id and owner = auth.uid();
  return json_build_object('ok', true);
end $$;

revoke all on function public.register_participant(uuid, text, text), public.get_submission_status(uuid), public.create_submission(json),
  public.complete_submission(uuid), public.record_backup(uuid, text, text, text, text, text), public.report_problem(uuid, text) from public, anon;
grant execute on function public.register_participant(uuid, text, text), public.get_submission_status(uuid), public.create_submission(json),
  public.complete_submission(uuid), public.record_backup(uuid, text, text, text, text, text), public.report_problem(uuid, text) to authenticated;

/* ---------- default settings ---------- */
insert into public.settings(key, value) values
  ('competitionName', to_jsonb('JOTA-JOTI'::text)),
  ('photosEnabled', 'true'::jsonb),
  ('videosEnabled', 'true'::jsonb),
  ('maxVideoSeconds', '60'::jsonb),
  ('videoBitsPerSecond', '2000000'::jsonb),
  ('maxMediaBytes', '31457280'::jsonb),
  ('locationMode', to_jsonb('optional'::text)),
  ('enforceRadius', 'false'::jsonb),
  ('allowCustomSounds', 'true'::jsonb),
  ('allowAudioUploads', 'true'::jsonb),
  ('maxCustomAudioSeconds', '15'::jsonb),
  ('micMode', to_jsonb('mix'::text)),
  ('mediaNotice', to_jsonb(''::text)),
  ('aButtonLabel', to_jsonb('A'::text)),
  ('aButtonUrl', to_jsonb(''::text)),
  ('tileUrl', to_jsonb('https://tile.openstreetmap.org/{z}/{x}/{y}.png'::text)),
  ('mapCenterLat', '-30.7745'::jsonb),
  ('mapCenterLon', '121.488'::jsonb),
  ('mapZoom', '13'::jsonb),
  ('offlineAudio', 'false'::jsonb)
on conflict (key) do nothing;

/*
  Final Supabase dashboard settings:
  1. Authentication -> Providers -> Anonymous sign-in: ON.
  2. Authentication -> Users: create an organiser user with the email above and the password you keep private.
  3. Run this whole file before using the site.
*/
