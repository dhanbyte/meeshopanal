create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','staff','client')),
  active boolean not null default true,
  name text,
  client_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(), name text not null, business_name text,
  panel_name text not null, contact_name text, phone text, email text, login_email text,
  auth_uid uuid unique references auth.users(id) on delete set null,
  service_fee_percent numeric(7,4) not null default 0 check (service_fee_percent between 0 and 100),
  opening_balance numeric(14,2) not null default 0, active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.profiles drop constraint if exists profiles_client_id_fkey;
alter table public.profiles add constraint profiles_client_id_fkey foreign key (client_id) references public.clients(id) on delete set null;
create table if not exists public.staff_client_access (
  staff_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (staff_id, client_id)
);
create table if not exists public.client_balances (
  client_id uuid primary key references public.clients(id) on delete cascade,
  payable numeric(14,2) not null default 0, receivable numeric(14,2) not null default 0,
  cash numeric(14,2) not null default 0, updated_at timestamptz not null default now()
);
create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id) on delete restrict,
  client_name text, order_number text not null, sub_order_number text, awb text not null,
  awb_normalized text generated always as (upper(regexp_replace(awb, '[[:space:]-]', '', 'g'))) stored,
  courier text, customer_name text not null default '', customer_address text not null default '', customer_phone text,
  items jsonb not null default '[]'::jsonb, invoice_total numeric(14,2) not null default 0,
  actual_settlement numeric(14,2), status text not null default 'ready' check (status in ('ready','dispatched','delivered','rto','return_initiated','returned','reconciled')),
  label_path text, label_name text, idempotency_key uuid unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (awb_normalized)
);
create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id) on delete restrict,
  shipment_id uuid references public.shipments(id) on delete restrict, order_number text not null, awb text not null,
  return_awb text, product_name text not null default '', quantity integer not null default 1 check (quantity > 0),
  reason text not null default '', condition text not null default 'quarantine' check (condition in ('sellable','damaged','wrong_item','missing_parts','quarantine','disposed')),
  notes text not null default '', evidence jsonb not null default '[]'::jsonb, shared_with_client boolean not null default false,
  claim_status text not null default 'not_raised' check (claim_status in ('not_raised','raised','approved','rejected')),
  claim_amount numeric(14,2) not null default 0 check (claim_amount >= 0), idempotency_key uuid unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id) on delete restrict,
  shipment_id uuid references public.shipments(id) on delete restrict, order_number text,
  type text not null check (type in ('settlement','product_cost','shipping','return_charge','claim_recovery','service_fee','client_payment','client_receipt','shipment_charge','adjustment')),
  amount numeric(14,2) not null check (amount > 0), direction text not null check (direction in ('in','out')),
  payable_delta numeric(14,2) not null default 0, receivable_delta numeric(14,2) not null default 0,
  cash_delta numeric(14,2) not null default 0, description text not null, reference text,
  idempotency_key uuid unique, reversal_of uuid unique references public.ledger_entries(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create table if not exists public.product_price_defaults (
  id text primary key, sku text not null default '', product_name text not null,
  unit_cost numeric(14,2) not null check (unit_cost > 0), updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists shipments_client_created_idx on public.shipments(client_id, created_at desc);
create index if not exists returns_client_created_idx on public.returns(client_id, created_at desc);
create index if not exists ledger_client_created_idx on public.ledger_entries(client_id, created_at desc);
create index if not exists ledger_shipment_idx on public.ledger_entries(shipment_id);

create or replace function public.current_profile_role() returns text
language sql stable security definer set search_path = ''
as $$ select p.role from public.profiles p where p.id = auth.uid() and p.active $$;
create or replace function public.can_access_client(target_client uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and (
  p.role = 'admin' or (p.role = 'client' and p.client_id = target_client) or
  (p.role = 'staff' and exists (select 1 from public.staff_client_access a where a.staff_id = p.id and a.client_id = target_client)))) $$;
create or replace function public.can_manage_client(target_client uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and (
  p.role = 'admin' or (p.role = 'staff' and exists (select 1 from public.staff_client_access a where a.staff_id = p.id and a.client_id = target_client)))) $$;
revoke all on function public.current_profile_role() from public, anon;
revoke all on function public.can_access_client(uuid) from public, anon;
revoke all on function public.can_manage_client(uuid) from public, anon;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.can_access_client(uuid) to authenticated;
grant execute on function public.can_manage_client(uuid) to authenticated;

grant select on public.profiles, public.staff_client_access, public.clients, public.client_balances, public.shipments, public.returns, public.ledger_entries, public.product_price_defaults to authenticated;
grant insert on public.clients to authenticated;
grant insert, update, delete on public.product_price_defaults to authenticated;
revoke update, delete on public.clients from authenticated;
revoke insert, update, delete on public.shipments, public.returns, public.ledger_entries, public.client_balances, public.profiles, public.staff_client_access from authenticated;
alter table public.profiles enable row level security;
alter table public.staff_client_access enable row level security;
alter table public.clients enable row level security;
alter table public.client_balances enable row level security;
alter table public.shipments enable row level security;
alter table public.returns enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.product_price_defaults enable row level security;

drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles for select to authenticated using (id = auth.uid() or public.current_profile_role() = 'admin');
drop policy if exists assignments_read_self_or_admin on public.staff_client_access;
create policy assignments_read_self_or_admin on public.staff_client_access for select to authenticated using (staff_id = auth.uid() or public.current_profile_role() = 'admin');
drop policy if exists clients_read_assigned on public.clients;
create policy clients_read_assigned on public.clients for select to authenticated using (public.can_access_client(id));
drop policy if exists clients_admin_write on public.clients;
create policy clients_admin_write on public.clients for all to authenticated using (public.current_profile_role() = 'admin') with check (public.current_profile_role() = 'admin');
drop policy if exists balances_read_assigned on public.client_balances;
create policy balances_read_assigned on public.client_balances for select to authenticated using (public.can_access_client(client_id));
drop policy if exists shipments_read_assigned on public.shipments;
create policy shipments_read_assigned on public.shipments for select to authenticated using (public.can_access_client(client_id));
drop policy if exists shipments_staff_write on public.shipments;
drop policy if exists returns_read_assigned_or_shared on public.returns;
create policy returns_read_assigned_or_shared on public.returns for select to authenticated using (public.can_manage_client(client_id) or (shared_with_client and public.can_access_client(client_id)));
drop policy if exists returns_staff_write on public.returns;
drop policy if exists ledger_read_assigned on public.ledger_entries;
create policy ledger_read_assigned on public.ledger_entries for select to authenticated using (public.can_access_client(client_id));
drop policy if exists prices_staff_access on public.product_price_defaults;
create policy prices_staff_access on public.product_price_defaults for all to authenticated using (public.current_profile_role() in ('admin','staff')) with check (public.current_profile_role() in ('admin','staff'));

create or replace function public.initialize_client_balance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.client_balances(client_id) values (new.id) on conflict (client_id) do nothing;
  return new;
end $$;
drop trigger if exists clients_initialize_balance on public.clients;
create trigger clients_initialize_balance after insert on public.clients for each row execute function public.initialize_client_balance();

create or replace function public.create_shipment_with_charge(p_id uuid, p_shipment jsonb, p_label jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; client_key uuid; order_key text; normalized_awb text; line_items jsonb; amount_due numeric(14,2);
begin
  client_key := (p_shipment->>'clientId')::uuid;
  order_key := p_shipment->>'orderNumber';
  normalized_awb := upper(regexp_replace(coalesce(p_shipment->>'awb',''), '[[:space:]-]', '', 'g'));
  if auth.uid() is null or not public.can_manage_client(client_key) then raise exception 'Not authorized to create orders for this client.' using errcode = '42501'; end if;
  if p_id is null or coalesce(order_key,'') = '' or normalized_awb = '' then raise exception 'Order number and AWB are required.' using errcode = '22023'; end if;
  insert into public.shipments(id,client_id,client_name,order_number,sub_order_number,awb,courier,customer_name,customer_address,customer_phone,items,invoice_total,status,label_path,label_name,idempotency_key,created_by)
  values (p_id,client_key,p_shipment->>'clientName',order_key,nullif(p_shipment->>'subOrderNumber',''),p_shipment->>'awb',nullif(p_shipment->>'courier',''),coalesce(p_shipment->>'customerName',''),coalesce(p_shipment->>'customerAddress',''),nullif(p_shipment->>'customerPhone',''),coalesce(p_shipment->'items','[]'::jsonb),coalesce((p_shipment->>'invoiceTotal')::numeric,0),coalesce(nullif(p_shipment->>'status',''),'ready'),p_label->>'path',p_label->>'name',p_id,auth.uid())
  on conflict (idempotency_key) do nothing returning id into new_id;
  if new_id is null then select id into new_id from public.shipments where idempotency_key = p_id; return new_id; end if;
  select coalesce(sum(greatest(0,coalesce((item->>'unitCost')::numeric,0)) * greatest(0,coalesce((item->>'quantity')::numeric,0))),0)
    into amount_due from jsonb_array_elements(coalesce(p_shipment->'items','[]'::jsonb)) item;
  if amount_due > 0 then
    insert into public.ledger_entries(client_id,shipment_id,order_number,type,amount,direction,receivable_delta,description,reference,idempotency_key,created_by)
    values (client_key,p_id,order_key,'shipment_charge',amount_due,'in',amount_due,'Product amount added from label',p_shipment->>'awb',p_id,auth.uid());
    insert into public.client_balances(client_id,receivable,updated_at) values (client_key,amount_due,now())
    on conflict (client_id) do update set receivable = public.client_balances.receivable + excluded.receivable, updated_at = now();
  end if;
  return new_id;
end $$;

create or replace function public.create_return_record(p_id uuid, p_record jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; client_key uuid; shipment_key uuid;
begin
  client_key := (p_record->>'clientId')::uuid;
  shipment_key := (p_record->>'shipmentId')::uuid;
  if auth.uid() is null or not public.can_manage_client(client_key) then raise exception 'Not authorized to record a return for this client.' using errcode = '42501'; end if;
  if not exists (select 1 from public.shipments s where s.id = shipment_key and s.client_id = client_key for update) then raise exception 'Choose an order belonging to this client.' using errcode = '22023'; end if;
  insert into public.returns(id,client_id,shipment_id,order_number,awb,return_awb,product_name,quantity,reason,condition,notes,evidence,shared_with_client,claim_status,claim_amount,created_by)
  values (p_id,client_key,shipment_key,p_record->>'orderNumber',p_record->>'awb',nullif(p_record->>'returnAwb',''),coalesce(p_record->>'productName',''),coalesce((p_record->>'quantity')::integer,1),coalesce(p_record->>'reason',''),coalesce(p_record->>'condition','quarantine'),coalesce(p_record->>'notes',''),coalesce(p_record->'evidence','[]'::jsonb),coalesce((p_record->>'sharedWithClient')::boolean,false),coalesce(p_record->>'claimStatus','not_raised'),coalesce((p_record->>'claimAmount')::numeric,0),auth.uid())
  on conflict (id) do nothing returning id into new_id;
  if new_id is null then return p_id; end if;
  update public.shipments set status = 'returned', updated_at = now() where id = shipment_key;
  return new_id;
end $$;
create or replace function public.update_shipment_details(p_shipment_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare current_row public.shipments%rowtype; next_items jsonb; old_amount numeric(14,2); new_amount numeric(14,2); delta_amount numeric(14,2);
begin
  select * into current_row from public.shipments where id = p_shipment_id for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if not public.can_manage_client(current_row.client_id) then raise exception 'Not authorized to edit this order.' using errcode = '42501'; end if;
  next_items := coalesce(p_patch->'items', current_row.items);
  select coalesce(sum(greatest(0,coalesce((item->>'unitCost')::numeric,0)) * greatest(0,coalesce((item->>'quantity')::numeric,0))),0) into old_amount from jsonb_array_elements(current_row.items) item;
  select coalesce(sum(greatest(0,coalesce((item->>'unitCost')::numeric,0)) * greatest(0,coalesce((item->>'quantity')::numeric,0))),0) into new_amount from jsonb_array_elements(next_items) item;
  delta_amount := new_amount - old_amount;
  update public.shipments set order_number = coalesce(p_patch->>'orderNumber',order_number), sub_order_number = nullif(coalesce(p_patch->>'subOrderNumber',sub_order_number),''), courier = nullif(coalesce(p_patch->>'courier',courier),''), customer_name = coalesce(p_patch->>'customerName',customer_name), customer_address = coalesce(p_patch->>'customerAddress',customer_address), customer_phone = nullif(coalesce(p_patch->>'customerPhone',customer_phone),''), items = next_items, invoice_total = coalesce((p_patch->>'invoiceTotal')::numeric,invoice_total), status = coalesce(p_patch->>'status',status), updated_at = now() where id = p_shipment_id;
  if delta_amount <> 0 then
    insert into public.ledger_entries(client_id,shipment_id,order_number,type,amount,direction,receivable_delta,description,reference,idempotency_key,created_by)
    values (current_row.client_id,p_shipment_id,coalesce(p_patch->>'orderNumber',current_row.order_number),'shipment_charge',abs(delta_amount),case when delta_amount > 0 then 'in' else 'out' end,delta_amount,'Shipment amount corrected',current_row.awb,gen_random_uuid(),auth.uid());
    insert into public.client_balances(client_id,receivable,updated_at) values (current_row.client_id,delta_amount,now())
    on conflict (client_id) do update set receivable = public.client_balances.receivable + excluded.receivable, updated_at = now();
  end if;
end $$;

create or replace function public.delete_shipment(p_shipment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare current_row public.shipments%rowtype; charge_total numeric(14,2);
begin
  select * into current_row from public.shipments where id = p_shipment_id for update;
  if not found then return; end if;
  if public.current_profile_role() <> 'admin' or not public.can_manage_client(current_row.client_id) then raise exception 'Only an administrator can remove an order.' using errcode = '42501'; end if;
  if exists (select 1 from public.returns r where r.shipment_id = p_shipment_id) or exists (select 1 from public.ledger_entries e where e.shipment_id = p_shipment_id and e.type <> 'shipment_charge') then
    raise exception 'This order has return or payment history. Keep it for the audit trail and change its status instead.' using errcode = '23503';
  end if;
  select coalesce(sum(receivable_delta),0) into charge_total from public.ledger_entries where shipment_id = p_shipment_id;
  delete from public.ledger_entries where shipment_id = p_shipment_id;
  update public.client_balances set receivable = receivable - charge_total, updated_at = now() where client_id = current_row.client_id;
  delete from public.shipments where id = p_shipment_id;
end $$;
create or replace function public.update_shipment_status(p_shipment_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare client_key uuid;
begin
  select client_id into client_key from public.shipments where id = p_shipment_id;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if not public.can_manage_client(client_key) then raise exception 'Not authorized to update this order.' using errcode = '42501'; end if;
  if p_status not in ('ready','dispatched','delivered','rto','return_initiated','returned','reconciled') then raise exception 'Invalid shipment status.' using errcode = '22023'; end if;
  update public.shipments set status = p_status, updated_at = now() where id = p_shipment_id;
end $$;
create or replace function public.update_return_record(p_return_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare client_key uuid;
begin
  select client_id into client_key from public.returns where id = p_return_id;
  if not found then raise exception 'Return record not found.' using errcode = 'P0002'; end if;
  if not public.can_manage_client(client_key) then raise exception 'Not authorized to update this return.' using errcode = '42501'; end if;
  update public.returns set condition = coalesce(p_patch->>'condition',condition), notes = coalesce(p_patch->>'notes',notes), evidence = coalesce(p_patch->'evidence',evidence), shared_with_client = coalesce((p_patch->>'sharedWithClient')::boolean,shared_with_client), claim_status = coalesce(p_patch->>'claimStatus',claim_status), claim_amount = coalesce((p_patch->>'claimAmount')::numeric,claim_amount), updated_at = now() where id = p_return_id;
end $$;
create or replace function public.update_client_details(p_client_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare linked_uid uuid;
begin
  if auth.uid() is null or public.current_profile_role() is distinct from 'admin' then raise exception 'Only an administrator can edit clients.' using errcode = '42501'; end if;
  update public.clients set name = coalesce(p_patch->>'name',name), business_name = coalesce(p_patch->>'businessName',business_name), panel_name = coalesce(p_patch->>'panelName',panel_name), contact_name = coalesce(p_patch->>'contactName',contact_name), phone = coalesce(p_patch->>'phone',phone), email = coalesce(p_patch->>'email',email), service_fee_percent = coalesce((p_patch->>'serviceFeePercent')::numeric,service_fee_percent), active = coalesce((p_patch->>'active')::boolean,active), updated_at = now() where id = p_client_id returning auth_uid into linked_uid;
  if not found then raise exception 'Client not found.' using errcode = 'P0002'; end if;
  if linked_uid is not null then update public.profiles set active = coalesce((p_patch->>'active')::boolean,active), name = coalesce(p_patch->>'contactName',p_patch->>'businessName',p_patch->>'name',name), updated_at = now() where id = linked_uid; end if;
end $$;
create or replace function public.archive_client(p_client_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare linked_uid uuid;
begin
  if auth.uid() is null or public.current_profile_role() is distinct from 'admin' then raise exception 'Only an administrator can archive clients.' using errcode = '42501'; end if;
  update public.clients set active = false, updated_at = now() where id = p_client_id returning auth_uid into linked_uid;
  if not found then raise exception 'Client not found.' using errcode = 'P0002'; end if;
  if linked_uid is not null then update public.profiles set active = false, updated_at = now() where id = linked_uid; end if;
end $$;
revoke all on function public.create_shipment_with_charge(uuid,jsonb,jsonb) from public, anon;
revoke all on function public.create_return_record(uuid,jsonb) from public, anon;
revoke all on function public.update_shipment_details(uuid,jsonb) from public, anon;
revoke all on function public.delete_shipment(uuid) from public, anon;
revoke all on function public.update_shipment_status(uuid,text) from public, anon;
revoke all on function public.update_return_record(uuid,jsonb) from public, anon;
revoke all on function public.update_client_details(uuid,jsonb) from public, anon;
revoke all on function public.archive_client(uuid) from public, anon;
grant execute on function public.create_shipment_with_charge(uuid,jsonb,jsonb) to authenticated;
grant execute on function public.create_return_record(uuid,jsonb) to authenticated;
grant execute on function public.update_shipment_details(uuid,jsonb) to authenticated;
grant execute on function public.delete_shipment(uuid) to authenticated;
grant execute on function public.update_shipment_status(uuid,text) to authenticated;
grant execute on function public.update_return_record(uuid,jsonb) to authenticated;
grant execute on function public.update_client_details(uuid,jsonb) to authenticated;
grant execute on function public.archive_client(uuid) to authenticated;

create or replace function public.record_ledger_entry(
  p_client_id uuid, p_type text, p_amount numeric, p_direction text,
  p_payable_delta numeric, p_receivable_delta numeric, p_cash_delta numeric,
  p_description text, p_reference text, p_shipment_id uuid, p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null or public.current_profile_role() not in ('admin','staff') or not public.can_manage_client(p_client_id) then raise exception 'Not authorized to post money for this client.' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 or p_idempotency_key is null or p_type not in ('settlement','product_cost','shipping','return_charge','claim_recovery','service_fee','client_payment','client_receipt','shipment_charge','adjustment') or p_direction not in ('in','out') or length(trim(coalesce(p_description,''))) = 0 then raise exception 'Invalid ledger entry.' using errcode = '22023'; end if;
  insert into public.ledger_entries(client_id,shipment_id,type,amount,direction,payable_delta,receivable_delta,cash_delta,description,reference,idempotency_key,created_by)
  values (p_client_id,p_shipment_id,p_type,p_amount,p_direction,p_payable_delta,p_receivable_delta,p_cash_delta,trim(p_description),nullif(trim(coalesce(p_reference,'')),''),p_idempotency_key,auth.uid())
  on conflict (idempotency_key) do nothing returning id into new_id;
  if new_id is null then select id into new_id from public.ledger_entries where idempotency_key = p_idempotency_key; return new_id; end if;
  insert into public.client_balances(client_id,payable,receivable,cash,updated_at) values (p_client_id,p_payable_delta,p_receivable_delta,p_cash_delta,now())
  on conflict (client_id) do update set payable = public.client_balances.payable + excluded.payable, receivable = public.client_balances.receivable + excluded.receivable, cash = public.client_balances.cash + excluded.cash, updated_at = now();
  return new_id;
end $$;

create or replace function public.reverse_ledger_entry(p_entry_id uuid, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare original public.ledger_entries%rowtype; reversal_id uuid;
begin
  select * into original from public.ledger_entries where id = p_entry_id for update;
  if not found then raise exception 'Ledger entry not found.' using errcode = 'P0002'; end if;
  if public.current_profile_role() <> 'admin' or not public.can_manage_client(original.client_id) then raise exception 'Only an administrator can reverse a ledger entry.' using errcode = '42501'; end if;
  insert into public.ledger_entries(client_id,shipment_id,order_number,type,amount,direction,payable_delta,receivable_delta,cash_delta,description,reference,idempotency_key,reversal_of,created_by)
  values (original.client_id,original.shipment_id,original.order_number,'adjustment',original.amount,case when original.direction = 'in' then 'out' else 'in' end,-original.payable_delta,-original.receivable_delta,-original.cash_delta,'Correction reversing entry ' || original.id::text,original.reference,p_idempotency_key,original.id,auth.uid())
  on conflict (reversal_of) do nothing returning id into reversal_id;
  if reversal_id is null then select id into reversal_id from public.ledger_entries where reversal_of = original.id; return reversal_id; end if;
  insert into public.client_balances(client_id,payable,receivable,cash,updated_at) values (original.client_id,-original.payable_delta,-original.receivable_delta,-original.cash_delta,now())
  on conflict (client_id) do update set payable = public.client_balances.payable - original.payable_delta, receivable = public.client_balances.receivable - original.receivable_delta, cash = public.client_balances.cash - original.cash_delta, updated_at = now();
  return reversal_id;
end $$;
revoke all on function public.record_ledger_entry(uuid,text,numeric,text,numeric,numeric,numeric,text,text,uuid,uuid) from public, anon;
revoke all on function public.reverse_ledger_entry(uuid,uuid) from public, anon;
grant execute on function public.record_ledger_entry(uuid,text,numeric,text,numeric,numeric,numeric,text,text,uuid,uuid) to authenticated;
grant execute on function public.reverse_ledger_entry(uuid,uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('labels','labels',false,26214400,array['application/pdf','image/jpeg','image/png']),
  ('return-evidence','return-evidence',false,314572800,array['image/*','video/*'])
on conflict (id) do update set public = false;
drop policy if exists parcel_desk_read_labels on storage.objects;
create policy parcel_desk_read_labels on storage.objects for select to authenticated using (bucket_id = 'labels' and public.can_access_client((storage.foldername(name))[1]::uuid));
drop policy if exists parcel_desk_write_labels on storage.objects;
create policy parcel_desk_write_labels on storage.objects for insert to authenticated with check (bucket_id = 'labels' and public.can_manage_client((storage.foldername(name))[1]::uuid));
drop policy if exists parcel_desk_delete_labels on storage.objects;
create policy parcel_desk_delete_labels on storage.objects for delete to authenticated using (bucket_id = 'labels' and public.can_manage_client((storage.foldername(name))[1]::uuid));
drop policy if exists parcel_desk_read_returns on storage.objects;
create policy parcel_desk_read_returns on storage.objects for select to authenticated using (bucket_id = 'return-evidence' and (public.can_manage_client((storage.foldername(name))[1]::uuid) or exists (select 1 from public.returns r where r.id = ((storage.foldername(name))[2])::uuid and r.client_id = ((storage.foldername(name))[1])::uuid and r.shared_with_client and public.can_access_client(r.client_id))));
drop policy if exists parcel_desk_write_returns on storage.objects;
create policy parcel_desk_write_returns on storage.objects for insert to authenticated with check (bucket_id = 'return-evidence' and public.can_manage_client((storage.foldername(name))[1]::uuid));
drop policy if exists parcel_desk_delete_returns on storage.objects;
create policy parcel_desk_delete_returns on storage.objects for delete to authenticated using (bucket_id = 'return-evidence' and public.can_manage_client((storage.foldername(name))[1]::uuid));
