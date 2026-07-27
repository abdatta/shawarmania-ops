import { Link } from 'react-router'

import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'

/**
 * What an unauthenticated visitor sees at the root. Sign-in arrives with
 * auth-and-roles (#4); until then the demo is the product, and the way in is
 * deliberately prominent.
 */
export function Landing() {
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardTitle>Shawarmania Ops</CardTitle>
        <CardBody className="space-y-4">
          <p>
            Counter billing, attendance, stock, expenses and daily cash for every Shawarmania
            outlet — with each outlet's data strictly isolated, and the owner's view across all of
            them.
          </p>
          <p>
            Sign-in for staff arrives with the auth-and-roles change. Meanwhile, the entire
            four-role experience is walkable in the demo with fabricated data.
          </p>
          <Link to="/demo" className={buttonVariants({ size: 'phone' })}>
            View the demo
          </Link>
        </CardBody>
      </Card>
    </div>
  )
}
