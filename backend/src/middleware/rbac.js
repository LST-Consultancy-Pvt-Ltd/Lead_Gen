/**
 * rbac.js
 * Role-Based Access Control Middleware
 */

const { error } = require('../utils/response');

const ADMIN_ROLES = ['org_admin', 'super_admin'];
const MANAGER_AND_ABOVE = ['manager', 'org_admin', 'super_admin'];

/**
 * Check if user has any of the required roles
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return error(res, 'Authentication required', 401);
    }
    if (!roles.includes(req.user.role)) {
      return error(res, 'Insufficient permissions', 403);
    }
    next();
  };
};

/** Manager, org_admin, or super_admin */
const requireManagerOrAdmin = requireRole(...MANAGER_AND_ABOVE);

/** org_admin or super_admin */
const requireAdmin = requireRole(...ADMIN_ROLES);

/** super_admin only */
const requireSuperAdmin = requireRole('super_admin');

/**
 * Ownership-based access control.
 * Allows access if the user is manager/admin, OR if they are the resource owner.
 * Resolves the ownerId lazily via a getter function so the middleware can be
 * applied before the resource is fetched.
 *
 * Usage:
 *   router.patch('/:id', authenticate, ownerOrManagerAdmin((req) => someService.getOwnerId(req.params.id)), ctrl.update)
 *
 * For cases where the owner check is done inside the service/controller, use the
 * `can` helpers below instead.
 */
const ownerOrManagerAdmin = (getOwnerIdFn) => {
  return async (req, res, next) => {
    if (!req.user) return error(res, 'Authentication required', 401);
    if (MANAGER_AND_ABOVE.includes(req.user.role)) return next();

    try {
      const ownerId = await getOwnerIdFn(req);
      if (ownerId && ownerId === req.user.id) return next();
      return error(res, 'You do not have permission to access this resource', 403);
    } catch (err) {
      return error(res, 'Authorization check failed', 500);
    }
  };
};

/**
 * buildLeadScope(user)
 * Prisma `where` fragment describing which leads a user may see/search/touch.
 * Always pinned to the user's organization. Callers must combine it with any
 * search/filter conditions via AND (never by spreading, which lets an `OR`
 * search overwrite the scope):
 *   org_admin / super_admin → every lead in their organization
 *   manager                 → leads they created OR that are assigned to them
 *   sales_user              → only leads currently assigned to them
 */
function buildLeadScope(user) {
  const organizationId = user.organizationId;
  if (ADMIN_ROLES.includes(user.role)) return { organizationId };
  if (user.role === 'manager') {
    return {
      organizationId,
      OR: [{ createdById: user.id }, { assignedToId: user.id }],
    };
  }
  return { organizationId, assignedToId: user.id };
}

/** scope AND extra conditions, so extra can never widen the scope */
function andScope(scope, extra) {
  return extra && Object.keys(extra).length ? { AND: [scope, extra] } : scope;
}

function scopeLeadWhere(user, extra) {
  return andScope(buildLeadScope(user), extra);
}

/**
 * Data that hangs off a lead follows the lead's scope. Records with no lead keep
 * an owner-based rule (admin: whole org, manager: own/created, rep: own).
 */
const unlinkedOwnerOr = (user, ownerField) =>
  user.role === 'manager'
    ? { OR: [{ [ownerField]: user.id }, { createdById: user.id }] }
    : { [ownerField]: user.id };

/** Opportunities: visible only when the linked lead is accessible. */
function buildOpportunityScope(user) {
  return { organizationId: user.organizationId, lead: buildLeadScope(user) };
}

/** Activities: follow the linked lead (directly or via the opportunity's lead). */
function buildActivityScope(user) {
  const leadScope = buildLeadScope(user);
  return {
    organizationId: user.organizationId,
    OR: [
      { lead: leadScope },
      { leadId: null, opportunity: { lead: leadScope } },
      { leadId: null, opportunityId: null, ...(ADMIN_ROLES.includes(user.role) ? {} : { userId: user.id }) },
    ],
  };
}

/** Contacts: lead-linked contacts follow the lead; unlinked ones are owner-based. */
function buildContactScope(user) {
  const organizationId = user.organizationId;
  if (ADMIN_ROLES.includes(user.role)) return { organizationId };
  return {
    organizationId,
    OR: [
      { lead: buildLeadScope(user) },
      { leadId: null, ...unlinkedOwnerOr(user, 'ownerId') },
    ],
  };
}

/** Accounts: visible through an accessible lead, or when owned/created by the user. */
function buildAccountScope(user) {
  const organizationId = user.organizationId;
  if (ADMIN_ROLES.includes(user.role)) return { organizationId };
  return {
    organizationId,
    OR: [
      { leads: { some: buildLeadScope(user) } },
      unlinkedOwnerOr(user, 'accountOwnerId'),
    ],
  };
}

/** In-memory equivalent of buildLeadScope for an already-loaded lead. */
function canAccessLead(user, lead) {
  if (!user || !lead || lead.organizationId !== user.organizationId) return false;
  if (ADMIN_ROLES.includes(user.role)) return true;
  if (user.role === 'manager') {
    return lead.createdById === user.id || lead.assignedToId === user.id;
  }
  return lead.assignedToId === user.id;
}

/**
 * canAssignLeadTo(user, target)
 * target: { id, organizationId, managerId, isActive }
 *   admin   → any active user in the same organization
 *   manager → an active member of their own team (managerId = manager); not themselves
 *   others  → never
 */
function canAssignLeadTo(user, target) {
  if (!user || !target || target.isActive === false) return false;
  if (target.organizationId !== user.organizationId) return false;
  if (ADMIN_ROLES.includes(user.role)) return true;
  if (user.role === 'manager') return target.id !== user.id && target.managerId === user.id;
  return false;
}

/**
 * Permission helper — pure functions used inside controllers/services
 */
const can = {
  viewAllLeads: (user) => MANAGER_AND_ABOVE.includes(user.role),

  viewLead: (user, lead) => canAccessLead(user, lead),

  createLead: () => true,

  updateLead: (user, lead) => canAccessLead(user, lead),

  deleteLead: (user) => ADMIN_ROLES.includes(user.role),

  reassignLead: (user) => MANAGER_AND_ABOVE.includes(user.role),

  viewAllActivities: (user) => MANAGER_AND_ABOVE.includes(user.role),

  createActivity: (user, lead) => canAccessLead(user, lead),

  manageUsers: (user) => ADMIN_ROLES.includes(user.role),

  manageCampaigns: (user) => MANAGER_AND_ABOVE.includes(user.role),

  viewOrgAnalytics: (user) => MANAGER_AND_ABOVE.includes(user.role),

  viewAllOpportunities: (user) => MANAGER_AND_ABOVE.includes(user.role),

  viewOpportunity: (user, opportunity) => {
    if (MANAGER_AND_ABOVE.includes(user.role)) return true;
    return opportunity.assignedToId === user.id;
  },

  updateOpportunity: (user, opportunity) => {
    if (MANAGER_AND_ABOVE.includes(user.role)) return true;
    return opportunity.assignedToId === user.id;
  },

  importLeads: (user) => ADMIN_ROLES.includes(user.role),
};

/**
 * Middleware to check a single permission using a `can.*` predicate
 */
const checkPermission = (permissionCheck) => {
  return (req, res, next) => {
    if (!req.user) return error(res, 'Authentication required', 401);
    if (!permissionCheck(req.user)) {
      return error(res, 'Insufficient permissions for this action', 403);
    }
    next();
  };
};

/**
 * buildOrganizationFilter(user)
 * Returns a Prisma `where` clause scoping data to what the user may see:
 *   org_admin / super_admin → whole organization
 *   manager                 → own records + all direct team-member records
 *   sales_user              → only records assigned to themselves
 */
async function buildOrganizationFilter(user) {
  const prismaClient = require('../utils/prisma');

  if (ADMIN_ROLES.includes(user.role)) {
    return { organizationId: user.organizationId };
  }

  if (user.role === 'manager') {
    const teamMembers = await prismaClient.user.findMany({
      where: { managerId: user.id, organizationId: user.organizationId },
      select: { id: true },
    });
    const teamMemberIds = teamMembers.map((m) => m.id);
    return {
      organizationId: user.organizationId,
      OR: [
        { assignedToId: { in: [...teamMemberIds, user.id] } },
        { assignedToId: null },
      ],
    };
  }

  // sales_user
  return { organizationId: user.organizationId, assignedToId: user.id };
}

/**
 * getTeamMemberIds(user)
 * Returns an array of user IDs that the given user is allowed to manage.
 *   org_admin / super_admin → all users in org
 *   manager                 → only their direct reports
 *   sales_user              → only themselves
 */
async function getTeamMemberIds(user) {
  const prismaClient = require('../utils/prisma');

  if (ADMIN_ROLES.includes(user.role)) {
    const members = await prismaClient.user.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true },
    });
    return members.map((m) => m.id);
  }

  if (user.role === 'manager') {
    const members = await prismaClient.user.findMany({
      where: { managerId: user.id, organizationId: user.organizationId },
      select: { id: true },
    });
    return members.map((m) => m.id);
  }

  return [user.id];
}

/**
 * authorizeRole(roles)
 * Spec-compatible alias that accepts both internal role names and spec aliases:
 *   'admin'   → org_admin, super_admin
 *   'manager' → manager
 *   'exec'    → sales_user
 *
 * Usage: router.get('/path', authenticate, authorizeRole(['admin', 'manager']), ctrl.handler)
 */
const ROLE_ALIASES = {
  admin: ['org_admin', 'super_admin'],
  manager: ['manager'],
  exec: ['sales_user'],
  // pass-through for internal names
  org_admin: ['org_admin'],
  super_admin: ['super_admin'],
  sales_user: ['sales_user'],
};

const authorizeRole = (roles) => {
  const allowed = roles.flatMap((r) => ROLE_ALIASES[r] || [r]);
  return (req, res, next) => {
    if (!req.user) return error(res, 'Authentication required', 401);
    if (!allowed.includes(req.user.role)) {
      return error(res, 'Insufficient permissions', 403);
    }
    next();
  };
};

module.exports = {
  requireRole,
  requireManagerOrAdmin,
  requireAdmin,
  requireSuperAdmin,
  ownerOrManagerAdmin,
  can,
  checkPermission,
  authorizeRole,
  ADMIN_ROLES,
  MANAGER_AND_ABOVE,
  buildOrganizationFilter,
  getTeamMemberIds,
  buildLeadScope,
  andScope,
  scopeLeadWhere,
  buildOpportunityScope,
  buildActivityScope,
  buildContactScope,
  buildAccountScope,
  canAccessLead,
  canAssignLeadTo,
};
