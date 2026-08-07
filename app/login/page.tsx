import { accountCount } from '@/lib/auth'
import { all } from '@/lib/db'
import { LoginForm } from '@/components/login-form'

export const dynamic = 'force-dynamic'

export default function LoginPage() {
  const setupOpen = accountCount() === 0
  const adults = setupOpen
    ? all<{ adult_id: string; display_name: string; role: string }>(
        `SELECT adult_id, display_name, role FROM adults ORDER BY display_name`,
      )
    : []

  return <LoginForm setupOpen={setupOpen} adults={adults} />
}
