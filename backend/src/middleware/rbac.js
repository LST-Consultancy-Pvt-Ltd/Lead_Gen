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
 * Permission helper — pure functions used inside controllers/services
 */
const can = {
  viewAllLeads: (user) => MANAGER_AND_ABOVE.includes(user.role),

  viewLead: (user, lead) => {
    if (MANAGER_AND_ABOVE.includes(user.role)) return true;
    return lead.assignedToId === user.id;
  },

  createLead: () => true,

  updateLead: (user, lead) => {
    if (MANAGER_AND_ABOVE.includes(user.role)) return true;
    return lead.assignedToId === user.id;
  },

  deleteLead: (user) => ADMIN_ROLES.includes(user.role),

  reassignLead: (user) => MANAGER_AND_ABOVE.includes(user.role),

  viewAllActivities: (user) => MANAGER_AND_ABOVE.includes(user.role),

  createActivity: (user, lead) => {
    if (MANAGER_AND_ABOVE.includes(user.role)) return true;
    return lead.assignedToId === user.id;
  },

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
};
