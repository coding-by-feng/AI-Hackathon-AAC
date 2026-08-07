import { signInRoster } from '@/lib/session'
import { WhoPicker } from '@/components/kid/who-picker'

export const dynamic = 'force-dynamic'

export default function WhoPage() {
  const roster = signInRoster().map((c) => ({
    child_id: c.child_id,
    display_name: c.display_name,
    year_group: c.year_group,
    hasPasscode: c.passcode !== null,
  }))

  return <WhoPicker children={roster} />
}
