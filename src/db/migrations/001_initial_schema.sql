
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_id UUID NOT NULL REFERENCES roles(id),
  is_active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) UNIQUE NOT NULL,
  code VARCHAR(30) UNIQUE NOT NULL,
  qty_limit_type VARCHAR(10) NOT NULL CHECK (qty_limit_type IN ('order','cutting')),
  has_multiplier BOOLEAN DEFAULT FALSE,
  multiplier_label VARCHAR(50),
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE
);
INSERT INTO operations (name,code,qty_limit_type,has_multiplier,multiplier_label,sort_order) VALUES
('Cutting','CUTTING','cutting',FALSE,NULL,1),('Fusing','FUSING','cutting',FALSE,NULL,2),
('Power Table','POWER_TABLE','cutting',FALSE,NULL,3),('SNLS','SNLS','cutting',FALSE,NULL,4),
('Kaja','KAJA','cutting',TRUE,'No of Kaja',5),('Button','BUTTON','cutting',TRUE,'No of Button',6),
('Bartag','BARTAG','cutting',TRUE,'No of Bartag',7),('Rope','ROPE','cutting',FALSE,NULL,8),
('Buckles','BUCKLES','cutting',FALSE,NULL,9),('Piccoding','PICCODING','cutting',FALSE,NULL,10),
('Net Folding','NET_FOLDING','cutting',FALSE,NULL,11),('Outer Elastic','OUTER_ELASTIC','cutting',FALSE,NULL,12),
('Trimmer','TRIMMER','cutting',FALSE,NULL,13),('Checking','CHECKING','cutting',FALSE,NULL,14),
('Ironing','IRONING','order',FALSE,NULL,15),('Panel Ironing','PANEL_IRONING','cutting',FALSE,NULL,16),
('Packing','PACKING','order',FALSE,NULL,17)
ON CONFLICT (code) DO NOTHING;
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number VARCHAR(50) UNIQUE NOT NULL,
  buyer_name VARCHAR(150) NOT NULL,
  style_number VARCHAR(80),
  item_name VARCHAR(150) NOT NULL,
  color VARCHAR(80),
  size VARCHAR(80),
  order_qty INTEGER NOT NULL CHECK (order_qty > 0),
  cutting_qty INTEGER NOT NULL CHECK (cutting_qty > 0),
  delivery_date DATE NOT NULL,
  remarks TEXT,
  status VARCHAR(30) DEFAULT 'In Progress',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS order_operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL REFERENCES operations(id),
  is_enabled BOOLEAN DEFAULT TRUE,
  rate NUMERIC(10,4) NOT NULL DEFAULT 0,
  contractor_name VARCHAR(100),
  multiplier_count INTEGER DEFAULT 1,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (order_id, operation_id)
);
CREATE TABLE IF NOT EXISTS production_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_operation_id UUID NOT NULL REFERENCES order_operations(id),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  produced_qty INTEGER NOT NULL CHECK (produced_qty > 0),
  contractor_name VARCHAR(100),
  remarks TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS weekly_bills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_number VARCHAR(50) UNIQUE NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  contractor_name VARCHAR(100) NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) DEFAULT 'Generated',
  generated_by UUID REFERENCES users(id),
  generated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS bill_details (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_id UUID NOT NULL REFERENCES weekly_bills(id) ON DELETE CASCADE,
  order_operation_id UUID NOT NULL REFERENCES order_operations(id),
  order_number VARCHAR(50),
  operation_name VARCHAR(100),
  produced_qty INTEGER NOT NULL,
  rate NUMERIC(10,4) NOT NULL,
  multiplier_count INTEGER DEFAULT 1,
  total_amount NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  user_email VARCHAR(150),
  table_name VARCHAR(80) NOT NULL,
  action VARCHAR(10) NOT NULL,
  old_values JSONB,
  new_values JSONB,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO roles (name,description,permissions) VALUES
('admin','Full system access','{"orders":"*","operations":"*","production":"*","billing":"*","reports":"*","users":"*"}'),
('production_manager','Manage orders and production','{"orders":"*","operations":"*","production":"*","reports":"read","billing":"read"}'),
('data_entry','Daily production entry only','{"production":"*","orders":"read","operations":"read"}'),
('billing_staff','Billing and reports access','{"billing":"*","reports":"*","orders":"read","production":"read"}')
ON CONFLICT (name) DO NOTHING;
