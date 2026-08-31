import { AuthForm } from "@/features/auth/components/AuthForm";
import { signIn } from "@/features/auth/actions";

export const metadata = { title: "Entrar — Hybrid Crono" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ volver?: string }>;
}) {
  const { volver } = await searchParams;
  return <AuthForm mode="login" action={signIn} volver={volver} />;
}
