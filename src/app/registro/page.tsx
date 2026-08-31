import { AuthForm } from "@/features/auth/components/AuthForm";
import { signUp } from "@/features/auth/actions";

export const metadata = { title: "Crear cuenta — Hybrid Crono" };

export default function RegistroPage() {
  return <AuthForm mode="registro" action={signUp} />;
}
