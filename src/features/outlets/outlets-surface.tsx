import { Crosshair, LoaderCircle, MapPin, MapPinOff, Store, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAdapters, type Tables } from '@/data-access'
import {
  captureQuality,
  CAPTURE_ACCURACY_GOOD_M,
  CAPTURE_ACCURACY_MAX_M,
  formatDateTime,
  formatMetres,
} from '@/domain'
import { watchBestPosition, type GeolocationFailureKind, type PositionReading } from '@/lib/geolocation'

/**
 * Outlets — and, the reason this screen exists now, capturing where each one
 * actually is.
 *
 * A geofence built from a map search is a geofence built on a guess, and every
 * future check-in is judged against it. So the position is read from the device
 * standing at the counter, and the quality of that reading is shown before
 * anything is saved and stored alongside it afterwards.
 */
export function OutletsSurface() {
  const { outlets: adapter } = useAdapters()
  const [outlets, setOutlets] = useState<Tables<'outlets'>[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [capturing, setCapturing] = useState<Tables<'outlets'> | null>(null)

  useEffect(() => {
    let active = true
    void adapter
      .listOutlets()
      .then((list) => {
        if (active) setOutlets(list)
      })
      .catch(() => {
        if (active) setError('Could not load outlets. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [adapter])

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Outlets"
        subtitle="Where each outlet is, and how far staff may be when they check in."
      />

      {error && (
        <p role="alert" data-testid="outlets-error" className="mb-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {outlets === null ? (
        <p className="text-sm text-content-muted">Loading…</p>
      ) : outlets.length === 0 ? (
        <EmptyState icon={Store} title="No outlets yet." />
      ) : (
        <div data-testid="outlet-list" className="space-y-3">
          {outlets.map((outlet) => (
            <OutletCard key={outlet.id} outlet={outlet} onCapture={() => setCapturing(outlet)} />
          ))}
        </div>
      )}

      {/*
        Keyed by the outlet: opening the sheet for a different shop starts from
        a clean reading, as a remount rather than an effect resetting state.
      */}
      <CaptureSheet
        key={capturing?.id ?? 'none'}
        outlet={capturing}
        onClose={() => setCapturing(null)}
        onSaved={(saved) => {
          setOutlets(
            (current) =>
              current?.map((outlet) => (outlet.id === saved.id ? saved : outlet)) ?? current,
          )
          setCapturing(null)
        }}
      />
    </div>
  )
}

function OutletCard({
  outlet,
  onCapture,
}: {
  outlet: Tables<'outlets'>
  onCapture: () => void
}) {
  const surveyed = outlet.location_captured_at !== null
  const positioned = outlet.latitude !== null && outlet.longitude !== null

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-content">{outlet.name}</h2>
        <span className="text-xs text-content-muted">{outlet.location_label}</span>
      </div>

      {surveyed ? (
        <div className="space-y-1 text-sm">
          <p className="inline-flex items-center gap-1 text-content">
            <MapPin aria-hidden size={14} />
            {outlet.latitude?.toFixed(5)}, {outlet.longitude?.toFixed(5)}
          </p>
          <p className="text-xs text-content-muted">
            Captured on site {formatDateTime(outlet.location_captured_at!)}
            {outlet.location_accuracy_m !== null &&
              ` · the fix was accurate to ±${formatMetres(outlet.location_accuracy_m)}`}
          </p>
        </div>
      ) : (
        <p
          data-testid={`uncaptured-${outlet.code}`}
          className="inline-flex items-start gap-2 rounded-lg border border-warning bg-surface-raised p-2 text-xs text-content"
        >
          <MapPinOff aria-hidden size={14} className="mt-0.5 shrink-0 text-warning" />
          <span>
            {positioned
              ? 'These coordinates were never captured on site, so they are a placeholder. Check-ins here are judged against a point nobody has stood on.'
              : 'No position recorded. Check-ins here are not measured against a geofence at all.'}
          </span>
        </p>
      )}

      <p className="text-xs text-content-muted">
        Staff may check in within {formatMetres(outlet.geofence_radius_m)} of this point.
      </p>

      <Button variant={surveyed ? 'secondary' : 'primary'} size="phone" onClick={onCapture}>
        <Crosshair aria-hidden size={16} />
        {surveyed ? 'Capture again' : 'Capture position here'}
      </Button>
    </Card>
  )
}

type CaptureState =
  | { kind: 'idle' }
  | { kind: 'sampling'; best: PositionReading | null }
  | { kind: 'captured'; reading: PositionReading }
  | { kind: 'failed'; failure: GeolocationFailureKind }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }

const FAILURE_COPY: Record<GeolocationFailureKind, string> = {
  denied: 'Location permission is off for this site. Turn it on and try again.',
  unavailable: 'This device could not find a position. Step outside and try again.',
  timeout: 'Finding a position took too long. Step outside for a clearer view of the sky.',
  unsupported: 'This browser cannot share a location. Try another one.',
}

function CaptureSheet({
  outlet,
  onClose,
  onSaved,
}: {
  outlet: Tables<'outlets'> | null
  onClose: () => void
  onSaved: (outlet: Tables<'outlets'>) => void
}) {
  const { outlets: adapter } = useAdapters()
  const [state, setState] = useState<CaptureState>({ kind: 'idle' })
  const [radius, setRadius] = useState(() => String(outlet?.geofence_radius_m ?? 150))

  async function takeReading() {
    setState({ kind: 'sampling', best: null })
    const result = await watchBestPosition({
      onSample: (reading) => setState({ kind: 'sampling', best: reading }),
    })
    setState(
      result.ok ? { kind: 'captured', reading: result.reading } : { kind: 'failed', failure: result.kind },
    )
  }

  async function save(reading: PositionReading) {
    if (!outlet) return
    const radiusMetres = Number(radius)
    if (!Number.isFinite(radiusMetres) || radiusMetres <= 0) {
      setState({ kind: 'error', message: 'The radius must be a number of metres above zero.' })
      return
    }

    setState({ kind: 'saving' })
    try {
      onSaved(
        await adapter.saveLocation(outlet.id, {
          latitude: reading.latitude,
          longitude: reading.longitude,
          accuracyMetres: reading.accuracyMetres,
          radiusMetres,
        }),
      )
    } catch {
      setState({ kind: 'error', message: 'Could not save that position. Try again in a moment.' })
    }
  }

  const captured = state.kind === 'captured' ? state.reading : null
  const quality = captured ? captureQuality(captured.accuracyMetres) : null

  return (
    <FormSheet
      open={outlet !== null}
      onClose={onClose}
      title={outlet ? `Capture ${outlet.name}` : 'Capture position'}
      footer={
        captured && quality !== 'unusable' ? (
          <Button
            size="phone"
            className="w-full"
            disabled={state.kind === 'saving'}
            onClick={() => void save(captured)}
            data-testid="save-position"
          >
            Save this as the outlet’s position
          </Button>
        ) : (
          <Button
            size="phone"
            className="w-full"
            variant="secondary"
            disabled={state.kind === 'sampling' || state.kind === 'saving'}
            onClick={() => void takeReading()}
            data-testid="take-reading"
          >
            {state.kind === 'sampling' ? 'Reading…' : 'Take a reading'}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-content-muted">
          Stand where staff will check in from — at the counter, not across the road. Hold still for
          a few seconds while the reading settles.
        </p>

        {state.kind === 'sampling' && (
          <p
            data-testid="capture-sampling"
            className="flex items-center gap-2 text-sm font-semibold text-content"
          >
            <LoaderCircle aria-hidden size={16} className="animate-spin" />
            {state.best
              ? `Best so far: ±${formatMetres(state.best.accuracyMetres)}`
              : 'Looking for a position…'}
          </p>
        )}

        {state.kind === 'failed' && (
          <p
            role="alert"
            data-testid="capture-failed"
            data-failure={state.failure}
            className="text-sm font-semibold text-danger"
          >
            {FAILURE_COPY[state.failure]}
          </p>
        )}

        {state.kind === 'error' && (
          <p role="alert" data-testid="capture-error" className="text-sm font-semibold text-danger">
            {state.message}
          </p>
        )}

        {captured && quality && (
          <div data-testid="capture-result" data-quality={quality} className="space-y-3">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-content-muted">Latitude</dt>
              <dd className="font-mono text-content">{captured.latitude.toFixed(6)}</dd>
              <dt className="text-content-muted">Longitude</dt>
              <dd className="font-mono text-content">{captured.longitude.toFixed(6)}</dd>
              <dt className="text-content-muted">Accuracy</dt>
              <dd className="font-semibold text-content">
                ±{formatMetres(captured.accuracyMetres)}
              </dd>
            </dl>

            {quality === 'unusable' && (
              <p className="flex items-start gap-2 rounded-lg border border-danger p-2 text-xs text-content">
                <TriangleAlert aria-hidden size={14} className="mt-0.5 shrink-0 text-danger" />
                <span>
                  This reading is too loose to save — anything past ±
                  {formatMetres(CAPTURE_ACCURACY_MAX_M)} would judge every future check-in against a
                  point that could be far from here. Step outside, away from the roof, and take
                  another.
                </span>
              </p>
            )}

            {quality === 'imprecise' && (
              <p className="flex items-start gap-2 rounded-lg border border-warning p-2 text-xs text-content">
                <TriangleAlert aria-hidden size={14} className="mt-0.5 shrink-0 text-warning" />
                <span>
                  This will do, but it is not tight. Anything past ±
                  {formatMetres(CAPTURE_ACCURACY_GOOD_M)} means the saved point may sit that far
                  from where you are standing, and every check-in is measured from it. Taking
                  another reading outside usually helps.
                </span>
              </p>
            )}

            <div className="space-y-1">
              <label htmlFor="capture-radius" className="block text-sm font-semibold">
                How far from here may staff check in?
              </label>
              <Input
                id="capture-radius"
                type="number"
                inputMode="numeric"
                min={1}
                value={radius}
                onChange={(event) => setRadius(event.target.value)}
              />
              <p className="text-xs text-content-muted">
                Metres. 150 is the agreed default; widen it if the shop sits back from the road.
              </p>
            </div>

            <button
              type="button"
              className={`${buttonVariants({ variant: 'ghost', size: 'phone' })} w-full`}
              onClick={() => void takeReading()}
            >
              Take another reading
            </button>
          </div>
        )}
      </div>
    </FormSheet>
  )
}
