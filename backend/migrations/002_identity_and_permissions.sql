-- Migration: 002_identity_and_permissions.sql
-- Description: Identity, tenancy, groups, roles, and document access control schema for Phase 2

-- 1. Tenants Table (Organization boundaries: global, ten_brightwave, ten_harborpine, ten_lumenfield)
CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'suspended', 'archived'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Groups Table (Permission groups: grp_support, grp_customer_success, grp_engineering, etc.)
CREATE TABLE IF NOT EXISTS groups (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Users Table (Employees and customer principals)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY, -- e.g. 'emp_001', 'cu_001'
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL, -- 'support_agent', 'support_lead', 'csm', 'cs_manager', 'engineer', 'engineering_manager', 'it_security_admin', 'customer_user'
    user_type VARCHAR(50) NOT NULL DEFAULT 'employee', -- 'employee', 'customer_user'
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'inactive', 'suspended'
    password_hash VARCHAR(255), -- Secure bcrypt hash for development credentials
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. User-Group Memberships (Many-to-Many mapping)
CREATE TABLE IF NOT EXISTS user_groups (
    user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id VARCHAR(50) NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, group_id)
);

-- 5. User-Tenant Scope (Tenants the user has access to, or '*' for wildcard all-tenant access)
CREATE TABLE IF NOT EXISTS user_tenants (
    user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id VARCHAR(50) NOT NULL, -- Specific tenant ID (e.g. 'ten_brightwave') or '*' for all tenants
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, tenant_id)
);

-- 6. Document Permissions (Explicit access rules per document)
CREATE TABLE IF NOT EXISTS document_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tenant_id VARCHAR(50) NOT NULL REFERENCES tenants(id),
    allowed_groups TEXT[] NOT NULL DEFAULT '{}',
    sensitivity VARCHAR(50) NOT NULL DEFAULT 'internal', -- 'public', 'internal', 'confidential', 'restricted'
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_document_permissions_doc UNIQUE (document_id)
);

-- 7. Indexes for performance and secure lookup
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_user_groups_user ON user_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_user_groups_group ON user_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_user_tenants_user ON user_tenants(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tenants_tenant ON user_tenants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_doc_perm_tenant ON document_permissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_doc_perm_groups ON document_permissions USING gin(allowed_groups);

