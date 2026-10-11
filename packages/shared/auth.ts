import { z } from "zod";

export const signupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email()
    .transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(72),
});

export type SignupInput = z.infer<typeof signupSchema>;