-- Campos específicos da base de preparo (aba CONSERVAÇÃO): equipe responsável e status do voo.
alter table programacao add column if not exists equipe text default '';
alter table programacao add column if not exists voo    text default '';
