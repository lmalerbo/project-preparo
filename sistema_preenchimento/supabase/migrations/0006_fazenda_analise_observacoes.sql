-- Nova etapa do fluxo de analistas, entre Escoamento e Projeto de Preparo:
--   "Aguardando observações" — liberada pelo próprio Analista B antes de iniciar o projeto.

alter table fazenda_analise
  add column if not exists observacoes_ok       boolean default false,
  add column if not exists observacoes_usuario  text default '',
  add column if not exists observacoes_data     timestamptz;
