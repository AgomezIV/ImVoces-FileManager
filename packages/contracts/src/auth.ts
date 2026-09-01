import { z } from 'zod';

export const googleLoginRequestSchema = z.object({
  /** idToken de Google Sign-In (web con PKCE o `google_sign_in` en Flutter). */
  idToken: z.string().min(10),
  device: z.string().max(120).optional(),
});
export type GoogleLoginRequest = z.infer<typeof googleLoginRequestSchema>;

export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  /** Solo se devuelve a clientes que no usan cookie (móvil). */
  refreshToken: z.string().optional(),
  user: sessionUserSchema,
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const refreshRequestSchema = z.object({ refreshToken: z.string().optional() });
