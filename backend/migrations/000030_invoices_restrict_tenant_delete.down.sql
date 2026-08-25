ALTER TABLE invoices DROP CONSTRAINT invoices_tenant_id_fkey;
ALTER TABLE invoices ADD CONSTRAINT invoices_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
