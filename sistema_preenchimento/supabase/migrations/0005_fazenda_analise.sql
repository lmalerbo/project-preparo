-- Acompanhamento do fluxo de analistas, por fazenda (não por talhão):
--   Analista A → identificação + escoamento (libera o orthomosaico processado)
--   Analista B → projeto de preparo (só depois de identificação + escoamento OK)

create table if not exists fazenda_analise (
  cod_faz                int primary key,
  fazenda                text default '',
  identificacao_ok       boolean default false,
  identificacao_usuario  text default '',
  identificacao_data     timestamptz,
  escoamento_ok          boolean default false,
  escoamento_usuario     text default '',
  escoamento_data        timestamptz,
  preparo_ok              boolean default false,
  preparo_usuario         text default '',
  preparo_data            timestamptz,
  updated_at              timestamptz default now()
);

alter table fazenda_analise enable row level security;

create policy "fazenda_analise_select_anon" on fazenda_analise
  for select to anon using (true);

create policy "fazenda_analise_insert_anon" on fazenda_analise
  for insert to anon with check (true);

create policy "fazenda_analise_update_anon" on fazenda_analise
  for update to anon using (true) with check (true);
