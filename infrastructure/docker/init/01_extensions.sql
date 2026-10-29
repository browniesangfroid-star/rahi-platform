-- Development DB init only. Real schema changes go through numbered
-- migrations in apps/api/migrations/ (Phase 2+), never by editing this file
-- after it has run against a shared database.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
