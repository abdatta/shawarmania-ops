## ADDED Requirements

### Requirement: A manager gives a dish a photo from the dish's own editor

While the `dish-photos` gate is on, an authorised manager SHALL add, change and
remove a dish's photo in that dish's editor, entirely through the application.

The manager SHALL choose the framing. A cropper SHALL ask for the large photo
first, in a shape the manager picks from 4:3, 1:1 and 4:5, then for the square
menu thumbnail separately; in each, the frame SHALL keep its shape while the
manager moves and zooms the photo under it, by touch, mouse or keyboard, and
the photo SHALL always cover the frame. The editor SHALL then show the
thumbnail and the large photo as the customer will see them. **Adjust** SHALL
reopen the cropper on the same photo at the framing last saved, without the
photo being picked again.

The phone SHALL prepare the files before they are sent, for quality first:
oriented upright; the large photo at up to 1600 px on its long side and the
thumbnail at 400×400, at high quality (0.92 and 0.90), never scaled up; and a
copy of the original at up to 2560 px kept only for re-cropping. Each SHALL be
WebP where the browser can encode it and JPEG otherwise. A crop too small to
look sharp when opened large SHALL be allowed with a plain warning.

The photo SHALL be saved with the dish, on **Save**, after the dish's other
fields, and a failed photo upload SHALL NOT undo those fields: the editor SHALL
say the photo was not saved and offer to retry. **Remove** SHALL take the photo
off on Save; **Cancel** SHALL discard a photo picked but not saved. Menu's item
rows SHALL show a small thumbnail beside a dish that has a photo and nothing
beside one that does not.

A dish's photo SHALL be stored apart from the dish row itself, so that adding,
changing or removing a photo does not change the menu the counter reads or
cause any counter to re-read it.

With the gate off, the editor and the item rows SHALL be as they were before
this change, and the database SHALL refuse to set or clear a photo.

#### Scenario: A manager adds a photo
- **WHEN** a manager picks a portrait camera photo for a dish, frames the large photo as 4:5 and the thumbnail on the dish's best part, and saves
- **THEN** the dish's large photo and thumbnail are exactly those framings, upright, its row shows the thumbnail, and the customer menu shows it within the cache minute

#### Scenario: A manager re-frames a saved photo
- **WHEN** a manager taps Adjust on a dish's photo
- **THEN** the cropper opens on the same photo at the saved shape and framings, and saving a new framing replaces the customer's photo without the photo being picked again

#### Scenario: The photo cannot be dragged off its frame
- **WHEN** a manager drags or zooms out as far as the cropper allows
- **THEN** the photo still covers the whole frame, with no empty edge

#### Scenario: The upload fails
- **WHEN** a manager edits a dish's price and adds a photo, and the photo upload fails
- **THEN** the new price is saved, and the editor says the photo was not saved and offers Retry

#### Scenario: The counter is not disturbed
- **WHEN** a photo is added, changed or removed
- **THEN** no counter tablet re-reads its menu because of it, and the counter's menu is unchanged

#### Scenario: A biller
- **WHEN** a biller's session calls the function that sets a dish's photo, or writes to the photo bucket
- **THEN** it is refused

#### Scenario: The gate is off
- **WHEN** `dish-photos` is off
- **THEN** the dish editor has no Photo field, the item rows show no thumbnails, and a hand-crafted call to set or clear a photo is refused

### Requirement: A dish's photo belongs to its outlet, in the database and in storage

A dish's photo row SHALL belong to the dish's own outlet, and the database SHALL
refuse a row naming any other. Photo files SHALL be stored under their outlet's
folder in a private bucket, and storage policies SHALL let only the owner, and a
manager at that outlet, read, write or delete them; a path not shaped as an
outlet folder SHALL be reachable by nobody. Setting a photo SHALL be refused
unless all three of its files (large photo, thumbnail, kept original) already
exist under the dish's outlet.

#### Scenario: Another outlet's manager
- **WHEN** a manager of one outlet, by hand-crafted request, sets a photo on another outlet's dish, reads that outlet's photo rows, or uploads, reads or deletes a file under that outlet's folder
- **THEN** each is refused by the database

#### Scenario: A key with no files
- **WHEN** a request sets a dish's photo to a key whose files were never uploaded, or were uploaded under another outlet
- **THEN** it is refused
