# Billing invoices SDD progress

Plan: docs/superpowers/plans/2026-08-25-billing-invoices.md (13 tasks)
Task 1: complete (commits 448bd3a..5bff10a, review clean; live-apply deferred to Task 2 integration tests)
Task 2: complete (commits 5bff10a..33c01c6, review clean; Minor noted: raw CHECK errors — handler-side validation lands in Tasks 7/9 per plan)
Task 3: complete (store CreateInvoice/GetInvoiceByID/ListInvoices + InvoiceFilter; per-year numbering via invoice_counters UPSERT, verified with relative-number assertions + a pinned 2001/41->42 direct-SQL case; 3 new integration tests all pass against real Postgres; full backend gate green — build, go test ./..., golangci-lint 0 issues)
