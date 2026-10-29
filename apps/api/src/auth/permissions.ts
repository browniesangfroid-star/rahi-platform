export const ALL_PERMISSIONS = [
  'users.read', 'users.suspend', 'drivers.approve', 'drivers.reject',
  'rides.read', 'rides.cancel', 'rides.assign', 'pricing.manage',
  'commission.manage', 'payments.manage', 'refunds.manage',
  'cities.manage', 'catalog.manage', 'support.manage', 'admins.manage', 'roles.manage', 'reports.read', 'audit.read',
] as const;
export type PermissionName = (typeof ALL_PERMISSIONS)[number];
