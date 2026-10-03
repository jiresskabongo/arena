import { z } from 'zod';
import { passwordSchema } from '@/server/auth/password';

export const registerSchema = z.object({
  email: z.string().email().max(254).transform((v) => v.toLowerCase()),
  password: passwordSchema,
  firstName: z.string().min(2, 'Minimum 2 caractères').max(50),
  lastName: z.string().min(2, 'Minimum 2 caractères').max(50),
  organizationName: z.string().min(2, 'Minimum 2 caractères').max(80),
  currency: z.enum(['USD', 'EUR', 'CDF']).optional(),
  locale: z.enum(['fr', 'en']).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase()),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(64),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase()),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(10).max(64),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
