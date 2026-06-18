export const ROLES = {
  ADMIN:     'ADMIN',
  COTIZADOR: 'COTIZADOR',
  PROVEEDOR: 'PROVEEDOR',
  CLIENTE:   'CLIENTE',
} as const;

export type UserRole = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN:     'Administrador',
  COTIZADOR: 'Cotizador',
  PROVEEDOR: 'Proveedor',
  CLIENTE:   'Cliente',
};
