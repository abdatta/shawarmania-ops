import { Link } from 'react-router'

import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'

export function NotFound() {
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardTitle>That page does not exist</CardTitle>
        <CardBody>
          <p>The link may be out of date, or the feature may not be built yet.</p>
          <Link to="/" className={`${buttonVariants({ size: 'phone' })} mt-4`}>
            Back to the start
          </Link>
        </CardBody>
      </Card>
    </div>
  )
}
