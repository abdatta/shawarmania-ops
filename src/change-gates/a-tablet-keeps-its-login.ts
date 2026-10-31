import { bootSnapshot } from './snapshot'

/**
 * The `a-tablet-keeps-its-login` toggle point for `signIn` and `redeemInvite`
 * (a-tablet-keeps-its-login, design D2). The account module is not a
 * component, so it reads the page's frozen snapshot directly. On, a person's
 * sign-in or activation is refused while the browser holds a tablet's session;
 * off, it is sent as before.
 */
export function onATabletKeepsItsLogin(): boolean {
  return bootSnapshot()['a-tablet-keeps-its-login']
}
