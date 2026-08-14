import { Suspense } from 'react';

import AuthForm from '@/components/AuthForm';

export const metadata = { title: 'Sign up — OMREval' };

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
