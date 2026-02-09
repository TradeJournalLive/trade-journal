import { Suspense } from "react";
import SignInClient from "./SignInClient";

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-ink text-white flex items-center justify-center">
          <div className="card text-sm text-muted">Loading sign in...</div>
        </main>
      }
    >
      <SignInClient />
    </Suspense>
  );
}
