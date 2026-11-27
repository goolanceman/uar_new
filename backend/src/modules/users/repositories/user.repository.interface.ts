/**
 * User (admin directory) repository contract — persistence operations for the
 * admin user management endpoints, including the CRM detachments and the
 * community cascade the legacy delete ran. The service depends on this
 * interface, never on Prisma directly.
 */

/** Wire select of the legacy `userSelect` const. */
export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  isActive: boolean;
  phone: string | null;
  city: string | null;
  pan: string | null;
  about: string | null;
  avatar: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserListFilters {
  q?: string;
  role?: string;
  status?: string;
}

export interface CreateUserAccess {
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  phone: string | null;
  city: string | null;
  about: string | null;
  status: string;
  isActive: boolean;
}

/** Full created row — password is stripped by the service before responding. */
export interface CreatedUserRow {
  id: string;
  email: string;
  password: string;
  [key: string]: unknown;
}

export interface UpdateUserData {
  name?: string;
  role?: string;
  status?: string;
  email?: string;
  phone?: string | null;
  city?: string | null;
  pan?: string | null;
  about?: string | null;
  avatar?: string | null;
  password?: string;
  isActive?: boolean;
}

export interface UserRepository {
  list(filters: UserListFilters): Promise<UserRow[]>;
  findByEmail(email: string): Promise<{ id: string } | null>;
  findByEmailExcluding(email: string, id: string): Promise<{ id: string } | null>;
  findById(id: string): Promise<UserRow | null>;
  findFullById(id: string): Promise<{ id: string; role: string; email: string } | null>;
  countAdmins(): Promise<number>;
  create(data: CreateUserAccess): Promise<CreatedUserRow>;
  update(id: string, data: UpdateUserData): Promise<{ id: string; email: string; password: string; [key: string]: unknown }>;
  listActivity(userId: string, take: number): Promise<unknown[]>;
  detachDonations(userId: string): Promise<void>;
  detachActivityLogs(userId: string): Promise<void>;
  detachBeneficiaries(userId: string): Promise<void>;
  deleteUserCascade(userId: string): Promise<void>;
}
