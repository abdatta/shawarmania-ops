import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'

/**
 * A session probably exists, and the app could not confirm it.
 *
 * The distinction this screen protects is the whole point of it: **not knowing
 * is not the same as being signed out**. Losing the network must never sign
 * anybody out, so a failed confirmation offers a retry and never a password
 * field — asking somebody to authenticate again for a session they still hold is
 * a refusal made on the strength of an unanswered request
 * (the-root-resolves-instead-of-greeting, design D3).
 *
 * It is shared by the application root and the role shells because it is one
 * fact about one session, and a variant of the sentence per screen would invite
 * them to drift into disagreeing about it.
 */
export function UnconfirmedSession({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4 text-content">
      <Card className="max-w-md">
        <CardTitle>Could not reach Shawarmania Ops</CardTitle>
        <CardBody className="space-y-4">
          <p>
            You are still signed in — the app just could not confirm it. Check your connection and
            try again.
          </p>
          <button type="button" onClick={onRetry} className={buttonVariants({ size: 'phone' })}>
            Try again
          </button>
        </CardBody>
      </Card>
    </div>
  )
}
