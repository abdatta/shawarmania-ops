# You Can't Click Your Way to the Counter Setup Page

**Area:** Navigation · **Reported:** 12 Aug 2026, Kalyani outlet

## What's wrong

There's a page where you set up the counter tablet. Right now, the only way to
get there is to type the web address by hand. That doesn't even work when the
app is installed as an app on the tablet, because installed apps don't have an
address bar to type into.

## Why this happens

- No button, link, or menu item anywhere in the app points to this page.
- The page that admins use to create the tablet's setup code also doesn't
  link to it — it just says "type this on the tablet," and leaves you to find
  the tablet's setup screen yourself.
- Bonus problem found while looking into this: there's a "Shift" tab that's
  supposed to show up in the app's menu, but it's switched off everywhere
  right now, even though the page it points to is fully working. Looks like
  it got turned off by accident.

## What a fix could look like

- Add a real button or link to the setup page, from wherever an admin
  generates the tablet's code.
- Turn the "Shift" tab back on, or confirm on purpose that it should stay
  off.

## Code hint (for whoever builds this)

- Setup page route: `src/routes/index.tsx:87`
- Code-generation screen: `src/features/counter/devices-surface.tsx:162`
- The switched-off tab: `src/gates/registry.ts:317-322`
