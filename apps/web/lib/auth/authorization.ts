
export type UserRole = "CUSTOMER" | "AGENT";

export type AuthenticatedUser = {
  id: string;
  role: UserRole;
};

export function requireAuth(
  user: AuthenticatedUser | null
): AuthenticatedUser {
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }

  return user;
}

export function requireRole(
  user: AuthenticatedUser | null,
  allowedRoles: UserRole[]
): AuthenticatedUser {
  const authenticatedUser = requireAuth(user);

  if (!allowedRoles.includes(authenticatedUser.role)) {
    throw new Error("FORBIDDEN");
  }

  return authenticatedUser;
}
