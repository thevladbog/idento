-- Invoices are financial documents (РФ: обязательное хранение бухгалтерских
-- документов) and must survive tenant hard-purge. invoices.tenant_id was
-- created ON DELETE CASCADE (000029), which would let PurgeExpiredTenants
-- silently destroy issued/paid invoices along with an archived tenant past
-- retention. Switch to ON DELETE RESTRICT so a hard-delete of a tenant with
-- any invoices fails loudly instead of cascading data loss; the store-level
-- purge (pg_store_retention.go) is updated to skip tenants that still have
-- invoices, so this RESTRICT should never actually be tripped in normal
-- operation.
ALTER TABLE invoices DROP CONSTRAINT invoices_tenant_id_fkey;
ALTER TABLE invoices ADD CONSTRAINT invoices_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
