import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { AddButton } from '@/components/ui/add-button'
import { Button } from '@/components/ui/button'
import { Shimmer } from '@/components/ui/loading'
import type { MenuItemPhoto, MenuPhotoAspect, MenuPhotoCrop } from '@/data-access/adapters'
import { cn } from '@/lib/cn'

import { ASPECT_RATIO } from './crop-geometry'
import { PhotoCropper, type PhotoFraming } from './photo-cropper'
import { UNCHANGED, type FramedOriginal, type PhotoDraft } from './photo-draft'
import {
  isSmallCrop,
  PhotoPrepareError,
  readSavedOriginal,
  startOriginal,
  type PreparedOriginal,
} from './prepare-photo'

/**
 * The dish editor's Photo field (a-dish-can-show-its-photo, design D8).
 *
 * Nothing uploads here. The field holds what the manager chose — a new photo
 * and its framings, a re-framed saved photo, or a removal — and the editor
 * sends it on Save, after the dish's own fields.
 */

interface MenuPhotoFieldProps {
  /** The dish's saved photo, if it has one. */
  saved: MenuItemPhoto | null
  draft: PhotoDraft
  onDraftChange: (draft: PhotoDraft) => void
  disabled?: boolean
}

interface Cropping {
  original: FramedOriginal
  initial: PhotoFraming | null
}

export function MenuPhotoField({ saved, draft, onDraftChange, disabled }: MenuPhotoFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  const [cropping, setCropping] = useState<Cropping | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // Every address this field made for a picked photo goes when the editor does.
  const made = useRef<string[]>([])
  useEffect(() => {
    const urls = made.current
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  async function picked(file: File | undefined) {
    if (!file) return
    setProblem(null)
    setPreparing(true)
    try {
      const { size, ready } = await startOriginal(file)
      const displayUrl = URL.createObjectURL(file)
      made.current.push(displayUrl)
      setCropping({ original: { displayUrl, size, ready, reused: false }, initial: null })
    } catch (cause) {
      setProblem(
        cause instanceof PhotoPrepareError ? cause.message : 'This photo could not be read.',
      )
    } finally {
      setPreparing(false)
    }
  }

  async function adjust() {
    setProblem(null)
    if (draft.kind === 'framed') {
      setCropping({ original: draft.original, initial: draft.framing })
      return
    }
    if (!saved) return
    setPreparing(true)
    try {
      const original = await readSavedOriginal(saved.sourceUrl)
      const prepared: PreparedOriginal = {
        blob: original.blob,
        format: saved.sourceFormat,
        key: saved.sourceKey,
        width: original.width,
        height: original.height,
      }
      setCropping({
        original: {
          displayUrl: saved.sourceUrl,
          size: { width: original.width, height: original.height },
          ready: Promise.resolve(prepared),
          reused: true,
        },
        initial: { aspect: saved.aspect, largeCrop: saved.largeCrop, thumbCrop: saved.thumbCrop },
      })
    } catch (cause) {
      setProblem(
        cause instanceof PhotoPrepareError ? cause.message : 'The saved photo could not be loaded.',
      )
    } finally {
      setPreparing(false)
    }
  }

  const choose = () => input.current?.click()

  // What the editor shows: the choice if there is one, else the saved photo.
  const shown: Preview | null =
    draft.kind === 'framed'
      ? {
          aspect: draft.framing.aspect,
          thumb: { url: draft.original.displayUrl, crop: draft.framing.thumbCrop },
          large: { url: draft.original.displayUrl, crop: draft.framing.largeCrop },
        }
      : draft.kind === 'unchanged' && saved
        ? {
            aspect: saved.aspect,
            thumb: { url: saved.thumbUrl, crop: null },
            large: { url: saved.largeUrl, crop: null },
          }
        : null

  const small = draft.kind === 'framed' && isSmallCrop(draft.framing.largeCrop, draft.original.size)

  return (
    <div className="space-y-2" data-testid="menu-photo-field">
      <p className="text-sm font-semibold" id="menu-item-photo-label">
        Photo
      </p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="menu-photo-input"
        aria-labelledby="menu-item-photo-label"
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Cleared so picking the same file again still reads as a choice.
          event.target.value = ''
          void picked(file)
        }}
      />

      {preparing ? (
        <Shimmer className="h-[5.5rem]" data-testid="menu-photo-preparing" />
      ) : shown ? (
        <>
          <div className="flex items-start gap-3" data-testid="menu-photo-preview">
            <PhotoPreview
              testId="menu-photo-thumb"
              label="Menu thumbnail"
              url={shown.thumb.url}
              crop={shown.thumb.crop}
              className="size-[5.5rem] rounded-[0.875rem]"
            />
            <PhotoPreview
              testId="menu-photo-large"
              label="Large photo"
              url={shown.large.url}
              crop={shown.large.crop}
              className="h-[8.5rem] rounded-lg"
              style={{ aspectRatio: ASPECT_RATIO[shown.aspect] }}
            />
          </div>
          {small && (
            <p className="text-xs text-content-muted" data-testid="menu-photo-small">
              This photo is small and may look soft when opened large.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="phone"
              disabled={disabled}
              onClick={() => void adjust()}
            >
              Adjust
            </Button>
            <Button variant="secondary" size="phone" disabled={disabled} onClick={choose}>
              Change
            </Button>
            <Button
              variant="secondary"
              size="phone"
              disabled={disabled}
              onClick={() => onDraftChange(saved ? { kind: 'removed' } : UNCHANGED)}
            >
              Remove
            </Button>
          </div>
        </>
      ) : (
        <div
          className="flex h-[5.5rem] items-center justify-center rounded-lg border-2 border-dashed border-border"
          data-testid="menu-photo-empty"
        >
          <AddButton label="Add photo" disabled={disabled} onClick={choose} />
        </div>
      )}

      {problem && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {problem}
        </p>
      )}

      {cropping && (
        <PhotoCropper
          open
          imageUrl={cropping.original.displayUrl}
          image={cropping.original.size}
          initial={cropping.initial}
          onCancel={() => setCropping(null)}
          onDone={(framing) => {
            onDraftChange({ kind: 'framed', original: cropping.original, framing })
            setCropping(null)
          }}
        />
      )}
    </div>
  )
}

interface Preview {
  aspect: MenuPhotoAspect
  thumb: { url: string; crop: MenuPhotoCrop | null }
  large: { url: string; crop: MenuPhotoCrop | null }
}

/**
 * A framing drawn without encoding anything: the original, scaled and moved so
 * the framed part fills the box. A saved photo is already cut, so it is drawn
 * whole.
 */
function PhotoPreview({
  url,
  crop,
  label,
  testId,
  className,
  style,
}: {
  url: string
  crop: MenuPhotoCrop | null
  label: string
  testId: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <div
      role="img"
      aria-label={label}
      data-testid={testId}
      className={cn('relative shrink-0 overflow-hidden bg-surface-raised', className)}
      style={style}
    >
      <img
        src={url}
        alt=""
        draggable={false}
        className="absolute max-w-none"
        style={
          crop
            ? {
                width: `${100 / crop.w}%`,
                height: `${100 / crop.h}%`,
                left: `${(-crop.x / crop.w) * 100}%`,
                top: `${(-crop.y / crop.h) * 100}%`,
              }
            : { inset: 0, width: '100%', height: '100%', objectFit: 'cover' }
        }
      />
    </div>
  )
}
