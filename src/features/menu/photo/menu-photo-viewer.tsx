import { X } from 'lucide-react'
import { useState } from 'react'

import { Modal } from '@/components/ui/modal'
import type { MenuItemPhoto, MenuPhotoAspect } from '@/data-access/adapters'
import { cn } from '@/lib/cn'

import { ASPECT_RATIO } from './crop-geometry'

/**
 * A saved photo, enlarged from its Menu row (a-dish-can-show-its-photo, design
 * D8; owner, 2026-11-18): the large photo customers open, and the thumbnail
 * beside the dish, one tab apart. It shows; it does not edit.
 */

type Version = 'large' | 'thumb'

const SHAPE_WORD: Record<MenuPhotoAspect, string> = {
  '4:3': 'Wide',
  '1:1': 'Square',
  '4:5': 'Tall',
}

const VERSIONS: { key: Version; label: string }[] = [
  { key: 'large', label: 'Large photo' },
  { key: 'thumb', label: 'Thumbnail' },
]

interface MenuPhotoViewerProps {
  photo: MenuItemPhoto
  dishName: string
  onClose: () => void
}

export function MenuPhotoViewer({ photo, dishName, onClose }: MenuPhotoViewerProps) {
  const [version, setVersion] = useState<Version>('large')
  const large = version === 'large'

  return (
    <Modal
      open
      onClose={onClose}
      aria-label={`Photo of ${dishName}`}
      className="m-auto w-[calc(100%-2rem)] max-w-[34rem] rounded-2xl border-on-photo-stage/20 bg-photo-stage p-4 text-on-photo-stage"
    >
      <div className="space-y-3" data-testid="menu-photo-viewer">
        <div className="flex items-start justify-between gap-3">
          <h2 className="pt-2 text-base font-bold">{dishName}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex size-[var(--size-control-phone)] shrink-0 items-center justify-center rounded-lg focus-visible:focus-ring"
          >
            <X aria-hidden size={20} />
          </button>
        </div>

        <div role="group" aria-label="Version" className="grid grid-cols-2 gap-2">
          {VERSIONS.map((choice) => (
            <button
              key={choice.key}
              type="button"
              aria-pressed={version === choice.key}
              onClick={() => setVersion(choice.key)}
              className={cn(
                'min-h-[var(--size-control-phone)] rounded-lg border px-2 text-sm font-semibold focus-visible:focus-ring',
                version === choice.key
                  ? 'border-on-photo-stage bg-on-photo-stage text-photo-stage'
                  : 'border-on-photo-stage/40 text-on-photo-stage',
              )}
            >
              {choice.label}
            </button>
          ))}
        </div>

        <img
          key={version}
          src={large ? photo.largeUrl : photo.thumbUrl}
          alt={large ? `${dishName}, large photo` : `${dishName}, thumbnail`}
          data-testid={large ? 'viewer-large' : 'viewer-thumb'}
          className={cn('mx-auto block h-auto', large ? 'rounded-xl' : 'rounded-[1.75rem]')}
          // One rule for every version (owner, 2026-11-18): the pop-up's full
          // width, unless the screen is too short for the shape, when it narrows
          // to stay in view. Set before the image loads, so nothing jumps.
          style={{
            width: `min(100%, calc(62dvh * ${large ? ASPECT_RATIO[photo.aspect] : 1}))`,
            aspectRatio: large ? ASPECT_RATIO[photo.aspect] : 1,
          }}
        />

        <p className="text-center text-sm" data-testid="viewer-caption">
          {large
            ? `${SHAPE_WORD[photo.aspect]} · opens when a customer taps the dish`
            : 'Square · beside the dish on the menu'}
        </p>
      </div>
    </Modal>
  )
}
