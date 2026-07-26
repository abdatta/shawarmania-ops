import { Card, CardBody, CardTitle } from '@/components/ui/card'

/**
 * Placeholder landing surface. The app is intentionally empty of features at
 * this point — project-foundations ships the shell, the theme and the
 * deployment path, and nothing else.
 */
export function Home() {
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardTitle>Foundations are in place</CardTitle>
        <CardBody>
          <p>
            The shell, design tokens, both themes and the offline app shell are live. Features
            arrive with the changes on the roadmap — the schema and tenancy model first, then
            attendance.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
