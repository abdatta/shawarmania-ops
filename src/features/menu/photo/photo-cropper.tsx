import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import type { MenuPhotoAspect, MenuPhotoCrop } from '@/data-access/adapters'
import { cn } from '@/lib/cn'

import {
  ASPECT_RATIO,
  ASPECTS,
  centredCrop,
  defaultAspect,
  frameSize,
  fromFractions,
  maxZoom,
  panCrop,
  reshapeCrop,
  squareWithin,
  toFractions,
  zoomCrop,
  zoomOf,
  type CropRect,
  type ImageSize,
} from './crop-geometry'

/**
 * The cropper (a-dish-can-show-its-photo, design D5): one framing makes the
 * large photo and, as the largest square inside it, the thumbnail; framing the
 * thumbnail separately is one tap away.
 *
 * In-house rather than `react-easy-crop`; the reasons are in the change's
 * design.md. The frame keeps its shape and stays put; the photo moves and
 * zooms under it by drag, pinch, wheel, slider or keyboard, and can never be
 * moved or zoomed out so far that an edge shows. What the frame shows is the
 * framing itself (see `crop-geometry.ts`), so it is exactly what is cut.
 */

export interface PhotoFraming {
  aspect: MenuPhotoAspect
  largeCrop: MenuPhotoCrop
  thumbCrop: MenuPhotoCrop
}

interface PhotoCropperProps {
  open: boolean
  /** The kept original, as the page can draw it. */
  imageUrl: string
  /** Its size in pixels: every framing is in these. */
  image: ImageSize
  /** Where to start: the saved framings on Adjust, a fresh one otherwise. */
  initial?: PhotoFraming | null | undefined
  onCancel: () => void
  onDone: (framing: PhotoFraming) => void
}

type Step = 'large' | 'thumb'

/**
 * Each shape in a word and a drawn outline, so a manager knows what it is
 * before tapping it; the ratio is for screen readers (owner, 2026-11-17).
 */
const SHAPES: Record<MenuPhotoAspect, { word: string; outline: string }> = {
  '4:3': { word: 'Wide', outline: 'h-3 w-4' },
  '1:1': { word: 'Square', outline: 'size-3.5' },
  '4:5': { word: 'Tall', outline: 'h-4 w-3.5' },
}

/** Whether a saved thumbnail is the square inside the saved frame, to a thousandth. */
function followsFrame(thumb: CropRect, large: CropRect, image: ImageSize) {
  const square = squareWithin(large, image)
  return (['x', 'y', 'w', 'h'] as const).every(
    (side) =>
      Math.abs(thumb[side] - square[side]) /
        (side === 'x' || side === 'w' ? image.width : image.height) <
      0.001,
  )
}

export function PhotoCropper({
  open,
  imageUrl,
  image,
  initial,
  onCancel,
  onDone,
}: PhotoCropperProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      dismissOnOutsideTap={false}
      aria-label="Frame the photo"
      className="m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-photo-stage p-0 text-on-photo-stage"
    >
      {/* Mounted only while open, so every opening starts from `initial`. */}
      <CropperSteps
        imageUrl={imageUrl}
        image={image}
        initial={initial}
        onCancel={onCancel}
        onDone={onDone}
      />
    </Modal>
  )
}

function CropperSteps({
  imageUrl,
  image,
  initial,
  onCancel,
  onDone,
}: Omit<PhotoCropperProps, 'open'>) {
  const [step, setStep] = useState<Step>('large')
  const [aspect, setAspect] = useState<MenuPhotoAspect>(initial?.aspect ?? defaultAspect(image))
  const [large, setLarge] = useState<CropRect>(() =>
    initial
      ? fromFractions(initial.largeCrop, image, ASPECT_RATIO[initial.aspect])
      : centredCrop(image, ASPECT_RATIO[aspect]),
  )
  // One framing makes both pictures (owner, 2026-11-17): null is a thumbnail
  // that follows the frame, the largest square inside it. A thumbnail the
  // manager framed separately is kept here, and stays put when the frame moves.
  const [thumb, setThumb] = useState<CropRect | null>(() => {
    if (!initial) return null
    const saved = fromFractions(initial.thumbCrop, image, 1)
    return followsFrame(saved, large, image) ? null : saved
  })
  // The square being framed in the thumbnail step, and whether it was moved.
  const [thumbWork, setThumbWork] = useState<CropRect | null>(null)
  const [thumbMoved, setThumbMoved] = useState(false)

  function changeAspect(next: MenuPhotoAspect) {
    if (next === aspect) return
    setLarge(reshapeCrop(large, ASPECT_RATIO[aspect], ASPECT_RATIO[next], image))
    setAspect(next)
  }

  function openThumb() {
    setThumbWork(thumb ?? squareWithin(large, image))
    setThumbMoved(false)
    setStep('thumb')
  }

  /** The thumbnail step's square, kept if it was moved. */
  function keptThumb() {
    return thumbMoved && thumbWork ? thumbWork : thumb
  }

  function backFromThumb() {
    setThumb(keptThumb())
    setStep('large')
  }

  function matchPhoto() {
    setThumb(null)
    setStep('large')
  }

  function done() {
    const chosen = step === 'thumb' ? keptThumb() : thumb
    onDone({
      aspect,
      largeCrop: toFractions(large, image),
      thumbCrop: toFractions(chosen ?? squareWithin(large, image), image),
    })
  }

  const onLarge = step === 'large'
  return (
    <div className="flex h-full flex-col" data-testid="photo-cropper">
      <header className="space-y-3 px-4 pt-4">
        <h2 className="text-base font-bold" data-testid="cropper-title">
          {onLarge ? 'Frame the photo' : 'Thumbnail'}
        </h2>
        {onLarge && (
          <div role="group" aria-label="Shape" className="grid grid-cols-3 gap-2">
            {ASPECTS.map((choice) => (
              <button
                key={choice}
                type="button"
                aria-pressed={aspect === choice}
                aria-label={`${SHAPES[choice].word}, ${choice}`}
                onClick={() => changeAspect(choice)}
                className={cn(
                  'inline-flex min-h-[var(--size-control-phone)] items-center justify-center gap-2 rounded-lg border px-2 text-sm font-semibold',
                  aspect === choice
                    ? 'border-on-photo-stage bg-on-photo-stage text-photo-stage'
                    : 'border-on-photo-stage/40 text-on-photo-stage',
                )}
              >
                <span
                  aria-hidden
                  data-testid={`shape-outline-${choice}`}
                  className={cn(
                    'shrink-0 rounded-[2px] border-2 border-current',
                    SHAPES[choice].outline,
                  )}
                />
                {SHAPES[choice].word}
              </button>
            ))}
          </div>
        )}
      </header>

      {onLarge ? (
        <CropStage
          key={`large-${aspect}`}
          label="Photo"
          imageUrl={imageUrl}
          image={image}
          ratio={ASPECT_RATIO[aspect]}
          rect={large}
          onChange={setLarge}
          thumbnail={thumb ? null : squareWithin(large, image)}
        />
      ) : (
        thumbWork && (
          <CropStage
            key="thumb"
            label="Thumbnail"
            imageUrl={imageUrl}
            image={image}
            ratio={1}
            rounded
            rect={thumbWork}
            onChange={(rect) => {
              setThumbWork(rect)
              setThumbMoved(true)
            }}
          />
        )
      )}

      <div className="flex justify-center px-4 pb-2">
        {onLarge ? (
          <button
            type="button"
            onClick={openThumb}
            className="min-h-[var(--size-control-phone)] px-2 text-sm font-semibold underline underline-offset-4"
          >
            {thumb ? 'Change the thumbnail ›' : 'Frame the thumbnail separately ›'}
          </button>
        ) : (
          <Button variant="secondary" size="phone" onClick={matchPhoto}>
            Match the photo
          </Button>
        )}
      </div>

      <footer className="flex items-center justify-between gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button variant="secondary" size="phone" onClick={onLarge ? onCancel : backFromThumb}>
          Back
        </Button>
        <Button size="phone" onClick={done}>
          Done
        </Button>
      </footer>
    </div>
  )
}

/** Measured once laid out, and on every resize; a stand-in where nothing lays out (tests). */
function useStageSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<ImageSize>({ width: 360, height: 360 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = element
      if (width > 0 && height > 0) setSize({ width, height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, size] as const
}

const KEY_STEP = 12
const ZOOM_STEP = 1.1

interface CropStageProps {
  label: string
  imageUrl: string
  image: ImageSize
  ratio: number
  rect: CropRect
  onChange: (rect: CropRect) => void
  /** The thumbnail this framing gives, drawn in it as a dashed square. */
  thumbnail?: CropRect | null
  /** The thumbnail's own frame, rounded as the menu row draws it. */
  rounded?: boolean
}

function CropStage({
  label,
  imageUrl,
  image,
  ratio,
  rect,
  onChange,
  thumbnail,
  rounded,
}: CropStageProps) {
  const [stageRef, stage] = useStageSize()
  const frame = frameSize(stage, ratio)
  const frameLeft = (stage.width - frame.width) / 2
  const frameTop = (stage.height - frame.height) / 2
  const scale = frame.width / rect.w
  const zoom = zoomOf(rect, image, ratio)
  const zoomLimit = maxZoom(image, ratio)

  // Pointer events can outrun React's renders, so each one works from the
  // framing the last one produced rather than the last one drawn.
  const latest = useRef(rect)
  useEffect(() => {
    latest.current = rect
  }, [rect])
  const commit = useCallback(
    (next: CropRect) => {
      latest.current = next
      onChange(next)
    },
    [onChange],
  )

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const [interacting, setInteracting] = useState(false)

  /** A point on screen as a fraction of the frame. */
  const anchorAt = useCallback(
    (clientX: number, clientY: number) => {
      const box = stageRef.current?.getBoundingClientRect()
      const left = (box?.left ?? 0) + frameLeft
      const top = (box?.top ?? 0) + frameTop
      return {
        x: Math.min(1, Math.max(0, (clientX - left) / frame.width)),
        y: Math.min(1, Math.max(0, (clientY - top) / frame.height)),
      }
    },
    [frame.height, frame.width, frameLeft, frameTop, stageRef],
  )

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    setInteracting(true)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const known = pointers.current
    const before = known.get(event.pointerId)
    if (!before) return
    const current = latest.current
    const s = frame.width / current.w
    if (known.size === 1) {
      known.set(event.pointerId, { x: event.clientX, y: event.clientY })
      commit(
        panCrop(
          current,
          -(event.clientX - before.x) / s,
          -(event.clientY - before.y) / s,
          image,
          ratio,
        ),
      )
      return
    }
    // Two fingers: zoom by how far apart they moved, about their midpoint, and
    // move with the midpoint.
    const others = [...known.entries()].filter(([id]) => id !== event.pointerId)
    const other = others[0]?.[1]
    if (!other) return
    const after = { x: event.clientX, y: event.clientY }
    known.set(event.pointerId, after)
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y)
    const was = distance(before, other)
    const now = distance(after, other)
    if (was < 1) return
    const midBefore = { x: (before.x + other.x) / 2, y: (before.y + other.y) / 2 }
    const midAfter = { x: (after.x + other.x) / 2, y: (after.y + other.y) / 2 }
    const zoomed = zoomCrop(
      current,
      zoomOf(current, image, ratio) * (now / was),
      image,
      ratio,
      anchorAt(midBefore.x, midBefore.y),
    )
    const s2 = frame.width / zoomed.w
    commit(
      panCrop(
        zoomed,
        -(midAfter.x - midBefore.x) / s2,
        -(midAfter.y - midBefore.y) / s2,
        image,
        ratio,
      ),
    )
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size === 0) setInteracting(false)
  }

  // The wheel is listened to directly: React's is passive, and a wheel that
  // zooms the photo must not also scroll whatever is behind it.
  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const current = latest.current
      const factor = Math.exp(-event.deltaY * 0.002)
      commit(
        zoomCrop(
          current,
          zoomOf(current, image, ratio) * factor,
          image,
          ratio,
          anchorAt(event.clientX, event.clientY),
        ),
      )
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [anchorAt, commit, image, ratio, stageRef])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = latest.current
    const s = frame.width / current.w
    const step = (event.shiftKey ? KEY_STEP * 4 : KEY_STEP) / s
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      // The keys move the photo, as a finger does: Left slides it left, which
      // brings more of its right side into the frame.
      commit(panCrop(current, -move[0], -move[1], image, ratio))
      return
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      commit(zoomCrop(current, zoomOf(current, image, ratio) * ZOOM_STEP, image, ratio))
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      commit(zoomCrop(current, zoomOf(current, image, ratio) / ZOOM_STEP, image, ratio))
    }
  }

  const thirds = [1 / 3, 2 / 3]
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={stageRef}
        role="group"
        aria-label={`${label}. Drag to move, pinch or use the slider to zoom. Arrow keys move, plus and minus zoom.`}
        aria-roledescription="photo framing"
        tabIndex={0}
        data-testid="crop-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-focus-ring active:cursor-grabbing"
      >
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          data-testid="crop-image"
          className="pointer-events-none absolute max-w-none"
          style={{
            left: frameLeft - rect.x * scale,
            top: frameTop - rect.y * scale,
            width: image.width * scale,
            height: image.height * scale,
          }}
        />
        <div
          data-testid="crop-frame"
          aria-hidden
          className={cn(
            'pointer-events-none absolute border border-on-photo-stage/80 shadow-[0_0_0_100vmax_var(--photo-stage-dim)]',
            rounded ? 'rounded-2xl' : 'rounded-sm',
          )}
          style={{ left: frameLeft, top: frameTop, width: frame.width, height: frame.height }}
        >
          {thumbnail && (
            <span
              data-testid="crop-thumbnail"
              className="absolute rounded-xl border-2 border-dashed border-on-photo-stage/90"
              style={{
                left: (thumbnail.x - rect.x) * scale,
                top: (thumbnail.y - rect.y) * scale,
                width: thumbnail.w * scale,
                height: thumbnail.h * scale,
              }}
            >
              <span className="absolute top-1.5 left-1.5 rounded-md bg-photo-stage-dim px-1.5 py-0.5 text-xs font-semibold">
                Thumbnail
              </span>
            </span>
          )}
          {interacting &&
            thirds.map((at) => (
              <span key={at}>
                <span
                  data-testid="crop-grid"
                  className="absolute inset-y-0 w-px bg-on-photo-stage/50"
                  style={{ left: `${at * 100}%` }}
                />
                <span
                  className="absolute inset-x-0 h-px bg-on-photo-stage/50"
                  style={{ top: `${at * 100}%` }}
                />
              </span>
            ))}
        </div>
      </div>
      <label className="flex items-center gap-3 px-6 py-3 text-sm font-semibold">
        Zoom
        <input
          type="range"
          aria-label="Zoom"
          min={1}
          max={Math.max(1, zoomLimit)}
          step={0.01}
          value={zoom}
          disabled={zoomLimit <= 1.001}
          onChange={(event) =>
            commit(zoomCrop(latest.current, Number(event.target.value), image, ratio))
          }
          className="flex-1 accent-primary"
        />
      </label>
    </div>
  )
}
