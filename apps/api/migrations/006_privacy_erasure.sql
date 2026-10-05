-- "Delete my data": erasing a guest must not delete the shop's business records (cycles, payments,
-- problem reports). Those rows stay, unlinked from the person (customer_id becomes NULL).
ALTER TABLE payments ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE payments DROP CONSTRAINT payments_customer_id_fkey,
  ADD CONSTRAINT payments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE cycles DROP CONSTRAINT cycles_customer_id_fkey,
  ADD CONSTRAINT cycles_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE tickets DROP CONSTRAINT tickets_customer_id_fkey,
  ADD CONSTRAINT tickets_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
