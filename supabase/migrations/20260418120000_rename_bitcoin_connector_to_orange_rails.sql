-- Align connector_type enum with the OrangeRails brand: bitcoin_connector -> orange_rails.
-- OrangeRails is the open-source aggregator Orange Way uses for bank and
-- exchange connections. The migration is idempotent and operates on the
-- enum label only — no row data is touched.
do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_enum e on t.oid = e.enumtypid
    where t.typname = 'connector_type'
      and e.enumlabel = 'bitcoin_connector'
  ) then
    alter type public.connector_type rename value 'bitcoin_connector' to 'orange_rails';
  end if;
end
$$;
