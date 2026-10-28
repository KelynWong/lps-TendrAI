// Role permissions — mirrors frontend/src/config.ts canDo exactly, plus admin.
import type { FastifyRequest } from 'fastify';
import { forbidden } from '../lib/errors.js';

export type Role = 'bd' | 'bidding-manager' | 'presales' | 'delivery' | 'finance' | 'drb' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  roleLabel: string;
}

const admin = (r: Role) => r === 'admin';

export const canDo = {
  uploadBc: (r: Role) => r === 'bd' || admin(r),
  downloadMspo: (r: Role) => r === 'bd' || admin(r),
  uploadPack: (r: Role) => r === 'bidding-manager' || admin(r),
  editChecklist: (r: Role) => r === 'bidding-manager' || admin(r),
  editClauses: (r: Role) => r === 'bd' || r === 'bidding-manager' || r === 'presales' || r === 'delivery' || admin(r),
  editCompliance: (r: Role) => r === 'bd' || r === 'bidding-manager' || admin(r),
  generateDocs: (r: Role) => r === 'bidding-manager' || admin(r),
  manageTemplates: (r: Role) => r === 'bd' || r === 'bidding-manager' || admin(r),
  manageRepo: (r: Role) => r === 'bd' || admin(r),
  manageRules: (r: Role) => r === 'bd' || admin(r),
  recordOutcome: (r: Role) => r === 'drb' || admin(r),
  viewFinancials: (r: Role) => r === 'finance' || r === 'drb' || admin(r),
  readOnlyReview: (r: Role) => r === 'finance' || r === 'drb',
  /** create / edit / delete tenders and change status */
  manageTenders: (r: Role) => r === 'bd' || r === 'bidding-manager' || admin(r),
  manageUsers: (r: Role) => admin(r),
} as const;

export type Permission = keyof typeof canDo;

export const ROLE_LABEL: Record<Role, string> = {
  bd: 'Business Development',
  'bidding-manager': 'Bidding Manager',
  presales: 'Presales',
  delivery: 'Delivery',
  finance: 'Finance',
  drb: 'DRB member',
  admin: 'Administrator',
};

/** Cognito group -> app role (groups are created in infra/modules/tendrai/cognito.tf). */
export const GROUP_ROLE: Record<string, Role> = {
  'bd-team': 'bd',
  'bidding-manager': 'bidding-manager',
  presales: 'presales',
  delivery: 'delivery',
  finance: 'finance',
  'executive-sponsor': 'drb',
  'business-sponsor': 'drb',
  admin: 'admin',
};

export function assertCan(req: FastifyRequest, perm: Permission, why?: string) {
  const role = req.user.role;
  if (!canDo[perm](role)) throw forbidden(why ?? `Your role (${req.user.roleLabel}) cannot do this`);
}

/** Finance and DRB only review: block every mutation for them. */
export function assertNotReadOnly(req: FastifyRequest) {
  if (canDo.readOnlyReview(req.user.role)) throw forbidden('Your role reviews only - every tender is read-only for you');
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}
